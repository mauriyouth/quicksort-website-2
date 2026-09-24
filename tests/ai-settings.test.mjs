import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettingsHandler } from "../apps/admin/api/ai-settings.ts";
import { encryptApiKey, loadAiSettings } from "../apps/admin/server/ai-settings.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);
delete process.env.OPENAI_API_KEY;
const key = "sk-test-key-for-settings-regression";
function fixture({ saved = true, owner = true, fail = false } = {}) {
  let row = saved ? { id: "cv-analyzer", encrypted_key: encryptApiKey(key), model: "old-model" } : null;
  const originalKey = row?.encrypted_key;
  const calls = [];
  const client = {
    rpc: async () => ({ data: "owner-id" }),
    from(table) {
      let patch;
      const query = {
        select() { return query; },
        eq(column, value) { assert.equal(value, table === "portal_owners" ? "owner-id" : "cv-analyzer"); return query; },
        update(value) { patch = value; return query; },
        async maybeSingle() {
          if (table === "portal_owners") return { data: owner ? { user_id: "owner-id" } : null };
          if (patch && row) row = { ...row, ...patch };
          return { data: row };
        },
        async upsert(value) { row = value; return {}; },
      };
      return query;
    },
  };
  const handler = createSettingsHandler({ createClient: () => client, loadAiSettings, generateText: async options => {
    calls.push(options);
    if (fail) throw new Error("Provider error with sensitive information");
    return { text: "OK" };
  } });
  return { calls, originalKey, client, row: () => row, async request(method, body, authorization = "Bearer token") {
    const response = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method, headers: { authorization }, body }, response);
    return response;
  } };
}
test("model-only save preserves encrypted key and analyzer reads new model", async () => {
  const f = fixture();
  assert.equal((await f.request("PUT", { model: "new-model" })).code, 200);
  assert.equal(f.row().encrypted_key, f.originalKey);
  assert.deepEqual(await loadAiSettings(f.client), { apiKey: key, model: "new-model" });
  assert.equal(f.calls.length, 0);
});
test("model-only save requires a stored key", async () => {
  const f = fixture({ saved: false });
  assert.equal((await f.request("PUT", { model: "new-model" })).code, 400);
  assert.equal(f.row(), null);
});
test("replacement key and model are saved together", async () => {
  const f = fixture();
  const replacement = "sk-replacement-key-for-regression";
  assert.equal((await f.request("PUT", { apiKey: replacement, model: "new-model" })).code, 200);
  assert.deepEqual(await loadAiSettings(f.client), { apiKey: replacement, model: "new-model" });
});
test("connection test uses selected model without modifying saved settings", async () => {
  const f = fixture();
  const response = await f.request("POST", { model: "test-model" });
  assert.equal(response.code, 200);
  assert.equal(response.body.connected, true);
  assert.equal(f.calls[0].model.modelId, "test-model");
  assert.equal(f.calls[0].maxRetries, 0);
  assert.equal(f.row().model, "old-model");
  assert.equal(f.row().encrypted_key, f.originalKey);
});
test("connection can test an entered key before saving", async () => {
  const f = fixture({ saved: false });
  assert.equal((await f.request("POST", { apiKey: key, model: "test-model" })).code, 200);
  assert.equal(f.row(), null);
});
test("invalid input and missing keys do not call the provider", async () => {
  const f = fixture({ saved: false });
  for (const body of [{ model: "test-model" }, { model: "bad model" }, { model: "test-model", apiKey: "bad" }]) {
    assert.equal((await f.request("POST", body)).code, 400);
  }
  assert.equal(f.calls.length, 0);
});
test("only authenticated owners can test or save", async () => {
  const f = fixture({ owner: false });
  for (const method of ["POST", "PUT"]) {
    assert.equal((await f.request(method, { model: "test-model" })).code, 403);
    assert.equal((await f.request(method, { model: "test-model" }, "")).code, 401);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.row().model, "old-model");
});
test("connection errors do not leak provider details", async () => {
  const f = fixture({ fail: true });
  const response = await f.request("POST", { model: "test-model" });
  assert.equal(response.code, 502);
  assert.match(response.body.error, /Could not connect/);
  assert.doesNotMatch(JSON.stringify(response.body), /sensitive|sk-/);
});
