import { db, getSessionToken, saveBlob, type DocumentAlert, type DocumentOwnerKind, type DocumentRecord, type DocumentTypeRecord } from "@quicksort/hr-db";

/**
 * Browser side of the document registry. Reads (documents, types, alerts,
 * folders) and metadata edits go straight to Supabase under RLS; anything
 * touching storage goes through /api/documents (apps/admin/server/documents).
 */
export type DocumentOwner = { kind: DocumentOwnerKind; id: string };
export type UnfiledFile = { id: string; name: string; mimeType: string; size: number | null; modifiedAt: string | null; link: string | null };
export type DocumentMetadata = {
  typeCode: string;
  title: string;
  issuedOn?: string | null;
  validFrom?: string | null;
  expiresOn?: string | null;
  notes?: string;
  parentDocumentId?: string | null;
  extensionId?: string | null;
  supersedes?: string | null;
};

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const token = await getSessionToken();
  if (!token) throw new Error("Sign in again to manage documents.");
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "The document request failed.");
  }
  return (response.headers.get("content-type") || "").includes("application/json")
    ? ((await response.json()) as T)
    : ((await response.blob()) as T);
}

/**
 * PUT the bytes through XHR instead of fetch: resumable upload URLs answer
 * upload progress events (fetch cannot), and an aborted XHR cancels cleanly.
 * Rejects with an AbortError when `signal` fires.
 */
function putBytes(url: string, headers: Record<string, string>, body: Blob, onProgress: ((pct: number) => void) | undefined, signal: AbortSignal | undefined) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && onProgress) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText);
      let detail = "";
      try { detail = (JSON.parse(xhr.responseText) as { error?: { message?: string } })?.error?.message || ""; } catch { /* not JSON */ }
      reject(
        /storageQuotaExceeded|do not have storage quota/i.test(detail)
          ? new Error(
              "Google Drive refuses the upload: a service account has no storage quota. Move the documents folder into a Shared Drive and add the service account as a DIRECT member (Content manager) — a group membership is not enough. See Settings → Google Drive.",
            )
          : new Error(detail ? `The upload failed (${xhr.status}): ${detail}` : `The upload failed (${xhr.status}).`),
      );
    };
    xhr.onerror = () => reject(new Error("The upload failed — the connection dropped."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
}

/** prepare → PUT the bytes straight to storage (with progress) → register. */
export async function uploadDocument(owner: DocumentOwner, file: File, meta: DocumentMetadata, onProgress?: (pct: number) => void, signal?: AbortSignal) {
  const requestId = crypto.randomUUID();
  const prepared = await request<{ upload: { uploadUrl: string; headers: Record<string, string>; fileId: string | null }; folder: { id: string } }>({
    action: "prepare-upload",
    owner,
    typeCode: meta.typeCode,
    title: meta.title,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    expiresOn: meta.expiresOn || null,
    // Dated subfolders (Navigo/<year>) are picked from these.
    issuedOn: meta.issuedOn || null,
    validFrom: meta.validFrom || null,
  });
  const body = await putBytes(prepared.upload.uploadUrl, prepared.upload.headers, file, onProgress, signal);
  const fileId = prepared.upload.fileId ?? ((JSON.parse(body || "{}") as { id?: string }).id);
  if (!fileId) throw new Error("Storage did not confirm the upload.");
  const { document } = await request<{ document: DocumentRecord }>({ action: "register", owner, folderId: prepared.folder.id, fileId, requestId, ...meta });
  return document;
}

export async function fileExisting(owner: DocumentOwner, fileId: string, meta: DocumentMetadata) {
  const { document } = await request<{ document: DocumentRecord }>({ action: "file-existing", owner, fileId, requestId: crypto.randomUUID(), ...meta });
  return document;
}

export async function listUnfiled(owner: DocumentOwner) {
  return (await request<{ files: UnfiledFile[] }>({ action: "list-unfiled", owner })).files;
}

export async function downloadDocument(doc: Pick<DocumentRecord, "id" | "file_name">) {
  const result = await request<Blob | { link: string }>({ action: "download", documentId: doc.id });
  if (result instanceof Blob) saveBlob(result, doc.file_name);
  else window.open(result.link, "_blank", "noopener");
}

/** The file bytes (or an external link for large Drive files), for previews. */
export async function fetchDocumentFile(doc: Pick<DocumentRecord, "id">) {
  return await request<Blob | { link: string }>({ action: "download", documentId: doc.id, preview: true });
}

/** Open the file in a browser tab (PDFs and images render inline); large Drive files open their link. */
export async function previewDocument(doc: Pick<DocumentRecord, "id" | "file_name">) {
  const result = await fetchDocumentFile(doc);
  if (result instanceof Blob) {
    const url = URL.createObjectURL(result);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    window.open(result.link, "_blank", "noopener");
  }
}

/** Portal: an employee's own payslip (the server only answers for active payslips linked to them). */
export async function downloadOwnPayslip(doc: Pick<DocumentRecord, "id" | "file_name">) {
  const result = await request<Blob | { link: string }>({ action: "download-own-payslip", documentId: doc.id });
  if (result instanceof Blob) saveBlob(result, doc.file_name);
  else window.open(result.link, "_blank", "noopener");
}

export async function previewOwnPayslip(doc: Pick<DocumentRecord, "id">) {
  const result = await request<Blob | { link: string }>({ action: "download-own-payslip", documentId: doc.id, preview: true });
  if (result instanceof Blob) {
    const url = URL.createObjectURL(result);
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    window.open(result.link, "_blank", "noopener");
  }
}

/** Re-files a payslip under another person; the old record is archived. */
export async function movePayslip(documentId: string, toPersonId: string) {
  return await request<{ document: DocumentRecord; previousMatricule: { employeeId: string; value: string } | null }>({
    action: "move-payslip", documentId, toPersonId, requestId: crypto.randomUUID(),
  });
}

/** Person-document audit trail: uploads (document_registered) and views/downloads (document_accessed). */
export type DocumentActivityEvent = { id: number; kind: string; next_state: string; actor_email: string; rationale: string; created_at: string };

export async function loadDocumentActivity(personId: string) {
  const { data, error } = await db()
    .from("hr_events")
    .select("id,kind,next_state,actor_email,rationale,created_at")
    .eq("person_id", personId)
    .in("kind", ["document_registered", "document_accessed"])
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data || []) as DocumentActivityEvent[];
}

const ownerColumn = (kind: DocumentOwnerKind) => `${kind}_id` as const;

export async function loadDocumentTypes() {
  const { data, error } = await db().from("document_types").select("*").order("position");
  if (error) throw error;
  return (data || []) as DocumentTypeRecord[];
}

export async function loadOwnerDocuments(owner: DocumentOwner) {
  const { data, error } = await db().from("documents").select("*").eq(ownerColumn(owner.kind), owner.id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as DocumentRecord[];
}

/** Fired on window after any upload, renewal or archive; detail is the owner. */
export const DOCUMENTS_CHANGED = "qs:documents-changed";

export function notifyDocumentsChanged(owner: DocumentOwner) {
  window.dispatchEvent(new CustomEvent<DocumentOwner>(DOCUMENTS_CHANGED, { detail: owner }));
}

/** The person's photo: their newest active PHOTO document, or null. */
export async function loadPersonPhoto(personId: string) {
  const { data, error } = await db()
    .from("documents")
    .select("id,file_name,mime_type")
    .eq("person_id", personId)
    .eq("type_code", "PHOTO")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data || [])[0] ?? null) as Pick<DocumentRecord, "id" | "file_name" | "mime_type"> | null;
}

export async function loadAlerts(filter?: { kind: DocumentOwnerKind; id?: string }) {
  let query = db().from("document_alerts").select("*");
  if (filter) {
    query = query.eq("owner_kind", filter.kind);
    if (filter.id) query = query.eq(ownerColumn(filter.kind), filter.id);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DocumentAlert[];
}

export async function loadOwnerFolderLink(owner: DocumentOwner) {
  const { data } = await db().from("document_folders").select("folder_link").eq("owner_kind", owner.kind).eq("owner_id", owner.id).eq("folder_code", "").maybeSingle();
  return data?.folder_link || null;
}

/** Metadata edits under RLS; type_code only changes while classifying (needs_review → false). */
export async function updateDocument(id: string, patch: Partial<Pick<DocumentRecord, "type_code" | "needs_review" | "title" | "issued_on" | "valid_from" | "expires_on" | "notes" | "status" | "parent_document_id" | "extension_id">>) {
  const { data, error } = await db().from("documents").update(patch).eq("id", id).select("*").single();
  if (error) throw error;
  return data as DocumentRecord;
}

/** Files the vision model can read, and the request-body cap set by api/documents-extract.ts. */
const EXTRACTABLE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_EXTRACT_BYTES = 3 * 1024 * 1024;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Read issuance/expiry dates off an uploaded file with the vision model.
 * Returns nulls per date when the document prints none (a carte vitale has
 * no expiry). Unsupported, oversized or unreadable files resolve to null —
 * the form simply keeps its hand-filled values.
 */
export async function extractDocumentDates(file: File): Promise<{ issuedOn: string | null; expiresOn: string | null } | null> {
  if (!EXTRACTABLE_TYPES.includes(file.type) || file.size > MAX_EXTRACT_BYTES) return null;
  const token = await getSessionToken();
  if (!token) return null;
  const response = await fetch("/api/documents-extract", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, data: toBase64(new Uint8Array(await file.arrayBuffer())) }),
  });
  if (!response.ok) return null;
  return (await response.json()) as { issuedOn: string | null; expiresOn: string | null };
}

/** Today in Paris, like the document_alerts view. */
export const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

export type ExpiryState = { tone: "expired" | "expiring" | "valid" | "none"; daysLeft: number | null };

/** Same thresholds as the view: expired before today, expiring inside the largest warn window. */
export function expiryState(doc: Pick<DocumentRecord, "expires_on">, type: Pick<DocumentTypeRecord, "warn_days"> | undefined, today = parisToday()): ExpiryState {
  if (!doc.expires_on) return { tone: "none", daysLeft: null };
  const daysLeft = dayNumber(doc.expires_on) - dayNumber(today);
  if (daysLeft < 0) return { tone: "expired", daysLeft };
  const window = Math.max(-1, ...(type?.warn_days || []));
  return { tone: daysLeft <= window ? "expiring" : "valid", daysLeft };
}

export function expiryLabel(state: ExpiryState) {
  if (state.daysLeft === null) return "";
  if (state.tone === "expired") return state.daysLeft === -1 ? "Expired yesterday" : `Expired ${-state.daysLeft} days ago`;
  if (state.daysLeft === 0) return "Expires today";
  return state.daysLeft === 1 ? "Expires tomorrow" : `Expires in ${state.daysLeft} days`;
}

/** Suggested expiry: issue date (or today) plus the type's default validity. */
export function suggestedExpiry(type: Pick<DocumentTypeRecord, "default_validity_months"> | undefined, from: string | null | undefined) {
  if (!type?.default_validity_months) return "";
  const start = from || parisToday();
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + type.default_validity_months);
  return d.toISOString().slice(0, 10);
}

/** One line for a list flag: expired first, then missing, then expiring. */
export function documentFlag(alerts: DocumentAlert[]) {
  const rank = { expired: 0, missing: 1, expiring: 2 } as const;
  return [...alerts]
    .sort((a, b) => rank[a.severity] - rank[b.severity] || (a.days_left ?? 0) - (b.days_left ?? 0))
    .slice(0, 2)
    .map(alert =>
      alert.severity === "missing"
        ? `${alert.title} not filed`
        : `${alert.title} ${expiryLabel({ tone: alert.severity, daysLeft: alert.days_left }).toLowerCase()}`,
    )
    .join(" · ");
}

export const formatDay = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** Compact byte size for file meta, e.g. "860 KB". */
export const formatBytes = (bytes: number | null) => {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
};

/** "30 Oct, 16:42" for the activity feed. */
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
