import { test } from "node:test";
import assert from "node:assert/strict";
import { createBankHandler } from "../apps/admin/api/bank-transactions.ts";
import { createBankCronHandler } from "../apps/admin/api/bank-transactions-cron.ts";
import { encryptCredentials } from "../apps/admin/server/invoicing/settings.ts";
import { encryptSecret } from "../apps/admin/server/ai-settings.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);
process.env.CRON_SECRET = "cron-secret";
delete process.env.MOONSHOT_API_KEY;
const KIMI = "sk-kimi-super-secret";

function memoryClient(tables, ops) {
  return {
    rpc: async () => ({ data: "user-1", error: null }),
    from(table) {
      const filters = [];
      let mode = "select", payload, options, single = null, head = false, count = null, orderBy = [], span = null, returning = false;
      const f = (fn) => (c, v) => { filters.push((r) => fn(r[c], v)); return q; };
      const q = {
        select(_cols, o) { if (mode !== "select") returning = true; head = o?.head === true; count = o?.count ?? null; return q; },
        eq: f((a, b) => a === b), gte: f((a, b) => a >= b), lte: f((a, b) => a <= b),
        order(c, o = {}) { orderBy.push([c, o.ascending !== false]); return q; },
        range(from, to) { span = [from, to]; return q; },
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
        let list = rows.filter(match);
        if (mode === "update") { for (const r of list) Object.assign(r, payload); if (!returning) return { data: null, error: null }; }
        if (mode === "upsert") {
          const found = rows.find((r) => r[options?.onConflict ?? "id"] === payload[options?.onConflict ?? "id"]);
          if (found) Object.assign(found, payload); else rows.push({ ...payload });
          return { data: null, error: null };
        }
        for (const [c, asc] of [...orderBy].reverse()) list.sort((a, b) => ((a[c] ?? "") < (b[c] ?? "") ? -1 : (a[c] ?? "") > (b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
        if (span) list = list.slice(span[0], span[1] + 1);
        if (head) return { data: null, count: list.length, error: null };
        list = list.map((r) => ({ ...r }));
        if (!single) return { data: list, count: count ? list.length : undefined, error: null };
        if (list.length === 1) return { data: list[0], error: null };
        if (single === "maybe" && list.length === 0) return { data: null, error: null };
        return { data: null, error: { message: "single row expected" } };
      }
      return q;
    },
  };
}

function fixture({ admin = true, qonto = true, kimi = false, extra = {} } = {}) {
  const tables = {
    user_roles: [{ user_id: "user-1", role: admin ? "admin" : "member" }],
    invoicing_settings: qonto ? [{ id: "default", encrypted_credentials: encryptCredentials({ secret: "qs", stagingToken: null }), options: { login: "org", iban: "FR76", staging: false } }] : [],
    ai_settings: kimi ? [{ id: "bank-classifier", encrypted_key: encryptSecret(KIMI, "quicksort/bank-classifier/v1"), model: "kimi-x" }] : [],
    bank_transactions: [{ id: "t1", manual_line: null }],
    bank_transactions_effective: [
      { id: "t1", month: "2026-03-01", line: "outils", needs_review: true },
      { id: "t2", month: "2026-04-01", line: null, needs_review: null },
      { id: "t3", month: "2025-12-01", line: "loyer", needs_review: false },
    ],
    bank_sync_state: [],
    ...extra,
  };
  const ops = [];
  const client = memoryClient(tables, ops);
  const fetchCalls = [];
  const state = { moonshotOk: true, syncCalls: 0 };
  const deps = {
    createClient: () => client,
    now: () => new Date("2026-11-04T05:00:00Z"),
    fetch: async (url, init) => { fetchCalls.push({ url, init }); return { ok: state.moonshotOk, status: state.moonshotOk ? 200 : 401 }; },
    runBankSync: async () => { state.syncCalls++; return { status: "ok", fetched: 1, classified: 1, remaining: 0 }; },
  };
  const bank = createBankHandler(deps);
  const cron = createBankCronHandler(deps);
  const call = (h) => async (req) => {
    const response = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    await h(req, response);
    return response;
  };
  const auth = { authorization: "Bearer t" };
  return {
    tables, ops, fetchCalls, state,
    get: (query) => call(bank)({ method: "GET", query, headers: auth }),
    post: (body) => call(bank)({ method: "POST", body, headers: auth }),
    raw: call(bank),
    cron: (headers, method = "GET") => call(cron)({ method, headers }),
  };
}

test("rejects non-admin (403) and missing token (401)", async () => {
  const f = fixture({ admin: false });
  assert.equal((await f.get({ resource: "status" })).code, 403);
  assert.equal((await f.raw({ method: "GET", query: { resource: "status" }, headers: {} })).code, 401);
});

test("cron: wrong or missing CRON_SECRET -> 401; correct -> runs sync", async () => {
  const f = fixture();
  assert.equal((await f.cron({})).code, 401);
  assert.equal((await f.cron({ authorization: "Bearer nope" })).code, 401);
  assert.equal((await f.cron({ authorization: "Bearer cron-secret-longer" })).code, 401);
  assert.equal(f.state.syncCalls, 0);
  const ok = await f.cron({ authorization: "Bearer cron-secret" });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.status, "ok");
  assert.equal(f.state.syncCalls, 1);
});

test("cron with empty CRON_SECRET env -> 401", async () => {
  const f = fixture();
  process.env.CRON_SECRET = "";
  try {
    assert.equal((await f.cron({ authorization: "Bearer " })).code, 401);
    assert.equal((await f.cron({})).code, 401);
  } finally { process.env.CRON_SECRET = "cron-secret"; }
});

test("cron without service role key -> 503", async () => {
  const f = fixture();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { assert.equal((await f.cron({ authorization: "Bearer cron-secret" })).code, 503); }
  finally { process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key"; }
});

test("classify writes manual_line only", async () => {
  const f = fixture();
  const res = await f.post({ action: "classify", id: "t1", line: "marketing" });
  assert.equal(res.code, 200);
  assert.deepEqual(f.ops.map((o) => [o.op, o.table]), [["update", "bank_transactions"]]);
  assert.deepEqual(Object.keys(f.ops[0].value).sort(), ["manual_at", "manual_by", "manual_line"]);
  assert.equal(f.tables.bank_transactions[0].manual_line, "marketing");
  assert.equal(f.tables.bank_transactions[0].manual_by, "user-1");
  assert.equal((await f.post({ action: "classify", id: "missing", line: "loyer" })).code, 404);
});

test("classify rejects unknown line (400)", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "classify", id: "t1", line: "yachts" })).code, 400);
  assert.equal(f.ops.length, 0);
});

test("status never leaks the Kimi key and counts reviews", async () => {
  const f = fixture({ kimi: true });
  const res = await f.get({ resource: "status" });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.classifier, { configured: true, model: "kimi-x", source: "settings" });
  assert.equal(res.body.reviewCount, 1);
  assert.equal(res.body.state.backfillDone, false);
  assert.ok(!JSON.stringify(res.body).includes(KIMI));
  const none = await fixture().get({ resource: "status" });
  assert.deepEqual(none.body.classifier, { configured: false, model: "kimi-k2-turbo-preview", source: "none" });
});

test("transactions require a year, filter by it and coerce needs_review", async () => {
  const f = fixture();
  assert.equal((await f.get({ resource: "transactions" })).code, 400);
  const res = await f.get({ resource: "transactions", year: "2026" });
  assert.deepEqual(res.body.transactions.map((t) => [t.id, t.needs_review]), [["t1", true], ["t2", false]]);
});

test("transactions paginate beyond 1000 rows", async () => {
  const many = Array.from({ length: 2300 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, month: "2026-05-01", line: null, needs_review: false }));
  const f = fixture({ extra: { bank_transactions_effective: many } });
  const res = await f.get({ resource: "transactions", year: "2026" });
  assert.equal(res.body.transactions.length, 2300);
});

test("save_classifier with invalid key -> 400, nothing saved", async () => {
  const f = fixture();
  f.state.moonshotOk = false;
  const res = await f.post({ action: "save_classifier", apiKey: "sk-bad", model: "kimi-k2" });
  assert.equal(res.code, 400);
  assert.equal(f.tables.ai_settings.length, 0);
  assert.equal(f.fetchCalls[0].url, "https://api.moonshot.ai/v1/models");
  assert.equal(f.fetchCalls[0].init.headers.authorization, "Bearer sk-bad");
});

test("save_classifier stores an encrypted key; model-only keeps it", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "save_classifier", apiKey: KIMI, model: "kimi-a" })).code, 200);
  const stored = f.tables.ai_settings[0];
  assert.equal(stored.id, "bank-classifier");
  assert.ok(!stored.encrypted_key.includes(KIMI));
  assert.equal((await f.post({ action: "save_classifier", model: "kimi-b" })).code, 200);
  assert.equal(f.fetchCalls.length, 1);
  const status = await f.get({ resource: "status" });
  assert.equal(status.body.classifier.model, "kimi-b");
  assert.equal(status.body.classifier.configured, true);
});

test("save_classifier model-only without any key -> 400", async () => {
  const f = fixture();
  assert.equal((await f.post({ action: "save_classifier", model: "kimi-b" })).code, 400);
});

test("sync when Qonto not configured -> 409", async () => {
  const f = fixture({ qonto: false });
  const res = await f.post({ action: "sync" });
  assert.equal(res.code, 409);
  assert.equal(res.body.error, "Connectez Qonto dans les réglages de facturation.");
  assert.equal(f.state.syncCalls, 0);
});

test("sync runs runBankSync when connected", async () => {
  const f = fixture();
  const res = await f.post({ action: "sync" });
  assert.equal(res.code, 200);
  assert.equal(res.body.fetched, 1);
});
