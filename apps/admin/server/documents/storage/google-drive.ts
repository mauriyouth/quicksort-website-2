import { createSign, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptApiKey } from "../../ai-settings.ts";
import type { DocumentStorage, StorageFolder, StorageRoot, StoredFile } from "./types.ts";

/**
 * Google Drive implementation of DocumentStorage, calling the Drive REST API
 * with a service-account JWT. A service account acts as its own Drive user:
 * each root folder must be shared with its email (Editor) once.
 *
 * Two roots: the clients root (e.g. "Contrats_Clients", shared with sales
 * admins) and an optional people root for HR documents, which must stay
 * restricted to HR — never share it with the whole domain.
 */
export const SETTING_ID = "connection";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const ROOT_FOLDER_NAME = "Contrats_Clients";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
const MULTIPART_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const API_BASE = "https://www.googleapis.com/drive/v3";
export const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,parents,sha256Checksum";

export const serviceAccountSchema = z.object({
  client_email: z.string().trim().min(3).max(300),
  private_key: z.string().min(1).max(20000),
});

export const settingsSchema = serviceAccountSchema.extend({
  root_folder_id: z.string().min(1).max(200),
  root_folder_name: z.string().max(500),
  people_root_folder_id: z.string().min(1).max(200).optional(),
  people_root_folder_name: z.string().max(500).optional(),
  /** Candidate CVs (hiring pipeline): <root>/<year>/<position>/<candidate>.pdf. */
  recruitment_root_folder_id: z.string().min(1).max(200).optional(),
  recruitment_root_folder_name: z.string().max(500).optional(),
});

export type DriveSettings = z.infer<typeof settingsSchema>;
type ServiceAccount = Pick<DriveSettings, "client_email" | "private_key">;
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  sha256Checksum?: string;
};

const base64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

/** Short-lived access tokens are cached per service account until expiry. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function serviceJwt(sa: ServiceAccount) {
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

async function driveToken(sa: ServiceAccount) {
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
  if (/storageQuotaExceeded|do not have storage quota/i.test(message))
    return new Error(
      `Google Drive refuses the upload: a service account has no storage quota, so files must live in a Shared Drive, not a personal "My Drive" folder. Move the "${ROOT_FOLDER_NAME}" folder into a Shared Drive and add ${sa.client_email} as a DIRECT member (Content manager) — group membership is not enough, the Drive quota check ignores groups for service accounts. Add it via the Drive API (POST /drive/v3/files/<driveId>/permissions as a shared-drive Manager) or Google Cloud Console, then re-save the connection.`,
    );
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

async function failure(response: globalThis.Response, sa: ServiceAccount) {
  let message = "";
  try { message = ((await response.json()) as { error?: { message?: string } })?.error?.message || ""; } catch { /* bare status */ }
  return driveError(response.status, message, sa);
}

export async function driveApi<T>(sa: ServiceAccount, path: string, opts: { method?: string; query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
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
  if (!response.ok) throw await failure(response, sa);
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

/** Query escaping for Drive's name filter. */
const escapeName = (name: string) => name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function findFolder(sa: ServiceAccount, parentId: string, name: string): Promise<DriveFile | null> {
  const body = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
    query: {
      q: `mimeType='${FOLDER_MIME}' and name='${escapeName(name)}' and '${parentId}' in parents and trashed=false`,
      fields: "files(id,name,webViewLink)",
      pageSize: "10",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    },
  });
  return body.files?.[0] || null;
}

export async function ensureChildFolder(sa: ServiceAccount, parentId: string, name: string): Promise<DriveFile> {
  const existing = await findFolder(sa, parentId, name);
  if (existing) return existing;
  return driveApi<DriveFile>(sa, "/files", {
    method: "POST",
    query: { fields: "id,name,webViewLink", supportsAllDrives: "true" },
    body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
}

/**
 * A service account has no quota: a file only lands if the target folder
 * itself sits in a Shared Drive. Folder IDs are cached (settings, project
 * rows), so a folder linked before a move can still be a My Drive one —
 * name it instead of surfacing Google's generic storageQuotaExceeded.
 */
async function assertSharedDriveFolder(sa: ServiceAccount, folderId: string) {
  const target = await driveApi<{ id: string; name?: string; driveId?: string; webViewLink?: string }>(sa, `/files/${folderId}`, {
    query: { fields: "id,name,driveId,webViewLink", supportsAllDrives: "true" },
  });
  if (!target.driveId)
    throw new Error(
      `The upload folder "${target.name || folderId}" (${target.webViewLink || folderId}) is in a personal My Drive, not a Shared Drive, so the service account cannot store files there. Move it into the Shared Drive (or unlink it so a new one is created under the root) and retry.`,
    );
}

/**
 * Uploads bytes the server already holds (single multipart request — fine for
 * files up to ~10 MB). appProperties are private key/value tags Drive can
 * search on (e.g. the HR person a CV belongs to).
 */
export async function uploadFileContent(
  sa: ServiceAccount,
  file: { name: string; mimeType: string; data: Buffer; appProperties?: Record<string, string> },
  folderId: string,
): Promise<DriveFile> {
  await assertSharedDriveFolder(sa, folderId);
  const token = await driveToken(sa);
  const boundary = `qs-${randomUUID()}`;
  const metadata = { name: file.name, parents: [folderId], mimeType: file.mimeType, ...(file.appProperties ? { appProperties: file.appProperties } : {}) };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`, "utf8"),
    file.data,
    Buffer.from(`\r\n--${boundary}--`, "utf8"),
  ]);
  const response = await fetch(`${MULTIPART_URL}&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!response.ok) throw await failure(response, sa);
  return (await response.json()) as DriveFile;
}

/** Opens a resumable upload session; the browser streams the bytes to the returned URL. */
export async function createUploadSession(sa: ServiceAccount, file: { name: string; mimeType: string; size: number }, folderId: string, origin?: string | null) {
  await assertSharedDriveFolder(sa, folderId);
  const token = await driveToken(sa);
  const response = await fetch(`${UPLOAD_URL}&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": file.mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(file.size),
      // Google only answers the browser's PUT to the session URL with CORS
      // headers when the session was opened with that browser's Origin.
      // Without it the bytes land but the response (with the file id) is
      // unreadable: "CORS Missing Allow Origin".
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name: file.name, parents: [folderId] }),
  });
  if (!response.ok) throw await failure(response, sa);
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return an upload session URL.");
  return uploadUrl;
}

export async function loadDriveSettings(client: SupabaseClient): Promise<DriveSettings | null> {
  const { data, error } = await client
    .from("google_drive_settings")
    .select("encrypted_credentials")
    .eq("id", SETTING_ID)
    .maybeSingle();
  // Existing installations work before the new migration is applied.
  if (error && !["42P01", "PGRST205"].includes(String(error.code || ""))) throw error;
  if (error || !data) return null;
  return decryptDriveSettings(data.encrypted_credentials);
}

/** Decrypts and validates the saved ciphertext; the one place that reads it. */
export function decryptDriveSettings(encrypted: string): DriveSettings {
  try {
    return settingsSchema.parse(JSON.parse(decryptApiKey(encrypted)));
  } catch {
    throw new Error("The saved Google Drive credentials could not be read. Save them again.");
  }
}

export const driveStorageFromEncrypted = (encrypted: string): DocumentStorage => createDriveStorage(decryptDriveSettings(encrypted));

const toFolder = (file: DriveFile): StorageFolder => ({ id: file.id, name: file.name, link: file.webViewLink || null });
const toStoredFile = (file: DriveFile): StoredFile => ({
  id: file.id,
  name: file.name,
  mimeType: file.mimeType,
  size: file.size === undefined ? null : Number(file.size),
  modifiedAt: file.modifiedTime || null,
  link: file.webViewLink || null,
  folderIds: file.parents || [],
  sha256: file.sha256Checksum?.toLowerCase() || null,
  isFolder: file.mimeType === FOLDER_MIME,
});

export function createDriveStorage(sa: DriveSettings): DocumentStorage {
  const rootId = (root: StorageRoot) => {
    if (root === "clients") return sa.root_folder_id;
    if (!sa.people_root_folder_id)
      throw new Error("No HR documents folder is connected. Set the people root folder in Settings → Google Drive (shared with HR only).");
    return sa.people_root_folder_id;
  };
  return {
    provider: "gdrive",
    async ensureFolder(root, path) {
      let folder: StorageFolder = { id: rootId(root), name: root === "clients" ? sa.root_folder_name : sa.people_root_folder_name || "", link: null };
      for (const name of path) folder = toFolder(await ensureChildFolder(sa, folder.id, name));
      return folder;
    },
    async ensureChild(parent, name) {
      return toFolder(await ensureChildFolder(sa, parent.id, name));
    },
    async prepareUpload(folder, file, origin) {
      const uploadUrl = await createUploadSession(sa, file, folder.id, origin);
      // Single-chunk resumable upload; Drive answers the PUT with { id, … }.
      return {
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": file.mimeType || "application/octet-stream" },
        fileId: null,
      };
    },
    async getFile(fileId) {
      return toStoredFile(await driveApi<DriveFile>(sa, `/files/${fileId}`, { query: { fields: FILE_FIELDS, supportsAllDrives: "true" } }));
    },
    async listFiles(folderId) {
      const body = await driveApi<{ files?: DriveFile[] }>(sa, "/files", {
        query: { q: `'${folderId}' in parents and trashed=false`, orderBy: "name", pageSize: "200", fields: `files(${FILE_FIELDS})`, supportsAllDrives: "true", includeItemsFromAllDrives: "true" },
      });
      return (body.files || []).map(toStoredFile);
    },
    async download(fileId) {
      const token = await driveToken(sa);
      const response = await fetch(`${API_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw await failure(response, sa);
      return response;
    },
    async move(fileId, fromFolderId, toFolderId) {
      await driveApi(sa, `/files/${fileId}`, {
        method: "PATCH",
        query: { addParents: toFolderId, removeParents: fromFolderId, supportsAllDrives: "true", fields: "id" },
        body: {},
      });
    },
    async trash(fileId) {
      await driveApi(sa, `/files/${fileId}`, { method: "PATCH", query: { supportsAllDrives: "true" }, body: { trashed: true } });
    },
  };
}
