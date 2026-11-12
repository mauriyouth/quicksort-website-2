import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountsHandler } from "../apps/admin/api/accounts.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-public-key";
process.env.CLERK_SECRET_KEY = "sk_test_secret";
const NEW_ID = "33333333-3333-4333-8333-333333333333";

function fixture({ actorRole = "admin", clerkUsers = [], rpcError = null, person = { full_name: "Amadou van Diallo", email: "Amadou@quicksort.fr" } } = {}) {
  const rpcs = [], clerkCalls = [];
  const client = {
    rpc: async (name, args) => {
      rpcs.push([name, args]);
      if (name === "sync_clerk_profile") return { data: "admin-id" };
      return rpcError ? { error: { message: rpcError } } : { data: args.new_id };
    },
    from(table) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "hr_people" ? person : { role: actorRole } }) };
      return q;
    },
  };
  const fetch = async (url, init = {}) => {
    clerkCalls.push([url, init.method || "GET", init.body ? JSON.parse(init.body) : null]);
    if (url.includes("/users?")) return { ok: true, json: async () => clerkUsers };
    return { ok: true, json: async () => ({ id: "user_new" }) };
  };
  const handler = createAccountsHandler({ createClient: () => client, fetch, randomUUID: () => NEW_ID });
  return { rpcs, clerkCalls, async request(body, method = "POST") {
    const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    await handler({ method, headers: { authorization: "Bearer token" }, body }, res);
    return res;
  } };
}

const input = { email: "Jane.Doe@quicksort.fr", role: "employee" };
const PERSON = "44444444-4444-4444-8444-444444444444";

test("creates a Clerk user linked to a new workspace profile", async () => {
  const f = fixture();
  const res = await f.request(input);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { id: NEW_ID, email: "jane.doe@quicksort.fr", role: "employee", linkedExisting: false });
  const [, method, body] = f.clerkCalls[1];
  assert.equal(method, "POST");
  assert.deepEqual(body, { email_address: ["jane.doe@quicksort.fr"], public_metadata: { user_id: NEW_ID }, skip_password_requirement: true });
  assert.deepEqual(f.rpcs[1], ["create_workspace_account", { new_id: NEW_ID, account_email: "jane.doe@quicksort.fr", account_role: "employee" }]);
});

test("creates the portal account of an HR person from the record, linked to it", async () => {
  for (const actorRole of ["admin", "hr"]) {
    const f = fixture({ actorRole });
    const res = await f.request({ personId: PERSON, role: "employee", email: "ignored@example.com" });
    assert.equal(res.code, 200);
    assert.equal(res.body.email, "amadou@quicksort.fr");
    assert.deepEqual(f.clerkCalls[0][0], "https://api.clerk.com/v1/users?email_address=amadou%40quicksort.fr&limit=2");
    assert.deepEqual(f.clerkCalls[1][2], { email_address: ["amadou@quicksort.fr"], first_name: "Amadou", last_name: "van Diallo", public_metadata: { user_id: NEW_ID }, skip_password_requirement: true });
    assert.deepEqual(f.rpcs[1], ["create_workspace_account", { new_id: NEW_ID, account_email: "amadou@quicksort.fr", account_role: "employee", link_person: PERSON }]);
  }
});

test("a person without an email cannot get an account", async () => {
  const f = fixture({ person: { full_name: "Amadou Diallo", email: "" } });
  const res = await f.request({ personId: PERSON, role: "employee" });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /Add a valid email address to Amadou Diallo/);
  assert.equal(f.clerkCalls.length, 0);
});

test("HR can only create person-linked candidate or employee accounts", async () => {
  const f = fixture({ actorRole: "hr" });
  assert.equal((await f.request({ personId: PERSON, role: "hr" })).code, 400);
  assert.equal((await f.request({ email: "x@quicksort.fr", role: "employee" })).code, 403);
  assert.equal(f.clerkCalls.length, 0);
});

test("links an unlinked Clerk sign-up instead of creating a duplicate", async () => {
  const f = fixture({ clerkUsers: [{ id: "user_existing", public_metadata: {} }] });
  const res = await f.request(input);
  assert.equal(res.code, 200);
  assert.equal(res.body.linkedExisting, true);
  assert.deepEqual(f.clerkCalls[1].slice(1), ["PATCH", { public_metadata: { user_id: NEW_ID } }]);
});

test("refuses an email that already has a workspace account", async () => {
  const f = fixture({ clerkUsers: [{ id: "user_existing", public_metadata: { user_id: "x" } }] });
  assert.equal((await f.request(input)).code, 409);
  assert.equal(f.clerkCalls.length, 1);
});

test("non-admins are refused before Clerk is called", async () => {
  const f = fixture({ actorRole: "hr" });
  assert.equal((await f.request(input)).code, 403);
  assert.equal(f.clerkCalls.length, 0);
});

test("deletes the new Clerk user when the workspace insert fails", async () => {
  const f = fixture({ rpcError: "An account already exists for jane.doe@quicksort.fr" });
  const res = await f.request(input);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /already exists/);
  assert.deepEqual(f.clerkCalls.at(-1).slice(0, 2), ["https://api.clerk.com/v1/users/user_new", "DELETE"]);
});

test("rejects admin role and bad input", async () => {
  const f = fixture();
  assert.equal((await f.request({ ...input, role: "admin" })).code, 400);
  assert.equal((await f.request({ ...input, email: "nope" })).code, 400);
  assert.equal((await f.request(input, "GET")).code, 405);
});
