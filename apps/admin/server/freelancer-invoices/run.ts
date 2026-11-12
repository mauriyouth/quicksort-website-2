// The freelancer invoice cycle, run by the cron and the admin "check now":
// 1. poll the mailbox for new PDF invoices (skipped with pollMail: false);
// 2. approve to_check invoices whose month matches the CRA;
// 3. match unpaid invoices to Qonto debits.
// Runs with a service-role client. Steps 2 and 3 are idempotent (conditional
// updates, insert-or-ignore), so only the poll takes the mailbox lock.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadClassifierSettings } from "../bank/settings.ts";
import { createDriveStorage, loadDriveSettings, type DriveSettings } from "../documents/storage/google-drive.ts";
import { expectedCraCents, monthCheck } from "./check.ts";
import { extractInvoice } from "./extract.ts";
import { getMessageMeta, getMessagePdfs, gmailToken, listMessageIds } from "./gmail.ts";
import { ingestInvoicePdf, type IngestDeps } from "./intake.ts";
import { debitIban, matchPayments, type Billing, type Debit, type Existing } from "./match.ts";
import { MAX_MESSAGE_ATTEMPTS, pollMailbox, type PollResult } from "./poll.ts";
import { createSupabaseFreelancerInvoiceStore } from "./store.ts";
import type { CraDay, FreelancerInvoice, RateRow } from "./types.ts";

export type { PollResult } from "./poll.ts";

export type CycleDeps = {
  fetch?: typeof fetch;
  now?: () => Date;
  /** false skips the Gmail poll and only runs review and matching (bank cron). Default true. */
  pollMail?: boolean;
  /** Time the poll may spend reading mail, in ms (default POLL_BUDGET_MS). */
  pollBudgetMs?: number;
};

export type CycleResult = { poll: PollResult | { skipped: string }; matched: number; suggested: number; reviewed: number };

const MAILBOX_ID = "mailbox";
const ACTOR = "freelancer invoices cycle";
const LOCK_MS = 10 * 60_000;
/**
 * Mail reading stops starting new messages after 150 s; a read in flight ends
 * by 15 s past that, leaving filing, review and matching well inside the
 * 300 s maxDuration of the cron and of the admin sync.
 */
export const POLL_BUDGET_MS = 150_000;
const EXTRACT_MS = 60_000;
const EXTRACT_GRACE_MS = 15_000;
const OVERLAP_DAYS = 2;
const PAGE = 1000;

type DbError = { message: string } | null;
function check(error: DbError, what: string): void {
  if (error) throw new Error(`Freelancer invoice cycle: ${what} failed: ${error.message}`);
}

/** Every row of a PostgREST query, a page at a time (the API caps a response at 1000 rows). */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    check(error, what);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return day(d);
};
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type InvoiceRow = {
  id: string; employee_id: string; number: string; issue_date: string | null; period_month: string | null; due_date: string | null;
  amount_ht_cents: number | string | null; vat_cents: number | string | null; amount_ttc_cents: number | string | null;
  is_credit_note: boolean; flags: string[] | null; review: FreelancerInvoice["review"]; review_note: string | null;
  paid_at: string | null; paid_by_transaction_id: string | null; source: FreelancerInvoice["source"]; created_at: string; version: number;
};
export const INVOICE_COLUMNS =
  "id,employee_id,number,issue_date,period_month,due_date,amount_ht_cents,vat_cents,amount_ttc_cents,is_credit_note,flags,review,review_note,paid_at,paid_by_transaction_id,source,created_at,version";

export function toInvoice(r: InvoiceRow): FreelancerInvoice {
  return {
    id: r.id,
    employeeId: r.employee_id,
    number: r.number ?? "",
    issueDate: r.issue_date,
    periodMonth: r.period_month,
    dueDate: r.due_date,
    amountHtCents: num(r.amount_ht_cents),
    vatCents: num(r.vat_cents),
    amountTtcCents: num(r.amount_ttc_cents),
    isCreditNote: !!r.is_credit_note,
    flags: r.flags ?? [],
    review: r.review,
    reviewNote: r.review_note ?? "",
    paidAt: r.paid_at,
    paidByTransactionId: r.paid_by_transaction_id,
    source: r.source,
    createdAt: r.created_at,
  };
}

/** When one PDF read must end: 60 s from now, and never past stopAt + 15 s. */
export function extractDeadline(now: number, stopAt?: number): number {
  return stopAt == null ? now + EXTRACT_MS : Math.min(now + EXTRACT_MS, stopAt + EXTRACT_GRACE_MS);
}

/**
 * What ingestInvoicePdf needs, built from the saved Drive and Kimi settings:
 * the mailbox poll and the portal upload file invoices the same way.
 * A read stops at the earlier of 60 s from its start and stopAt + 15 s.
 */
export async function intakeDepsFromSettings(
  client: SupabaseClient,
  drive: DriveSettings,
  deps: Pick<CycleDeps, "fetch" | "now"> & { stopAt?: number },
): Promise<IngestDeps> {
  const fetchImpl = deps.fetch ?? fetch;
  const kimi = await loadClassifierSettings(client);
  return {
    store: createSupabaseFreelancerInvoiceStore(client),
    storage: createDriveStorage(drive),
    now: () => (deps.now ? deps.now() : new Date()),
    extract: (pdf) => {
      if (!kimi.apiKey) return Promise.reject(new Error("No Kimi API key is set in Settings → Kimi (Moonshot)."));
      return extractInvoice({ apiKey: kimi.apiKey, model: kimi.model }, pdf, extractDeadline(Date.now(), deps.stopAt), fetchImpl);
    },
  };
}

async function logEvent(client: SupabaseClient, invoiceId: string, kind: string, detail: unknown) {
  const { error } = await client.from("freelancer_invoice_events").insert({ invoice_id: invoiceId, kind, actor_email: ACTOR, detail });
  if (error) console.error(`Freelancer invoice cycle: ${kind} event failed:`, error.message);
}

type MailboxSettings = { address: string; backfill_from: string; last_polled_at: string | null };

async function loadMailbox(client: SupabaseClient): Promise<MailboxSettings | null> {
  const { data, error } = await client
    .from("freelancer_mailbox_settings")
    .select("address,backfill_from,last_polled_at")
    .eq("id", MAILBOX_ID)
    .maybeSingle();
  check(error, "read mailbox settings");
  return (data as MailboxSettings | null) ?? null;
}

/** Poll window start: max(backfill_from, last_polled_at - 2 days), as YYYY-MM-DD. */
export function pollAfter(backfillFrom: string, lastPolledAt: string | null): string {
  const from = backfillFrom.slice(0, 10);
  if (!lastPolledAt) return from;
  const t = Date.parse(lastPolledAt);
  if (Number.isNaN(t)) return from;
  const overlap = day(new Date(t - OVERLAP_DAYS * 86_400_000));
  return overlap > from ? overlap : from;
}

async function poll(client: SupabaseClient, mailbox: MailboxSettings | null, deps: CycleDeps): Promise<PollResult | { skipped: string }> {
  if (!mailbox) return { skipped: "The mailbox settings are missing." };
  const fetchImpl = deps.fetch ?? fetch;
  const startedAt = deps.now ? deps.now() : new Date();

  // Lock (the bank sync pattern): only one poll at a time.
  const lock = await client
    .from("freelancer_mailbox_settings")
    .update({ locked_until: new Date(startedAt.getTime() + LOCK_MS).toISOString() })
    .eq("id", MAILBOX_ID)
    .or(`locked_until.is.null,locked_until.lt."${startedAt.toISOString()}"`)
    .select("id");
  check(lock.error, "acquire mailbox lock");
  if ((lock.data?.length ?? 0) === 0) return { skipped: "Another mailbox poll is in progress." };

  const release = async (patch: { last_error: string | null; last_polled_at?: string }) => {
    const { error } = await client.from("freelancer_mailbox_settings").update({ locked_until: null, ...patch }).eq("id", MAILBOX_ID);
    check(error, "release mailbox lock");
  };

  let skipped: string | null = null;
  let result: PollResult | null = null;
  try {
    const address = (mailbox.address ?? "").trim();
    const drive = await loadDriveSettings(client);
    if (!address) skipped = "No mailbox address is set.";
    else if (!drive) skipped = "Google Drive is not connected, so neither Gmail nor invoice filing is available.";
    else if (!drive.people_root_folder_id) skipped = "No HR documents folder is connected in Settings → Google Drive.";
    if (skipped || !drive) {
      await release({ last_error: skipped });
      return { skipped: skipped ?? "Google Drive is not connected." };
    }

    const senders = await client.rpc("freelancer_known_senders");
    check(senders.error, "read known senders");
    const read = await all<{ message_id: string; status: "done" | "failed"; attempts: number }>(
      (from, to) => client.from("freelancer_mailbox_messages").select("message_id,status,attempts").order("message_id").range(from, to),
      "read mailbox messages",
    );
    const token = await gmailToken(drive, address, fetchImpl);
    const stopAt = Date.now() + (deps.pollBudgetMs ?? POLL_BUDGET_MS);
    const intake = await intakeDepsFromSettings(client, drive, { fetch: deps.fetch, now: deps.now, stopAt });

    result = await pollMailbox({
      senders: ((senders.data ?? []) as { employee_id: string; email: string }[]).map((s) => ({ employeeId: s.employee_id, email: s.email })),
      mailbox: address,
      after: pollAfter(mailbox.backfill_from, mailbox.last_polled_at),
      seenMessageIds: new Set(read.filter((r) => r.status === "done").map((r) => r.message_id)),
      failedAttempts: new Map(read.filter((r) => r.status === "failed").map((r) => [r.message_id, Number(r.attempts) || 0])),
      record: async (m) => {
        const { error } = await client.from("freelancer_mailbox_messages").upsert(
          { message_id: m.id, status: m.status, attempts: m.attempts, last_error: m.error, internal_date: m.internalDate, processed_at: new Date().toISOString() },
          { onConflict: "message_id" },
        );
        check(error, "record mailbox message");
      },
      gmail: {
        list: (query) => listMessageIds(token, address, query, fetchImpl),
        meta: (id) => getMessageMeta(token, address, id, fetchImpl),
        get: (id) => getMessagePdfs(token, address, id, fetchImpl),
      },
      ingest: (input) => ingestInvoicePdf(intake, input),
      stopAt,
    });
  } catch (error) {
    await release({ last_error: message(error) }).catch((e) => console.error(message(e)));
    return { skipped: `Mailbox poll failed: ${message(error)}` };
  }

  // The window must keep covering unread mail: a partial run leaves
  // last_polled_at alone, and it never moves past a message still to retry.
  let polledAt: string | null = result.partial ? null : startedAt.toISOString();
  try {
    if (polledAt) {
      const failed = await client.from("freelancer_mailbox_messages").select("internal_date").eq("status", "failed").order("internal_date", { ascending: true, nullsFirst: true }).limit(1);
      check(failed.error, "read failed messages");
      const oldest = (failed.data?.[0] as { internal_date: string | null } | undefined);
      if (oldest && !oldest.internal_date) polledAt = null;
      else if (oldest?.internal_date && Date.parse(oldest.internal_date) < Date.parse(polledAt)) polledAt = new Date(Date.parse(oldest.internal_date)).toISOString();
    }
  } catch (error) {
    polledAt = null;
    console.error(message(error));
  }
  const errors = [
    result.abandoned ? `Gave up on ${result.abandoned} message(s) after ${MAX_MESSAGE_ATTEMPTS} attempts; file them by hand. Last: ${result.lastAbandoned}` : "",
    result.failed ? `${result.failed} PDF(s) could not be filed; retried next run. Last: ${result.lastFailure}` : "",
  ].filter(Boolean);
  await release({ last_error: errors.length ? errors.join(" ") : null, ...(polledAt ? { last_polled_at: polledAt } : {}) });
  return result;
}

/** Approves to_check invoices with no flags whose freelancer month matches the CRA. */
async function autoReview(client: SupabaseClient): Promise<number> {
  const candidates = await all<InvoiceRow>(
    (from, to) => client.from("freelancer_invoices").select(INVOICE_COLUMNS).eq("review", "to_check").eq("flags", "{}").not("period_month", "is", null).order("id").range(from, to),
    "read invoices to check",
  );
  const months = new Map<string, { employeeId: string; month: string }>();
  for (const r of candidates) months.set(`${r.employee_id}|${r.period_month}`, { employeeId: r.employee_id, month: r.period_month as string });

  let reviewed = 0;
  const rates = new Map<string, RateRow[]>();
  for (const { employeeId, month } of months.values()) {
    const [invoices, entries] = await Promise.all([
      client.from("freelancer_invoices").select(INVOICE_COLUMNS).eq("employee_id", employeeId).eq("period_month", month),
      client.from("cra_entries").select("day,part,status,project_id").eq("employee_id", employeeId).eq("month", month),
    ]);
    check(invoices.error, "read month invoices");
    check(entries.error, "read CRA entries");
    if (!rates.has(employeeId)) {
      const r = await client.from("employee_salaries").select("daily_rate,start_date,end_date,rate_kind").eq("employee_id", employeeId);
      check(r.error, "read daily rates");
      rates.set(employeeId, ((r.data ?? []) as { daily_rate: unknown; start_date: string; end_date: string | null; rate_kind: RateRow["rateKind"] }[])
        .map((x) => ({ dailyRate: num(x.daily_rate), startDate: x.start_date, endDate: x.end_date, rateKind: x.rate_kind })));
    }
    const days = ((entries.data ?? []) as { day: string; part: CraDay["part"]; status: string; project_id: string | null }[])
      .map((e) => ({ day: e.day, part: e.part, status: e.status, projectId: e.project_id }));
    // No CRA filed, or a day without a daily rate: a human checks it.
    const expected = days.length ? expectedCraCents(days, rates.get(employeeId) as RateRow[]) : null;
    if (expected?.missingRate) continue;
    const rows = (invoices.data ?? []) as InvoiceRow[];
    const result = monthCheck(rows.map(toInvoice), expected);
    if (!result.ok) continue;

    for (const r of rows) {
      if (r.review !== "to_check" || (r.flags ?? []).length) continue;
      // Conditional on the version read: an admin decision in between wins.
      const { data, error } = await client
        .from("freelancer_invoices")
        .update({ review: "ok", version: r.version + 1, updated_at: new Date().toISOString() })
        .eq("id", r.id)
        .eq("version", r.version)
        .eq("review", "to_check")
        .select("id");
      check(error, "approve invoice");
      if (!data?.length) continue;
      reviewed++;
      await logEvent(client, r.id, "review_auto_ok", { month, expectedCents: result.expectedCents, invoicedHtCents: result.invoicedHtCents });
    }
  }
  return reviewed;
}

/** Marks confident payments paid and records probable ones for a human. */
async function matchDebits(client: SupabaseClient): Promise<{ matched: number; suggested: number }> {
  const freelancers = await all<{ id: string; person_id: string | null }>(
    (from, to) => client.from("employees").select("id,person_id").eq("contract_type", "Freelance").order("id").range(from, to),
    "read freelancers",
  );
  if (freelancers.length === 0) return { matched: 0, suggested: 0 };
  const employeeIds = freelancers.map((f) => f.id);

  // The contract of matchPayments: ALL invoices of these freelancers, paid and rejected included.
  const rows = await all<InvoiceRow>(
    (from, to) => client.from("freelancer_invoices").select(INVOICE_COLUMNS).in("employee_id", employeeIds).order("id").range(from, to),
    "read invoices",
  );
  const open = rows.filter((r) => r.paid_at == null && r.review !== "rejected" && !r.is_credit_note && r.issue_date && num(r.amount_ttc_cents));
  if (open.length === 0) return { matched: 0, suggested: 0 };

  const personIds = [...new Set(freelancers.map((f) => f.person_id).filter((id): id is string => !!id))];
  const [people, billingRows] = await Promise.all([
    personIds.length ? client.from("hr_people").select("id,full_name").in("id", personIds) : Promise.resolve({ data: [], error: null }),
    client.from("freelancer_billing").select("employee_id,company_name,iban").in("employee_id", employeeIds),
  ]);
  check(people.error, "read people");
  check(billingRows.error, "read billing");
  const names = new Map(((people.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? ""]));
  const billingOf = new Map(((billingRows.data ?? []) as { employee_id: string; company_name: string; iban: string }[]).map((b) => [b.employee_id, b]));
  const billing: Billing[] = freelancers.map((f) => ({
    employeeId: f.id,
    personName: (f.person_id && names.get(f.person_id)) || "",
    companyName: billingOf.get(f.id)?.company_name ?? "",
    iban: billingOf.get(f.id)?.iban ?? "",
  }));

  // Debits settled from the day before the oldest open invoice (Paris vs UTC dates).
  const since = addDays(open.map((r) => r.issue_date as string).sort()[0], -1);
  const debitRows = await all<{ id: string; settled_at: string; amount_cents: number | string; counterparty: string | null; transfer: unknown }>(
    (from, to) => client
      .from("bank_transactions")
      .select("id,settled_at,amount_cents,counterparty,transfer:raw->transfer")
      .lt("amount_cents", 0)
      // Qonto statuses: pending, completed, declined, reversed. Only a completed debit paid anyone.
      .eq("status", "completed")
      .gte("settled_at", `${since}T00:00:00Z`)
      .order("id")
      .range(from, to),
    "read debits",
  );
  const debits: Debit[] = debitRows.map((d) => ({
    id: d.id,
    settledAt: d.settled_at,
    amountCents: Number(d.amount_cents),
    counterparty: d.counterparty ?? "",
    iban: debitIban({ transfer: d.transfer }),
  }));

  const invoiceIds = new Set(rows.map((r) => r.id));
  const matchRows = await all<{ invoice_id: string; transaction_id: string; state: Existing["state"] }>(
    (from, to) => client.from("freelancer_invoice_matches").select("invoice_id,transaction_id,state").order("invoice_id").order("transaction_id").range(from, to),
    "read matches",
  );
  const existing: Existing[] = matchRows
    .filter((m) => invoiceIds.has(m.invoice_id))
    .map((m) => ({ invoiceId: m.invoice_id, transactionId: m.transaction_id, state: m.state }));

  const result = matchPayments(rows.map(toInvoice), debits, billing, existing);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const debitById = new Map(debits.map((d) => [d.id, d]));

  let matched = 0;
  for (const pair of result.confident) {
    const inv = byId.get(pair.invoiceId) as InvoiceRow;
    const debit = debitById.get(pair.transactionId) as Debit;
    // One transaction under a per-debit lock: re-checks the debit is free and
    // the invoice still open, marks it paid, confirms the match, logs paid_auto.
    const { error } = await client.rpc("freelancer_invoice_mark_paid", {
      invoice_ids: [inv.id], transaction_id: debit.id, match_kind: "confident", actor: ACTOR, paid_at: debit.settledAt,
    });
    // P0409: the debit or the invoice was used since it was read; P0404: the invoice is gone.
    if (error && ["P0409", "P0404"].includes(String((error as { code?: string }).code))) continue;
    check(error, "mark invoice paid");
    matched++;
  }

  let suggested = 0;
  if (result.probable.length) {
    // Insert-or-ignore: a pair suggested before, dismissed or confirmed keeps its state.
    const { data, error } = await client
      .from("freelancer_invoice_matches")
      .upsert(
        result.probable.map((p) => ({ invoice_id: p.invoiceId, transaction_id: p.transactionId, kind: "probable", state: "suggested" })),
        { onConflict: "invoice_id,transaction_id", ignoreDuplicates: true },
      )
      .select("invoice_id,transaction_id");
    check(error, "record probable matches");
    const created = (data ?? []) as { invoice_id: string; transaction_id: string }[];
    suggested = created.length;
    const why = new Map(result.probable.map((p) => [`${p.invoiceId}|${p.transactionId}`, p.why]));
    for (const c of created) {
      await logEvent(client, c.invoice_id, "match_suggested", { transactionId: c.transaction_id, why: why.get(`${c.invoice_id}|${c.transaction_id}`) });
    }
  }
  return { matched, suggested };
}

export async function runFreelancerInvoicesCycle(client: SupabaseClient, deps: CycleDeps = {}): Promise<CycleResult> {
  let pollResult: PollResult | { skipped: string } = { skipped: "Mail polling is off for this run." };
  if (deps.pollMail !== false) {
    try {
      pollResult = await poll(client, await loadMailbox(client), deps);
    } catch (error) {
      // Lock or settings read failed: matching still runs.
      pollResult = { skipped: `Mailbox poll failed: ${message(error)}` };
    }
  }
  const reviewed = await autoReview(client);
  const { matched, suggested } = await matchDebits(client);
  return { poll: pollResult, matched, suggested, reviewed };
}
