import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { callTreg, micro } from "../apps/admin/server/treg.ts";
import { validateLedger } from "../apps/admin/server/treg-report.ts";
import { createUsageHandler } from "../apps/admin/api/business-research-usage.ts";

test("Treg tags trusted admin context and records original replay cost without storing bodies", async () => {
  const previous = globalThis.fetch;
  const rows = [];
  const ctx = { adminId: "admin-1", feature: "competitors", record: async row => rows.push(row) };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers["X-Treg-Meta"], "customer=quicksort,admin=admin-1,workspace=business,feature=competitors");
    assert.match(options.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
    assert.equal(options.headers["X-Treg-Route-Max-Cost"], "0.20");
    return new Response('{"result":"example"}', { headers: { "X-Treg-Call-Id": "call-1", "X-Treg-Cost-Micro": "0", "X-Treg-Original-Cost-Micro": "123" } });
  };
  try {
    assert.deepEqual(await callTreg("secret", "treg.web.extract", { url: "https://example.com" }, ctx, "0.20"), { result: "example" });
    assert.equal(rows[0].cost_micro, 123);
    assert.equal(rows[0].call_id, "call-1");
    assert.equal(JSON.stringify(rows).includes("secret"), false);
    assert.equal(JSON.stringify(rows).includes("example.com"), false);
    await assert.rejects(callTreg("secret", "endpoint", {}, { ...ctx, adminId: "bad,admin=other" }), /attribution/);
    await assert.rejects(callTreg("secret", "endpoint", {}, { ...ctx, record: async () => { throw Error("storage failure"); } }, "0.20"), /storage failure/);
  } finally { globalThis.fetch = previous; }
});
test("costs reject malformed amounts and preserve unmetered null", () => {
  assert.equal(micro(null), null);
  assert.equal(micro("0"), 0);
  for (const input of ["", "-1", "1.5", "Infinity", "9007199254740992"]) assert.throws(() => micro(input));
});
test("Treg errors hide provider and account details, but charged failures are recorded", async () => {
  const previous = globalThis.fetch;
  const rows = [];
  globalThis.fetch = async () => new Response('{"balance":50,"topup":"private-url"}', { status: 402, headers: { "X-Treg-Error": "1", "X-Treg-Call-Id": "call-error", "X-Treg-Cost-Micro": "5" } });
  try {
    await assert.rejects(callTreg("secret", "endpoint", {}, { adminId: "admin", feature: "events", record: async row => rows.push(row) }), { message: "Research service is unavailable. Contact a workspace owner." });
    assert.equal(rows[0].cost_micro, 5);
  } finally { globalThis.fetch = previous; }
});
const ledger = { key: "admin", days: 30, rows: [{ value: "admin", charged_micro: 10, calls: 2 }], attributed_micro: 10, unattributed_micro: 3, total_micro: 13 };
test("ledger reconciliation rejects inconsistent totals, duplicates and unsafe numbers", () => {
  assert.equal(validateLedger(ledger).unattributed_micro, 3);
  for (const change of [{ total_micro: 14 }, { attributed_micro: 9 }, { total_micro: 9007199254740992 }, { rows: [ledger.rows[0], ledger.rows[0]], attributed_micro: 20, total_micro: 23 }]) assert.throws(() => validateLedger({ ...ledger, ...change }));
});
test("usage reporting rejects unauthenticated and non-admin users before reading ledger", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test";
  let reads = 0;
  const handler = createUsageHandler({ createClient: () => ({ rpc: async () => ({ data: "id" }), from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({ data: { role: "candidate" } }) }) }), loadTregReport: async () => { reads++; return ledger; } });
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: "GET", headers: {} }, res); assert.equal(res.code, 401);
  await handler({ method: "GET", headers: { authorization: "Bearer test" } }, res); assert.equal(res.code, 403);
  assert.equal(reads, 0);
});
test("usage SQL protects costs from client writes and deduplicates call IDs", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema private; create function private.is_admin() returns boolean language sql as 'select true'; grant usage on schema private to authenticated; create table profiles(id uuid primary key); insert into profiles values ('00000000-0000-0000-0000-000000000001');");
    await db.exec(await readFile(new URL("../supabase/migrations/20261101153753_treg_usage.sql", import.meta.url), "utf8"));
    const insert = "insert into treg_usage(call_id,request_id,admin_id,customer,feature,endpoint,status,cost_micro) values ('call-1','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','quicksort','events','enrich',200,42)";
    await db.exec("set role service_role;");
    await db.exec(insert);
    await db.exec(insert + " on conflict(call_id) do nothing");
    assert.equal((await db.query("select count(*)::int as count from treg_usage")).rows[0].count, 1);
    await db.exec("set role authenticated;");
    assert.equal((await db.query("select cost_micro from treg_usage")).rows[0].cost_micro, 42);
    await assert.rejects(db.exec("update treg_usage set cost_micro = 0"), /permission denied/);
    await assert.rejects(db.exec(insert), /permission denied/);
    await db.exec("set role anon;");
    await assert.rejects(db.exec("select * from treg_usage"), /permission denied/);
  } finally { await db.close(); }
});

test("event batches finish recording in-flight calls before reporting failure", async () => {
  const { enrichWithTreg } = await import("../apps/admin/server/treg.ts");
  const previous = globalThis.fetch;
  const oldToken = process.env.TREG_TOKEN;
  process.env.TREG_TOKEN = "test";
  let recorded = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.email === "failed@example.com") throw new Error("network error");
    return new Response('{"output":{"role":"Engineer"}}', { headers: { "X-Treg-Call-Id": "successful-call", "X-Treg-Cost-Micro": "10" } });
  };
  try {
    await assert.rejects(enrichWithTreg(["failed", "success"].map(name => ({ name, email: `${name}@example.com`, linkedin: "", role: "", company: "" })), { adminId: "admin", feature: "events", record: async () => { await new Promise(resolve => setTimeout(resolve, 15)); recorded = true; } }), /network error/);
    assert.equal(recorded, true);
  } finally {
    globalThis.fetch = previous;
    if (oldToken === undefined) delete process.env.TREG_TOKEN; else process.env.TREG_TOKEN = oldToken;
  }
});
