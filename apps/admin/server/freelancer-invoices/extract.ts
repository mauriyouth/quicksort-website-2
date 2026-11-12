import { extractPdfText } from "../cv-text.ts";

const ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";

/** The Moonshot (Kimi) request itself failed; unreadable content never throws. */
export class ExtractionError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ExtractionError";
    this.status = status;
  }
}
const MAX_TEXT_CHARS = 20_000;
const MIN_TEXT_CHARS = 20;
const RETRY_MIN_MS = 20_000;

export type InvoiceFields = {
  number: string;
  issueDate: string | null;
  dueDate: string | null;
  periodMonth: string | null;
  amountHtCents: number | null;
  vatCents: number | null;
  amountTtcCents: number | null;
  isCreditNote: boolean;
  issuerName: string;
  issuerSiret: string;
  issuerIban: string;
  looksLikeInvoice: boolean;
  /** True when Kimi answered but never with a usable structure (unreadable), as opposed to "not an invoice". */
  extractionFailed?: boolean;
};

const str = (description: string) => ({ type: "string", description });
const amount = (description: string) => ({ type: ["number", "null"], description });

/* Flat and strict, like the resume schema: kimi-k2.6 is unstable on complex ones. */
export const INVOICE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["looks_like_invoice", "document_kind", "number", "issue_date", "due_date", "period", "total_ht", "total_vat", "total_ttc", "issuer_name", "issuer_siret", "issuer_iban", "vat_exemption_mention"],
  properties: {
    looks_like_invoice: { type: "boolean", description: "True when the document is an invoice or a credit note." },
    document_kind: { type: "string", enum: ["facture", "avoir", "autre"], description: "facture for an invoice, avoir for a credit note, autre otherwise." },
    number: str("Invoice number as written, or empty."),
    issue_date: str("Invoice date as written (DD/MM/YYYY or YYYY-MM-DD), or empty."),
    due_date: str("Due date (échéance, à payer avant le) as written, or empty."),
    period: str("Billed period or month as written (période, mois de, prestations d'octobre 2026), or empty."),
    total_ht: amount("Total excluding VAT in euros, null when absent."),
    total_vat: amount("VAT amount in euros, null when absent."),
    total_ttc: amount("Total including VAT (net à payer) in euros, null when absent."),
    issuer_name: str("Name of the issuer (the freelancer or their company), or empty."),
    issuer_siret: str("Issuer SIRET as written, or empty."),
    issuer_iban: str("Issuer IBAN as written, or empty."),
    vat_exemption_mention: str("The VAT exemption sentence if present (e.g. \"TVA non applicable, art. 293 B du CGI\"), else empty."),
  },
};

/* ---------- Lenient normalisation ---------- */

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "").slice(0, max);

/** "1234.565" style decimal string to integer cents, rounding half up on exact decimal digits (no float error). */
function decimalCents(value: string): number | null {
  const m = value.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] ?? "").padEnd(3, "0");
  const total = Number(m[1] || "0") * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  return Number.isFinite(total) ? total : null;
}

/** Euros as a number or a French/English string ("8 400,00 €", "1.234,56", "1,234.56") to integer cents. */
function cents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const plain = String(Math.abs(value));
    const c = /e/i.test(plain) ? Math.round(Math.abs(value) * 100) : decimalCents(plain);
    return c === null ? null : value < 0 ? -c : c;
  }
  if (typeof value !== "string") return null;
  let s = value.replace(/[\s\u00a0\u202f€]|EUR/gi, "");
  const negative = /^[-−–(]/.test(s);
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;
  const last = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (last >= 0 && s.length - last - 1 <= 2) s = `${s.slice(0, last).replace(/[.,]/g, "")}.${s.slice(last + 1)}`;
  else s = s.replace(/[.,]/g, "");
  const c = decimalCents(s);
  return c === null ? null : negative ? -c : c;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** DD/MM/YYYY (or - . separators) and YYYY-MM-DD to ISO; anything else is null. */
function isoDate(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  const fr = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (fr) return validDate(+fr[3], +fr[2], +fr[1]) ? `${fr[3]}-${pad(+fr[2])}-${pad(+fr[1])}` : null;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return iso && validDate(+iso[1], +iso[2], +iso[3]) ? iso[0] : null;
}

/* Full French names or exact abbreviations (optional dot), on word boundaries. */
const MONTHS = [
  "janvier|janv|jan", "f[eé]vrier|f[eé]vr|f[eé]v|feb", "mars|mar", "avril|avr|apr", "mai|may", "juin|jun",
  "juillet|juil|jul", "ao[uû]t|aug", "septembre|sept|sep", "octobre|oct", "novembre|nov", "d[eé]cembre|d[eé]c|dec",
];
const MONTH_PATTERNS = MONTHS.map(pattern => new RegExp(`(?<![a-zà-ÿ])(?:${pattern})\\.?(?![a-zà-ÿ])`));

/** "octobre 2026", "Oct. 2026", "10/2026", "2026-10", "du 01/10/2026 au 31/10/2026" (start month) to YYYY-MM-01. */
function periodMonth(value: unknown): string | null {
  const s = (typeof value === "string" ? value : "").toLowerCase().normalize("NFC");
  const full = isoDate(s);
  if (full) return `${full.slice(0, 7)}-01`;
  const ym = s.match(/\b(20\d{2})[-/](\d{1,2})\b/);
  if (ym && +ym[2] >= 1 && +ym[2] <= 12) return `${ym[1]}-${pad(+ym[2])}-01`;
  const my = s.match(/\b(\d{1,2})[/.-](20\d{2})\b/);
  if (my && +my[1] >= 1 && +my[1] <= 12) return `${my[2]}-${pad(+my[1])}-01`;
  const year = s.match(/\b(20\d{2})\b/)?.[1];
  if (!year) return null;
  let best = -1, bestAt = Infinity;
  MONTH_PATTERNS.forEach((pattern, index) => {
    const at = s.search(pattern);
    if (at >= 0 && at < bestAt) { best = index; bestAt = at; }
  });
  return best >= 0 ? `${year}-${pad(best + 1)}-01` : null;
}

/** Maps Kimi's answer onto InvoiceFields, trimming and coercing instead of rejecting. */
export function toInvoiceFields(raw: unknown): InvoiceFields {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const issueDate = isoDate(r.issue_date);
  const issueDay = issueDate ? Number(issueDate.slice(8)) : 0;
  let period = periodMonth(r.period);
  if (!period && issueDate && issueDay >= 1 && issueDay <= 10) {
    const [y, m] = issueDate.split("-").map(Number);
    period = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
  }
  const exemption = r.vat_exemption_mention === true || /293\s*B|TVA\s+non\s+applicable/i.test(text(r.vat_exemption_mention, 400));
  const kind = text(r.document_kind, 40);
  const isCreditNote = /avoir|credit/i.test(kind);

  let ht = cents(r.total_ht);
  let vat = cents(r.total_vat);
  let ttc = cents(r.total_ttc);
  if (exemption && (vat === null || (ht !== null && ht === ttc))) vat = 0;
  if (ttc === null && ht !== null && vat !== null) ttc = ht + vat;
  if (ttc === null && ht !== null && exemption) ttc = ht;
  if (vat === null && ht !== null && ttc !== null) vat = ttc - ht;
  if (ht === null && ttc !== null && vat !== null) ht = ttc - vat;
  const sign = (n: number | null) => (n === null ? null : isCreditNote ? -Math.abs(n) : n);

  const iban = text(r.issuer_iban, 60).replace(/\s+/g, "").toUpperCase();
  return {
    number: text(r.number, 100),
    issueDate,
    dueDate: isoDate(r.due_date),
    periodMonth: period,
    amountHtCents: sign(ht),
    vatCents: sign(vat),
    amountTtcCents: sign(ttc),
    isCreditNote,
    issuerName: text(r.issuer_name, 200),
    issuerSiret: text(r.issuer_siret, 40).replace(/\s+/g, ""),
    issuerIban: iban,
    looksLikeInvoice: r.looks_like_invoice === true,
  };
}

const empty = (): InvoiceFields => toInvoiceFields({});

/** JSON from the answer, tolerating a ```json fence (seen on kimi-k2.6). */
function json(content: unknown) {
  if (typeof content !== "string") throw new Error("no content");
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : content).trim());
}

const SYSTEM = [
  "You read French freelancer invoices (factures) and credit notes (avoirs) for an accounting back office. Fill the \"invoice\" structure from the PDF text. Transcribe; never invent. Use an empty string or null when the document does not show a field.",
  "number: the invoice number (numéro de facture). issue_date: date d'émission. due_date: date d'échéance, only if written. period: the billed period or month (période, mois de, prestations du ... au ...), as written.",
  "total_ht, total_vat, total_ttc: totals in euros (HT = excluding VAT, TVA = VAT, TTC = including VAT / net à payer), as numbers; null when absent. Never compute them yourself.",
  "issuer_name, issuer_siret, issuer_iban: the issuer of the invoice (the freelancer or their company, not the customer), as written.",
  "vat_exemption_mention: copy the VAT exemption sentence (e.g. \"TVA non applicable, art. 293 B du CGI\") if present, else empty.",
  "document_kind: avoir for a credit note, facture for an invoice, autre if the document is neither. looks_like_invoice: true only for an invoice or a credit note.",
].join("\n");

/**
 * Reads the invoice fields of a freelancer PDF with Kimi (Moonshot) Structured
 * Output. Only the text leaves our server. Unreadable or non-invoice content
 * yields looksLikeInvoice=false; only an HTTP failure throws (ExtractionError).
 */
export async function extractInvoice(
  cfg: { apiKey: string; model: string },
  pdf: Uint8Array,
  deadline: number,
  fetchImpl: typeof fetch = fetch,
): Promise<InvoiceFields> {
  let content = "";
  try { content = await extractPdfText(pdf, MAX_TEXT_CHARS); } catch { return empty(); }
  if (content.replace(/\s+/g, "").length < MIN_TEXT_CHARS) return empty();

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt && deadline - Date.now() < RETRY_MIN_MS) break;
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        // No temperature: current Kimi models only accept their default.
        thinking: { type: "disabled" },
        response_format: { type: "json_schema", json_schema: { name: "invoice", strict: true, schema: INVOICE_JSON_SCHEMA } },
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
    });
    if (!res.ok) throw new ExtractionError(`Moonshot request failed (HTTP ${res.status}).`, res.status);
    const body = await res.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null;
    try {
      return toInvoiceFields(json(body?.choices?.[0]?.message?.content));
    } catch { /* malformed answer: retry once if time allows */ }
  }
  return { ...empty(), extractionFailed: true };
}
