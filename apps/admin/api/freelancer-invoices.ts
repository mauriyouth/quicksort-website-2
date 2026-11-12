// Freelancer invoices API. Admins review invoices month by month, confirm
// payments, edit billing details and upload an invoice for a freelancer
// (upload); any signed-in freelancer uploads their own invoice (portal_upload). The Clerk token is forwarded so admin reads and
// writes go through RLS; the portal upload and the cycle use the service role
// once the caller is known.
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { defaultStorage } from "../server/documents/handler.ts";
import { loadDriveSettings } from "../server/documents/storage/google-drive.ts";
import type { DocumentStorage } from "../server/documents/storage/types.ts";
import { displayStatus, expectedCraCents, monthCheck } from "../server/freelancer-invoices/check.ts";
import { ingestInvoicePdf, type IngestInput } from "../server/freelancer-invoices/intake.ts";
import { debitIban } from "../server/freelancer-invoices/match.ts";
import {
  INVOICE_COLUMNS,
  POLL_BUDGET_MS,
  intakeDepsFromSettings,
  runFreelancerInvoicesCycle,
  toInvoice,
  type CycleDeps,
  type CycleResult,
  type InvoiceRow,
} from "../server/freelancer-invoices/run.ts";
import { createSupabaseFreelancerInvoiceStore } from "../server/freelancer-invoices/store.ts";
import type { CraDay, FreelancerInvoice, RateRow } from "../server/freelancer-invoices/types.ts";
import { HttpError } from "../server/invoicing/lifecycle.ts";
import { MAX_EXTRACT_BYTES } from "./documents-extract.ts";

// The cycle (sync) may poll the mailbox for up to 150 s, then match.
export const config = { maxDuration: 300 };
type Request = { method?: string; query?: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = Pick<CycleDeps, "fetch" | "now"> & {
  createClient: typeof createClient;
  /** Files one portal PDF (default: ingestInvoicePdf with the saved Drive and Kimi settings). */
  ingest?: (service: SupabaseClient, input: IngestInput) => Promise<{ invoiceId: string; duplicate: boolean }>;
  runCycle?: (service: SupabaseClient, deps: CycleDeps) => Promise<CycleResult>;
  storage?: (client: SupabaseClient) => Promise<DocumentStorage | null>;
};
type Ctx = { client: SupabaseClient; service: () => SupabaseClient; userId: string; email: string; deps: Deps; query: Record<string, string | undefined> };
type Result = { status: number; body: unknown };
type DbError = { message: string; code?: string } | null;

const PAGE = 1000;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const SIRET = /^\d{14}$/;
const PORTAL_STATUSES_ENDED = "ended";
/** Freelance employments still running; an ended one sends its final invoice for this many days. */
const OPEN_STATUSES = ["preboarding", "active", "offboarding"];
const FINAL_INVOICE_DAYS = 90;
const MAX_BASE64_CHARS = Math.ceil(MAX_EXTRACT_BYTES / 3) * 4 + 8;

const uuid = z.string().uuid();
/** A real calendar day, YYYY-MM-DD (2026-13-45 is refused). */
const day = z.string().regex(DAY_FORMAT).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Invalid date");
const note = z.string().trim().min(3).max(500);
const cents = z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable();
const fields = z.object({
  number: z.string().trim().max(100),
  issueDate: day.nullable(),
  dueDate: day.nullable(),
  periodMonth: z.string().regex(MONTH).nullable(),
  amountHtCents: cents,
  vatCents: cents,
  amountTtcCents: cents,
  isCreditNote: z.boolean(),
}).partial().strict();
const FIELD_COLUMNS: Record<keyof z.infer<typeof fields>, string> = {
  number: "number",
  issueDate: "issue_date",
  dueDate: "due_date",
  periodMonth: "period_month",
  amountHtCents: "amount_ht_cents",
  vatCents: "vat_cents",
  amountTtcCents: "amount_ttc_cents",
  isCreditNote: "is_credit_note",
};

/** Columns an approval rests on: changing one sends an approved invoice back to check. */
const REVIEWED_COLUMNS = ["amount_ht_cents", "vat_cents", "amount_ttc_cents", "period_month", "number", "is_credit_note"];

const pdfFile = {
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().max(100).optional(),
  data: z.string().max(MAX_BASE64_CHARS).base64(),
};
const portalSchema = z.object({ action: z.literal("portal_upload"), ...pdfFile });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_fields"), id: uuid, version: z.number().int().min(1), fields }),
  z.object({ action: z.literal("accept_difference"), id: uuid, note }),
  z.object({ action: z.literal("reject"), id: uuid, note }),
  z.object({ action: z.literal("confirm_match"), invoiceId: uuid, transactionId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("dismiss_match"), invoiceId: uuid, transactionId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("link_debit"), invoiceIds: z.array(uuid).min(1).max(24), transactionId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("unlink"), invoiceId: uuid }),
  z.object({
    action: z.literal("save_billing"),
    employeeId: uuid,
    companyName: z.string().trim().max(200),
    siret: z.string().max(30).transform((v) => v.replace(/\s+/g, "")).refine((v) => v === "" || SIRET.test(v), "Invalid SIRET"),
    iban: z.string().max(60).transform((v) => v.replace(/\s+/g, "").toUpperCase()).refine((v) => v === "" || IBAN.test(v), "Invalid IBAN"),
    extraEmails: z.array(z.email().max(320)).max(10),
  }),
  z.object({ action: z.literal("save_mailbox"), address: z.email().max(320), backfillFrom: day }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("upload"), employeeId: uuid, ...pdfFile }),
]);

function check(error: DbError, what: string): void {
  if (error) throw Object.assign(new Error(`Freelancer invoices API: ${what} failed: ${error.message}`), { code: error.code });
}

async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    check(error, what);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const nowOf = (deps: Deps) => (deps.now ? deps.now() : new Date());
const stamp = (deps: Deps) => nowOf(deps).toISOString();
const nextMonth = (month: string) => {
  const d = new Date(`${month}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

type FullRow = InvoiceRow & { document_id: string | null };
const COLUMNS = `${INVOICE_COLUMNS},document_id`;

async function logEvent(client: SupabaseClient, invoiceId: string, kind: string, actorEmail: string, detail: unknown) {
  const { error } = await client.from("freelancer_invoice_events").insert({ invoice_id: invoiceId, kind, actor_email: actorEmail, detail: detail ?? {} });
  check(error, `log ${kind}`);
}

async function loadInvoice(client: SupabaseClient, id: string): Promise<FullRow> {
  const { data, error } = await client.from("freelancer_invoices").select(COLUMNS).eq("id", id).maybeSingle();
  check(error, "read invoice");
  if (!data) throw new HttpError("Invoice not found.", 404);
  return data as unknown as FullRow;
}

/** Conditional on the version read: a concurrent change answers 409. */
async function updateInvoice(client: SupabaseClient, row: { id: string; version: number }, patch: Record<string, unknown>, deps: Deps) {
  const { data, error } = await client.from("freelancer_invoices")
    .update({ ...patch, version: row.version + 1, updated_at: stamp(deps) })
    .eq("id", row.id)
    .eq("version", row.version)
    .select("id");
  if (error?.code === "23505") throw new HttpError("Another invoice of this freelancer already has this number.", 409);
  check(error, "update invoice");
  if (!data?.length) throw new HttpError("This invoice changed in the meantime. Reload and try again.", 409);
}

type DebitRow = { id: string; settled_at: string; amount_cents: number | string; status: string | null; counterparty: string | null; raw: unknown };

async function loadDebit(client: SupabaseClient, id: string): Promise<DebitRow> {
  const { data, error } = await client.from("bank_transactions").select("id,settled_at,amount_cents,status,counterparty,raw").eq("id", id).maybeSingle();
  check(error, "read bank transaction");
  if (!data) throw new HttpError("Bank transaction not found.", 404);
  const debit = data as DebitRow;
  // Qonto statuses: pending, completed, declined, reversed. Only a completed debit paid anyone.
  if (!(Number(debit.amount_cents) < 0) || !debit.settled_at || debit.status !== "completed") {
    throw new HttpError("Only a completed debit can pay an invoice.", 400);
  }
  return debit;
}

/** A PDF of 3 MB at most, from its base64; a 400 otherwise. */
function pdfBytes(input: { mimeType?: string; data: string }): Buffer {
  if (input.mimeType != null && input.mimeType !== "application/pdf") throw new HttpError("Only PDF invoices are accepted.", 400);
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length === 0) throw new HttpError("The file is empty.", 400);
  if (bytes.length > MAX_EXTRACT_BYTES) throw new HttpError("The invoice is larger than 3 MB.", 400);
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError("Only PDF invoices are accepted.", 400);
  return bytes;
}

/**
 * Review and payment matching right after a new invoice, so a debit already
 * in the bank pays it at once. Never fails the upload.
 */
async function matchAfterUpload(service: SupabaseClient, deps: Deps) {
  try {
    await (deps.runCycle ?? runFreelancerInvoicesCycle)(service, { fetch: deps.fetch, now: deps.now, pollMail: false });
  } catch (error) {
    console.error("Freelancer invoices API: matching after upload failed:", error);
  }
}

const AMOUNT_COLUMNS = ["amount_ht_cents", "vat_cents", "amount_ttc_cents"] as const;

/**
 * Marks invoices paid by one debit through freelancer_invoice_mark_paid: one
 * transaction under a per-debit lock re-checks that the debit pays nothing
 * else and the invoices are still open, confirms the match rows and logs.
 */
async function markPaid(client: SupabaseClient, invoiceIds: string[], debit: DebitRow, kind: "probable" | "manual", email: string) {
  const { error } = await client.rpc("freelancer_invoice_mark_paid", {
    invoice_ids: invoiceIds, transaction_id: debit.id, match_kind: kind, actor: email, paid_at: debit.settled_at,
  });
  const code = String((error as { code?: string } | null)?.code ?? "");
  if (code === "P0409") throw new HttpError(`${error!.message}. Reload; unlink it first if it is wrong.`, 409);
  if (code === "P0404") throw new HttpError("Invoice not found.", 404);
  if (code === "42501") throw new HttpError("Admin access is required.", 403);
  check(error, "mark invoices paid");
}

function assertPayable(row: FullRow) {
  if (row.review === "rejected") throw new HttpError("A rejected invoice cannot be marked paid.", 400);
  if (row.paid_at) throw new HttpError("This invoice is already paid. Unlink it first.", 409);
}

const resources: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  async month({ client, deps, query }) {
    const month = query.month ?? "";
    if (!MONTH.test(month)) throw new HttpError("Choose a month (YYYY-MM-01).", 400);

    const freelancers = await paged<{ id: string; person_id: string | null; status: string | null }>(
      (from, to) => client.from("employees").select("id,person_id,status").eq("contract_type", "Freelance").order("id").range(from, to),
      "read freelancers",
    );
    if (freelancers.length === 0) return { rows: [], unassigned: [] };
    const ids = freelancers.map((f) => f.id);
    const personIds = [...new Set(freelancers.map((f) => f.person_id).filter((id): id is string => !!id))];

    const [people, invoices, unassigned, entries, rates, billing] = await Promise.all([
      personIds.length
        ? paged<{ id: string; full_name: string | null }>((from, to) => client.from("hr_people").select("id,full_name").in("id", personIds).order("id").range(from, to), "read people")
        : Promise.resolve([]),
      paged<FullRow>((from, to) => client.from("freelancer_invoices").select(COLUMNS).in("employee_id", ids).eq("period_month", month).order("id").range(from, to), "read invoices"),
      // No readable period: listed apart until an admin sets it.
      paged<FullRow>((from, to) => client.from("freelancer_invoices").select(COLUMNS).in("employee_id", ids).is("period_month", null).neq("review", "rejected").order("id").range(from, to), "read invoices without a period"),
      paged<{ employee_id: string; day: string; part: CraDay["part"]; status: string; project_id: string | null }>(
        (from, to) => client.from("cra_entries").select("employee_id,day,part,status,project_id").in("employee_id", ids).eq("month", month).order("employee_id").order("day").range(from, to),
        "read CRA entries",
      ),
      paged<{ employee_id: string; daily_rate: unknown; start_date: string; end_date: string | null; rate_kind: RateRow["rateKind"] }>(
        (from, to) => client.from("employee_salaries").select("employee_id,daily_rate,start_date,end_date,rate_kind").in("employee_id", ids).order("employee_id").order("start_date").range(from, to),
        "read daily rates",
      ),
      paged<{ employee_id: string; company_name: string; siret: string; iban: string; extra_emails: string[] | null }>(
        (from, to) => client.from("freelancer_billing").select("employee_id,company_name,siret,iban,extra_emails").in("employee_id", ids).order("employee_id").range(from, to),
        "read billing",
      ),
    ]);

    // Suggestions of unpaid invoices, with their debit, unless that debit already pays something.
    const all = [...invoices, ...unassigned];
    const open = all.filter((r) => !r.paid_at && r.review !== "rejected").map((r) => r.id);
    const suggestionsOf = new Map<string, { transactionId: string; amountCents: number; settledAt: string; counterparty: string; why: string }[]>();
    if (open.length) {
      const matches = await paged<{ invoice_id: string; transaction_id: string; kind: string }>(
        (from, to) => client.from("freelancer_invoice_matches").select("invoice_id,transaction_id,kind").in("invoice_id", open).eq("state", "suggested").order("invoice_id").order("transaction_id").range(from, to),
        "read suggestions",
      );
      const txIds = [...new Set(matches.map((m) => m.transaction_id))];
      if (txIds.length) {
        const [debits, used, whyEvents] = await Promise.all([
          paged<{ id: string; settled_at: string; amount_cents: number | string; counterparty: string | null }>(
            (from, to) => client.from("bank_transactions").select("id,settled_at,amount_cents,counterparty").in("id", txIds).order("id").range(from, to),
            "read suggested debits",
          ),
          paged<{ transaction_id: string }>(
            (from, to) => client.from("freelancer_invoice_matches").select("transaction_id").in("transaction_id", txIds).eq("state", "confirmed").order("transaction_id").range(from, to),
            "read used debits",
          ),
          paged<{ invoice_id: string; detail: { transactionId?: string; why?: string } | null }>(
            (from, to) => client.from("freelancer_invoice_events").select("invoice_id,detail").in("invoice_id", open).eq("kind", "match_suggested").order("invoice_id").range(from, to),
            "read suggestion reasons",
          ),
        ]);
        const usedIds = new Set([...used.map((u) => u.transaction_id), ...all.map((r) => r.paid_by_transaction_id).filter(Boolean)]);
        const debitOf = new Map(debits.map((d) => [d.id, d]));
        const why = new Map(whyEvents.map((e) => [`${e.invoice_id}|${e.detail?.transactionId ?? ""}`, e.detail?.why ?? ""]));
        for (const m of matches) {
          const d = debitOf.get(m.transaction_id);
          if (!d || usedIds.has(d.id)) continue;
          const list = suggestionsOf.get(m.invoice_id) ?? [];
          list.push({
            transactionId: d.id,
            amountCents: Number(d.amount_cents),
            settledAt: d.settled_at,
            counterparty: d.counterparty ?? "",
            why: why.get(`${m.invoice_id}|${d.id}`) || m.kind,
          });
          suggestionsOf.set(m.invoice_id, list);
        }
      }
    }

    const today = parisDay.format(nowOf(deps));
    const names = new Map(people.map((p) => [p.id, p.full_name ?? ""]));
    const billingOf = new Map(billing.map((b) => [b.employee_id, b]));
    const view = (r: FullRow, monthOk: boolean) => {
      const inv: FreelancerInvoice = toInvoice(r);
      return {
        ...inv,
        version: r.version,
        documentId: r.document_id,
        display: displayStatus(inv, monthOk, today),
        suggestions: suggestionsOf.get(r.id) ?? [],
      };
    };

    const monthEnd = nextMonth(month);
    const rows = [];
    for (const f of freelancers) {
      const mine = invoices.filter((r) => r.employee_id === f.id);
      const days = entries.filter((e) => e.employee_id === f.id).map((e) => ({ day: e.day, part: e.part, status: e.status, projectId: e.project_id }));
      if (f.status === PORTAL_STATUSES_ENDED && mine.length === 0 && days.length === 0) continue;
      const rateRows: RateRow[] = rates
        .filter((r) => r.employee_id === f.id)
        .map((r) => ({ dailyRate: r.daily_rate == null ? null : Number(r.daily_rate), startDate: r.start_date, endDate: r.end_date, rateKind: r.rate_kind }));
      // No CRA filed at all: nothing to compare with.
      const computed = days.length ? expectedCraCents(days, rateRows) : null;
      const expected = computed ? { days: computed.days, cents: computed.cents } : null;
      const result = monthCheck(mine.map(toInvoice), expected);
      const live = mine.filter((r) => r.review !== "rejected");
      const b = billingOf.get(f.id);
      rows.push({
        employeeId: f.id,
        name: (f.person_id && names.get(f.person_id)) || "",
        expected,
        missingRate: computed?.missingRate ?? false,
        // Daily rates in effect during the month, for the CRA breakdown.
        rates: rateRows
          .filter((r) => r.rateKind === "daily" && r.dailyRate != null && r.startDate < monthEnd && (r.endDate == null || r.endDate >= month))
          .map((r) => ({ dailyRate: r.dailyRate as number, startDate: r.startDate, endDate: r.endDate })),
        check: result,
        invoices: mine.map((r) => view(r, result.ok)),
        missing: (expected?.days ?? 0) > 0 && live.length === 0,
        billing: { companyName: b?.company_name ?? "", siret: b?.siret ?? "", iban: b?.iban ?? "", extraEmails: b?.extra_emails ?? [] },
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId));
    return {
      rows,
      unassigned: unassigned.map((r) => ({ ...view(r, false), name: names.get(freelancers.find((f) => f.id === r.employee_id)?.person_id ?? "") ?? "" })),
    };
  },

  async settings({ client }) {
    const { data, error } = await client.from("freelancer_mailbox_settings").select("address,backfill_from,last_polled_at,last_error").eq("id", "mailbox").maybeSingle();
    check(error, "read mailbox settings");
    let driveServiceAccountEmail: string | null = null;
    try {
      driveServiceAccountEmail = (await loadDriveSettings(client))?.client_email ?? null;
    } catch {
      driveServiceAccountEmail = null;
    }
    const row = data as { address: string; backfill_from: string; last_polled_at: string | null; last_error: string | null } | null;
    return {
      mailbox: row?.address ?? "",
      backfillFrom: row?.backfill_from ?? null,
      lastPolledAt: row?.last_polled_at ?? null,
      lastError: row?.last_error ?? null,
      driveServiceAccountEmail,
    };
  },

  async events({ client, query }) {
    if (!uuid.safeParse(query.id).success) throw new HttpError("Choose an invoice.", 400);
    const { data, error } = await client.from("freelancer_invoice_events").select("id,kind,actor_email,detail,created_at").eq("invoice_id", query.id as string).order("created_at", { ascending: false }).limit(200);
    check(error, "read events");
    return { events: data ?? [] };
  },

  // A link to the PDF, the way documents downloads answer for large files.
  async pdf({ client, deps, query }) {
    if (!uuid.safeParse(query.id).success) throw new HttpError("Choose an invoice.", 400);
    const inv = await loadInvoice(client, query.id as string);
    if (!inv.document_id) throw new HttpError("This invoice has no PDF on file.", 404);
    const { data: doc, error } = await client.from("documents").select("id,storage_provider,provider_file_id").eq("id", inv.document_id).maybeSingle();
    check(error, "read document");
    if (!doc) throw new HttpError("Document not found.", 404);
    const storage = await (deps.storage ?? defaultStorage)(client);
    if (!storage || storage.provider !== doc.storage_provider) throw new HttpError("The storage holding this document is not connected.", 503);
    const logged = await client.rpc("log_document_access", { document_id: doc.id });
    check(logged.error, "log document access");
    const link = (await storage.getFile(doc.provider_file_id as string)).link;
    if (!link) throw new HttpError("The storage gave no link for this PDF.", 502);
    return { url: link };
  },
};

const actions: Record<string, (ctx: Ctx, input: any) => Promise<Result>> = {
  async update_fields({ client, deps, email }, input: { id: string; version: number; fields: z.infer<typeof fields> }) {
    const row = await loadInvoice(client, input.id);
    if (row.version !== input.version) throw new HttpError("This invoice changed in the meantime. Reload and try again.", 409);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.fields)) patch[FIELD_COLUMNS[key as keyof typeof FIELD_COLUMNS]] = value;
    if (Object.keys(patch).length === 0) throw new HttpError("Nothing to change.", 400);
    // A credit note is stored negative, an invoice positive, whatever sign was typed:
    // the month check and the business plan add amounts as they are.
    const creditNote = (input.fields.isCreditNote ?? row.is_credit_note) === true;
    const signed = (v: number) => (v === 0 ? 0 : creditNote ? -Math.abs(v) : Math.abs(v));
    for (const column of AMOUNT_COLUMNS) {
      const value = column in patch ? patch[column] : row[column];
      if (value == null) continue;
      const fixed = signed(Number(value));
      if (column in patch || fixed !== Number(value)) patch[column] = fixed;
    }
    const merged = { ...row, ...patch } as FullRow;
    if (merged.amount_ht_cents != null && merged.period_month != null && (row.flags ?? []).includes("unreadable")) {
      patch.flags = (row.flags ?? []).filter((f) => f !== "unreadable");
    }
    // What the approval rested on changed: the invoice goes back to be checked.
    const changed = (Object.keys(patch) as (keyof FullRow)[]).filter((c) => REVIEWED_COLUMNS.includes(c as string) && merged[c] !== row[c]);
    const reset = row.review === "ok" && changed.length > 0;
    if (reset) patch.review = "to_check";
    await updateInvoice(client, row, patch, deps);
    await logEvent(client, row.id, "fields_updated", email, { fields: input.fields });
    if (reset) await logEvent(client, row.id, "review_reset", email, { previous: "ok", changed });
    return { status: 200, body: { saved: true } };
  },

  async accept_difference({ client, deps, email }, input: { id: string; note: string }) {
    const row = await loadInvoice(client, input.id);
    if (row.review === "rejected") throw new HttpError("This invoice was rejected; it cannot be accepted.", 409);
    await updateInvoice(client, row, { review: "ok", review_note: input.note }, deps);
    await logEvent(client, row.id, "difference_accepted", email, { note: input.note, previous: row.review });
    return { status: 200, body: { saved: true } };
  },

  async reject({ client, deps, email }, input: { id: string; note: string }) {
    const row = await loadInvoice(client, input.id);
    await updateInvoice(client, row, { review: "rejected", review_note: input.note }, deps);
    await logEvent(client, row.id, "rejected", email, { note: input.note, previous: row.review });
    return { status: 200, body: { saved: true } };
  },

  async confirm_match({ client, email }, input: { invoiceId: string; transactionId: string }) {
    const row = await loadInvoice(client, input.invoiceId);
    assertPayable(row);
    const debit = await loadDebit(client, input.transactionId);
    await markPaid(client, [row.id], debit, "probable", email);
    // Who the debit went to: only fills billing details still empty, logged so
    // an unlink can tell where they came from.
    try {
      const filled = await createSupabaseFreelancerInvoiceStore(client)
        .prefillBilling(row.employee_id, { companyName: debit.counterparty ?? "", iban: debitIban(debit.raw) ?? "" }, email);
      if (Object.keys(filled).length) await logEvent(client, row.id, "billing_prefilled", email, { transactionId: debit.id, ...filled });
    } catch (error) {
      console.error("Freelancer invoices API: billing prefill failed:", error);
    }
    return { status: 200, body: { saved: true } };
  },

  async dismiss_match({ client, email }, input: { invoiceId: string; transactionId: string }) {
    const { data, error } = await client
      .from("freelancer_invoice_matches")
      .update({ state: "dismissed", decided_by: email })
      .eq("invoice_id", input.invoiceId)
      .eq("transaction_id", input.transactionId)
      .eq("state", "suggested")
      .select("invoice_id");
    check(error, "dismiss match");
    if (!data?.length) throw new HttpError("Suggestion not found.", 404);
    await logEvent(client, input.invoiceId, "match_dismissed", email, { transactionId: input.transactionId });
    return { status: 200, body: { saved: true } };
  },

  async link_debit({ client, email }, input: { invoiceIds: string[]; transactionId: string }) {
    const ids = [...new Set(input.invoiceIds)];
    const rows = await Promise.all(ids.map((id) => loadInvoice(client, id)));
    rows.forEach(assertPayable);
    const debit = await loadDebit(client, input.transactionId);
    await markPaid(client, ids, debit, "manual", email);
    return { status: 200, body: { saved: true } };
  },

  async unlink({ client, deps, email }, input: { invoiceId: string }) {
    const row = await loadInvoice(client, input.invoiceId);
    if (!row.paid_at && !row.paid_by_transaction_id) throw new HttpError("This invoice is not marked paid.", 400);
    await updateInvoice(client, row, { paid_at: null, paid_by_transaction_id: null }, deps);
    const { error } = await client
      .from("freelancer_invoice_matches")
      .update({ state: "dismissed", decided_by: email })
      .eq("invoice_id", row.id)
      .eq("state", "confirmed");
    check(error, "dismiss confirmed matches");
    await logEvent(client, row.id, "paid_unlinked", email, { transactionId: row.paid_by_transaction_id, paidAt: row.paid_at });
    if (row.paid_by_transaction_id) await clearBillingFromDebit(client, row, row.paid_by_transaction_id, email, deps);
    return { status: 200, body: { saved: true } };
  },

  async save_billing({ client, deps, email }, input: { employeeId: string; companyName: string; siret: string; iban: string; extraEmails: string[] }) {
    const employee = await client.from("employees").select("id,contract_type").eq("id", input.employeeId).maybeSingle();
    check(employee.error, "read employee");
    if (!employee.data) throw new HttpError("Employee not found.", 404);
    if (employee.data.contract_type !== "Freelance") throw new HttpError("Only freelancers have billing details.", 400);
    const { error } = await client.from("freelancer_billing").upsert(
      {
        employee_id: input.employeeId,
        company_name: input.companyName,
        siret: input.siret,
        iban: input.iban,
        extra_emails: [...new Set(input.extraEmails.map((e) => e.trim().toLowerCase()))],
        updated_by: email,
        updated_at: stamp(deps),
      },
      { onConflict: "employee_id" },
    );
    check(error, "save billing");
    return { status: 200, body: { saved: true } };
  },

  async save_mailbox({ client, email }, input: { address: string; backfillFrom: string }) {
    const address = input.address.trim().toLowerCase();
    const current = await client.from("freelancer_mailbox_settings").select("address,backfill_from").eq("id", "mailbox").maybeSingle();
    check(current.error, "read mailbox settings");
    const was = current.data as { address: string; backfill_from: string } | null;
    // Another mailbox or start date: the next poll reads from backfill_from again.
    const restart = !was || was.address !== address || String(was.backfill_from).slice(0, 10) !== input.backfillFrom;
    const { data, error } = await client
      .from("freelancer_mailbox_settings")
      .update({ address, backfill_from: input.backfillFrom, updated_by: email, ...(restart ? { last_polled_at: null } : {}) })
      .eq("id", "mailbox")
      .select("id");
    check(error, "save mailbox settings");
    if (!data?.length) throw new HttpError("The mailbox settings are missing. Apply the database migration.", 409);
    return { status: 200, body: { saved: true } };
  },

  async sync({ service, deps }) {
    const run = deps.runCycle ?? runFreelancerInvoicesCycle;
    return { status: 200, body: await run(service(), { fetch: deps.fetch, now: deps.now, pollBudgetMs: POLL_BUDGET_MS }) };
  },

  // An invoice the freelancer could not send (portal closed, mail missed), filed by an admin.
  async upload({ client, service, deps, email }, input: { employeeId: string; fileName: string; mimeType?: string; data: string }) {
    const bytes = pdfBytes(input);
    const employee = await client.from("employees").select("id,contract_type").eq("id", input.employeeId).maybeSingle();
    check(employee.error, "read employee");
    if (!employee.data) throw new HttpError("Employee not found.", 404);
    if (employee.data.contract_type !== "Freelance") throw new HttpError("Only freelancers send invoices.", 400);
    const svc = service();
    const ingest = deps.ingest ?? ((c, i) => defaultIngest(c, i, deps));
    const result = await ingest(svc, { employeeId: input.employeeId, bytes: new Uint8Array(bytes), fileName: input.fileName, source: "portal", actorEmail: email });
    if (!result.duplicate) await matchAfterUpload(svc, deps);
    return { status: 200, body: { received: true, duplicate: result.duplicate } };
  },
};

/**
 * After an unlink: billing details equal to that debit's payee may have been
 * prefilled from the wrong payment, so they are cleared (only while they still
 * match) for the next auto-match not to pay the wrong account.
 */
async function clearBillingFromDebit(client: SupabaseClient, row: FullRow, transactionId: string, email: string, deps: Deps) {
  const { data, error } = await client.from("bank_transactions").select("counterparty,raw").eq("id", transactionId).maybeSingle();
  check(error, "read unlinked debit");
  if (!data) return;
  const debit = data as { counterparty: string | null; raw: unknown };
  const cleared: Record<string, string> = {};
  const targets: [string, string][] = [["iban", debitIban(debit.raw) ?? ""], ["company_name", (debit.counterparty ?? "").trim()]];
  for (const [column, value] of targets) {
    if (!value) continue;
    const updated = await client
      .from("freelancer_billing")
      .update({ [column]: "", updated_by: email, updated_at: stamp(deps) })
      .eq("employee_id", row.employee_id)
      .eq(column, value)
      .select("employee_id");
    check(updated.error, `clear billing ${column}`);
    if (updated.data?.length) cleared[column] = value;
  }
  if (Object.keys(cleared).length) await logEvent(client, row.id, "billing_cleared", email, { transactionId, ...cleared });
}

async function defaultIngest(service: SupabaseClient, input: IngestInput, deps: Deps) {
  const drive = await loadDriveSettings(service);
  if (!drive) throw new HttpError("Invoice upload is not available yet: Google Drive is not connected.", 503);
  if (!drive.people_root_folder_id) throw new HttpError("Invoice upload is not available yet: no HR documents folder is connected.", 503);
  return ingestInvoicePdf(await intakeDepsFromSettings(service, drive, { fetch: deps.fetch, now: deps.now }), input);
}

/** YYYY-MM-DD, `days` before `iso`. */
const daysBefore = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/**
 * The caller's own freelance employment, from their linked HR person. Never
 * from the request. An open one (preboarding to offboarding) wins; with none,
 * one ended in the last 90 days, for its final invoice. Same rule as
 * public.freelancer_known_senders().
 */
export async function callerFreelanceEmployee(service: SupabaseClient, profileId: string, today: string): Promise<string | null> {
  const account = await service.from("hr_person_accounts").select("person_id").eq("profile_id", profileId).maybeSingle();
  check(account.error, "read linked person");
  const personId = account.data?.person_id as string | undefined;
  if (!personId) return null;
  const rows = await paged<{ id: string; status: string; end_date: string | null }>(
    (from, to) => service.from("employees").select("id,status,end_date").eq("person_id", personId).eq("contract_type", "Freelance").order("id").range(from, to),
    "read freelance employment",
  );
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const since = daysBefore(today, FINAL_INVOICE_DAYS);
  const found = open.length ? open : rows.filter((r) => r.status === PORTAL_STATUSES_ENDED && !!r.end_date && r.end_date >= since);
  // Two candidate employments: which one is ambiguous, so refuse rather than guess.
  return found.length === 1 ? found[0].id : null;
}

async function portalUpload(service: SupabaseClient, userId: string, email: string, body: unknown, deps: Deps): Promise<Result> {
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Send the invoice as a PDF of 3 MB at most." } };
  const input = parsed.data;
  const bytes = pdfBytes(input);

  const employeeId = await callerFreelanceEmployee(service, userId, parisDay.format(nowOf(deps)));
  if (!employeeId) return { status: 403, body: { error: "Only freelancers can send invoices here." } };
  const ingest = deps.ingest ?? ((client, i) => defaultIngest(client, i, deps));
  const result = await ingest(service, { employeeId, bytes: new Uint8Array(bytes), fileName: input.fileName, source: "portal", actorEmail: email });
  if (!result.duplicate) await matchAfterUpload(service, deps);
  return { status: 200, body: { received: true, duplicate: result.duplicate } };
}

export function createFreelancerInvoicesHandler(deps: Deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method || "")) { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET or POST." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage freelancer invoices." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Freelancer invoices are not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
      const userId = String(identity.data);

      // Created only once the caller is known (and, for admin actions, checked).
      let serviceClient: SupabaseClient | null = null;
      const service = () => {
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceKey) throw new HttpError("Freelancer invoices need SUPABASE_SERVICE_ROLE_KEY configured on the server.", 503);
        return (serviceClient ??= deps.createClient(url, serviceKey));
      };
      const emailOf = async (c: SupabaseClient) => {
        const { data } = await c.from("profiles").select("email").eq("id", userId).maybeSingle();
        return ((data?.email as string | undefined) ?? "").trim() || userId;
      };

      const action = (req.body as { action?: unknown } | null)?.action;
      if (req.method === "POST" && action === "portal_upload") {
        const svc = service();
        const result = await portalUpload(svc, userId, await emailOf(svc), req.body, deps);
        return res.status(result.status).json(result.body);
      }

      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });

      const query: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) query[k] = Array.isArray(v) ? v[0] : v;
      const ctx: Ctx = { client, service, userId, email: await emailOf(client), deps, query };
      if (req.method === "GET") {
        const name = query.resource;
        const load = name && Object.hasOwn(resources, name) ? resources[name] : undefined;
        if (!load) return res.status(400).json({ error: "Unknown resource." });
        return res.status(200).json(await load(ctx));
      }
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid freelancer invoice request." });
      const result = await actions[parsed.data.action](ctx, parsed.data);
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
      console.error("Freelancer invoices API failed:", error);
      return res.status(502).json({ error: "The freelancer invoice request failed. Try again." });
    }
  };
}
export default createFreelancerInvoicesHandler();
