import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { FOLDER_LABELS, datedSubfolder, documentFileName, folderPath, type FolderOwner } from "./folders.ts";
import { createDriveStorage, driveStorageFromEncrypted, loadDriveSettings } from "./storage/google-drive.ts";
import { MAX_UPLOAD_BYTES, type DocumentStorage, type StorageFolder, type StoredFile } from "./storage/types.ts";
import { browserOrigin } from "./storage/origin.ts";
import { archivedProjectPrefix } from "./archive.ts";

/**
 * Document registry API. Only what needs storage credentials lives here;
 * listing documents and alerts, and editing metadata, go straight to Supabase
 * under RLS. The Clerk token is forwarded so the same policies apply: HR
 * operators manage person documents, admins everything.
 *
 * POST /api/documents
 *   { action: "prepare-upload", owner, typeCode, title, fileName, mimeType, size, expiresOn? }
 *     Resolves the owner's folder (cached in document_folders) and opens an
 *     upload the browser PUTs the bytes to. Returns { upload, folder, fileName }.
 *   { action: "register", owner, folderId, fileId, typeCode, title, …dates, supersedes? }
 *     Checks the file landed in the owner's folder and registers it through
 *     register_document (renewals supersede atomically). An upload that cannot
 *     be registered is moved to the trash so nothing untracked stays behind.
 *   { action: "list-unfiled", owner }
 *     Files sitting loose in the owner's folder with no registry row — the
 *     contracts uploaded before the registry existed.
 *   { action: "file-existing", owner, fileId, typeCode, title, … }
 *     Moves such a file into its type's subfolder and registers it (moved
 *     back if the registration is refused).
 *   { action: "download", documentId }
 *     Streams the file (person documents are logged to hr_events first).
 *     Files above the inline limit answer { link } instead.
 *   { action: "download-own-payslip", documentId }
 *     Any signed-in role. payslip_download_source only answers for an active
 *     payslip of a person linked to the caller (and logs the access itself).
 *   { action: "move-payslip", documentId, toPersonId, requestId? }
 *     HR. Moves a wrongly filed payslip to another person's folder; move_payslip
 *     archives the old row and registers the new one atomically.
 */
type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};
type Response = {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): Response;
  send(body: Buffer): Response;
};

/** Serverless responses are capped around 4.5 MB; scans and PDFs fit well below. */
const INLINE_DOWNLOAD_BYTES = 4 * 1024 * 1024;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ownerSchema = z.object({ kind: z.enum(["person", "client", "project"]), id: uuid });
const typeCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
const title = z.string().trim().min(1).max(200);

/** What a document says about itself; shared by fresh uploads and filed legacy files. */
const metadataFields = {
  owner: ownerSchema,
  fileId: z.string().min(1).max(1024),
  typeCode,
  title,
  issuedOn: isoDate.nullish(),
  validFrom: isoDate.nullish(),
  expiresOn: isoDate.nullish(),
  notes: z.string().max(2000).optional(),
  parentDocumentId: uuid.nullish(),
  extensionId: uuid.nullish(),
  supersedes: uuid.nullish(),
  requestId: uuid.optional(),
};

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare-upload"),
    owner: ownerSchema,
    typeCode,
    title,
    fileName: z.string().trim().min(1).max(300),
    mimeType: z.string().max(200).optional().default(""),
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    expiresOn: isoDate.nullish(),
    issuedOn: isoDate.nullish(),
    validFrom: isoDate.nullish(),
  }),
  z.object({
    action: z.literal("register"),
    folderId: z.string().min(1).max(1024),
    ...metadataFields,
  }),
  z.object({ action: z.literal("list-unfiled"), owner: ownerSchema }),
  z.object({ action: z.literal("file-existing"), ...metadataFields }),
  z.object({ action: z.literal("download"), documentId: uuid, preview: z.boolean().optional().default(false) }),
  z.object({ action: z.literal("download-own-payslip"), documentId: uuid, preview: z.boolean().optional().default(false) }),
  z.object({ action: z.literal("move-payslip"), documentId: uuid, toPersonId: uuid, requestId: uuid.optional() }),
]);

type Owner = z.infer<typeof ownerSchema>;
type Metadata = z.infer<z.ZodObject<typeof metadataFields>>;
type DocumentType = { code: string; label: string; owner_kinds: string[]; folder: string; requires_expiry: boolean };

class DocumentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function defaultStorage(client: SupabaseClient): Promise<DocumentStorage | null> {
  const settings = await loadDriveSettings(client);
  return settings ? createDriveStorage(settings) : null;
}

async function loadType(client: SupabaseClient, code: string, owner: Owner, expiresOn: string | null | undefined) {
  const { data, error } = await client.from("document_types").select("code,label,owner_kinds,folder,requires_expiry").eq("code", code).maybeSingle();
  if (error) throw error;
  const type = data as DocumentType | null;
  if (!type) throw new DocumentError(400, "Unknown document type.");
  if (!type.owner_kinds.includes(owner.kind)) throw new DocumentError(400, `${type.label} cannot be filed on a ${owner.kind}.`);
  if (type.requires_expiry && !expiresOn) throw new DocumentError(400, `${type.label} needs an expiry date.`);
  return type;
}

/** Names used for the owner's storage folder, read under the caller's RLS. */
async function folderOwner(client: SupabaseClient, owner: Owner): Promise<FolderOwner> {
  if (owner.kind === "person") {
    const { data } = await client.from("hr_people").select("full_name").eq("id", owner.id).maybeSingle();
    if (!data) throw new DocumentError(404, "Person not found.");
    return { kind: "person", fullName: data.full_name, personId: owner.id };
  }
  if (owner.kind === "client") {
    const { data } = await client.from("sales_clients").select("name").eq("id", owner.id).maybeSingle();
    if (!data) throw new DocumentError(404, "Client not found.");
    return { kind: "client", clientName: data.name };
  }
  const { data } = await client.from("sales_projects").select("title,client_id").eq("id", owner.id).maybeSingle();
  if (!data) throw new DocumentError(404, "Project not found.");
  const clientRow = await client.from("sales_clients").select("name").eq("id", data.client_id).maybeSingle();
  return { kind: "project", clientName: clientRow.data?.name || "Client", projectTitle: data.title };
}

async function cachedFolder(client: SupabaseClient, storage: DocumentStorage, owner: Owner, code: string): Promise<StorageFolder | null> {
  const { data, error } = await client
    .from("document_folders")
    .select("provider_folder_id,folder_name,folder_link")
    .eq("storage_provider", storage.provider)
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id)
    .eq("folder_code", code)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.provider_folder_id, name: data.folder_name, link: data.folder_link || null } : null;
}

/** First writer wins: a concurrent upload that created a twin folder files into the cached one. */
async function cacheFolder(client: SupabaseClient, storage: DocumentStorage, owner: Owner, code: string, folder: StorageFolder) {
  const { error } = await client.from("document_folders").upsert(
    { storage_provider: storage.provider, owner_kind: owner.kind, owner_id: owner.id, folder_code: code, provider_folder_id: folder.id, folder_name: folder.name, folder_link: folder.link || "" },
    { onConflict: "storage_provider,owner_kind,owner_id,folder_code", ignoreDuplicates: true },
  );
  if (error) throw error;
  return (await cachedFolder(client, storage, owner, code)) ?? folder;
}

/**
 * The owner's folder is found once by name, then always by its cached id —
 * renaming a client, project or person never splits their documents. Projects
 * linked by the legacy contract endpoint reuse sales_projects.drive_folder_id.
 */
async function existingBaseFolder(client: SupabaseClient, storage: DocumentStorage, owner: Owner) {
  const cached = await cachedFolder(client, storage, owner, "");
  if (cached || owner.kind !== "project" || storage.provider !== "gdrive") return cached;
  const { data } = await client.from("sales_projects").select("drive_folder_id,drive_folder_name,drive_folder_link").eq("id", owner.id).maybeSingle();
  return data?.drive_folder_id ? { id: data.drive_folder_id, name: data.drive_folder_name || "", link: data.drive_folder_link || null } : null;
}

/** `sub` nests below the type's folder (e.g. ["Navigo", "2025"]); each level is cached as "<leaf>/<sub…>". */
async function resolveFolder(client: SupabaseClient, storage: DocumentStorage, owner: Owner, typeFolder: string, sub: string[] = []) {
  const leafCode = owner.kind === "client" ? "societe" : typeFolder in FOLDER_LABELS ? typeFolder : "divers";
  const target = await cachedFolder(client, storage, owner, [leafCode, ...sub].join("/"));
  if (target) return target;
  let folder = await cachedFolder(client, storage, owner, leafCode);
  if (!folder) {
    const names = await folderOwner(client, owner);
    let base = await existingBaseFolder(client, storage, owner);
    if (!base) {
      const { root, path } = folderPath(names, "");
      // An archived project's first document opens its folder under archived/<year>.
      const prefix = owner.kind === "project" ? await archivedProjectPrefix(client, owner.id) : [];
      base = await storage.ensureFolder(root, [...prefix, ...path]);
    }
    base = await cacheFolder(client, storage, owner, "", base);
    folder = await cacheFolder(client, storage, owner, leafCode, await storage.ensureChild(base, folderPath(names, leafCode).path.at(-1)!));
  }
  const path = [leafCode];
  for (const part of sub) {
    path.push(part);
    folder = await cacheFolder(client, storage, owner, path.join("/"), await storage.ensureChild(folder, part));
  }
  return folder;
}

async function ownerFolderIds(client: SupabaseClient, storage: DocumentStorage, owner: Owner) {
  const { data, error } = await client
    .from("document_folders")
    .select("provider_folder_id")
    .eq("storage_provider", storage.provider)
    .eq("owner_kind", owner.kind)
    .eq("owner_id", owner.id);
  if (error) throw error;
  return new Set((data || []).map(row => row.provider_folder_id as string));
}

const ownerColumns = (owner: Owner) => ({
  person_id: owner.kind === "person" ? owner.id : null,
  client_id: owner.kind === "client" ? owner.id : null,
  project_id: owner.kind === "project" ? owner.id : null,
});

/**
 * Registers a stored file. On refusal the file is undone (`undo`: trash a
 * fresh upload, move a legacy file back) so storage never holds an untracked
 * copy — except on a double submit, where the first registration stands.
 */
async function registerFile(client: SupabaseClient, storage: DocumentStorage, meta: Metadata, file: StoredFile, folderId: string, undo: () => Promise<unknown>) {
  const registered = await client.rpc("register_document", {
    document: {
      owner_kind: meta.owner.kind,
      ...ownerColumns(meta.owner),
      type_code: meta.typeCode,
      title: meta.title,
      issued_on: meta.issuedOn ?? null,
      valid_from: meta.validFrom ?? null,
      expires_on: meta.expiresOn ?? null,
      notes: meta.notes ?? "",
      parent_document_id: meta.parentDocumentId ?? null,
      extension_id: meta.extensionId ?? null,
      storage_provider: storage.provider,
      provider_file_id: file.id,
      provider_folder_id: folderId,
      file_name: file.name,
      mime_type: file.mimeType,
      size_bytes: file.size,
      sha256: file.sha256,
    },
    supersedes: meta.supersedes ?? null,
    request_id: meta.requestId ?? randomUUID(),
  });
  if (!registered.error) return { status: 200, body: { document: registered.data } };
  if (registered.error.code === "23505") {
    const existing = await client.from("documents").select("*").eq("storage_provider", storage.provider).eq("provider_file_id", file.id).neq("status", "archived").maybeSingle();
    if (existing.data) return { status: 200, body: { document: existing.data } };
  }
  await undo().catch(() => undefined);
  if (registered.error.code === "P0001") return { status: 400, body: { error: registered.error.message } };
  throw registered.error;
}

const contentDisposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export function createDocumentsHandler(deps: {
  createClient: typeof createClient;
  storage?: (client: SupabaseClient) => Promise<DocumentStorage | null>;
  storageFromEncrypted?: (encrypted: string) => DocumentStorage;
} = { createClient }) {
  const storageFromCredentials = deps.storageFromEncrypted || driveStorageFromEncrypted;
  const storageFor = deps.storage || defaultStorage;
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed." });
    }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer "))
      return res.status(401).json({ error: "Sign in to manage documents." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    const parsed = actionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid document request." });
    const action = parsed.data;
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      if (action.action === "download-own-payslip") {
        const source = await client.rpc("payslip_download_source", { document_id: action.documentId });
        if (source.error) throw source.error;
        const row = (Array.isArray(source.data) ? source.data[0] : source.data) as
          | { provider_file_id: string; file_name: string; mime_type: string | null; size_bytes: number | null; storage_provider: string; encrypted_credentials: string | null }
          | null | undefined;
        if (!row) return res.status(404).json({ error: "Payslip not found." });
        if (row.storage_provider !== "gdrive" || !row.encrypted_credentials)
          return res.status(503).json({ error: "The storage holding this payslip is not connected." });
        const storage = storageFromCredentials(row.encrypted_credentials);
        if ((row.size_bytes ?? 0) > INLINE_DOWNLOAD_BYTES)
          return res.status(200).json({ link: (await storage.getFile(row.provider_file_id)).link });
        const bytes = await (await storage.download(row.provider_file_id)).arrayBuffer();
        res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
        res.setHeader("Content-Disposition", action.preview
          ? `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`
          : contentDisposition(row.file_name));
        return res.status(200).send(Buffer.from(bytes));
      }

      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      const roleName = role.error ? "" : role.data?.role;
      if (roleName !== "admin" && roleName !== "hr") return res.status(403).json({ error: "Admin or HR access is required." });
      if ("owner" in action && action.owner.kind !== "person" && roleName !== "admin")
        return res.status(403).json({ error: "Client and project documents are managed by admins." });

      if (action.action === "download") {
        const { data: doc, error } = await client
          .from("documents")
          .select("id,owner_kind,type_code,storage_provider,provider_file_id,file_name,mime_type,size_bytes")
          .eq("id", action.documentId)
          .maybeSingle();
        if (error) throw error;
        if (!doc) return res.status(404).json({ error: "Document not found." });
        // The photo loads on every visit to the person page; logging it would bury real accesses.
        if (doc.owner_kind === "person" && doc.type_code !== "PHOTO") {
          const logged = await client.rpc("log_document_access", { document_id: doc.id });
          if (logged.error) throw logged.error;
        }
        let bytes: ArrayBuffer;
        if (doc.storage_provider === "supabase") {
          const [bucket, ...rest] = String(doc.provider_file_id).split("/");
          const file = await client.storage.from(bucket).download(rest.join("/"));
          if (file.error || !file.data) throw new DocumentError(502, "The file could not be read from storage.");
          bytes = await file.data.arrayBuffer();
        } else {
          const storage = await storageFor(client);
          if (!storage || storage.provider !== doc.storage_provider)
            return res.status(503).json({ error: "The storage holding this document is not connected." });
          if ((doc.size_bytes ?? 0) > INLINE_DOWNLOAD_BYTES)
            return res.status(200).json({ link: (await storage.getFile(doc.provider_file_id)).link });
          bytes = await (await storage.download(doc.provider_file_id)).arrayBuffer();
        }
        res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
        res.setHeader("Content-Disposition", action.preview
          ? `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`
          : contentDisposition(doc.file_name));
        return res.status(200).send(Buffer.from(bytes));
      }

      const storage = await storageFor(client);
      if (!storage) return res.status(503).json({ error: "Connect Google Drive first (Settings → Google Drive)." });

      if (action.action === "move-payslip") {
        const { data: doc, error } = await client.from("documents").select("id,type_code,status,person_id,provider_file_id,provider_folder_id,valid_from,storage_provider").eq("id", action.documentId).maybeSingle();
        if (error) throw error;
        if (!doc) return res.status(404).json({ error: "Document not found." });
        if (doc.type_code !== "PAYSLIP" || doc.status !== "active" || !doc.person_id)
          return res.status(400).json({ error: "Only an active payslip can be moved." });
        if (doc.person_id === action.toPersonId) return res.status(400).json({ error: "Choose a different person." });
        if (storage.provider !== doc.storage_provider) return res.status(503).json({ error: "The storage holding this document is not connected." });
        await folderOwner(client, { kind: "person", id: action.toPersonId });
        const matricule = await client
          .from("hr_events")
          .select("employee_id,previous_state")
          .eq("person_id", doc.person_id)
          .eq("kind", "matricule_changed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (matricule.error) throw matricule.error;
        const target = await resolveFolder(client, storage, { kind: "person", id: action.toPersonId }, "bulletins", datedSubfolder("PAYSLIP", { validFrom: doc.valid_from }));
        await storage.move(doc.provider_file_id, doc.provider_folder_id, target.id);
        const moved = await client.rpc("move_payslip", { document_id: doc.id, to_person_id: action.toPersonId, to_folder_id: target.id, request_id: action.requestId ?? randomUUID() });
        if (moved.error) {
          await storage.move(doc.provider_file_id, target.id, doc.provider_folder_id).catch(() => undefined);
          if (moved.error.code === "P0001") return res.status(400).json({ error: moved.error.message });
          throw moved.error;
        }
        const previous = matricule.data as { employee_id: string | null; previous_state: string | null } | null;
        return res.status(200).json({
          document: moved.data,
          previousMatricule: previous?.employee_id && previous.previous_state ? { employeeId: previous.employee_id, value: previous.previous_state } : null,
        });
      }

      if (action.action === "prepare-upload") {
        const type = await loadType(client, action.typeCode, action.owner, action.expiresOn);
        const folder = await resolveFolder(client, storage, action.owner, type.folder, datedSubfolder(type.code, action));
        const names = await folderOwner(client, action.owner);
        const ownerName = names.kind === "person" ? names.fullName : names.kind === "client" ? names.clientName : names.projectTitle;
        const fileName = documentFileName(type.code, ownerName, action.fileName, action.title, action.validFrom);
        const upload = await storage.prepareUpload(folder, { name: fileName, mimeType: action.mimeType, size: action.size }, browserOrigin(req));
        return res.status(200).json({ upload, folder, fileName });
      }

      if (action.action === "list-unfiled") {
        const base = await existingBaseFolder(client, storage, action.owner);
        if (!base) return res.status(200).json({ files: [] });
        const [files, filed] = await Promise.all([
          storage.listFiles(base.id),
          client.from("documents").select("provider_file_id").eq("storage_provider", storage.provider).eq(`${action.owner.kind}_id`, action.owner.id),
        ]);
        if (filed.error) throw filed.error;
        const known = new Set((filed.data || []).map(row => row.provider_file_id as string));
        return res.status(200).json({ files: files.filter(file => !file.isFolder && !known.has(file.id)) });
      }

      const type = await loadType(client, action.typeCode, action.owner, action.expiresOn);

      if (action.action === "file-existing") {
        const base = await existingBaseFolder(client, storage, action.owner);
        const file = base && await storage.getFile(action.fileId);
        if (!base || !file?.folderIds.includes(base.id))
          return res.status(400).json({ error: "This file is not in the owner's Drive folder." });
        const folder = await resolveFolder(client, storage, action.owner, type.folder, datedSubfolder(type.code, action));
        await storage.move(file.id, base.id, folder.id);
        const result = await registerFile(client, storage, action, file, folder.id, () => storage.move(file.id, folder.id, base.id));
        return res.status(result.status).json(result.body);
      }

      // register — a fresh upload, in the folder prepare-upload returned.
      if (!(await ownerFolderIds(client, storage, action.owner)).has(action.folderId))
        return res.status(400).json({ error: "The upload folder does not belong to this owner." });
      const file = await storage.getFile(action.fileId);
      if (!file.folderIds.includes(action.folderId))
        return res.status(400).json({ error: "The uploaded file is not in the expected folder." });
      const result = await registerFile(client, storage, action, file, action.folderId, () => storage.trash(file.id));
      return res.status(result.status).json(result.body);
    } catch (e) {
      if (e instanceof DocumentError) return res.status(e.status).json({ error: e.message });
      // Errors with a message but no PostgREST code are user-safe (storage
      // auth/share failures); database errors stay generic.
      const err = e as { message?: string; code?: string } | null;
      if (err?.code && ["42P01", "PGRST205"].includes(String(err.code)))
        return res.status(503).json({ error: "The documents tables are missing. Apply the 20261122090000_documents migration (supabase db push) and retry." });
      if (err?.message && !err.code) return res.status(502).json({ error: err.message });
      return res.status(502).json({ error: "The document request could not be completed. Please try again." });
    }
  };
}
