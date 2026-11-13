// Supabase side of the freelancer invoice intake. Runs with a service-role
// client (cron, or the API after it checked the caller), so RLS does not apply
// and every query scopes itself by employee.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { personFolder } from "../documents/file.ts";
import type { DocumentStorage, StorageFolder, StorageProvider } from "../documents/storage/types.ts";
import type { Billing } from "./match.ts";

export const INVOICE_TYPE_CODE = "FREELANCE_INVOICE";

/** One freelancer_invoices insert, camelCase. Amounts in cents, credit notes negative as extracted. */
export type NewInvoiceRow = {
  employeeId: string;
  source: "portal" | "email";
  gmailMessageId: string | null;
  documentId: string | null;
  sha256: string;
  number: string;
  issueDate: string | null;
  periodMonth: string | null;
  dueDate: string | null;
  amountHtCents: number | null;
  vatCents: number | null;
  amountTtcCents: number | null;
  isCreditNote: boolean;
  review: "to_check";
  flags: string[];
  /** The full extraction, kept for review. */
  extraction: unknown;
};

export type RegisterInvoiceDocument = {
  personId: string;
  fileId: string;
  folderId: string;
  fileName: string;
  sha256: string;
  size: number;
  issuedOn: string | null;
  /** Defaults to "gdrive", the only storage in use. */
  provider?: StorageProvider;
  title?: string;
  /** For the hr_events audit row; the employee whose invoice this is. */
  employeeId?: string;
  /** Who filed it; matched to a profile for uploaded_by and the hr_events actor. */
  actorEmail?: string;
};

export interface FreelancerInvoiceStore {
  /**
   * An invoice of this freelancer with the same file hash, or the same
   * non-empty number among invoices not rejected: a corrected invoice may
   * reuse the number of the one it replaces.
   */
  findDuplicate(employeeId: string, sha256: string, number: string): Promise<string | null>;
  /** Throws an error with `code: "23505"` when a unique constraint is hit. */
  insertInvoice(row: NewInvoiceRow): Promise<string>;
  /** The person's 09_Factures folder, resolved and cached like every registry folder. */
  invoiceFolder(storage: DocumentStorage, personId: string): Promise<StorageFolder>;
  registerDocument(input: RegisterInvoiceDocument): Promise<string>;
  /** Archives a document registered for an upload that lost a race. */
  archiveDocument(documentId: string): Promise<void>;
  /** null when the employee does not exist; empty strings when nothing is on file yet. */
  billing(employeeId: string): Promise<Billing | null>;
  /** Fills only the fields still empty; never overwrites what an admin entered. Returns the columns it filled. */
  prefillBilling(employeeId: string, patch: { companyName?: string; siret?: string; iban?: string }, actor?: string): Promise<Record<string, string>>;
  logEvent(invoiceId: string, kind: string, actorEmail: string, detail: unknown): Promise<void>;
  /** Rejects an employee whose contract is not Freelance. */
  personFor(employeeId: string): Promise<{ personId: string; fullName: string }>;
}

type DbError = { message: string; code?: string } | null;

function check(error: DbError, what: string): void {
  if (error) throw Object.assign(new Error(`Freelancer invoice store: ${what} failed: ${error.message}`), { code: error.code });
}

const BILLING_COLUMNS = { companyName: "company_name", siret: "siret", iban: "iban" } as const;

export function createSupabaseFreelancerInvoiceStore(client: SupabaseClient): FreelancerInvoiceStore {
  async function personOf(employeeId: string): Promise<{ personId: string; fullName: string; contractType: string } | null> {
    const employee = await client.from("employees").select("person_id,contract_type").eq("id", employeeId).maybeSingle();
    check(employee.error, "read employee");
    const personId = employee.data?.person_id as string | null | undefined;
    if (!personId) return null;
    const person = await client.from("hr_people").select("full_name").eq("id", personId).maybeSingle();
    check(person.error, "read person");
    return { personId, fullName: (person.data?.full_name as string | undefined) ?? "", contractType: (employee.data?.contract_type as string | null) ?? "" };
  }

  /** The profile behind an email, if any (profiles.email is not unique: first match). */
  async function profileId(email: string | undefined): Promise<string | null> {
    const value = (email ?? "").trim();
    if (!value.includes("@")) return null;
    const { data, error } = await client.from("profiles").select("id").ilike("email", value.replace(/[%_\\]/g, "\\$&")).limit(1);
    if (error) return null;
    return (data?.[0]?.id as string | undefined) ?? null;
  }

  return {
    async findDuplicate(employeeId, sha256, number) {
      const byHash = await client.from("freelancer_invoices").select("id").eq("employee_id", employeeId).eq("sha256", sha256).limit(1);
      check(byHash.error, "find duplicate by hash");
      if (byHash.data?.[0]) return byHash.data[0].id as string;
      if (!number) return null;
      const byNumber = await client.from("freelancer_invoices").select("id").eq("employee_id", employeeId).eq("number", number).neq("review", "rejected").limit(1);
      check(byNumber.error, "find duplicate by number");
      return (byNumber.data?.[0]?.id as string | undefined) ?? null;
    },

    async insertInvoice(row) {
      const { data, error } = await client
        .from("freelancer_invoices")
        .insert({
          employee_id: row.employeeId,
          source: row.source,
          gmail_message_id: row.gmailMessageId,
          document_id: row.documentId,
          sha256: row.sha256,
          number: row.number,
          issue_date: row.issueDate,
          period_month: row.periodMonth,
          due_date: row.dueDate,
          amount_ht_cents: row.amountHtCents,
          vat_cents: row.vatCents,
          amount_ttc_cents: row.amountTtcCents,
          is_credit_note: row.isCreditNote,
          review: row.review,
          flags: row.flags,
          extraction: row.extraction,
        })
        .select("id")
        .single();
      check(error, "insert invoice");
      return data!.id as string;
    },

    invoiceFolder(storage, personId) {
      return personFolder(client, storage, personId, INVOICE_TYPE_CODE);
    },

    // register_document needs a signed-in user (private.workspace_user_id());
    // the cron has none, so the service role inserts the same columns itself.
    async registerDocument(input) {
      const actor = await profileId(input.actorEmail);
      const { data, error } = await client
        .from("documents")
        .insert({
          type_code: INVOICE_TYPE_CODE,
          owner_kind: "person",
          person_id: input.personId,
          title: (input.title || "Freelance invoice").slice(0, 200),
          issued_on: input.issuedOn,
          storage_provider: input.provider ?? "gdrive",
          provider_file_id: input.fileId,
          provider_folder_id: input.folderId,
          file_name: input.fileName,
          mime_type: "application/pdf",
          size_bytes: input.size,
          sha256: input.sha256,
          uploaded_by: actor,
        })
        .select("id,title")
        .single();
      check(error, "register document");
      const documentId = data!.id as string;
      // The audit row private.insert_document writes. hr_events.actor_id is
      // required, so a filing with no matching profile (the mail cron) has none.
      // Best effort: the document is already registered.
      if (actor) {
        const audit = await client.from("hr_events").insert({
          person_id: input.personId,
          employee_id: input.employeeId ?? null,
          kind: "document_registered",
          previous_state: "",
          next_state: documentId,
          actor_id: actor,
          actor_email: input.actorEmail ?? "",
          rationale: `Freelance invoice: ${data!.title as string}`,
          request_id: randomUUID(),
        });
        if (audit.error) console.error("Freelancer invoice store: hr_events audit failed:", audit.error.message);
      }
      return documentId;
    },

    async archiveDocument(documentId) {
      const { error } = await client.from("documents").update({ status: "archived" }).eq("id", documentId);
      check(error, "archive document");
    },

    async billing(employeeId) {
      const person = await personOf(employeeId);
      if (!person) return null;
      const billing = await client.from("freelancer_billing").select("company_name,iban").eq("employee_id", employeeId).maybeSingle();
      check(billing.error, "read billing");
      return { employeeId, personName: person.fullName, companyName: billing.data?.company_name ?? "", iban: billing.data?.iban ?? "" };
    },

    async prefillBilling(employeeId, patch, actor = "invoice intake") {
      const fields = (Object.keys(BILLING_COLUMNS) as (keyof typeof BILLING_COLUMNS)[])
        .map((key) => {
          const raw = (patch[key] ?? "").trim();
          return [BILLING_COLUMNS[key], key === "iban" ? raw.replace(/\s+/g, "").toUpperCase() : raw] as const;
        })
        .filter(([, value]) => value !== "");
      const filled: Record<string, string> = {};
      if (fields.length === 0) return filled;
      const seed = await client.from("freelancer_billing").upsert({ employee_id: employeeId }, { onConflict: "employee_id", ignoreDuplicates: true });
      check(seed.error, "create billing");
      // One conditional update per field: a concurrent admin edit is never overwritten.
      for (const [column, value] of fields) {
        const { data, error } = await client
          .from("freelancer_billing")
          .update({ [column]: value, updated_by: actor, updated_at: new Date().toISOString() })
          .eq("employee_id", employeeId)
          .eq(column, "")
          .select("employee_id");
        check(error, `prefill ${column}`);
        if (data?.length) filled[column] = value;
      }
      return filled;
    },

    async logEvent(invoiceId, kind, actorEmail, detail) {
      const { error } = await client
        .from("freelancer_invoice_events")
        .insert({ invoice_id: invoiceId, kind, actor_email: actorEmail, detail: detail ?? {} });
      check(error, "log event");
    },

    async personFor(employeeId) {
      const person = await personOf(employeeId);
      if (!person) throw new Error("Freelancer invoice store: employee not found.");
      if (person.contractType !== "Freelance") throw new Error("Freelancer invoice store: only freelancers send invoices.");
      return { personId: person.personId, fullName: person.fullName };
    },
  };
}
