// Read-only Gmail access for freelancer invoices: the Drive service account
// impersonates the configured mailbox (domain-wide delegation) with the
// gmail.readonly scope. Only messages from known freelancer addresses with a
// PDF attachment are listed; each is first read as headers only (From and
// date), and only a known, unambiguous sender's message is opened in full for
// its PDF parts, the only attachments downloaded.
import { signServiceAccountJwt, type ServiceAccount } from "../documents/storage/google-drive.ts";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users";
const MAX_PAGES = 50;

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
};

export type MailPdf = { fileName: string; bytes: Uint8Array };
export type MailMeta = { from: string; /** When Gmail received it (ISO), null when absent. */ internalDate: string | null };
export type MailMessage = MailMeta & { pdfs: MailPdf[] };

/** An OAuth access token for `mailbox`, through the service account's domain-wide delegation. */
export async function gmailToken(sa: ServiceAccount, mailbox: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = signServiceAccountJwt(sa, { iss: sa.client_email, sub: mailbox, scope: GMAIL_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string; error_description?: string };
      detail = [body?.error, body?.error_description].filter(Boolean).join(": ");
    } catch { /* bare status */ }
    throw new Error(
      `Google refused Gmail access to ${mailbox} (HTTP ${response.status}${detail ? `, ${detail}` : ""}). ` +
        `A Workspace admin must grant the service account ${sa.client_email} domain-wide delegation for the scope ${GMAIL_SCOPE}, and the Gmail API must be enabled for its project.`,
    );
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google did not return a Gmail access token for the service account.");
  return body.access_token;
}

const parisParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** Epoch seconds of 00:00 Europe/Paris on `date` (YYYY-MM-DD). */
export function parisMidnightEpoch(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Paris offset at that instant; DST switches at 01:00 UTC, so it is also the offset at Paris midnight.
  const p = Object.fromEntries(parisParts.formatToParts(new Date(utcMidnight)).map((x) => [x.type, x.value]));
  const asParis = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return (utcMidnight - (asParis - utcMidnight)) / 1000;
}

/**
 * Gmail search for PDF attachments from known senders, received from Paris
 * midnight of `after` (YYYY-MM-DD). A numeric `after:` is exact; a date one is
 * read in the mailbox's own time zone.
 */
export function buildQuery(senders: string[], after: string): string {
  return `from:(${senders.join(" OR ")}) has:attachment filename:pdf after:${parisMidnightEpoch(after)}`;
}

async function gmailGet<T>(token: string, path: string, query: Record<string, string>, fetchImpl: typeof fetch): Promise<T> {
  const suffix = Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  const response = await fetchImpl(`${API_BASE}${path}${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = "";
    try { message = ((await response.json()) as { error?: { message?: string } })?.error?.message || ""; } catch { /* bare status */ }
    throw Object.assign(new Error(`Gmail answered ${response.status}${message ? `: ${message}` : ""}.`), { status: response.status });
  }
  return (await response.json()) as T;
}

const mailboxPath = (mailbox: string) => `/${encodeURIComponent(mailbox)}`;

/** Every message id matching `query`, following nextPageToken. */
export async function listMessageIds(token: string, mailbox: string, query: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = { q: query, maxResults: "500" };
    if (pageToken) params.pageToken = pageToken;
    const body = await gmailGet<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `${mailboxPath(mailbox)}/messages`, params, fetchImpl);
    for (const m of body.messages ?? []) if (m?.id) ids.push(m.id);
    if (!body.nextPageToken) return ids;
    pageToken = body.nextPageToken;
  }
  return ids;
}

const isPdf = (part: GmailPart) =>
  part.mimeType === "application/pdf" || (part.filename ?? "").toLowerCase().endsWith(".pdf");

function pdfParts(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  if (isPdf(part) && (part.body?.attachmentId || part.body?.data)) out.push(part);
  for (const child of part.parts ?? []) pdfParts(child, out);
  return out;
}

const decode = (data: string) => new Uint8Array(Buffer.from(data, "base64url"));

const fromHeader = (payload: GmailPart | undefined) => payload?.headers?.find((h) => (h.name ?? "").toLowerCase() === "from")?.value ?? "";
const isoDate = (internalDate: string | undefined) => {
  const ms = Number(internalDate);
  return internalDate && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** The sender and date of one message, from its headers: no body, no attachment. */
export async function getMessageMeta(token: string, mailbox: string, id: string, fetchImpl: typeof fetch = fetch): Promise<MailMeta> {
  const message = await gmailGet<{ payload?: GmailPart; internalDate?: string }>(
    token, `${mailboxPath(mailbox)}/messages/${encodeURIComponent(id)}`, { format: "metadata", metadataHeaders: "From" }, fetchImpl,
  );
  return { from: fromHeader(message.payload), internalDate: isoDate(message.internalDate) };
}

/** The sender and the PDF attachments of one message; other parts are never downloaded. */
export async function getMessagePdfs(token: string, mailbox: string, id: string, fetchImpl: typeof fetch = fetch): Promise<MailMessage> {
  const base = `${mailboxPath(mailbox)}/messages/${encodeURIComponent(id)}`;
  const message = await gmailGet<{ payload?: GmailPart; internalDate?: string }>(token, base, { format: "full" }, fetchImpl);
  const from = fromHeader(message.payload);
  const pdfs: MailPdf[] = [];
  for (const [index, part] of pdfParts(message.payload).entries()) {
    const fileName = part.filename || `attachment-${index + 1}.pdf`;
    if (part.body?.attachmentId) {
      const attachment = await gmailGet<{ data?: string }>(token, `${base}/attachments/${encodeURIComponent(part.body.attachmentId)}`, {}, fetchImpl);
      if (attachment.data) pdfs.push({ fileName, bytes: decode(attachment.data) });
    } else if (part.body?.data) {
      pdfs.push({ fileName, bytes: decode(part.body.data) });
    }
  }
  return { from, pdfs, internalDate: isoDate(message.internalDate) };
}
