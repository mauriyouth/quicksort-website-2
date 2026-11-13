import { test } from "node:test";
import assert from "node:assert/strict";
import { createFreelancerInvoicesHandler } from "../apps/admin/api/freelancer-invoices.ts";
import { createFreelancerInvoicesCronHandler } from "../apps/admin/api/freelancer-invoices-cron.ts";
import { createBankCronHandler } from "../apps/admin/api/bank-transactions-cron.ts";
import { encryptCredentials } from "../apps/admin/server/invoicing/settings.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.CRON_SECRET = "cron-secret";
process.env.AI_SETTINGS_ENCRYPTION_KEY ??= "ab".repeat(32);

const MONTH = "2026-10-01";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF").toString("base64");

// Column defaults of the tables the handler creates rows in.
const DEFAULTS = { freelancer_billing: { company_name: "", siret: "", iban: "", extra_emails: [] } };

/** In-memory PostgREST: enough of the builder for the handler. */
function memoryClient(tables, ops, rpcs = {}) {
  return {
    rpc: async (name, args) => {
      ops.push({ op: "rpc", name, args });
      if (name in rpcs) return rpcs[name](args);
      return { data: null, error: null };
    },
    from(table) {
      const filters = [];
      let mode = "select", payload, options, single = null, orderBy = [], span = null, limit = null, returning = false;
      const f = (fn) => (c, v) => { filters.push((r) => fn(r[c], v)); return q; };
      const q = {
        select() { if (mode !== "select") returning = true; return q; },
        eq: f((a, b) => a === b), neq: f((a, b) => a !== b), gte: f((a, b) => a >= b), lte: f((a, b) => a <= b), lt: f((a, b) => a < b),
        in: f((a, b) => b.includes(a)),
        is: f((a, b) => (a ?? null) === b),
        not(c, op, v) { if (op === "is") filters.push((r) => (r[c] ?? null) !== v); return q; },
        ilike: f((a, b) => String(a ?? "").toLowerCase() === String(b).toLowerCase()),
        or() { return q; },
        order(c, o = {}) { orderBy.push([c, o.ascending !== false]); return q; },
        range(from, to) { span = [from, to]; return q; },
        limit(n) { limit = n; return q; },
        insert(v) { mode = "insert"; payload = v; return q; },
        update(v) { mode = "update"; payload = v; return q; },
        upsert(v, o) { mode = "upsert"; payload = v; options = o; return q; },
        single() { single = "one"; return q; },
        maybeSingle() { single = "maybe"; return q; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      function run() {
        const rows = (tables[table] ??= []);
        const match = (r) => filters.every((fn) => fn(r));
        if (mode !== "select") ops.push({ op: mode, table, value: payload });
        if (mode === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: `${table}-${rows.length + 1}`, ...r }));
          rows.push(...list);
          return { data: single ? list[0] : list, error: null };
        }
        if (mode === "upsert") {
          const keys = (options?.onConflict ?? "id").split(",");
          const out = [];
          for (const p of Array.isArray(payload) ? payload : [payload]) {
            const found = rows.find((r) => keys.every((k) => r[k] === p[k]));
            if (found) { if (!options?.ignoreDuplicates) { Object.assign(found, p); out.push({ ...found }); } }
            else { rows.push({ ...DEFAULTS[table], ...p }); out.push({ ...p }); }
          }
          return { data: returning ? out : null, error: null };
        }
        let list = rows.filter(match);
        if (mode === "update") {
          for (const r of list) Object.assign(r, payload);
          return { data: returning ? (single ? list[0] ?? null : list.map((r) => ({ ...r }))) : null, error: null };
        }
        for (const [c, asc] of [...orderBy].reverse()) list.sort((a, b) => ((a[c] ?? "") < (b[c] ?? "") ? -1 : (a[c] ?? "") > (b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        if (span) list = list.slice(span[0], span[1] + 1);
        if (limit != null) list = list.slice(0, limit);
        list = list.map((r) => ({ ...r }));
        if (!single) return { data: list, error: null };
        if (list.length === 1) return { data: list[0], error: null };
        if (single === "maybe" && list.length === 0) return { data: null, error: null };
        return { data: null, error: { message: "single row expected" } };
      }
      return q;
    },
  };
}

function invoice(over = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001", employee_id: "emp-ana", number: "F-10", issue_date: "2026-11-02", period_month: MONTH, due_date: "2026-12-02",
    amount_ht_cents: 840000, vat_cents: 168000, amount_ttc_cents: 1008000, is_credit_note: false, flags: [], review: "to_check",
    review_note: "", paid_at: null, paid_by_transaction_id: null, source: "email", created_at: "2026-11-02T08:00:00Z", version: 1,
    document_id: "doc-1", ...over,
  };
}

function fixture({ role = "admin", extra = {} } = {}) {
  const tables = {
    user_roles: [{ user_id: "user-1", role }],
    profiles: [{ id: "user-1", email: "admin@quicksort.fr" }, { id: "user-ana", email: "ana@example.com" }, { id: "user-cdi", email: "cdi@example.com" }],
    hr_people: [{ id: "p-ana", full_name: "Ana Lopez" }, { id: "p-bob", full_name: "Bob Martin" }, { id: "p-cdi", full_name: "Cid Dupont" }],
    hr_person_accounts: [{ profile_id: "user-ana", person_id: "p-ana" }, { profile_id: "user-cdi", person_id: "p-cdi" }],
    employees: [
      { id: "emp-ana", person_id: "p-ana", contract_type: "Freelance", status: "active" },
      { id: "emp-bob", person_id: "p-bob", contract_type: "Freelance", status: "active" },
      { id: "emp-cdi", person_id: "p-cdi", contract_type: "CDI", status: "active" },
    ],
    cra_entries: [
      { employee_id: "emp-ana", month: MONTH, day: "2026-10-01", part: "full", status: "client_project", project_id: "pr" },
      { employee_id: "emp-bob", month: MONTH, day: "2026-10-01", part: "full", status: "client_project", project_id: "pr" },
      { employee_id: "emp-bob", month: MONTH, day: "2026-10-02", part: "am", status: "client_project", project_id: "pr" },
    ],
    employee_salaries: [
      { employee_id: "emp-ana", daily_rate: "700.00", start_date: "2026-01-01", end_date: null, rate_kind: "daily" },
      { employee_id: "emp-bob", daily_rate: "650", start_date: "2026-01-01", end_date: null, rate_kind: "daily" },
    ],
    freelancer_invoices: [invoice()],
    freelancer_billing: [],
    freelancer_invoice_matches: [],
    freelancer_invoice_events: [],
    freelancer_mailbox_settings: [{ id: "mailbox", address: "mohamed@quicksort.fr", backfill_from: "2026-01-01", last_polled_at: null, last_error: null }],
    bank_transactions: [
      // As the bank sync stores it: Qonto's positive amount, the direction in raw.side
      // (`side` stands for the raw->>side column alias the in-memory client cannot resolve).
      { id: "tx-1", settled_at: "2026-11-08T10:00:00Z", amount_cents: 1008000, status: "completed", counterparty: "ANA LOPEZ CONSEIL", side: "debit", raw: { side: "debit", transfer: { counterparty_account_number: "FR76 3000 4000 0312 3456 7890 143" } } },
    ],
    ...extra,
  };
  const ops = [];
  const state = { profile: "user-1", ingested: [], cycles: [] };
  const rpcs = {
    sync_clerk_profile: () => ({ data: state.profile, error: null }),
    // The checks of public.freelancer_invoice_mark_paid (tests/freelancer-invoices.sql covers the SQL itself).
    freelancer_invoice_mark_paid: ({ invoice_ids, transaction_id, match_kind, actor, paid_at }) => {
      const invoices = tables.freelancer_invoices;
      const mine = invoices.filter((i) => invoice_ids.includes(i.id));
      if (mine.length !== invoice_ids.length) return { data: null, error: { code: "P0404", message: "Invoice not found" } };
      if (mine.some((i) => i.paid_at || i.paid_by_transaction_id || i.review === "rejected")) return { data: null, error: { code: "P0409", message: "An invoice is already paid or rejected" } };
      const used = invoices.some((i) => i.paid_by_transaction_id === transaction_id && !invoice_ids.includes(i.id))
        || tables.freelancer_invoice_matches.some((m) => m.transaction_id === transaction_id && m.state === "confirmed" && !invoice_ids.includes(m.invoice_id));
      if (used) return { data: null, error: { code: "P0409", message: "This debit already pays another invoice" } };
      const kind = { confident: "paid_auto", probable: "paid_confirmed", manual: "paid_linked" }[match_kind];
      for (const i of mine) {
        Object.assign(i, { paid_at, paid_by_transaction_id: transaction_id, version: i.version + 1 });
        const m = tables.freelancer_invoice_matches.find((x) => x.invoice_id === i.id && x.transaction_id === transaction_id);
        if (m) Object.assign(m, { kind: match_kind, state: "confirmed", decided_by: actor });
        else tables.freelancer_invoice_matches.push({ invoice_id: i.id, transaction_id, kind: match_kind, state: "confirmed", decided_by: actor });
        tables.freelancer_invoice_events.push({ invoice_id: i.id, kind, actor_email: actor, detail: { transactionId: transaction_id } });
      }
      return { data: mine.length, error: null };
    },
  };
  const client = memoryClient(tables, ops, rpcs);
  const deps = {
    createClient: () => client,
    now: () => new Date("2026-11-11T09:00:00Z"),
    ingest: async (_client, input) => { state.ingested.push(input); return { invoiceId: "inv-new", duplicate: false }; },
    runCycle: async (_client, options) => { state.cycles.push(options); return { poll: { skipped: "off" }, matched: 0, suggested: 0, reviewed: 0 }; },
  };
  const api = createFreelancerInvoicesHandler(deps);
  const cron = createFreelancerInvoicesCronHandler(deps);
  const call = (h) => async (req) => {
    const response = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    await h(req, response);
    return response;
  };
  const auth = { authorization: "Bearer t" };
  return {
    tables, ops, state, deps,
    get: (query) => call(api)({ method: "GET", query, headers: auth }),
    post: (body) => call(api)({ method: "POST", body, headers: auth }),
    cron: (headers) => call(cron)({ method: "GET", headers }),
  };
}

test("a non-admin GET month is refused (403)", async () => {
  const f = fixture({ role: "member" });
  const res = await f.get({ resource: "month", month: MONTH });
  assert.equal(res.code, 403);
});

test("GET month builds rows, flags a freelancer with CRA and no invoice as missing", async () => {
  const f = fixture();
  const res = await f.get({ resource: "month", month: MONTH });
  assert.equal(res.code, 200);
  const bob = res.body.rows.find((r) => r.employeeId === "emp-bob");
  assert.equal(bob.name, "Bob Martin");
  assert.deepEqual(bob.expected, { days: 1.5, cents: 97500 });
  assert.equal(bob.missing, true);
  assert.equal(bob.missingRate, false);
  assert.equal(bob.invoices.length, 0);
  const ana = res.body.rows.find((r) => r.employeeId === "emp-ana");
  assert.equal(ana.missing, false);
  assert.deepEqual(ana.expected, { days: 1, cents: 70000 });
  assert.equal(ana.check.reason, "mismatch");
  assert.equal(ana.invoices[0].display.status, "to_check");
  assert.equal(ana.invoices[0].version, 1);
  // CDI employees never appear.
  assert.ok(!res.body.rows.some((r) => r.employeeId === "emp-cdi"));
  assert.equal((await f.get({ resource: "month", month: "2026-10" })).code, 400);
});

test("GET year returns each month up to the current one, checked as GET month", async () => {
  const f = fixture();
  const res = await f.get({ resource: "year", year: "2026" });
  assert.equal(res.code, 200);
  // The fixture clock is 11 Nov 2026: January to November.
  assert.deepEqual(res.body.months.map((m) => m.month), Array.from({ length: 11 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`));
  const october = res.body.months.find((m) => m.month === MONTH);
  const single = (await f.get({ resource: "month", month: MONTH })).body;
  assert.deepEqual(october.rows, single.rows);
  assert.equal((await f.get({ resource: "year", year: "26" })).code, 400);
});

test("a non-admin GET year is refused (403)", async () => {
  const f = fixture({ role: "member" });
  assert.equal((await f.get({ resource: "year", year: "2026" })).code, 403);
});

test("GET month surfaces a missing TJM", async () => {
  const f = fixture({ extra: { employee_salaries: [] } });
  const res = await f.get({ resource: "month", month: MONTH });
  const bob = res.body.rows.find((r) => r.employeeId === "emp-bob");
  assert.equal(bob.missingRate, true);
});

test("GET month lists suggestions for an unpaid invoice", async () => {
  const f = fixture({ extra: { freelancer_invoice_matches: [{ invoice_id: "00000000-0000-4000-8000-000000000001", transaction_id: "tx-1", kind: "probable", state: "suggested" }] } });
  const res = await f.get({ resource: "month", month: MONTH });
  const ana = res.body.rows.find((r) => r.employeeId === "emp-ana");
  assert.deepEqual(ana.invoices[0].suggestions, [
    { transactionId: "tx-1", amountCents: 1008000, settledAt: "2026-11-08T10:00:00Z", counterparty: "ANA LOPEZ CONSEIL", label: "", reference: "", iban: "FR7630004000031234567890143", why: "probable" },
  ]);
});

test("GET month shows the debit that paid an invoice, how it was matched and what else it paid", async () => {
  const f = fixture({ extra: { freelancer_invoice_matches: [{ invoice_id: "00000000-0000-4000-8000-000000000001", transaction_id: "tx-1", kind: "confident", state: "confirmed", decided_by: "freelancer invoices cycle" }] } });
  Object.assign(f.tables.freelancer_invoices[0], { paid_at: "2026-11-08T10:00:00Z", paid_by_transaction_id: "tx-1" });
  f.tables.freelancer_invoices.push({ ...f.tables.freelancer_invoices[0], id: "00000000-0000-4000-8000-000000000002", number: "F-2", period_month: "2026-09-01" });
  Object.assign(f.tables.bank_transactions[0], { label: "Virement Ana", reference: "Facture F-1" });
  const res = await f.get({ resource: "month", month: MONTH });
  const ana = res.body.rows.find((r) => r.employeeId === "emp-ana");
  assert.deepEqual(ana.invoices[0].payment, {
    transactionId: "tx-1", amountCents: 1008000, settledAt: "2026-11-08T10:00:00Z", counterparty: "ANA LOPEZ CONSEIL",
    label: "Virement Ana", reference: "Facture F-1", iban: "FR7630004000031234567890143",
    matchedBy: "automatic", decidedBy: "freelancer invoices cycle", alsoPays: ["F-2"],
  });
  assert.equal(ana.invoices[0].suggestions.length, 0);
});

test("GET month: an unpaid invoice has no payment", async () => {
  const res = await fixture().get({ resource: "month", month: MONTH });
  assert.equal(res.body.rows.find((r) => r.employeeId === "emp-ana").invoices[0].payment, null);
});

test("accept_difference needs a note of at least 3 characters", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "accept_difference", id: "00000000-0000-4000-8000-000000000001", note: "ok" })).code, 400);
  assert.equal(f.tables.freelancer_invoices[0].review, "to_check");
  const ok = await f.post({ action: "accept_difference", id: "00000000-0000-4000-8000-000000000001", note: "Expenses billed" });
  assert.equal(ok.code, 200);
  assert.equal(f.tables.freelancer_invoices[0].review, "ok");
  assert.equal(f.tables.freelancer_invoices[0].review_note, "Expenses billed");
  const event = f.tables.freelancer_invoice_events.at(-1);
  assert.equal(event.actor_email, "admin@quicksort.fr");
});

test("confirm_match marks paid and prefills the billing IBAN from the debit", async () => {
  const f = fixture({ extra: { freelancer_invoice_matches: [{ invoice_id: "00000000-0000-4000-8000-000000000001", transaction_id: "tx-1", kind: "probable", state: "suggested" }] } });
  const res = await f.post({ action: "confirm_match", invoiceId: "00000000-0000-4000-8000-000000000001", transactionId: "tx-1" });
  assert.equal(res.code, 200);
  const inv = f.tables.freelancer_invoices[0];
  assert.equal(inv.paid_at, "2026-11-08T10:00:00Z");
  assert.equal(inv.paid_by_transaction_id, "tx-1");
  assert.equal(f.tables.freelancer_invoice_matches[0].state, "confirmed");
  assert.equal(f.tables.freelancer_billing[0].iban, "FR7630004000031234567890143");
  assert.equal(f.tables.freelancer_billing[0].company_name, "ANA LOPEZ CONSEIL");
  assert.equal(f.tables.freelancer_billing[0].updated_by, "admin@quicksort.fr");
  const call = f.ops.find((o) => o.name === "freelancer_invoice_mark_paid");
  assert.deepEqual(call.args.invoice_ids, ["00000000-0000-4000-8000-000000000001"]);
  assert.equal(call.args.match_kind, "probable");
  assert.equal(call.args.actor, "admin@quicksort.fr");
  const event = f.tables.freelancer_invoice_events.find((e) => e.kind === "paid_confirmed");
  assert.equal(event.actor_email, "admin@quicksort.fr");
});

test("confirm_match refuses a debit that already pays another invoice", async () => {
  const f = fixture({ extra: { freelancer_invoices: [invoice(), invoice({ id: "00000000-0000-4000-8000-000000000002", number: "F-09", paid_at: "2026-11-08T10:00:00Z", paid_by_transaction_id: "tx-1" })] } });
  const res = await f.post({ action: "confirm_match", invoiceId: "00000000-0000-4000-8000-000000000001", transactionId: "tx-1" });
  assert.equal(res.code, 409);
  assert.equal(f.tables.freelancer_invoices[0].paid_at, null);
});

test("link_debit pays several invoices; unlink clears one and dismisses its match", async () => {
  const f = fixture({ extra: { freelancer_invoices: [invoice({ amount_ttc_cents: 504000 }), invoice({ id: "00000000-0000-4000-8000-000000000002", number: "F-11", amount_ttc_cents: 504000 })] } });
  const res = await f.post({ action: "link_debit", invoiceIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"], transactionId: "tx-1" });
  assert.equal(res.code, 200);
  assert.ok(f.tables.freelancer_invoices.every((i) => i.paid_by_transaction_id === "tx-1"));
  assert.deepEqual(f.tables.freelancer_invoice_matches.map((m) => [m.invoice_id, m.kind, m.state]), [["00000000-0000-4000-8000-000000000001", "manual", "confirmed"], ["00000000-0000-4000-8000-000000000002", "manual", "confirmed"]]);
  // The debit is now used: another invoice cannot take it.
  f.tables.freelancer_invoices.push(invoice({ id: "00000000-0000-4000-8000-000000000003", number: "F-12" }));
  assert.equal((await f.post({ action: "link_debit", invoiceIds: ["00000000-0000-4000-8000-000000000003"], transactionId: "tx-1" })).code, 409);
  const un = await f.post({ action: "unlink", invoiceId: "00000000-0000-4000-8000-000000000001" });
  assert.equal(un.code, 200);
  assert.equal(f.tables.freelancer_invoices[0].paid_at, null);
  assert.equal(f.tables.freelancer_invoices[0].paid_by_transaction_id, null);
  assert.equal(f.tables.freelancer_invoice_matches[0].state, "dismissed");
  assert.equal(f.tables.freelancer_invoice_matches[1].state, "confirmed");
});

test("update_fields is versioned and clears unreadable once amount and period are set", async () => {
  const f = fixture({ extra: { freelancer_invoices: [invoice({ amount_ht_cents: null, period_month: null, flags: ["unreadable"], version: 3 })] } });
  assert.equal((await f.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 2, fields: { amountHtCents: 840000 } })).code, 409);
  const res = await f.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 3, fields: { amountHtCents: 840000, periodMonth: MONTH } });
  assert.equal(res.code, 200);
  const inv = f.tables.freelancer_invoices[0];
  assert.equal(inv.amount_ht_cents, 840000);
  assert.deepEqual(inv.flags, []);
  assert.equal(inv.version, 4);
});

test("update_fields on an approved invoice sends it back to check when the amount changes", async () => {
  const f = fixture({ extra: { freelancer_invoices: [invoice({ review: "ok" })] } });
  const res = await f.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 1, fields: { amountHtCents: 900000, dueDate: "2026-12-10" } });
  assert.equal(res.code, 200);
  assert.equal(f.tables.freelancer_invoices[0].review, "to_check");
  assert.ok(f.tables.freelancer_invoice_events.some((e) => e.kind === "review_reset"));
  // A due date alone keeps the approval.
  const g = fixture({ extra: { freelancer_invoices: [invoice({ review: "ok" })] } });
  await g.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 1, fields: { dueDate: "2026-12-10" } });
  assert.equal(g.tables.freelancer_invoices[0].review, "ok");
  // Not a real day.
  assert.equal((await g.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 2, fields: { issueDate: "2026-13-45" } })).code, 400);
  assert.equal((await g.post({ action: "update_fields", id: "00000000-0000-4000-8000-000000000001", version: 2, fields: { issueDate: "2026-02-30" } })).code, 400);
});

test("accept_difference refuses a rejected invoice (409)", async () => {
  const f = fixture({ extra: { freelancer_invoices: [invoice({ review: "rejected" })] } });
  assert.equal((await f.post({ action: "accept_difference", id: "00000000-0000-4000-8000-000000000001", note: "Expenses billed" })).code, 409);
  assert.equal(f.tables.freelancer_invoices[0].review, "rejected");
});

test("save_billing validates IBAN and SIRET; save_mailbox records the admin", async () => {
  const f = fixture();
  const base = { action: "save_billing", employeeId: "00000000-0000-4000-8000-0000000000e1", companyName: "Ana Conseil", siret: "", iban: "", extraEmails: [] };
  f.tables.employees.push({ id: base.employeeId, person_id: "p-ana", contract_type: "Freelance", status: "active" });
  assert.equal((await f.post({ ...base, iban: "not an iban" })).code, 400);
  assert.equal((await f.post({ ...base, siret: "1234" })).code, 400);
  const ok = await f.post({ ...base, iban: "fr76 3000 4000 0312 3456 7890 143", siret: "123 456 789 00012" });
  assert.equal(ok.code, 200);
  const saved = f.tables.freelancer_billing.find((b) => b.employee_id === base.employeeId);
  assert.equal(saved.iban, "FR7630004000031234567890143");
  assert.equal(saved.siret, "12345678900012");
  assert.equal((await f.post({ action: "save_mailbox", address: "billing@quicksort.fr", backfillFrom: "2026-02-31" })).code, 400);
  assert.equal((await f.post({ action: "save_mailbox", address: "billing@quicksort.fr", backfillFrom: "2026-02-01" })).code, 200);
  assert.equal(f.tables.freelancer_mailbox_settings[0].updated_by, "admin@quicksort.fr");
});

test("save_billing with a new extra email re-reads the mailbox from the backfill date; same emails do not", async () => {
  const f = fixture();
  const base = { action: "save_billing", employeeId: "00000000-0000-4000-8000-0000000000e1", companyName: "", siret: "", iban: "", extraEmails: [] };
  f.tables.employees.push({ id: base.employeeId, person_id: "p-ana", contract_type: "Freelance", status: "active" });
  const mailbox = f.tables.freelancer_mailbox_settings[0];
  mailbox.last_polled_at = "2026-11-10T09:00:00Z";
  assert.equal((await f.post(base)).code, 200);
  assert.equal(mailbox.last_polled_at, "2026-11-10T09:00:00Z");
  assert.equal((await f.post({ ...base, extraEmails: ["No-Reply@invoice.tiime.fr"] })).code, 200);
  assert.equal(mailbox.last_polled_at, null);
  mailbox.last_polled_at = "2026-11-12T09:00:00Z";
  assert.equal((await f.post({ ...base, extraEmails: ["no-reply@invoice.tiime.fr"] })).code, 200);
  assert.equal(mailbox.last_polled_at, "2026-11-12T09:00:00Z");
});

test("portal_upload ignores a body employeeId and files under the caller's own freelance employment", async () => {
  const f = fixture({ role: "member" });
  f.state.profile = "user-ana";
  const res = await f.post({ action: "portal_upload", employeeId: "emp-bob", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF });
  assert.equal(res.code, 200);
  assert.equal(f.state.ingested.length, 1);
  assert.equal(f.state.ingested[0].employeeId, "emp-ana");
  assert.equal(f.state.ingested[0].source, "portal");
  assert.equal(f.state.ingested[0].actorEmail, "ana@example.com");
});

test("portal_upload from a CDI employee is refused (403)", async () => {
  const f = fixture({ role: "member" });
  f.state.profile = "user-cdi";
  const res = await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF });
  assert.equal(res.code, 403);
  assert.equal(f.state.ingested.length, 0);
});

test("portal_upload of a non-PDF is refused (400)", async () => {
  const f = fixture({ role: "member" });
  f.state.profile = "user-ana";
  const png = Buffer.from("\x89PNG\r\n\x1a\n0000").toString("base64");
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: png })).code, 400);
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.png", mimeType: "image/png", data: PDF })).code, 400);
  assert.equal(f.state.ingested.length, 0);
});

test("portal_upload above 3 MB is refused (400)", async () => {
  const f = fixture({ role: "member" });
  f.state.profile = "user-ana";
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(3 * 1024 * 1024)]).toString("base64");
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: big })).code, 400);
  assert.equal(f.state.ingested.length, 0);
});

test("the cron without the secret is refused (401); with it the cycle runs", async () => {
  const f = fixture();
  assert.equal((await f.cron({})).code, 401);
  assert.equal((await f.cron({ authorization: "Bearer nope" })).code, 401);
  assert.equal(f.state.cycles.length, 0);
  const ok = await f.cron({ authorization: "Bearer cron-secret" });
  assert.equal(ok.code, 200);
  assert.equal(f.state.cycles.length, 1);
  assert.notEqual(f.state.cycles[0].pollMail, false);
});

test("the bank cron runs the cycle without mail, and survives its failure", async () => {
  const f = fixture();
  const call = async (h) => {
    const response = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    await h({ method: "GET", headers: { authorization: "Bearer cron-secret" } }, response);
    return response;
  };
  const cycles = [];
  f.tables.invoicing_settings = [{ id: "default", encrypted_credentials: encryptCredentials({ secret: "qs", stagingToken: null }), options: { login: "org", iban: "FR76", staging: false } }];
  const bankDeps = {
    createClient: () => memoryClient(f.tables, f.ops),
    runBankSync: async () => ({ status: "ok", fetched: 1, classified: 0, remaining: 0 }),
  };
  const good = await call(createBankCronHandler({
    ...bankDeps,
    runFreelancerInvoicesCycle: async (_c, o) => { cycles.push(o); return { matched: 2 }; },
  }));
  assert.equal(good.code, 200);
  assert.equal(good.body.status, "ok");
  assert.deepEqual(good.body.freelancerInvoices, { matched: 2 });
  assert.equal(cycles[0].pollMail, false);
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(" ")); };
  try {
    const bad = await call(createBankCronHandler({
      ...bankDeps,
      runFreelancerInvoicesCycle: async () => { throw new Error("boom"); },
    }));
    assert.equal(bad.code, 200);
    assert.equal(bad.body.status, "ok");
    assert.equal(bad.body.freelancerInvoices, undefined);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /boom/);

    // Less than 30 s of the 120 s budget left after the bank sync: matching is skipped.
    let t = 0;
    const late = [];
    const slow = await call(createBankCronHandler({
      ...bankDeps,
      clock: () => (t += 95_000),
      runFreelancerInvoicesCycle: async (_c, o) => { late.push(o); return { matched: 1 }; },
    }));
    assert.equal(slow.code, 200);
    assert.equal(slow.body.freelancerInvoices, undefined);
    assert.equal(late.length, 0);
    assert.equal(logged.length, 2);
    assert.match(logged[1], /skipped/);
  } finally {
    console.error = original;
  }
});

const INV1 = "00000000-0000-4000-8000-000000000001";

test("update_fields stores credit-note amounts negative and invoice amounts positive", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "update_fields", id: INV1, version: 1, fields: { isCreditNote: true, amountHtCents: 100000, vatCents: 20000, amountTtcCents: 120000 } })).code, 200);
  let inv = f.tables.freelancer_invoices[0];
  assert.deepEqual([inv.is_credit_note, inv.amount_ht_cents, inv.vat_cents, inv.amount_ttc_cents], [true, -100000, -20000, -120000]);
  // Ticking the box alone flips the stored amounts.
  const g = fixture();
  await g.post({ action: "update_fields", id: INV1, version: 1, fields: { isCreditNote: true } });
  inv = g.tables.freelancer_invoices[0];
  assert.deepEqual([inv.amount_ht_cents, inv.vat_cents, inv.amount_ttc_cents], [-840000, -168000, -1008000]);
  // An amount typed positive on an existing credit note stays negative.
  await g.post({ action: "update_fields", id: INV1, version: 2, fields: { amountHtCents: 50000 } });
  assert.equal(g.tables.freelancer_invoices[0].amount_ht_cents, -50000);
  // Back to an invoice: positive again.
  await g.post({ action: "update_fields", id: INV1, version: 3, fields: { isCreditNote: false } });
  inv = g.tables.freelancer_invoices[0];
  assert.deepEqual([inv.amount_ht_cents, inv.vat_cents, inv.amount_ttc_cents], [50000, 168000, 1008000]);
});

test("portal_upload accepts a freelancer whose employment ended in the last 90 days", async () => {
  const f = fixture({ role: "member" });
  f.tables.employees[0] = { ...f.tables.employees[0], status: "ended", end_date: "2026-10-01" };
  f.state.profile = "user-ana";
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF })).code, 200);
  assert.equal(f.state.ingested[0].employeeId, "emp-ana");
  // Ended over 90 days ago: refused.
  const g = fixture({ role: "member" });
  g.tables.employees[0] = { ...g.tables.employees[0], status: "ended", end_date: "2026-07-01" };
  g.state.profile = "user-ana";
  assert.equal((await g.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF })).code, 403);
  // Renewed: the open employment wins over the one just ended.
  const h = fixture({ role: "member" });
  h.tables.employees[0] = { ...h.tables.employees[0], id: "emp-ana-old", status: "ended", end_date: "2026-10-31" };
  h.tables.employees.push({ id: "emp-ana-new", person_id: "p-ana", contract_type: "Freelance", status: "active", end_date: null });
  h.state.profile = "user-ana";
  assert.equal((await h.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF })).code, 200);
  assert.equal(h.state.ingested[0].employeeId, "emp-ana-new");
});

test("an upload matches payments right away; a failing match never fails it", async () => {
  const f = fixture({ role: "member" });
  f.state.profile = "user-ana";
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF })).code, 200);
  assert.equal(f.state.cycles.length, 1);
  assert.equal(f.state.cycles[0].pollMail, false);
  // A duplicate changes nothing to match.
  f.deps.ingest = async () => ({ invoiceId: "inv-old", duplicate: true });
  assert.equal((await f.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF })).code, 200);
  assert.equal(f.state.cycles.length, 1);

  const g = fixture({ role: "member" });
  g.state.profile = "user-ana";
  g.deps.runCycle = async () => { throw new Error("matching down"); };
  const logged = [];
  const original = console.error;
  console.error = (...args) => { logged.push(args.map(String).join(" ")); };
  try {
    const res = await g.post({ action: "portal_upload", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF });
    assert.equal(res.code, 200);
    assert.equal(res.body.received, true);
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /matching down/);
});

test("an admin uploads an invoice for a freelancer", async () => {
  const upload = { action: "upload", employeeId: "00000000-0000-4000-8000-0000000000a1", fileName: "facture.pdf", mimeType: "application/pdf", data: PDF };
  const member = fixture({ role: "member" });
  assert.equal((await member.post(upload)).code, 403);
  assert.equal(member.state.ingested.length, 0);

  const f = fixture();
  f.tables.employees.push(
    { id: upload.employeeId, person_id: "p-ana", contract_type: "Freelance", status: "ended", end_date: "2025-01-31" },
    { id: "00000000-0000-4000-8000-0000000000c1", person_id: "p-cdi", contract_type: "CDI", status: "active" },
  );
  const res = await f.post(upload);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { received: true, duplicate: false });
  assert.equal(f.state.ingested.length, 1);
  assert.deepEqual([f.state.ingested[0].employeeId, f.state.ingested[0].source, f.state.ingested[0].actorEmail], [upload.employeeId, "portal", "admin@quicksort.fr"]);
  assert.equal(f.state.cycles.length, 1);
  assert.equal(f.state.cycles[0].pollMail, false);
  // Only freelancers, only PDFs of 3 MB at most.
  assert.equal((await f.post({ ...upload, employeeId: "00000000-0000-4000-8000-0000000000c1" })).code, 400);
  assert.equal((await f.post({ ...upload, employeeId: "00000000-0000-4000-8000-0000000000f9" })).code, 404);
  assert.equal((await f.post({ ...upload, mimeType: "image/png" })).code, 400);
  assert.equal((await f.post({ ...upload, data: Buffer.from("not a pdf").toString("base64") })).code, 400);
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(3 * 1024 * 1024)]).toString("base64");
  assert.equal((await f.post({ ...upload, data: big })).code, 400);
  assert.equal(f.state.ingested.length, 1);
});

test("sync polls with the 150 s budget", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "sync" })).code, 200);
  assert.equal(f.state.cycles[0].pollBudgetMs, 150_000);
});

test("confirm_match logs the billing it prefilled, and nothing when billing was already set", async () => {
  const f = fixture();
  await f.post({ action: "confirm_match", invoiceId: INV1, transactionId: "tx-1" });
  const event = f.tables.freelancer_invoice_events.find((e) => e.kind === "billing_prefilled");
  assert.equal(event.invoice_id, INV1);
  assert.equal(event.actor_email, "admin@quicksort.fr");
  assert.deepEqual(event.detail, { transactionId: "tx-1", company_name: "ANA LOPEZ CONSEIL", iban: "FR7630004000031234567890143" });

  const g = fixture({ extra: { freelancer_billing: [{ employee_id: "emp-ana", company_name: "Ana Conseil", siret: "", iban: "FR7612345000011234567890189", extra_emails: [] }] } });
  await g.post({ action: "confirm_match", invoiceId: INV1, transactionId: "tx-1" });
  assert.ok(!g.tables.freelancer_invoice_events.some((e) => e.kind === "billing_prefilled"));
});

test("unlink clears billing details that came from the wrong debit", async () => {
  const f = fixture();
  await f.post({ action: "confirm_match", invoiceId: INV1, transactionId: "tx-1" });
  assert.equal(f.tables.freelancer_billing[0].iban, "FR7630004000031234567890143");
  assert.equal((await f.post({ action: "unlink", invoiceId: INV1 })).code, 200);
  assert.equal(f.tables.freelancer_billing[0].iban, "");
  assert.equal(f.tables.freelancer_billing[0].company_name, "");
  const event = f.tables.freelancer_invoice_events.find((e) => e.kind === "billing_cleared");
  assert.deepEqual(event.detail, { transactionId: "tx-1", iban: "FR7630004000031234567890143", company_name: "ANA LOPEZ CONSEIL" });

  // Details that differ from the debit are kept, and nothing is logged.
  const g = fixture({ extra: {
    freelancer_billing: [{ employee_id: "emp-ana", company_name: "Ana Conseil", siret: "", iban: "FR7612345000011234567890189", extra_emails: [] }],
    freelancer_invoices: [invoice({ paid_at: "2026-11-08T10:00:00Z", paid_by_transaction_id: "tx-1" })],
  } });
  assert.equal((await g.post({ action: "unlink", invoiceId: INV1 })).code, 200);
  assert.equal(g.tables.freelancer_billing[0].iban, "FR7612345000011234567890189");
  assert.equal(g.tables.freelancer_billing[0].company_name, "Ana Conseil");
  assert.ok(!g.tables.freelancer_invoice_events.some((e) => e.kind === "billing_cleared"));
});

test("only a completed debit can pay an invoice", async () => {
  const f = fixture();
  f.tables.bank_transactions[0].status = "pending";
  assert.equal((await f.post({ action: "confirm_match", invoiceId: INV1, transactionId: "tx-1" })).code, 400);
  assert.equal((await f.post({ action: "link_debit", invoiceIds: [INV1], transactionId: "tx-1" })).code, 400);
  assert.equal(f.tables.freelancer_invoices[0].paid_at, null);
});

test("save_mailbox restarts the poll window when the address or start date changes", async () => {
  const f = fixture();
  f.tables.freelancer_mailbox_settings[0].last_polled_at = "2026-11-10T09:00:00Z";
  await f.post({ action: "save_mailbox", address: "Mohamed@quicksort.fr", backfillFrom: "2026-01-01" });
  assert.equal(f.tables.freelancer_mailbox_settings[0].last_polled_at, "2026-11-10T09:00:00Z");
  await f.post({ action: "save_mailbox", address: "mohamed@quicksort.fr", backfillFrom: "2025-12-01" });
  assert.equal(f.tables.freelancer_mailbox_settings[0].last_polled_at, null);
  f.tables.freelancer_mailbox_settings[0].last_polled_at = "2026-11-10T09:00:00Z";
  await f.post({ action: "save_mailbox", address: "billing@quicksort.fr", backfillFrom: "2025-12-01" });
  assert.equal(f.tables.freelancer_mailbox_settings[0].last_polled_at, null);
});

test("the cycle only matches completed debits", async () => {
  const { runFreelancerInvoicesCycle } = await import("../apps/admin/server/freelancer-invoices/run.ts");
  const billing = [{ employee_id: "emp-ana", company_name: "", siret: "", iban: "FR7630004000031234567890143", extra_emails: [] }];
  const pending = fixture({ extra: { freelancer_billing: billing } });
  pending.tables.bank_transactions[0].status = "pending";
  pending.tables.bank_transactions[0].transfer = { counterparty_account_number: "FR7630004000031234567890143" };
  const none = await runFreelancerInvoicesCycle(pending.deps.createClient(), { pollMail: false });
  assert.equal(none.matched + none.suggested, 0);
  assert.equal(pending.tables.freelancer_invoices[0].paid_at, null);

  const completed = fixture({ extra: { freelancer_billing: billing } });
  completed.tables.bank_transactions[0].transfer = { counterparty_account_number: "FR7630004000031234567890143" };
  const paid = await runFreelancerInvoicesCycle(completed.deps.createClient(), { pollMail: false });
  assert.equal(paid.matched, 1);
  assert.equal(completed.tables.freelancer_invoices[0].paid_by_transaction_id, "tx-1");
});

test("the cycle matches a debit stored with a positive amount, and never a credit", async () => {
  const { runFreelancerInvoicesCycle } = await import("../apps/admin/server/freelancer-invoices/run.ts");
  const billing = [{ employee_id: "emp-ana", company_name: "", siret: "", iban: "FR7630004000031234567890143", extra_emails: [] }];
  const credit = fixture({ extra: { freelancer_billing: billing } });
  Object.assign(credit.tables.bank_transactions[0], { side: "credit", transfer: { counterparty_account_number: "FR7630004000031234567890143" } });
  const none = await runFreelancerInvoicesCycle(credit.deps.createClient(), { pollMail: false });
  assert.equal(none.matched + none.suggested, 0);

  const debit = fixture({ extra: { freelancer_billing: billing } });
  debit.tables.bank_transactions[0].transfer = { counterparty_account_number: "FR7630004000031234567890143" };
  const paid = await runFreelancerInvoicesCycle(debit.deps.createClient(), { pollMail: false });
  assert.equal(paid.matched, 1);
  assert.equal(debit.tables.freelancer_invoices[0].paid_at, "2026-11-08T10:00:00Z");
});

test("a PDF read ends 60 s after it starts, and never past the poll budget + 15 s", async () => {
  const { extractDeadline, POLL_BUDGET_MS } = await import("../apps/admin/server/freelancer-invoices/run.ts");
  assert.equal(POLL_BUDGET_MS, 150_000);
  assert.equal(extractDeadline(1_000), 61_000);
  assert.equal(extractDeadline(1_000, 500_000), 61_000);
  assert.equal(extractDeadline(149_000, 150_000), 165_000);
});
