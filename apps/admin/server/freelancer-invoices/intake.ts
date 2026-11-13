// Takes one freelancer PDF (portal upload or mail attachment) into the
// registry: dedupe, file it in the person's Drive folder, read it, insert the
// invoice to check, and prefill billing. Approval is the cycle's job (Task 6):
// every invoice lands as 'to_check', with flags saying why it may not pass.
import { createHash } from "node:crypto";
import { documentFileName } from "../documents/folders.ts";
import type { DocumentStorage } from "../documents/storage/types.ts";
import { dueDate } from "./check.ts";
import type { InvoiceFields } from "./extract.ts";
import type { FreelancerInvoiceStore } from "./store.ts";

// Mirrors store.ts INVOICE_TYPE_CODE; importing it would load Supabase and Drive here.
const INVOICE_TYPE_CODE = "FREELANCE_INVOICE";

export type IngestDeps = {
  store: FreelancerInvoiceStore;
  storage: DocumentStorage;
  extract: (pdf: Uint8Array) => Promise<InvoiceFields>;
  now: () => Date;
};

export type IngestInput = {
  employeeId: string;
  bytes: Uint8Array;
  fileName: string;
  source: "portal" | "email";
  gmailMessageId?: string;
  actorEmail: string;
};

const normalizeIban = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "").toUpperCase();

const blankFields = (): InvoiceFields => ({
  number: "",
  issueDate: null,
  dueDate: null,
  periodMonth: null,
  amountHtCents: null,
  vatCents: null,
  amountTtcCents: null,
  isCreditNote: false,
  issuerName: "",
  issuerSiret: "",
  issuerIban: "",
  looksLikeInvoice: false,
  extractionFailed: true,
});

const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === "23505";

/** Why the invoice cannot be approved automatically. */
export function intakeFlags(fields: InvoiceFields, billingIban: string): string[] {
  const flags: string[] = [];
  // A failed read says nothing about what the document is: only "unreadable".
  if (!fields.looksLikeInvoice && !fields.extractionFailed) flags.push("not_invoice");
  if (fields.extractionFailed || fields.amountHtCents == null || fields.periodMonth == null) flags.push("unreadable");
  const stored = normalizeIban(billingIban);
  const issuer = normalizeIban(fields.issuerIban);
  if (stored && issuer && stored !== issuer) flags.push("iban_changed");
  return flags;
}

/** What happened to one PDF. `skipped`: an email attachment read as not an invoice (a timesheet, a contract), not stored. */
export type IngestResult =
  | { invoiceId: string; duplicate: boolean; skipped: false }
  | { invoiceId: null; duplicate: false; skipped: true };

export async function ingestInvoicePdf(deps: IngestDeps, input: IngestInput): Promise<IngestResult> {
  const { store, storage } = deps;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const duplicateOf = async (invoiceId: string) => {
    await store.logEvent(invoiceId, "duplicate_received", input.actorEmail, {
      source: input.source,
      fileName: input.fileName,
      gmailMessageId: input.gmailMessageId ?? null,
      sha256,
    });
    return { invoiceId, duplicate: true, skipped: false } as const;
  };

  const sameFile = await store.findDuplicate(input.employeeId, sha256, "");
  if (sameFile) return duplicateOf(sameFile);

  // A failed read (Kimi down, AI not configured) never drops the invoice: it is
  // stored with nothing filled in, flagged unreadable, for an admin to complete.
  let fields: InvoiceFields;
  let extraction: unknown;
  try {
    fields = await deps.extract(input.bytes);
    extraction = fields;
  } catch (error) {
    fields = blankFields();
    extraction = { error: error instanceof Error ? error.message : String(error) };
  }
  // Mail often carries a timesheet or contract next to the invoice: only invoices
  // are kept. A failed read says nothing about the file, so that one is kept.
  // A portal upload is always kept: the freelancer chose to send it as an invoice.
  if (input.source === "email" && !fields.looksLikeInvoice && !fields.extractionFailed) {
    return { invoiceId: null, duplicate: false, skipped: true };
  }
  if (fields.number) {
    const sameNumber = await store.findDuplicate(input.employeeId, sha256, fields.number);
    if (sameNumber) return duplicateOf(sameNumber);
  }

  const person = await store.personFor(input.employeeId);
  // Everything that can fail runs before the upload, so only insertInvoice
  // can fail once a file exists (and that path undoes the upload).
  const billing = await store.billing(input.employeeId);
  const flags = intakeFlags(fields, billing?.iban ?? "");
  const folder = await store.invoiceFolder(storage, person.personId);
  const datedOn = fields.issueDate ?? deps.now().toISOString().slice(0, 10);
  const name = documentFileName(INVOICE_TYPE_CODE, person.fullName, "invoice.pdf", undefined, null, datedOn);
  const file = await storage.uploadFile(folder, { name, mimeType: "application/pdf" }, input.bytes);

  let documentId: string;
  try {
    documentId = await store.registerDocument({
      personId: person.personId,
      fileId: file.id,
      folderId: folder.id,
      fileName: file.name,
      sha256,
      size: input.bytes.length,
      issuedOn: fields.issueDate,
      provider: storage.provider,
      title: fields.number ? `Invoice ${fields.number}` : "Freelance invoice",
      employeeId: input.employeeId,
      actorEmail: input.actorEmail,
    });
  } catch (error) {
    // Storage never keeps a file the registry does not know.
    await storage.trash(file.id).catch(() => undefined);
    throw error;
  }

  let invoiceId: string;
  try {
    invoiceId = await store.insertInvoice({
      employeeId: input.employeeId,
      source: input.source,
      gmailMessageId: input.gmailMessageId ?? null,
      documentId,
      sha256,
      number: fields.number,
      issueDate: fields.issueDate,
      periodMonth: fields.periodMonth,
      dueDate: dueDate(fields.issueDate, fields.dueDate),
      amountHtCents: fields.amountHtCents,
      vatCents: fields.vatCents,
      amountTtcCents: fields.amountTtcCents,
      isCreditNote: fields.isCreditNote,
      review: "to_check",
      flags,
      extraction,
    });
  } catch (error) {
    // The copy just filed is not attached to any invoice: undo it either way.
    await storage.trash(file.id).catch(() => undefined);
    await store.archiveDocument(documentId).catch(() => undefined);
    if (!isUniqueViolation(error)) throw error;
    // Lost a race with the same file or number: the winner is the invoice.
    const winner = await store.findDuplicate(input.employeeId, sha256, fields.number);
    if (!winner) throw error;
    return duplicateOf(winner);
  }

  // The invoice is stored: a retry would only see a duplicate, so what follows
  // is best effort and never fails the intake.
  // Issuer fields come from the PDF (untrusted): they only fill what is empty.
  if (fields.looksLikeInvoice && !fields.extractionFailed) {
    await store
      .prefillBilling(input.employeeId, { companyName: fields.issuerName, siret: fields.issuerSiret, iban: fields.issuerIban })
      .catch((error) => console.error("Freelancer invoice intake: billing prefill failed:", error));
  }

  await store
    .logEvent(invoiceId, "received", input.actorEmail, {
      source: input.source,
      fileName: input.fileName,
      gmailMessageId: input.gmailMessageId ?? null,
      flags,
    })
    .catch((error) => console.error("Freelancer invoice intake: received event failed:", error));
  return { invoiceId, duplicate: false, skipped: false };
}
