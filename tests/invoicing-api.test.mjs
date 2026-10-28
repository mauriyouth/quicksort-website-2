import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvoicingHandler } from "../apps/admin/api/invoicing.ts";
import { encryptCredentials } from "../apps/admin/server/invoicing/settings.ts";
import { providerFromSettings } from "../apps/admin/server/invoicing/settings.ts";
import { ProviderError } from "../apps/admin/server/invoicing/provider.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);
const SECRET = "super-secret-qonto-key";
const PROJECT = "11111111-1111-4111-8111-111111111111";

const EMP = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";

// First 18 weekdays of September 2026 (no French holiday in that range).
function septemberDays(count = 18) {
  const out = [];
  for (let d = 1; out.length < count; d++) {
    const day = `2026-09-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(day);
  }
  return out;
}

function remoteInvoice(overrides = {}) {
  return {
    id: "q-1", number: null, status: "draft", clientId: "qc-1", clientEmails: ["billing@acme.test"],
    issueDate: "2026-10-28", dueDate: "2026-11-27", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    currency: "EUR", totalHt: "11700.00", totalVat: "2340.00", totalTtc: "14040.00",
    paidAt: null, finalizedAt: null, invoiceUrl: "https://qonto.test/i/q-1", purchaseOrder: "", lines: [],
    ...overrides,
  };
}

// In-memory Supabase: tables are arrays, filters are applied, writes are logged in `ops`.
function memoryClient(tables, ops, { failures = {}, hooks = {} } = {}) {
  let seq = 0;
  const copy = (r) => ({ ...r });
  return {
    rpc: async () => ({ data: "user-1", error: null }),
    from(table) {
      const filters = [];
      let mode = "select", payload, options, returning = false, single = null, orderBy = null;
      const cmp = (fn) => (c, v) => { filters.push((r) => fn(r[c], v)); return q; };
      const q = {
        select() { if (mode !== "select") returning = true; return q; },
        eq: cmp((a, b) => a === b), neq: cmp((a, b) => a !== b), in: cmp((a, b) => b.includes(a)),
        gte: cmp((a, b) => a != null && a >= b), lte: cmp((a, b) => a != null && a <= b),
        gt: cmp((a, b) => a != null && a > b), lt: cmp((a, b) => a != null && a < b),
        is: cmp((a, b) => (a ?? null) === b),
        order(c, o = {}) { orderBy = { c, asc: o.ascending !== false }; return q; },
        limit() { return q; },
        insert(v) { mode = "insert"; payload = v; return q; },
        update(v) { mode = "update"; payload = v; return q; },
        upsert(v, o) { mode = "upsert"; payload = v; options = o; return q; },
        delete() { mode = "delete"; return q; },
        single() { single = "one"; return q; },
        maybeSingle() { single = "maybe"; return q; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      function shape(list) {
        if (!single) return { data: list, error: null };
        if (list.length === 1) return { data: list[0], error: null };
        if (single === "maybe" && list.length === 0) return { data: null, error: null };
        return { data: null, error: { message: "single row expected", code: "PGRST116" } };
      }
      function run() {
        const rows = (tables[table] ??= []);
        const match = (r) => filters.every((f) => f(r));
        if (mode !== "select") ops.push({ op: mode, table, value: payload, options });
        const failure = failures[`${table}.${mode}`];
        if (failure) return { data: null, error: failure };
        if (mode === "select") {
          const list = rows.filter(match).map(copy);
          if (orderBy) list.sort((a, b) => ((a[orderBy.c] ?? "") < (b[orderBy.c] ?? "") ? -1 : (a[orderBy.c] ?? "") > (b[orderBy.c] ?? "") ? 1 : 0) * (orderBy.asc ? 1 : -1));
          return shape(list);
        }
        if (mode === "insert") {
          hooks[`${table}.insert`]?.(tables);
          const added = [];
          for (const v of Array.isArray(payload) ? payload : [payload]) {
            const row = { id: `${table}-${++seq}`, created_at: new Date(Date.UTC(2026, 9, 28, 0, 0, seq)).toISOString(), ...v };
            if (table === "invoices") {
              Object.assign(row, { ignored: false, sent_at: null, ...row });
              const clash = rows.some((r) => row.source === "cra" && r.source === "cra" && r.status !== "canceled" && row.status !== "canceled" &&
                r.project_id === row.project_id && r.employee_id === row.employee_id && r.period_month === row.period_month);
              if (clash) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
            }
            rows.push(row);
            added.push(copy(row));
          }
          return returning ? shape(added) : { data: null, error: null };
        }
        if (mode === "update") {
          const changed = rows.filter(match);
          for (const r of changed) Object.assign(r, payload);
          return returning ? shape(changed.map(copy)) : { data: null, error: null };
        }
        if (mode === "upsert") {
          const keys = (options?.onConflict ?? "id").split(",");
          for (const v of Array.isArray(payload) ? payload : [payload]) {
            const found = rows.find((r) => keys.every((k) => r[k] === v[k]));
            if (found) { if (!options?.ignoreDuplicates) Object.assign(found, v); }
            else rows.push({ id: `${table}-${++seq}`, ...v });
          }
          return { data: null, error: null };
        }
        const gone = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
        if (table === "invoices") {
          const ids = new Set(gone.map((r) => r.id));
          for (const child of ["invoice_lines", "invoice_events"]) tables[child] = (tables[child] ?? []).filter((r) => !ids.has(r.invoice_id));
        }
        return { data: null, error: null };
      }
      return q;
    },
  };
}

function fixture({ admin = true, saved = true, accountsError = null, productLinked = true, invoices = [], provider: overrides = {}, failures, hooks, lastSyncedAt = null } = {}) {
  const tables = {
    user_roles: [{ user_id: "user-1", role: admin ? "admin" : "member" }],
    invoicing_settings: saved ? [{ id: "default", provider: "qonto", encrypted_credentials: encryptCredentials({ secret: SECRET, stagingToken: null }), options: { login: "org", iban: "FR76", staging: false, due_days: 30 }, start_month: "2026-01-01", last_synced_at: lastSyncedAt }] : [],
    employees: [{ id: EMP, person_id: "per-1", start_date: "2024-01-01", end_date: null }],
    hr_people: [{ id: "per-1", full_name: "Jane Doe" }],
    sales_projects: [
      { id: PROJECT, title: "Data platform", client_id: CLIENT, intermediary_client_id: null, pricing_model: "regie", currency: "EUR", tjm_profiles: [{ name: "Data Engineer", tjm: 650, end_date: null }], start_date: "2026-08-01", end_date: null },
      { id: P2, title: "Other", client_id: CLIENT, intermediary_client_id: null, pricing_model: "regie", currency: "EUR", tjm_profiles: [], start_date: "2026-01-01", end_date: null },
    ],
    sales_project_extensions: [],
    sales_clients: [{ id: CLIENT, name: "Acme" }],
    invoicing_client_links: [{ client_id: CLIENT, provider: "qonto", provider_client_id: "qc-1", provider_client_name: "Acme" }],
    invoicing_product_links: productLinked ? [{ project_id: PROJECT, pricing_line: "Data Engineer", provider: "qonto", provider_product_id: "prod-1", title: "Prestation de conseil", description: "Assistance technique", unit: "jour", vat_rate: 0.2 }] : [],
    employee_project_assignments: [{ employee_id: EMP, project_id: PROJECT, pricing_line: "Data Engineer", start_date: "2026-08-01", end_date: null, status: "active" }],
    cra_months: [{ employee_id: EMP, month: "2026-09-01", version: 3 }],
    cra_entries: septemberDays().map((day) => ({ employee_id: EMP, month: "2026-09-01", day, part: "full", status: "client_project", project_id: PROJECT })),
    invoices: invoices.map((r) => ({ provider: "qonto", ignored: false, sent_at: null, currency: "EUR", total_ht: 0, total_vat: 0, total_ttc: 0, purchase_order: "", ...r })),
    invoice_lines: [],
    invoice_events: [],
  };
  const ops = [];
  const calls = [];
  const client = memoryClient(tables, ops, { failures, hooks });
  const base = {
    name: "qonto",
    listPaymentAccounts: async () => { if (accountsError) throw accountsError; return [{ iban: "FR76", name: "Main" }]; },
    listClients: async () => [], listProducts: async () => [],
    listInvoices: async () => [],
    getInvoice: async (id) => remoteInvoice({ id }),
    createDraft: async (draft) => remoteInvoice({ id: "q-1", lines: draft.lines }),
    updateDraft: async (id, draft) => remoteInvoice({ id, lines: draft.lines }),
    deleteDraft: async () => {},
    finalize: async (id) => remoteInvoice({ id, status: "finalized", number: "F-2026-0042", finalizedAt: "2026-10-28T09:00:00Z" }),
    send: async () => {},
    cancel: async (id) => remoteInvoice({ id, status: "canceled", number: "F-2026-0042" }),
    ...overrides,
  };
  const provider = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === "function" ? (...args) => { calls.push({ name: k, args }); return v(...args); } : v]));
  const count = (name) => calls.filter((c) => c.name === name).length;
  const handler = createInvoicingHandler({ createClient: () => client, createProvider: () => provider, now: () => new Date("2026-10-28T09:00:00Z") });
  return { ops, tables, calls, count, async request(method, { query, body } = {}) {
    const response = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(b) { this.body = b; } };
    await handler({ method, query, body, headers: { authorization: "Bearer t" } }, response);
    return response;
  } };
}

const DRAFT_REQUEST = { action: "create_draft", projectId: PROJECT, employeeId: EMP, month: "2026-09" };
const craInvoice = (overrides = {}) => ({ id: "inv-1", provider_invoice_id: "q-1", source: "cra", status: "draft", project_id: PROJECT, employee_id: EMP, period_month: "2026-09-01", cra_version: 3, billed_client_id: CLIENT, provider_client_id: "qc-1", issue_date: "2026-10-28", due_date: "2026-11-27", number: null, ...overrides });

test("non-admin gets 403", async () => {
  const r = await fixture({ admin: false }).request("GET", { query: { resource: "settings" } });
  assert.equal(r.code, 403);
});
test("settings never returns the secret", async () => {
  const r = await fixture().request("GET", { query: { resource: "settings" } });
  assert.equal(r.code, 200);
  assert.equal(r.body.hasSecret, true);
  assert.equal(r.body.startMonth, "2026-01");
  const json = JSON.stringify(r.body);
  assert.ok(!json.includes(SECRET) && !json.includes("encrypted"));
});
test("save_settings rejects bad credentials", async () => {
  const f = fixture({ accountsError: new ProviderError("Unauthorized", 401) });
  const r = await f.request("POST", { body: { action: "save_settings", login: "org", secret: "bad", iban: "FR76", staging: false, dueDays: 30, startMonth: "2026-01" } });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "Unauthorized");
  assert.equal(f.ops.length, 0);
});
test("save_settings without secret keeps stored credentials", async () => {
  const f = fixture();
  const r = await f.request("POST", { body: { action: "save_settings", login: "org", iban: "FR76", staging: false, dueDays: 45, startMonth: "2026-02" } });
  assert.equal(r.code, 200);
  assert.ok(!("encrypted_credentials" in f.ops[0].value));
  assert.equal(f.ops[0].value.start_month, "2026-02-01");
});
test("unconfigured provider returns 409 and unknown action 400", async () => {
  const f = fixture({ saved: false });
  const r = await f.request("GET", { query: { resource: "payment-accounts" } });
  assert.equal(r.code, 409);
  assert.equal(r.body.error, "Connect Qonto in Invoicing settings first.");
  assert.equal((await fixture().request("POST", { body: { action: "nope" } })).code, 400);
});
test("link_product copies product fields", async () => {
  const f = fixture();
  const r = await f.request("POST", { body: { action: "link_product", projectId: PROJECT, pricingLine: "Data Engineer", product: { id: "prod-1", title: "Prestation de conseil", description: "Assistance technique", unit: "jour", unitPrice: "600.00", vatRate: "0.2" } } });
  assert.equal(r.code, 200);
  assert.deepEqual(f.ops[0].value, { project_id: PROJECT, pricing_line: "Data Engineer", provider: "qonto", provider_product_id: "prod-1", title: "Prestation de conseil", description: "Assistance technique", unit: "jour", vat_rate: 0.2 });
});
test("providerFromSettings requires a secret", () => {
  assert.throws(() => providerFromSettings({ login: "", iban: "", staging: false, secret: null, stagingToken: null }));
});
test("staging without a staging token is rejected and fails closed", async () => {
  const f = fixture();
  const r = await f.request("POST", { body: { action: "save_settings", login: "org", secret: "new", iban: "FR76", staging: true, dueDays: 30, startMonth: "2026-01" } });
  assert.equal(r.code, 400);
  assert.equal(r.body.error, "Add the Qonto staging token to use the sandbox.");
  assert.equal(f.ops.length, 0);
  assert.throws(() => providerFromSettings({ login: "", iban: "", staging: true, secret: "s", stagingToken: null }), /staging token/);
});
test("link_product rejects an invalid vatRate", async () => {
  const f = fixture();
  const r = await f.request("POST", { body: { action: "link_product", projectId: PROJECT, pricingLine: "X", product: { id: "p", title: "t", description: "", unit: null, vatRate: "abc" } } });
  assert.equal(r.code, 400);
  assert.equal(f.ops.length, 0);
});

test("create_draft twice makes one provider call", async () => {
  const f = fixture();
  const first = await f.request("POST", { body: DRAFT_REQUEST });
  assert.equal(first.code, 200);
  const second = await f.request("POST", { body: DRAFT_REQUEST });
  assert.equal(second.code, 200);
  assert.equal(second.body.invoice.id, first.body.invoice.id);
  assert.equal(f.count("createDraft"), 1);
  const [draft] = f.calls.find((c) => c.name === "createDraft").args;
  assert.deepEqual({ ...draft, lines: undefined }, { clientId: "qc-1", issueDate: "2026-10-28", dueDate: "2026-11-27", currency: "EUR", periodStart: "2026-09-01", periodEnd: "2026-09-30", purchaseOrder: "", lines: undefined });
  assert.deepEqual(draft.lines, [{ title: "Prestation de conseil", description: "Assistance technique\nConsultant : Jane Doe — septembre 2026", quantity: "18", unit: "jour", unitPrice: "650.00", vatRate: "0.2" }]);
  const [row] = f.tables.invoices;
  assert.equal(row.provider_invoice_id, "q-1");
  assert.equal(row.status, "draft");
  assert.equal(row.cra_version, 3);
  assert.equal(row.total_ttc, "14040.00");
  assert.equal(f.tables.invoice_lines.length, 1);
  assert.equal(f.tables.invoice_lines[0].computed_quantity, 18);
  assert.equal(f.tables.invoice_lines[0].computed_unit_price, 650);
  assert.deepEqual(f.tables.invoice_events.map((e) => [e.kind, e.actor]), [["create_draft", "user-1"]]);
});
test("create_draft returns the row a concurrent request inserted", async () => {
  const f = fixture({ hooks: { "invoices.insert": (t) => { if (!t.invoices.length) t.invoices.push({ ...craInvoice({ id: "inv-race" }), provider: "qonto" }); } } });
  const r = await f.request("POST", { body: DRAFT_REQUEST });
  assert.equal(r.code, 200);
  assert.equal(r.body.invoice.id, "inv-race");
  assert.equal(f.count("createDraft"), 0);
});
test("create_draft rolls back on provider failure", async () => {
  const f = fixture({ provider: { createDraft: async () => { throw new ProviderError("client_id is invalid", 422); } } });
  const r = await f.request("POST", { body: DRAFT_REQUEST });
  assert.equal(r.code, 502);
  assert.equal(r.body.error, "client_id is invalid");
  assert.equal(f.tables.invoices.length, 0);
});
test("blocked draft returns 422", async () => {
  const f = fixture({ productLinked: false });
  const r = await f.request("POST", { body: DRAFT_REQUEST });
  assert.equal(r.code, 422);
  assert.equal(r.body.blocker, "product_not_linked");
  assert.equal(f.count("createDraft"), 0);
  assert.equal(f.tables.invoices.length, 0);
});
test("send refuses client without email", async () => {
  const f = fixture({ invoices: [craInvoice({ status: "finalized", number: "F-2026-0041" })], provider: { getInvoice: async (id) => remoteInvoice({ id, status: "finalized", number: "F-2026-0041", clientEmails: [] }) } });
  const r = await f.request("POST", { body: { action: "send", invoiceId: "inv-1" } });
  assert.equal(r.code, 422);
  assert.equal(r.body.error, "This client has no invoice email in Qonto.");
  assert.equal(f.count("send"), 0);
});
test("send emails the client and records sent_at", async () => {
  const f = fixture({ invoices: [craInvoice({ status: "finalized", number: "F-2026-0041" })], provider: { getInvoice: async (id) => remoteInvoice({ id, status: "finalized", number: "F-2026-0041" }) } });
  const r = await f.request("POST", { body: { action: "send", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  const [, message] = f.calls.find((c) => c.name === "send").args;
  assert.deepEqual(message, { to: ["billing@acme.test"], subject: "Facture F-2026-0041 — Quicksort", body: "Bonjour,\n\nVeuillez trouver ci-joint la facture F-2026-0041 pour la période septembre 2026.\n\nCordialement,\nQuicksort" });
  assert.equal(f.tables.invoices[0].sent_at, "2026-10-28T09:00:00.000Z");
});
test("send still succeeds with a warning when sent_at cannot be saved", async () => {
  const f = fixture({ invoices: [craInvoice({ status: "finalized", number: "F-2026-0041" })], failures: { "invoices.update": { message: "boom" } } });
  const r = await f.request("POST", { body: { action: "send", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  assert.equal(r.body.sent, true);
  assert.match(r.body.warning, /sent/);
  assert.equal(f.count("send"), 1);
});
test("finalize stores number and status", async () => {
  const f = fixture({ invoices: [craInvoice()] });
  const r = await f.request("POST", { body: { action: "finalize", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  const [row] = f.tables.invoices;
  assert.equal(row.status, "finalized");
  assert.equal(row.number, "F-2026-0042");
  assert.equal(row.finalized_at, "2026-10-28T09:00:00Z");
  assert.equal(row.invoice_url, "https://qonto.test/i/q-1");
  assert.ok(f.tables.invoice_events.some((e) => e.kind === "finalize" && e.actor === "user-1" && e.invoice_id === "inv-1"));
});
test("finalize falls back to getInvoice when the response is unusable", async () => {
  const f = fixture({ invoices: [craInvoice()], provider: {
    finalize: async () => { throw new ProviderError("Qonto returned an unexpected response.", 502); },
    getInvoice: async (id) => remoteInvoice({ id, status: "finalized", number: "F-2026-0043" }),
  } });
  const r = await f.request("POST", { body: { action: "finalize", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  assert.equal(f.tables.invoices[0].number, "F-2026-0043");
  assert.equal(f.tables.invoices[0].status, "finalized");
});
test("finalize surfaces the provider error when the invoice is still a draft", async () => {
  const f = fixture({ invoices: [craInvoice()], provider: { finalize: async () => { throw new ProviderError("Client address is missing", 422); } } });
  const r = await f.request("POST", { body: { action: "finalize", invoiceId: "inv-1" } });
  assert.equal(r.code, 502);
  assert.equal(r.body.error, "Client address is missing");
  assert.equal(f.tables.invoices[0].status, "draft");
});
test("cancel only applies to finalized invoices and releases the triple", async () => {
  const f = fixture({ invoices: [craInvoice()] });
  assert.equal((await f.request("POST", { body: { action: "cancel", invoiceId: "inv-1" } })).code, 409);
  f.tables.invoices[0].status = "finalized";
  const r = await f.request("POST", { body: { action: "cancel", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  assert.equal(f.tables.invoices[0].status, "canceled");
  assert.equal(f.count("cancel"), 1);
});
test("update_draft sends all lines to the provider and saves them", async () => {
  const f = fixture();
  await f.request("POST", { body: DRAFT_REQUEST });
  const line = f.tables.invoice_lines[0];
  const r = await f.request("POST", { body: { action: "update_draft", invoiceId: f.tables.invoices[0].id, dueDate: "2026-12-15", purchaseOrder: "PO-7", lines: [{ id: line.id, quantity: "17.5", unitPrice: "650.00", description: "Edited" }] } });
  assert.equal(r.code, 200);
  const [, draft] = f.calls.find((c) => c.name === "updateDraft").args;
  assert.equal(draft.dueDate, "2026-12-15");
  assert.equal(draft.purchaseOrder, "PO-7");
  assert.deepEqual(draft.lines.map((l) => [l.quantity, l.unitPrice, l.description]), [["17.5", "650.00", "Edited"]]);
  assert.equal(f.tables.invoice_lines[0].quantity, 17.5);
  assert.equal(f.tables.invoices[0].purchase_order, "PO-7");
});
test("update_draft and delete_draft refuse validated invoices", async () => {
  const f = fixture({ invoices: [craInvoice({ status: "finalized" })] });
  assert.equal((await f.request("POST", { body: { action: "update_draft", invoiceId: "inv-1", dueDate: "2026-12-15", purchaseOrder: "", lines: [] } })).code, 409);
  assert.equal((await f.request("POST", { body: { action: "delete_draft", invoiceId: "inv-1" } })).code, 409);
  assert.equal(f.count("updateDraft") + f.count("deleteDraft"), 0);
});
test("delete_draft removes the provider draft and our row", async () => {
  const f = fixture({ invoices: [craInvoice()] });
  const r = await f.request("POST", { body: { action: "delete_draft", invoiceId: "inv-1" } });
  assert.equal(r.code, 200);
  assert.equal(f.count("deleteDraft"), 1);
  assert.equal(f.tables.invoices.length, 0);
});
test("assign only applies to imported invoices", async () => {
  const f = fixture({ invoices: [craInvoice(), { id: "inv-imp", provider_invoice_id: "q-9", source: "imported", status: "paid", project_id: null }] });
  assert.equal((await f.request("POST", { body: { action: "assign", invoiceId: "inv-1", projectId: P2 } })).code, 409);
  const r = await f.request("POST", { body: { action: "assign", invoiceId: "inv-imp", projectId: P2 } });
  assert.equal(r.code, 200);
  assert.equal(f.tables.invoices.find((i) => i.id === "inv-imp").project_id, P2);
});
test("sync keeps manual project assignment", async () => {
  const f = fixture({
    invoices: [{ id: "inv-imp", provider_invoice_id: "q-9", source: "imported", status: "finalized", project_id: "p2", number: "F-1" }],
    provider: { listInvoices: async () => [remoteInvoice({ id: "q-9", status: "paid", number: "F-1", paidAt: "2026-10-20T00:00:00Z" })] },
  });
  const r = await f.request("GET", { query: { resource: "invoices", refresh: "1" } });
  assert.equal(r.code, 200);
  const row = f.tables.invoices.find((i) => i.id === "inv-imp");
  assert.equal(row.project_id, "p2");
  assert.equal(row.status, "paid");
  assert.equal(f.tables.invoicing_settings[0].last_synced_at, "2026-10-28T09:00:00.000Z");
  assert.equal(r.body.lastSyncedAt, "2026-10-28T09:00:00.000Z");
  assert.equal(r.body.invoices.length, 1);
});
test("sync imports unknown invoices with the provider and removes vanished drafts", async () => {
  const f = fixture({
    invoices: [craInvoice({ id: "inv-gone", provider_invoice_id: "q-gone" })],
    provider: { listInvoices: async () => [remoteInvoice({ id: "q-new", status: "finalized", number: "F-9", periodStart: "2026-09-01" })] },
  });
  const r = await f.request("GET", { query: { resource: "invoices", refresh: "1" } });
  assert.equal(r.code, 200);
  assert.deepEqual(f.tables.invoices.map((i) => [i.provider_invoice_id, i.provider, i.source]), [["q-new", "qonto", "imported"]]);
  assert.equal(r.body.invoices[0].client_name, "Acme");
});
test("invoices list skips sync when it ran less than 5 minutes ago", async () => {
  const f = fixture({ lastSyncedAt: "2026-10-28T08:57:00Z" });
  const r = await f.request("GET", { query: { resource: "invoices" } });
  assert.equal(r.code, 200);
  assert.equal(f.count("listInvoices"), 0);
});
test("month and project resources list consultant months to invoice", async () => {
  const f = fixture();
  const month = await f.request("GET", { query: { resource: "month", month: "2026-09" } });
  assert.equal(month.code, 200);
  assert.equal(month.body.rows.length, 1);
  assert.equal(month.body.rows[0].consultantName, "Jane Doe");
  assert.equal(month.body.rows[0].amountHt, "11700.00");
  const project = await f.request("GET", { query: { resource: "project", projectId: PROJECT } });
  assert.equal(project.code, 200);
  assert.deepEqual(project.body.rows.map((r) => [r.employeeId, r.status]), [[EMP, "not_invoiced"]]);
  assert.deepEqual(project.body.totals, { invoicedHt: "0.00", paidTtc: "0.00", outstandingTtc: "0.00" });
});
test("project totals sum validated and paid invoices", async () => {
  const f = fixture({ invoices: [
    craInvoice({ status: "finalized", total_ht: 100.1, total_ttc: 120.12 }),
    craInvoice({ id: "inv-2", period_month: "2026-08-01", status: "paid", total_ht: 200.2, total_ttc: 240.24 }),
    craInvoice({ id: "inv-3", period_month: "2026-07-01", status: "draft", total_ht: 999, total_ttc: 999 }),
  ] });
  const r = await f.request("GET", { query: { resource: "project", projectId: PROJECT } });
  assert.deepEqual(r.body.totals, { invoicedHt: "300.30", paidTtc: "240.24", outstandingTtc: "120.12" });
  assert.equal(r.body.rows.length, 0);
});
test("invoice resource returns lines and events", async () => {
  const f = fixture();
  const created = await f.request("POST", { body: DRAFT_REQUEST });
  const r = await f.request("GET", { query: { resource: "invoice", id: created.body.invoice.id } });
  assert.equal(r.code, 200);
  assert.equal(r.body.invoice.id, created.body.invoice.id);
  assert.equal(r.body.lines.length, 1);
  assert.equal(r.body.events[0].kind, "create_draft");
});
