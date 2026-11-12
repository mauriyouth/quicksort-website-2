import { driveApi, driveToken } from "../documents/storage/google-drive.ts";
import type { DriveSettings } from "../documents/storage/google-drive.ts";
import { extractFields } from "./fields.ts";

type ServiceAccount = Pick<DriveSettings, "client_email" | "private_key">;

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
const DOCS_BASE = "https://docs.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

export class DocAccessError extends Error {
  constructor(serviceAccountEmail: string) {
    super(`Share this Google Doc with ${serviceAccountEmail} (Viewer is enough).`);
    this.name = "DocAccessError";
  }
}

/** Injection points so tests never touch the network. */
export type GoogleDocsDeps = {
  driveApi?: typeof driveApi;
  fetch?: typeof fetch;
  token?: (sa: ServiceAccount) => Promise<string>;
};

const statusOf = (error: unknown) => (error as { status?: number })?.status;
const isAccess = (status: number | undefined) => status === 403 || status === 404;

async function docsApi<T>(sa: ServiceAccount, path: string, opts: { method?: string; body?: unknown } = {}, deps: GoogleDocsDeps = {}): Promise<T> {
  const token = await (deps.token || driveToken)(sa);
  const response = await (deps.fetch || fetch)(`${DOCS_BASE}/${path}`, {
    method: opts.method || "GET",
    headers: { Authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!response.ok) {
    if (isAccess(response.status)) throw new DocAccessError(sa.client_email);
    let message = "";
    try { message = ((await response.json()) as { error?: { message?: string } })?.error?.message || ""; } catch { /* bare status */ }
    throw new Error(`Google Docs answered ${response.status}${message ? `: ${message}` : "."}`);
  }
  return (await response.json()) as T;
}

type Element = { textRun?: { content?: string } };
type Structural = { paragraph?: { elements?: Element[] }; table?: { tableRows?: { tableCells?: { content?: Structural[] }[] }[] } };

function collect(content: Structural[] | undefined, out: string[]) {
  for (const item of content || []) {
    for (const el of item.paragraph?.elements || []) if (el.textRun?.content) out.push(el.textRun.content);
    for (const row of item.table?.tableRows || []) for (const cell of row.tableCells || []) collect(cell.content, out);
  }
}

type Segment = { content?: Structural[] };
type Segments = { body?: Segment; headers?: Record<string, Segment>; footers?: Record<string, Segment>; footnotes?: Record<string, Segment> };
type Tab = { documentTab?: Segments; childTabs?: Tab[] };
type Doc = Segments & { tabs?: Tab[] };

function collectSegments(doc: Segments | undefined, parts: string[]) {
  if (!doc) return;
  collect(doc.body?.content, parts);
  for (const group of [doc.headers, doc.footers, doc.footnotes])
    for (const segment of Object.values(group || {})) {
      parts.push("\n");
      collect(segment.content, parts);
    }
}

function collectTabs(tabs: Tab[], parts: string[]) {
  for (const tab of tabs) {
    parts.push("\n");
    collectSegments(tab.documentTab, parts);
    collectTabs(tab.childTabs || [], parts);
  }
}

/** Every tab's text (with child tabs); a response without tabs is read in the legacy single-tab shape. */
export async function readDocText(sa: ServiceAccount, docId: string, deps: GoogleDocsDeps = {}): Promise<string> {
  const doc = await docsApi<Doc>(sa, `documents/${docId}?includeTabsContent=true`, {}, deps);
  const parts: string[] = [];
  if (doc.tabs) collectTabs(doc.tabs, parts);
  else collectSegments(doc, parts);
  return parts.join("");
}

export function assertNoPlaceholders(text: string): void {
  const left = extractFields(text);
  if (left.length) throw new Error(`These fields were not filled: ${left.join(", ")}`);
  if (text.includes("{{")) throw new Error("Some {{…}} placeholders were left in the document.");
}

export async function fillTemplate(
  sa: ServiceAccount,
  input: { templateDocId: string; folderId: string; name: string; values: Record<string, string> },
  deps: GoogleDocsDeps = {},
): Promise<{ docCopyId: string; pdf: Uint8Array }> {
  const drive = deps.driveApi || driveApi;
  let copy: { id: string };
  try {
    copy = await drive<{ id: string }>(sa, `/files/${input.templateDocId}/copy`, {
      method: "POST",
      query: { supportsAllDrives: "true", fields: "id" },
      body: { name: input.name, parents: [input.folderId] },
    });
  } catch (error) {
    if (isAccess(statusOf(error))) throw new DocAccessError(sa.client_email);
    throw error;
  }
  try {
    // Replace every spelling actually present ({{ nom }} as well as {{nom}}).
    const present = await readDocText(sa, copy.id, deps);
    const spellings = new Map<string, Set<string>>();
    for (const match of present.matchAll(PLACEHOLDER)) {
      if (!(match[1] in input.values)) continue;
      spellings.set(match[1], (spellings.get(match[1]) || new Set([`{{${match[1]}}}`])).add(match[0]));
    }
    const requests = Object.entries(input.values).flatMap(([key, value]) =>
      [...(spellings.get(key) || [`{{${key}}}`])].map((text) => ({
        replaceAllText: { containsText: { text, matchCase: true }, replaceText: value },
      })));
    await docsApi(sa, `documents/${copy.id}:batchUpdate`, { method: "POST", body: { requests } }, deps);
    assertNoPlaceholders(await readDocText(sa, copy.id, deps));
    const token = await (deps.token || driveToken)(sa);
    const response = await (deps.fetch || fetch)(
      `${DRIVE_BASE}/files/${copy.id}/export?mimeType=${encodeURIComponent("application/pdf")}&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Google Drive could not export the document as PDF (status ${response.status}).`);
    return { docCopyId: copy.id, pdf: new Uint8Array(await response.arrayBuffer()) };
  } catch (error) {
    // The copy holds personal data: do not leave it behind.
    try {
      await drive(sa, `/files/${copy.id}`, { method: "PATCH", query: { supportsAllDrives: "true" }, body: { trashed: true } });
    } catch { /* keep the original error */ }
    throw error;
  }
}
