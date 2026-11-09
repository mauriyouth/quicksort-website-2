import { test } from "node:test";
import assert from "node:assert/strict";
import { createYoutrustClient, YoutrustError } from "../apps/admin/server/signatures/youtrust.ts";
import {
  encryptSignatureCredentials, loadSignatureSettings, youtrustFromSettings,
} from "../apps/admin/server/signatures/settings.ts";

process.env.AI_SETTINGS_ENCRYPTION_KEY = "ab".repeat(32);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Recording fake fetch: `handlers` maps "METHOD /path" to a Response factory.
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname.replace(/^\/v3/, "");
    calls.push({ method, path, url: String(url), init, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    const h = handlers[`${method} ${path}`];
    if (!h) throw new Error(`unexpected ${method} ${path}`);
    return h(calls.at(-1));
  };
  return { impl, calls };
}

const input = {
  name: "Probation letter", fileName: "letter.pdf", externalId: "req_1", pdf: new Uint8Array([37, 80, 68, 70]),
  signers: [
    { name: "Ada Lovelace", email: "ada@quicksort.fr", order: 0 },
    { name: "Grace Hopper", email: "grace@example.com", order: 1 },
  ],
};

function happyHandlers() {
  let n = 0;
  return {
    "POST /signature_requests": () => json({ id: "sr1" }, 201),
    "POST /signature_requests/sr1/documents": () => json({ id: "doc1", total_pages: 3 }, 201),
    "POST /signature_requests/sr1/signers": () => json({ id: `sg${++n}` }, 201),
    "POST /signature_requests/sr1/activate": () => json({ id: "sr1", status: "ongoing" }, 201),
  };
}

test("createRequest runs create, upload, signers, activate against sandbox", async () => {
  const { impl, calls } = fakeFetch(happyHandlers());
  const client = createYoutrustClient({ apiKey: "k", staging: true }, impl);
  const out = await client.createRequest(input);
  assert.deepEqual(out, { requestId: "sr1", documentId: "doc1" });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    "POST /signature_requests", "POST /signature_requests/sr1/documents",
    "POST /signature_requests/sr1/signers", "POST /signature_requests/sr1/signers",
    "POST /signature_requests/sr1/activate",
  ]);
  assert.ok(calls.every((c) => c.url.startsWith("https://api-sandbox.yousign.app/v3/")));
  assert.ok(calls.every((c) => c.init.headers.Authorization === "Bearer k"));
  assert.deepEqual(calls[0].body, {
    name: "Probation letter", delivery_mode: "email", ordered_signers: true, external_id: "req_1",
  });
  const form = calls[1].init.body;
  assert.equal(form.get("nature"), "signable_document");
  assert.equal(form.get("file").name, "letter.pdf");
});

test("production base url when staging is off", async () => {
  const { impl, calls } = fakeFetch(happyHandlers());
  await createYoutrustClient({ apiKey: "k", staging: false }, impl).createRequest(input);
  assert.ok(calls[0].url.startsWith("https://api.yousign.app/v3/"));
});

test("signers are added in order, chained, with a signature on the last page", async () => {
  const { impl, calls } = fakeFetch(happyHandlers());
  await createYoutrustClient({ apiKey: "k", staging: true }, impl).createRequest({
    ...input, signers: [...input.signers].reverse(),
  });
  const [a, b] = calls.filter((c) => c.path.endsWith("/signers")).map((c) => c.body);
  assert.equal(a.info.email, "ada@quicksort.fr"); // order 0 first even if passed reversed
  assert.equal(b.info.email, "grace@example.com");
  assert.equal(a.insert_after_id, undefined);
  assert.equal(b.insert_after_id, "sg1");
  assert.equal(a.info.first_name, "Ada");
  assert.equal(a.info.last_name, "Lovelace");
  assert.equal(a.signature_level, "electronic_signature");
  assert.equal(a.signature_authentication_mode, "otp_email");
  assert.equal(a.fields.length, 1);
  assert.equal(a.fields[0].type, "signature");
  assert.equal(a.fields[0].document_id, "doc1");
  assert.equal(a.fields[0].page, 3);
  assert.notDeepEqual([a.fields[0].x, a.fields[0].y], [b.fields[0].x, b.fields[0].y]);
});

test("a 4xx on activate deletes the draft and rejects with YoutrustError", async () => {
  const handlers = happyHandlers();
  handlers["POST /signature_requests/sr1/activate"] = () => json({ detail: "bad" }, 422);
  handlers["DELETE /signature_requests/sr1"] = () => new Response(null, { status: 204 });
  const { impl, calls } = fakeFetch(handlers);
  await assert.rejects(
    createYoutrustClient({ apiKey: "k", staging: true }, impl).createRequest(input),
    (e) => e instanceof YoutrustError && e.status === 422,
  );
  assert.equal(calls.at(-1).method, "DELETE");
});

test("getStatus maps the request and its signers", async () => {
  const { impl } = fakeFetch({
    "GET /signature_requests/sr1": () => json({ id: "sr1", status: "ongoing" }),
    "GET /signature_requests/sr1/signers": () => json([
      { id: "a", status: "signed", info: { email: "ada@quicksort.fr" } },
      { id: "b", status: "notified", info: { email: "grace@example.com" } },
    ]),
  });
  const s = await createYoutrustClient({ apiKey: "k", staging: true }, impl).getStatus("sr1");
  assert.deepEqual(s, { status: "ongoing", signers: [
    { email: "ada@quicksort.fr", status: "signed" }, { email: "grace@example.com", status: "notified" },
  ] });
});

test("cancel posts a reason and downloads return bytes", async () => {
  const { impl, calls } = fakeFetch({
    "POST /signature_requests/sr1/cancel": () => json({ status: "canceled" }, 201),
    "GET /signature_requests/sr1/documents/download": () => new Response(new Uint8Array([1, 2, 3])),
    "GET /signature_requests/sr1/audit_trails/download": () => new Response(new Uint8Array([4, 5])),
  });
  const c = createYoutrustClient({ apiKey: "k", staging: true }, impl);
  await c.cancel("sr1", "Replaced by a new letter");
  assert.deepEqual(calls[0].body, { reason: "other", custom_note: "Replaced by a new letter" });
  assert.deepEqual([...await c.downloadSigned("sr1")], [1, 2, 3]);
  assert.deepEqual([...await c.downloadAuditTrail("sr1")], [4, 5]);
});

function settingsClient(row) {
  return { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) };
}

test("settings round-trip through encryption", async () => {
  const row = {
    id: "default",
    options: { staging: true, signatory_name: "Ada", signatory_email: "ada@quicksort.fr" },
    encrypted_credentials: encryptSignatureCredentials({ apiKey: "yt-key", webhookSecret: "whs" }),
  };
  const s = await loadSignatureSettings(settingsClient(row));
  assert.equal(s.apiKey, "yt-key");
  assert.equal(s.webhookSecret, "whs");
  assert.equal(s.hasApiKey, true);
  assert.equal(s.hasWebhookSecret, true);
  assert.equal(s.staging, true);
  assert.equal(s.signatoryName, "Ada");
  assert.equal(s.signatoryEmail, "ada@quicksort.fr");
  assert.ok(youtrustFromSettings(s));
});

test("empty settings are unconfigured", async () => {
  const s = await loadSignatureSettings(settingsClient(null));
  assert.equal(s.hasApiKey, false);
  assert.throws(() => youtrustFromSettings(s), /Connect Youtrust in Settings/);
});

test("a missing id in the create or upload response fails (and cleans up when a request exists)", async () => {
  const noCreateId = fakeFetch({ "POST /signature_requests": () => json({}, 201) });
  await assert.rejects(
    createYoutrustClient({ apiKey: "k", staging: true }, noCreateId.impl).createRequest(input),
    (e) => e instanceof YoutrustError,
  );
  assert.equal(noCreateId.calls.length, 1);

  const handlers = happyHandlers();
  handlers["POST /signature_requests/sr1/documents"] = () => json({ total_pages: 1 }, 201);
  handlers["DELETE /signature_requests/sr1"] = () => new Response(null, { status: 204 });
  const noDocId = fakeFetch(handlers);
  await assert.rejects(
    createYoutrustClient({ apiKey: "k", staging: true }, noDocId.impl).createRequest(input),
    (e) => e instanceof YoutrustError,
  );
  assert.equal(noDocId.calls.at(-1).method, "DELETE");
});
