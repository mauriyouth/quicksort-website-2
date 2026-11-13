import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { encryptApiKey, decryptApiKey, settingsReady } from "./ai-settings.ts";
import { contractFolderName } from "./documents/folders.ts";
import { ARCHIVE_FOLDER_NAME, archiveYear, archivedProjectPrefix } from "./documents/archive.ts";
import { MAX_UPLOAD_BYTES } from "./documents/storage/types.ts";
import {
  FOLDER_MIME,
  ROOT_FOLDER_NAME,
  SETTING_ID,
  createUploadSession,
  driveApi,
  ensureChildFolder,
  loadDriveSettings as loadSettings,
  serviceAccountSchema,
  settingsSchema,
  type DriveFile,
  type DriveSettings,
} from "./documents/storage/google-drive.ts";
import { browserOrigin } from "./documents/storage/origin.ts";

export { contractFolderName };

/**
 * Google Drive contract storage API. Follows the ai-settings pattern: the
 * Clerk token is forwarded to Supabase so the same RLS/admin policies apply,
 * and the Google service-account key is stored AES-256-GCM encrypted
 * (server-side key) in google_drive_settings. The Drive API is called from
 * here, never from the browser with the credentials.
 *
 * A Google service account acts as its own Drive user: the contracts root
 * folder (e.g. "Contrats_Clients") must be shared with the service-account
 * email (Editor) once, after which the API can create the per-contract
 * folders ("<Client>/<Contract>") and files inside it.
 *
 * GET    /api/google-drive — connection status (configured, root folder,
 *        service-account email, canSave).
 * PUT    /api/google-drive — save { serviceAccountJson?, rootFolderId?, peopleRootFolderId?, recruitmentRootFolderId? }
 *        (portal owners only). Without rootFolderId the single folder named
 *        "Contrats_Clients" is looked up at save time — which also proves the
 *        share works. Without serviceAccountJson the saved key and root are
 *        kept. peopleRootFolderId is the HR documents folder (by ID only —
 *        it must be shared with HR alone); a saved one is kept when omitted.
 *        recruitmentRootFolderId is the candidate CVs folder (same rules).
 *        companyRootFolderId holds the company's own papers (Operations → Admin).
 *        templatesRootFolderId holds the Google Doc contract templates.
 * DELETE /api/google-drive — remove the saved connection (portal owners only).
 * POST   /api/google-drive — Drive actions (admins):
 *        { action: "prepare-upload", projectId, fileName, mimeType, size }
 *          Finds (or creates) the project's "<Client>/<Title>" folder under
 *          the root, links it on sales_projects, and returns a resumable
 *          upload URL plus the folder. The browser PUTs the file bytes to
 *          that URL directly (serverless request bodies are too small for
 *          contract PDFs, and the session URL carries its own authorization).
 *        { action: "confirm-upload", projectId, fileId }
 *          Reads back the uploaded file and links the folder if not linked.
 *        { action: "list-files", folderId } — the folder contents.
 *        { action: "delete-file", fileId } — move a file to the Drive trash.
 */
type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): Response };

/** Accepts a bare folder ID or a pasted Drive folder URL (…/folders/<id>, ?id=<id>). */
const folderIdInput = z
  .string()
  .trim()
  .max(500)
  .transform(value => value.match(/\/folders\/([\w-]+)/)?.[1] || value.match(/[?&]id=([\w-]+)/)?.[1] || value)
  .pipe(z.string().max(200).regex(/^[\w-]*$/, "Paste the folder ID or the folder's Drive URL."));

const saveSchema = z.object({
  // Omitted: keep the saved key and its contracts root (e.g. to set the HR folder only).
  serviceAccountJson: z.string().trim().max(50000).optional(),
  rootFolderId: folderIdInput.optional(),
  peopleRootFolderId: folderIdInput.optional(),
  recruitmentRootFolderId: folderIdInput.optional(),
  companyRootFolderId: folderIdInput.optional(),
  templatesRootFolderId: folderIdInput.optional(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare-upload"),
    projectId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(300),
    mimeType: z.string().max(200).optional().default(""),
    size: z.number().int().min(0).max(MAX_UPLOAD_BYTES),
  }),
  z.object({
    action: z.literal("confirm-upload"),
    projectId: z.string().uuid(),
    fileId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("list-files"),
    folderId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("delete-file"),
    fileId: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("archive-folder"),
    projectId: z.string().uuid(),
    /** true: move into archived/<year>; false: back to the contracts root. */
    archived: z.boolean(),
  }),
]);


/**
 * Moves an archived project's contract folder into archived/<year>, or back to
 * the root on restore. Folders are cached by id, so links keep working. No
 * folder yet (nothing filed): nothing to move.
 */
async function placeContractFolder(client: SupabaseClient, sa: DriveSettings, projectId: string, archived: boolean) {
  const project = await client.from("sales_projects").select("id,end_date,drive_folder_id").eq("id", projectId).single();
  if (project.error || !project.data) throw new Error("Project not found.");
  const row = project.data as { id: string; end_date: string | null; drive_folder_id: string | null };
  let folderId = row.drive_folder_id;
  if (!folderId) {
    const cached = await client
      .from("document_folders")
      .select("provider_folder_id")
      .eq("storage_provider", "gdrive")
      .eq("owner_kind", "project")
      .eq("owner_id", projectId)
      .eq("folder_code", "")
      .maybeSingle();
    if (cached.error) throw cached.error;
    folderId = (cached.data as { provider_folder_id?: string } | null)?.provider_folder_id || null;
  }
  if (!folderId) return { moved: false, reason: "no-folder" as const };
  const target = archived
    ? (await ensureChildFolder(sa, (await ensureChildFolder(sa, sa.root_folder_id, ARCHIVE_FOLDER_NAME)).id, archiveYear(row.end_date))).id
    : sa.root_folder_id;
  const current = await driveApi<{ parents?: string[] }>(sa, `/files/${folderId}`, { query: { fields: "id,parents", supportsAllDrives: "true" } });
  const parents = current.parents || [];
  if (parents.length === 1 && parents[0] === target) return { moved: false, reason: "in-place" as const, folderId, parentId: target };
  await driveApi(sa, `/files/${folderId}`, {
    method: "PATCH",
    query: { addParents: target, removeParents: parents.join(","), fields: "id,parents", supportsAllDrives: "true" },
    body: {},
  });
  return { moved: true, folderId, parentId: target };
}

/** Loads the project and its client name, and links the contract folder when new. */
async function projectContractFolder(
  client: SupabaseClient,
  sa: DriveSettings,
  projectId: string,
): Promise<{ project: { id: string; title: string; drive_folder_id: string | null; drive_folder_name: string | null; drive_folder_link: string | null }; folder: DriveFile }> {
  const project = await client
    .from("sales_projects")
    .select("id,title,client_id,drive_folder_id,drive_folder_name,drive_folder_link")
    .eq("id", projectId)
    .single();
  if (project.error || !project.data) throw new Error("Project not found.");
  const row = project.data as { id: string; title: string; client_id: string; drive_folder_id: string | null; drive_folder_name: string | null; drive_folder_link: string | null };
  let folder: DriveFile | null = row.drive_folder_id
    ? { id: row.drive_folder_id, name: row.drive_folder_name || "", mimeType: FOLDER_MIME, webViewLink: row.drive_folder_link || undefined }
    : null;
  if (!folder) {
    const clientRow = await client.from("sales_clients").select("id,name").eq("id", row.client_id).single();
    const clientName = clientRow.data?.name || "Client";
    // An archived project's first contract opens its folder under archived/<year>.
    let parentId = sa.root_folder_id;
    for (const name of await archivedProjectPrefix(client, row.id)) parentId = (await ensureChildFolder(sa, parentId, name)).id;
    folder = await ensureChildFolder(sa, parentId, contractFolderName(clientName, row.title));
    const patch = {
      drive_folder_id: folder.id,
      drive_folder_name: folder.name,
      drive_folder_link: folder.webViewLink || null,
      updated_at: new Date().toISOString(),
    };
    const saved = await client.from("sales_projects").update(patch).eq("id", row.id).select("id").single();
    if (saved.error) throw saved.error;
  }
  return { project: { ...row, drive_folder_id: folder.id, drive_folder_name: folder.name, drive_folder_link: folder.webViewLink || null }, folder };
}

export function createGoogleDriveHandler(deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "PUT", "DELETE", "POST"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, PUT, DELETE, POST");
      return res.status(405).json({ error: "Method not allowed." });
    }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer "))
      return res.status(401).json({ error: "Sign in to manage Google Drive contracts." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin")
        return res.status(403).json({ error: "Admin access is required." });

      if (req.method === "GET") {
        const { data, error } = await client
          .from("google_drive_settings")
          .select("encrypted_credentials,updated_at")
          .eq("id", SETTING_ID)
          .maybeSingle();
        if (error && !["42P01", "PGRST205"].includes(String(error.code || ""))) throw error;
        if (error || !data) return res.status(200).json({ configured: false, updatedAt: null, canSave: settingsReady() });
        let settings: DriveSettings;
        try {
          settings = settingsSchema.parse(JSON.parse(decryptApiKey(data.encrypted_credentials)));
        } catch {
          return res.status(200).json({ configured: true, unreadable: true, updatedAt: data.updated_at, canSave: settingsReady() });
        }
        return res.status(200).json({
          configured: true,
          updatedAt: data.updated_at,
          canSave: settingsReady(),
          serviceAccountEmail: settings.client_email,
          rootFolderId: settings.root_folder_id,
          rootFolderName: settings.root_folder_name,
          peopleRootFolderId: settings.people_root_folder_id || null,
          peopleRootFolderName: settings.people_root_folder_name || null,
          recruitmentRootFolderId: settings.recruitment_root_folder_id || null,
          recruitmentRootFolderName: settings.recruitment_root_folder_name || null,
          companyRootFolderId: settings.company_root_folder_id || null,
          companyRootFolderName: settings.company_root_folder_name || null,
          templatesRootFolderId: settings.templates_root_folder_id || null,
          templatesRootFolderName: settings.templates_root_folder_name || null,
        });
      }

      if (req.method === "PUT" || req.method === "DELETE") {
        const owner = await client.from("portal_owners").select("user_id").eq("user_id", identity.data).maybeSingle();
        if (owner.error || !owner.data)
          return res.status(403).json({ error: "Only portal owners can manage the Google Drive connection." });
      }

      if (req.method === "DELETE") {
        const result = await client.from("google_drive_settings").delete().eq("id", SETTING_ID);
        if (result.error) throw result.error;
        return res.status(200).json({ saved: false });
      }

      if (req.method === "PUT") {
        if (!settingsReady())
          return res.status(503).json({ error: "Set AI_SETTINGS_ENCRYPTION_KEY on the server before saving credentials." });
        const parsed = saveSchema.safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: "Paste the service-account JSON key (and optionally the root folder ID)." });
        const saved = await loadSettings(client).catch(() => null);
        let account: { client_email: string; private_key: string };
        if (parsed.data.serviceAccountJson) {
          let rawAccount: unknown;
          try {
            rawAccount = JSON.parse(parsed.data.serviceAccountJson);
          } catch {
            return res.status(400).json({ error: "The service-account key is not valid JSON. Copy the whole key file contents." });
          }
          const checked = serviceAccountSchema.safeParse(rawAccount);
          if (!checked.success)
            return res.status(400).json({ error: "The JSON key has no client_email/private_key. Export a service-account key from Google Cloud (IAM → Service Accounts → Keys)." });
          account = checked.data;
        } else if (saved) {
          account = { client_email: saved.client_email, private_key: saved.private_key };
        } else {
          return res.status(400).json({ error: "Paste the service-account JSON key (and optionally the root folder ID)." });
        }

        const probe: DriveSettings = {
          ...account,
          // A kept key keeps its root; a new key resolves it again (and proves the share).
          root_folder_id: parsed.data.rootFolderId || (!parsed.data.serviceAccountJson && saved ? saved.root_folder_id : ""),
          root_folder_name: "",
        };
        let root: DriveFile;
        if (probe.root_folder_id) {
          root = await driveApi<DriveFile>(probe, `/files/${probe.root_folder_id}`, {
            query: { fields: "id,name,webViewLink", supportsAllDrives: "true" },
          });
        } else {
          // No explicit ID: use the single "Contrats_Clients" folder. The
          // lookup doubles as the share check — it only succeeds when the
          // folder is already shared with the service account.
          const matches = await driveApi<{ files?: DriveFile[] }>(probe, "/files", {
            query: {
              q: `mimeType='${FOLDER_MIME}' and name='${ROOT_FOLDER_NAME}' and trashed=false`,
              fields: "files(id,name,webViewLink)",
              pageSize: "10",
              supportsAllDrives: "true",
              includeItemsFromAllDrives: "true",
            },
          });
          const folders = matches.files || [];
          if (!folders.length)
            throw new Error(
              `No "${ROOT_FOLDER_NAME}" folder is visible to ${account.client_email}. Share your Drive contracts folder with the service-account email (Editor), then retry.`,
            );
          if (folders.length > 1)
            throw new Error(`Several "${ROOT_FOLDER_NAME}" folders are visible — pass the root folder ID explicitly.`);
          root = folders[0];
        }
        const peopleId = parsed.data.peopleRootFolderId || saved?.people_root_folder_id || "";
        if (peopleId && peopleId === root.id)
          return res.status(400).json({ error: "The HR documents folder must be separate from the contracts root — it holds identity documents." });
        const people = peopleId
          ? await driveApi<DriveFile>(probe, `/files/${peopleId}`, { query: { fields: "id,name", supportsAllDrives: "true" } })
          : null;
        const recruitmentId = parsed.data.recruitmentRootFolderId || saved?.recruitment_root_folder_id || "";
        if (recruitmentId && (recruitmentId === root.id || recruitmentId === people?.id))
          return res.status(400).json({ error: "The candidate CVs folder must be separate from the contracts and HR documents folders." });
        // Looking the folder up proves it is shared with the service account.
        const recruitment = recruitmentId
          ? await driveApi<DriveFile>(probe, `/files/${recruitmentId}`, { query: { fields: "id,name", supportsAllDrives: "true" } })
          : null;
        const companyId = parsed.data.companyRootFolderId || saved?.company_root_folder_id || "";
        if (companyId && (companyId === root.id || companyId === people?.id || companyId === recruitment?.id))
          return res.status(400).json({ error: "The company documents folder must be separate from the contracts, HR and CV folders." });
        const company = companyId
          ? await driveApi<DriveFile>(probe, `/files/${companyId}`, { query: { fields: "id,name", supportsAllDrives: "true" } })
          : null;
        const templatesId = parsed.data.templatesRootFolderId || saved?.templates_root_folder_id || "";
        if (templatesId && (templatesId === people?.id || templatesId === recruitment?.id))
          return res.status(400).json({ error: "The templates folder must be separate from the HR documents and CV folders." });
        const templates = templatesId
          ? await driveApi<DriveFile>(probe, `/files/${templatesId}`, { query: { fields: "id,name", supportsAllDrives: "true" } })
          : null;
        const settings: DriveSettings = {
          ...account,
          root_folder_id: root.id,
          root_folder_name: root.name || ROOT_FOLDER_NAME,
          ...(people ? { people_root_folder_id: people.id, people_root_folder_name: people.name } : {}),
          ...(recruitment ? { recruitment_root_folder_id: recruitment.id, recruitment_root_folder_name: recruitment.name } : {}),
          ...(company ? { company_root_folder_id: company.id, company_root_folder_name: company.name } : {}),
          ...(templates ? { templates_root_folder_id: templates.id, templates_root_folder_name: templates.name } : {}),
        };
        const result = await client.from("google_drive_settings").upsert(
          { id: SETTING_ID, encrypted_credentials: encryptApiKey(JSON.stringify(settings)), updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
        if (result.error) throw result.error;
        return res.status(200).json({ saved: true, rootFolderName: settings.root_folder_name, peopleRootFolderName: settings.people_root_folder_name || null, recruitmentRootFolderName: settings.recruitment_root_folder_name || null, companyRootFolderName: settings.company_root_folder_name || null, templatesRootFolderName: settings.templates_root_folder_name || null, serviceAccountEmail: settings.client_email });
      }

      // POST — Drive actions (admins).
      const sa = await loadSettings(client);
      if (!sa) return res.status(503).json({ error: "Connect the Google Drive service account first (Settings → Google Drive contracts)." });
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Unknown Google Drive action." });
      const action = parsed.data;

      if (action.action === "list-files") {
        const body = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
          query: {
            q: `'${action.folderId}' in parents and trashed=false`,
            orderBy: "name",
            pageSize: "200",
            fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          },
        });
        return res.status(200).json({ files: body.files || [] });
      }

      if (action.action === "delete-file") {
        await driveApi(sa, `/files/${action.fileId}`, { method: "DELETE", query: { supportsAllDrives: "true" } });
        return res.status(200).json({ deleted: true });
      }

      if (action.action === "archive-folder")
        return res.status(200).json(await placeContractFolder(client, sa, action.projectId, action.archived));

      const { folder } = await projectContractFolder(client, sa, action.projectId);

      if (action.action === "prepare-upload") {
        const uploadUrl = await createUploadSession(sa, { name: action.fileName, mimeType: action.mimeType, size: action.size }, folder.id, browserOrigin(req));
        return res.status(200).json({ uploadUrl, folder });
      }

      // confirm-upload — the folder is already linked by prepare-upload;
      // this just reads the file back so the UI can show the fresh entry.
      const file = await driveApi<DriveFile>(sa, `/files/${action.fileId}`, {
        query: { fields: "id,name,mimeType,size,modifiedTime,webViewLink", supportsAllDrives: "true" },
      });
      return res.status(200).json({ file, folder });
    } catch (e) {
      // Errors with a message but no PostgREST code are user-safe (Google
      // auth/share failures); database errors stay generic.
      const err = e as { message?: string; code?: string } | null;
      if (err?.code && ["42P01", "PGRST205"].includes(String(err.code)))
        return res.status(503).json({ error: "The google_drive_settings table is missing. Apply the 20261023090000_google_drive_contracts migration (supabase db push) and retry." });
      if (err?.message && !err.code) return res.status(502).json({ error: err.message });
      return res.status(502).json({ error: "The Google Drive request could not be completed. Please try again." });
    }
  };
}
