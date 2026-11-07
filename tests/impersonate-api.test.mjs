import { test } from "node:test";
import assert from "node:assert/strict";
import { createImpersonateHandler } from "../apps/admin/api/impersonate.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.CLERK_SECRET_KEY = "sk_test_secret";
const TARGET = "11111111-1111-4111-8111-111111111111";
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

function fixture({ gateError = null, clerkUsers = [{ id: "user_target", public_metadata: { user_id: TARGET } }] } = {}) {
  const rpcs = [], clerkCalls = [];
  const client = { rpc: async (name, args) => {
    rpcs.push([name, args]);
    if (name === "sync_clerk_profile") return { data: "admin-id" };
    return gateError ? { error: { message: gateError } } : { data: "target@quicksort.fr" };
  } };
  const fetch = async (url, init = {}) => {
    clerkCalls.push([url, init]);
    const body = url.includes("/actor_tokens") ? { token: "ticket-123" } : clerkUsers;
    return { ok: true, json: async () => body };
  };
  const handler = createImpersonateHandler({ createClient: () => client, fetch });
  return { rpcs, clerkCalls, async request(body, claims = { sub: "user_admin" }, method = "POST") {
    const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    await handler({ method, headers: { authorization: `Bearer ${jwt(claims)}` }, body }, res);
    return res;
  } };
}

test("mints an actor token after the database gate approves", async () => {
  const f = fixture();
  const res = await f.request({ targetId: TARGET });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ticket: "ticket-123", email: "target@quicksort.fr" });
  assert.deepEqual(f.rpcs[1], ["begin_impersonation", { target_id: TARGET }]);
  const [url, init] = f.clerkCalls[1];
  assert.match(url, /\/actor_tokens$/);
  assert.deepEqual(JSON.parse(init.body).actor, { sub: "user_admin" });
  assert.equal(JSON.parse(init.body).user_id, "user_target");
});

test("refuses when the database gate rejects, without calling Clerk", async () => {
  const f = fixture({ gateError: "Portal owners cannot be impersonated" });
  const res = await f.request({ targetId: TARGET });
  assert.equal(res.code, 403);
  assert.equal(res.body.error, "Portal owners cannot be impersonated");
  assert.equal(f.clerkCalls.length, 0);
});

test("an impersonated session cannot start another impersonation", async () => {
  const f = fixture();
  const res = await f.request({ targetId: TARGET }, { sub: "user_admin", act: { sub: "user_x" } });
  assert.equal(res.code, 403);
  assert.equal(f.rpcs.length, 0);
});

test("refuses a Clerk account linked to a different workspace user", async () => {
  const f = fixture({ clerkUsers: [{ id: "user_other", public_metadata: { user_id: "22222222-2222-4222-8222-222222222222" } }] });
  const res = await f.request({ targetId: TARGET });
  assert.equal(res.code, 404);
  assert.equal(f.clerkCalls.length, 1);
});

test("validates method and input", async () => {
  const f = fixture();
  assert.equal((await f.request({ targetId: TARGET }, undefined, "GET")).code, 405);
  assert.equal((await f.request({ targetId: "nope" })).code, 400);
});
