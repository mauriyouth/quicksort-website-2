import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createKimiClassifier,
  buildMessages,
  FIXED_CHARGE_LINES,
  REVIEW_THRESHOLD,
  DEFAULT_KIMI_MODEL,
} from "../apps/admin/server/bank/classifier.ts";

const item = (id, extra = {}) => ({
  id,
  label: "Abonnement",
  counterparty: "OVH",
  amountEur: 12.5,
  operationType: "card",
  qontoCategory: null,
  note: null,
  ...extra,
});

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    return next;
  };
  return { impl, calls };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const completion = (content) => json({ choices: [{ message: { content } }] });
const cfg = { apiKey: "k", model: "m1" };

test("constants", () => {
  assert.equal(REVIEW_THRESHOLD, 0.7);
  assert.equal(FIXED_CHARGE_LINES.length, 7);
  assert.ok(FIXED_CHARGE_LINES.includes("deplacements"));
});

test("default model is a current Kimi model", () => {
  assert.equal(DEFAULT_KIMI_MODEL, "kimi-k2.6");
});

test("classify posts to Moonshot chat completions", async () => {
  const { impl, calls } = fakeFetch([completion('{"results":[]}')]);
  await createKimiClassifier(cfg, impl).classify([item("a")], []);
  assert.equal(calls[0].url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer k");
  assert.equal(calls[0].body.model, "m1");
  // Current Kimi models reject any temperature other than their default.
  assert.equal("temperature" in calls[0].body, false);
  // Reasoning off: a 20-item batch must answer well under the 30 s timeout.
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
});

test("system prompt lists every line and the exclusions", () => {
  const system = buildMessages([item("a")], [])[0];
  assert.equal(system.role, "system");
  for (const line of FIXED_CHARGE_LINES) assert.ok(system.content.includes(line), line);
  for (const word of ["URSSAF", "chasseurs de têtes", "affacturage", "matériel", "mutuelle"]) {
    assert.ok(system.content.includes(word), word);
  }
});

test("corrections are injected as examples", () => {
  const msgs = buildMessages([item("a")], [{ counterparty: "OVH", label: "Facture 1", line: "outils" }]);
  const all = JSON.stringify(msgs);
  assert.ok(all.includes("OVH"));
  assert.ok(all.includes("outils"));
  assert.ok(all.includes("Facture 1"));
});

test("only the 30 most recent corrections are used", () => {
  const corrections = Array.from({ length: 40 }, (_, i) => ({ counterparty: `CP${i}`, label: "l", line: "divers" }));
  const all = JSON.stringify(buildMessages([item("a")], corrections));
  assert.ok(all.includes('CP29'));
  assert.ok(!all.includes('CP30'));
});

test("user message carries the transactions as JSON", () => {
  const msgs = buildMessages([item("a")], []);
  const user = msgs[msgs.length - 1];
  assert.equal(user.role, "user");
  assert.equal(JSON.parse(user.content).transactions[0].id, "a");
});

test("parses results and clamps confidence to [0,1]", async () => {
  const { impl } = fakeFetch([
    completion('{"results":[{"id":"a","line":"outils","confidence":1.4},{"id":"b","line":"divers","confidence":-2},{"id":"c","line":"loyer","confidence":0.8}]}'),
  ]);
  const out = await createKimiClassifier(cfg, impl).classify([item("a"), item("b"), item("c")], []);
  assert.deepEqual(out, [
    { id: "a", line: "outils", confidence: 1 },
    { id: "b", line: "divers", confidence: 0 },
    { id: "c", line: "loyer", confidence: 0.8 },
  ]);
});

test("invalid JSON returns []", async () => {
  const { impl } = fakeFetch([completion("not json at all")]);
  assert.deepEqual(await createKimiClassifier(cfg, impl).classify([item("a")], []), []);
});

test("malformed shapes return []", async () => {
  for (const body of ['{"results":"x"}', "null", "[]", '{"foo":1}']) {
    const { impl } = fakeFetch([completion(body)]);
    assert.deepEqual(await createKimiClassifier(cfg, impl).classify([item("a")], []), []);
  }
  const { impl } = fakeFetch([json({ choices: [] })]);
  assert.deepEqual(await createKimiClassifier(cfg, impl).classify([item("a")], []), []);
});

test("unknown id and out-of-list line are dropped, valid ones kept", async () => {
  const { impl } = fakeFetch([
    completion('{"results":[{"id":"zzz","line":"outils","confidence":0.9},{"id":"a","line":"cadeaux","confidence":0.9},{"id":"b","line":"marketing","confidence":0.9},{"id":"b","line":"divers","confidence":0.5},{"id":"a","line":"loyer","confidence":"high"}]}'),
  ]);
  const out = await createKimiClassifier(cfg, impl).classify([item("a"), item("b")], []);
  assert.deepEqual(out, [{ id: "b", line: "marketing", confidence: 0.9 }]);
});

test("missing ids are simply absent", async () => {
  const { impl } = fakeFetch([completion('{"results":[{"id":"a","line":"divers","confidence":0.9}]}')]);
  const out = await createKimiClassifier(cfg, impl).classify([item("a"), item("b")], []);
  assert.deepEqual(out.map((r) => r.id), ["a"]);
});

test("HTTP 401 throws a readable error without the key", async () => {
  const { impl } = fakeFetch([json({ error: { message: "Invalid Authentication k" } }, 401)]);
  await assert.rejects(
    () => createKimiClassifier({ apiKey: "sk-SECRET", model: "m1" }, impl).classify([item("a")], []),
    (err) => {
      assert.ok(err.message.includes("401"));
      assert.ok(!err.message.includes("sk-SECRET"));
      return true;
    },
  );
});

test("error message redacts the key if the API echoes it", async () => {
  const { impl } = fakeFetch([new Response("bad key sk-SECRET", { status: 401 })]);
  await assert.rejects(
    () => createKimiClassifier({ apiKey: "sk-SECRET", model: "m1" }, impl).classify([item("a")], []),
    (err) => !err.message.includes("sk-SECRET"),
  );
});
