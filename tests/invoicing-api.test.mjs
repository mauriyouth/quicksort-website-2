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

function fixture({ admin = true, saved = true, accountsError = null } = {}) {
  const rows = { invoicing_settings: saved ? { id: "default", provider: "qonto", encrypted_credentials: encryptCredentials({ secret: SECRET, stagingToken: null }), options: { login: "org", iban: "FR76", staging: false, due_days: 30 }, start_month: "2026-01-01", last_synced_at: null } : null };
  const ops = [];
  const client = {
    rpc: async () => ({ data: "user-1" }),
    from(table) {
      const q = {
        select() { return q; },
        eq() { return q; },
        single: async () => ({ data: table === "user_roles" ? { role: admin ? "admin" : "member" } : null }),
        maybeSingle: async () => ({ data: rows[table] ?? null }),
        upsert: async (value, options) => { ops.push({ op: "upsert", table, value, options }); if (table === "invoicing_settings") rows[table] = value; return {}; },
        delete() { ops.push({ op: "delete", table }); return { eq() { return this; }, then: r => r({}) }; },
        then: r => r({ data: [], error: null }),
      };
      return q;
    },
  };
  const provider = { name: "qonto", listPaymentAccounts: async () => { if (accountsError) throw accountsError; return [{ iban: "FR76", name: "Main" }]; }, listClients: async () => [], listProducts: async () => [] };
  const handler = createInvoicingHandler({ createClient: () => client, createProvider: () => provider, now: () => new Date("2026-10-28T00:00:00Z") });
  return { ops, rows, async request(method, { query, body } = {}) {
    const response = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(b) { this.body = b; } };
    await handler({ method, query, body, headers: { authorization: "Bearer t" } }, response);
    return response;
  } };
}

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
