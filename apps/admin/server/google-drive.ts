import { createSign } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptApiKey, encryptApiKey, settingsReady } from "./ai-settings.ts";

/**
 * Google Drive contract storage API. Follows the boondmanager pattern: the
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
 * PUT    /api/google-drive — save { serviceAccountJson, rootFolderId? }
 *        (portal owners only). Without rootFolderId the single folder named
 *        "Contrats_Clients" is looked up at save time — which also proves the
 *        share works.
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

const SETTING_ID = "connection";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
const API_BASE = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Contrats_Clients";
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const serviceAccountSchema = z.object({
  client_email: z.string().trim().min(3).max(300),
  private_key: z.string().min(1).max(20000),
});

const saveSchema = z.object({
  serviceAccountJson: z.string().trim().min(1).max(50000),
  rootFolderId: z.string().trim().max(200).optional(),
});

const settingsSchema = serviceAccountSchema.extend({
  root_folder_id: z.string().min(1).max(200),
  root_folder_name: z.string().max(500),
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
]);

type DriveSettings = z.infer<typeof settingsSchema>;
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

/** Short-lived access tokens are cached per service account until expiry. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function serviceJwt(sa: Pick<DriveSettings, "client_email" | "private_key">) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: sa.client_email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    signature = signer.sign(sa.private_key, "base64url");
  } catch {
    throw new Error("The service-account private_key is not a valid RSA key. Paste the whole JSON key file, including -----BEGIN PRIVATE KEY-----.");
  }
  return `${header}.${payload}.${signature}`;
}

async function driveToken(sa: Pick<DriveSettings, "client_email" | "private_key">) {
  const hit = tokenCache.get(sa.client_email);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: serviceJwt(sa),
    }),
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json())?.error?.description || ""; } catch { /* keep the generic message */ }
    throw new Error(
      detail
        ? `Google refused the service-account credentials: ${detail}`
        : "Google refused the service-account credentials (HTTP " + response.status + "). Check that the JSON key belongs to an existing service account and that the Google Drive API is enabled for its project.",
    );
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google did not return an access token for the service account.");
  const seconds = Number(body.expires_in) || 3600;
  tokenCache.set(sa.client_email, { token: body.access_token, expiresAt: Date.now() + seconds * 1000 });
  return body.access_token;
}

function driveError(status: number, message: string, sa: Pick<DriveSettings, "client_email">) {
  if (status === 401 || status === 403)
    return new Error(
      `Google Drive denied access for ${sa.client_email}. Share the contracts root folder with that service-account email (Editor) and retry.${message ? ` (${message})` : ""}`,
    );
  if (status === 404)
    return new Error(
      `The Drive folder was not found or is not shared with ${sa.client_email}.${message ? ` (${message})` : ""}`,
    );
  return new Error(message ? `Google Drive answered ${status}: ${message}` : `Google Drive answered with status ${status}.`);
}

async function driveApi<T>(sa: DriveSettings, path: string, opts: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const token = await driveToken(sa);
  const suffix = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const response = await fetch(`${API_BASE}${path}${suffix}`, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!response.ok) {
    let message = "";
    try { message = ((await response.json()) as { error?: { message?: string } })?.error?.message || ""; } catch { /* bare status */ }
    throw driveError(response.status, message, sa);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

/** Query escaping for Drive's name filter. */
const escapeName = (name: string) => name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findFolder(sa: DriveSettings, parentId: string, name: string): Promise<DriveFile | null> {
  const body = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
    query: {
      q: `mimeType='${FOLDER_MIME}' and name='${escapeName(name)}' and '${parentId}' in parents and trashed=false`,
      fields: "files(id,name,webViewLink)",
      pageSize: "10",
    },
  });
  return body.files?.[0] || null;
}

/** Drive allows "/" inside a name; the team names contract folders "<Client>/<Contract>". */
const cleanPart = (value: string) => value.replace(/\s+/g, " ").replace(/^\/+|\/+$/g, "").trim();
export const contractFolderName = (clientName: string, title: string) =>
  (`${cleanPart(clientName)}/${cleanPart(title)}`.slice(0, 200).trim()) || "Contract";

async function ensureContractFolder(sa: DriveSettings, name: string): Promise<DriveFile> {
  const existing = await findFolder(sa, sa.root_folder_id, name);
  if (existing) return existing;
  return driveApi<DriveFile>(sa, "/files", {
    method: "POST",
    query: { fields: "id,name,webViewLink", supportsAllDrives: "true" },
    body: { name, mimeType: FOLDER_MIME, parents: [sa.root_folder_id] },
  });
}

/** Opens a resumable upload session; the browser streams the bytes to the returned URL. */
async function createUploadSession(sa: DriveSettings, file: { name: string; mimeType: string; size: number }, folderId: string) {
  const token = await driveToken(sa);
  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
    },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!response.ok) {
    let message = "";
    try { message = ((await response.json()) as { error?: { message?: string } })?.error?.message || ""; } catch { /* bare status */ }
    throw driveError(response.status, message, sa);
  }
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return an upload session URL.");
  return uploadUrl;
}

async function loadSettings(client: SupabaseClient): Promise<DriveSettings | null> {
  const { data, error } = await client
    .from("google_drive_settings")
    .select("encrypted_credentials")
    .eq("id", SETTING_ID)
    .maybeSingle();
  // Existing installations work before the new migration is applied.
  if (error && !["42P01", "PGRST205"].includes(String(error.code || ""))) throw error;
  if (error || !data) return null;
  try {
    return settingsSchema.parse(JSON.parse(decryptApiKey(data.encrypted_credentials)));
  } catch {
    throw new Error("The saved Google Drive credentials could not be read. Save them again.");
  }
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
    folder = await ensureContractFolder(sa, contractFolderName(clientName, row.title));
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
          rootFolderName: settings.root_folder_name,
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
        let rawAccount: unknown;
        try {
          rawAccount = JSON.parse(parsed.data.serviceAccountJson);
        } catch {
          return res.status(400).json({ error: "The service-account key is not valid JSON. Copy the whole key file contents." });
        }
        const account = serviceAccountSchema.safeParse(rawAccount);
        if (!account.success)
          return res.status(400).json({ error: "The JSON key has no client_email/private_key. Export a service-account key from Google Cloud (IAM → Service Accounts → Keys)." });

        const probe: DriveSettings = {
          ...account.data,
          root_folder_id: parsed.data.rootFolderId || "",
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
            },
          });
          const folders = matches.files || [];
          if (!folders.length)
            throw new Error(
              `No "${ROOT_FOLDER_NAME}" folder is visible to ${account.data.client_email}. Share your Drive contracts folder with the service-account email (Editor), then retry.`,
            );
          if (folders.length > 1)
            throw new Error(`Several "${ROOT_FOLDER_NAME}" folders are visible — pass the root folder ID explicitly.`);
          root = folders[0];
        }
        const settings: DriveSettings = {
          ...account.data,
          root_folder_id: root.id,
          root_folder_name: root.name || ROOT_FOLDER_NAME,
        };
        const result = await client.from("google_drive_settings").upsert(
          { id: SETTING_ID, encrypted_credentials: encryptApiKey(JSON.stringify(settings)), updated_at: new Date().toISOString() },
          { onConflict: "id" },
        );
        if (result.error) throw result.error;
        return res.status(200).json({ saved: true, rootFolderName: settings.root_folder_name, serviceAccountEmail: settings.client_email });
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
          },
        });
        return res.status(200).json({ files: body.files || [] });
      }

      if (action.action === "delete-file") {
        await driveApi(sa, `/files/${action.fileId}`, { method: "DELETE" });
        return res.status(200).json({ deleted: true });
      }

      const { folder } = await projectContractFolder(client, sa, action.projectId);

      if (action.action === "prepare-upload") {
        const uploadUrl = await createUploadSession(sa, { name: action.fileName, mimeType: action.mimeType, size: action.size }, folder.id);
        return res.status(200).json({ uploadUrl, folder });
      }

      // confirm-upload — the folder is already linked by prepare-upload;
      // this just reads the file back so the UI can show the fresh entry.
      const file = await driveApi<DriveFile>(sa, `/files/${action.fileId}`, {
        query: { fields: "id,name,mimeType,size,modifiedTime,webViewLink" },
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
