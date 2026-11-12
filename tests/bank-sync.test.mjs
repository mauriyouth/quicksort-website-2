import { test } from "node:test";
import assert from "node:assert/strict";
import { runBankSync } from "../apps/admin/server/bank/sync.ts";

// In-memory BankStore mirroring the Supabase store semantics.
function memoryStore({ planYear = null, state = {} } = {}) {
  const s = {
    cursor: null,
    coverageStart: null,
    backfillDone: false,
    lockedUntil: null,
    lastRunAt: null,
    lastError: null,
    ...state,
  };
  const rows = new Map();
  const log = { tryLock: [], saveCursor: [], release: [], correctionLimits: [] };
  const store = {
    rows,
    log,
    get s() { return s; },
    async state() { return { ...s }; },
    async tryLock(untilIso, nowIso) {
      log.tryLock.push({ untilIso, nowIso });
      if (s.lockedUntil && Date.parse(s.lockedUntil) >= Date.parse(nowIso)) return false;
      s.lockedUntil = untilIso;
      return true;
    },
    async release(patch) {
      log.release.push(patch);
      Object.assign(s, { lockedUntil: null }, patch);
    },
    async saveCursor(cursor, coverageStart) {
      log.saveCursor.push({ cursor, coverageStart });
      s.cursor = cursor;
      s.coverageStart = coverageStart;
    },
    async upsertQonto(list) {
      for (const t of list) {
        const prev = rows.get(t.id);
        rows.set(t.id, {
          ...t,
          aiLine: prev?.aiLine ?? null,
          aiConfidence: prev?.aiConfidence ?? null,
          aiModel: prev?.aiModel ?? null,
          manualLine: prev?.manualLine ?? null,
          manualAt: prev?.manualAt ?? null,
        });
      }
    },
    async unclassified(limit) {
      return [...rows.values()]
        .filter((r) => r.status === "completed" && r.aiLine == null && r.manualLine == null)
        .sort((a, b) => (a.emittedAt ?? "").localeCompare(b.emittedAt ?? "") || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          label: r.label,
          counterparty: r.counterparty,
          amountEur: r.amountCents / 100,
          operationType: r.operationType,
          qontoCategory: r.qontoCategory,
          note: r.note,
        }));
    },
    async saveAi(results, model) {
      for (const r of results) {
        const row = rows.get(r.id);
        if (!row || row.aiLine != null) continue;
        row.aiLine = r.line;
        row.aiConfidence = r.confidence;
        row.aiModel = model;
      }
    },
    async corrections(limit) {
      log.correctionLimits.push(limit);
      return [...rows.values()]
        .filter((r) => r.manualLine != null)
        .sort((a, b) => (b.manualAt ?? "").localeCompare(a.manualAt ?? ""))
        .slice(0, limit)
        .map((r) => ({ counterparty: r.counterparty, label: r.label, line: r.manualLine }));
    },
    async firstPlanYear() { return planYear; },
  };
  return store;
}

function tx(id, updatedAt, extra = {}) {
  return {
    id,
    settledAt: updatedAt,
    emittedAt: updatedAt,
    month: updatedAt.slice(0, 7) + "-01",
    amountCents: 1200,
    vatCents: 200,
    amountHtCents: 1000,
    currency: "EUR",
    label: `label ${id}`,
    counterparty: `cp ${id}`,
    operationType: "card",
    qontoCategory: null,
    note: null,
    reference: null,
    status: "completed",
    qontoUpdatedAt: updatedAt,
    raw: {},
    ...extra,
  };
}

// Fake Qonto: `pages` is a function (since, page) => TransactionPage | Error, or a queue.
function fakeQonto(handler) {
  const calls = [];
  return {
    calls,
    async listDebitsSince(since, page) {
      calls.push({ since, page });
      const res = handler(since, page, calls.length);
      if (res instanceof Error) throw res;
      return res;
    },
  };
}

// Qonto backed by a list of transactions: filters updated_at >= since, sorts asc, pages of `per`.
function listQonto(all, per = 2) {
  return fakeQonto((since, page) => {
    const matching = all
      .filter((t) => Date.parse(t.qontoUpdatedAt) >= Date.parse(since))
      .sort((a, b) => Date.parse(a.qontoUpdatedAt) - Date.parse(b.qontoUpdatedAt));
    const slice = matching.slice((page - 1) * per, page * per);
    const nextPage = page * per < matching.length ? page + 1 : null;
    return { transactions: slice, nextPage };
  });
}

function fakeClassifier(lineFor = () => "outils") {
  const calls = [];
  return {
    calls,
    async classify(items, corrections) {
      calls.push({ items, corrections });
      return items.map((i) => ({ id: i.id, line: lineFor(i), confidence: 0.9 }));
    },
  };
}

const NOW = new Date("2026-11-04T10:00:00.000Z");
const fixedNow = () => new Date(NOW);

test("first run starts at Jan 1 of first plan year and sets coverageStart", async () => {
  const store = memoryStore({ planYear: 2024 });
  const qonto = listQonto([]);
  const res = await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(qonto.calls[0].since, "2024-01-01T00:00:00.000Z");
  assert.equal(qonto.calls[0].page, 1);
  assert.equal(store.s.coverageStart, "2024-01-01");
  assert.equal(res.status, "ok");
});

test("first run without business plan starts at 2025-01-01", async () => {
  const store = memoryStore({ planYear: null });
  const qonto = listQonto([]);
  await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(qonto.calls[0].since, "2025-01-01T00:00:00.000Z");
  assert.equal(store.s.coverageStart, "2025-01-01");
});

test("coverageStart is never changed after the first run", async () => {
  const store = memoryStore({ planYear: 2020, state: { cursor: "2026-01-01T00:00:00.000Z", coverageStart: "2025-01-01", backfillDone: true } });
  const qonto = listQonto([tx("a", "2026-02-01T00:00:00.000Z")]);
  await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(qonto.calls[0].since, "2026-01-01T00:00:00.000Z");
  assert.equal(store.s.coverageStart, "2025-01-01");
  assert.equal(store.s.cursor, "2026-02-01T00:00:00.000Z");
});

test("paginates and advances the cursor to the max qontoUpdatedAt after each page", async () => {
  const all = [
    tx("a", "2025-01-02T00:00:00.000Z"),
    tx("b", "2025-01-03T00:00:00.000Z"),
    tx("c", "2025-01-04T00:00:00.000Z"),
    tx("d", "2025-01-05T00:00:00.000Z"),
    tx("e", "2025-01-06T00:00:00.000Z"),
  ];
  const store = memoryStore();
  const qonto = listQonto(all, 2);
  const res = await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(res.status, "ok");
  assert.deepEqual(
    store.log.saveCursor.map((c) => c.cursor).filter((c) => c !== "2025-01-01T00:00:00.000Z"),
    ["2025-01-03T00:00:00.000Z", "2025-01-04T00:00:00.000Z", "2025-01-05T00:00:00.000Z", "2025-01-06T00:00:00.000Z"],
  );
  // After each advance the next request restarts at page 1 with the new cursor.
  assert.deepEqual(qonto.calls.map((c) => c.page), [1, 1, 1, 1]);
  assert.equal(qonto.calls[1].since, "2025-01-03T00:00:00.000Z");
  assert.equal(store.rows.size, 5);
  assert.equal(store.s.cursor, "2025-01-06T00:00:00.000Z");
  assert.equal(store.s.backfillDone, true);
  assert.equal(store.s.lockedUntil, null);
});

test("error on page 2 keeps the cursor of page 1, records lastError, releases the lock", async () => {
  const store = memoryStore();
  const qonto = fakeQonto((since, page, n) => {
    if (n === 1) return { transactions: [tx("a", "2025-02-01T00:00:00.000Z"), tx("b", "2025-02-02T00:00:00.000Z")], nextPage: 2 };
    return new Error("Qonto HTTP 500");
  });
  const res = await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(res.status, "partial");
  assert.equal(res.fetched, 2);
  assert.equal(store.s.cursor, "2025-02-02T00:00:00.000Z");
  assert.match(store.s.lastError, /Qonto HTTP 500/);
  assert.equal(store.s.lockedUntil, null);
  assert.equal(store.s.backfillDone, false);
  assert.equal(store.s.lastRunAt, NOW.toISOString());
});

test("same updated_at across pages: nothing lost, re-fetch is idempotent", async () => {
  const same = "2025-03-01T00:00:00.000Z";
  const all = [
    tx("a", same), tx("b", same), tx("c", same), tx("d", same), tx("e", same),
    tx("f", "2025-03-02T00:00:00.000Z"),
  ];
  const store = memoryStore({ state: { cursor: same, coverageStart: "2025-01-01" } });
  const qonto = listQonto(all, 2);
  const res = await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(res.status, "ok");
  assert.deepEqual([...store.rows.keys()].sort(), ["a", "b", "c", "d", "e", "f"]);
  // Pages that did not move the cursor move to page+1 with the same cursor.
  assert.deepEqual(qonto.calls.map((c) => [c.since, c.page]), [
    [same, 1], [same, 2], [same, 3],
  ]);
  assert.equal(store.s.cursor, "2025-03-02T00:00:00.000Z");

  // Re-running from the same cursor re-upserts without duplicating.
  const again = await runBankSync({ store, qonto: listQonto(all, 2), classifier: null, model: "m", now: fixedNow });
  assert.equal(again.status, "ok");
  assert.equal(store.rows.size, 6);
});

test("re-sync of a manually classified transaction keeps manual_line and ai_line", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  await store.upsertQonto([tx("a", "2025-01-02T00:00:00.000Z")]);
  Object.assign(store.rows.get("a"), { aiLine: "outils", aiConfidence: 0.4, manualLine: "loyer", manualAt: "2025-06-01T00:00:00.000Z" });
  const qonto = listQonto([tx("a", "2025-04-01T00:00:00.000Z", { label: "new label" })]);
  const classifier = fakeClassifier(() => "divers");
  await runBankSync({ store, qonto, classifier, model: "m", now: fixedNow });
  const row = store.rows.get("a");
  assert.equal(row.label, "new label");
  assert.equal(row.manualLine, "loyer");
  assert.equal(row.aiLine, "outils");
  assert.equal(classifier.calls.length, 0);
});

test("status change to reversed is stored, classification kept", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  await store.upsertQonto([tx("a", "2025-01-02T00:00:00.000Z")]);
  Object.assign(store.rows.get("a"), { aiLine: "outils", aiConfidence: 0.9 });
  const qonto = listQonto([tx("a", "2025-05-01T00:00:00.000Z", { status: "reversed" })]);
  await runBankSync({ store, qonto, classifier: fakeClassifier(), model: "m", now: fixedNow });
  const row = store.rows.get("a");
  assert.equal(row.status, "reversed");
  assert.equal(row.aiLine, "outils");
  assert.equal(row.aiConfidence, 0.9);
});

test("classifies unclassified in batches of 20 using corrections", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  const all = Array.from({ length: 45 }, (_, i) =>
    tx(`t${String(i).padStart(2, "0")}`, new Date(Date.UTC(2025, 0, 2, 0, i)).toISOString()));
  await store.upsertQonto([tx("m1", "2024-12-01T00:00:00.000Z")]);
  Object.assign(store.rows.get("m1"), { manualLine: "honoraires", manualAt: "2025-01-01T00:00:00.000Z" });
  const classifier = fakeClassifier();
  const res = await runBankSync({ store, qonto: listQonto(all, 100), classifier, model: "kimi-x", now: fixedNow });
  assert.equal(res.status, "ok");
  assert.equal(res.fetched, 45);
  assert.equal(res.classified, 45);
  assert.equal(res.remaining, 0);
  assert.deepEqual(classifier.calls.map((c) => c.items.length), [20, 20, 5]);
  // Oldest first, TTC amount in euros.
  assert.equal(classifier.calls[0].items[0].id, "t00");
  assert.equal(classifier.calls[0].items[0].amountEur, 12);
  assert.deepEqual(classifier.calls[0].corrections, [{ counterparty: "cp m1", label: "label m1", line: "honoraires" }]);
  assert.equal(store.rows.get("t44").aiModel, "kimi-x");
  assert.equal(store.s.lastError, null);
});

test("only completed transactions are sent to the classifier", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  const all = [
    tx("ok", "2025-01-02T00:00:00.000Z"),
    tx("declined", "2025-01-03T00:00:00.000Z", { status: "declined" }),
  ];
  const classifier = fakeClassifier();
  const res = await runBankSync({ store, qonto: listQonto(all), classifier, model: "m", now: fixedNow });
  assert.deepEqual(classifier.calls.flatMap((c) => c.items.map((i) => i.id)), ["ok"]);
  assert.equal(res.classified, 1);
});

test("classifier skipping items does not loop forever on them", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  const all = Array.from({ length: 25 }, (_, i) => tx(`t${String(i).padStart(2, "0")}`, new Date(Date.UTC(2025, 0, 2, 0, i)).toISOString()));
  const calls = [];
  const classifier = {
    async classify(items) {
      calls.push(items.map((i) => i.id));
      return items.filter((i) => i.id !== "t00").map((i) => ({ id: i.id, line: "outils", confidence: 0.9 }));
    },
  };
  const res = await runBankSync({ store, qonto: listQonto(all, 100), classifier, model: "m", now: fixedNow });
  assert.equal(calls.length, 2);
  assert.equal(res.classified, 24);
  assert.equal(res.remaining, 1);
});

test("classifier null → fetched ok, classified 0", async () => {
  const store = memoryStore();
  const res = await runBankSync({ store, qonto: listQonto([tx("a", "2025-01-02T00:00:00.000Z")]), classifier: null, model: "m", now: fixedNow });
  assert.equal(res.status, "ok");
  assert.equal(res.fetched, 1);
  assert.equal(res.classified, 0);
  assert.equal(res.remaining, 1);
});

test("classifier throws → sync still ok, lastError set", async () => {
  const store = memoryStore();
  const classifier = { async classify() { throw new Error("Moonshot request failed (HTTP 401)"); } };
  const res = await runBankSync({ store, qonto: listQonto([tx("a", "2025-01-02T00:00:00.000Z")]), classifier, model: "m", now: fixedNow });
  assert.equal(res.status, "ok");
  assert.equal(res.fetched, 1);
  assert.equal(res.classified, 0);
  assert.match(store.s.lastError, /HTTP 401/);
  assert.equal(store.s.cursor, "2025-01-02T00:00:00.000Z");
  assert.equal(store.s.lockedUntil, null);
});

test("successful run clears a previous lastError", async () => {
  const store = memoryStore({ state: { lastError: "old" } });
  await runBankSync({ store, qonto: listQonto([]), classifier: null, model: "m", now: fixedNow });
  assert.equal(store.s.lastError, null);
});

test("locked → status \"locked\", nothing fetched", async () => {
  const store = memoryStore({ state: { lockedUntil: "2026-11-04T10:03:00.000Z" } });
  const qonto = listQonto([tx("a", "2025-01-02T00:00:00.000Z")]);
  const res = await runBankSync({ store, qonto, classifier: fakeClassifier(), model: "m", now: fixedNow });
  assert.deepEqual(res, { status: "locked", fetched: 0, classified: 0, remaining: 0 });
  assert.equal(qonto.calls.length, 0);
  assert.equal(store.log.release.length, 0);
  assert.equal(store.s.lockedUntil, "2026-11-04T10:03:00.000Z");
});

test("lock expires after 5 minutes", async () => {
  const store = memoryStore();
  const qonto = fakeQonto(() => ({ transactions: [], nextPage: null }));
  await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.deepEqual(store.log.tryLock[0], { untilIso: "2026-11-04T10:05:00.000Z", nowIso: NOW.toISOString() });

  // A crashed run left its lock: blocked within 5 minutes, free after.
  store.s.lockedUntil = "2026-11-04T10:05:00.000Z";
  const blocked = await runBankSync({ store, qonto, classifier: null, model: "m", now: () => new Date("2026-11-04T10:04:00.000Z") });
  assert.equal(blocked.status, "locked");
  const free = await runBankSync({ store, qonto, classifier: null, model: "m", now: () => new Date("2026-11-04T10:05:01.000Z") });
  assert.equal(free.status, "ok");
});

test("budget exceeded → status \"partial\", remaining > 0", async () => {
  const store = memoryStore({ state: { cursor: "2025-01-01T00:00:00.000Z", coverageStart: "2025-01-01" } });
  const all = Array.from({ length: 30 }, (_, i) => tx(`t${String(i).padStart(2, "0")}`, new Date(Date.UTC(2025, 0, 2, 0, i)).toISOString()));
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  const classifier = {
    async classify(items) {
      clock += 1000; // each batch costs 1s, budget is 0.5s
      return items.map((i) => ({ id: i.id, line: "outils", confidence: 0.9 }));
    },
  };
  const res = await runBankSync({ store, qonto: listQonto(all, 100), classifier, model: "m", now, budgetMs: 500 });
  assert.equal(res.status, "partial");
  assert.equal(res.classified, 20);
  assert.equal(res.remaining, 10);
  assert.equal(store.s.lockedUntil, null);
});

test("budget exceeded while fetching → partial, backfill not done", async () => {
  const store = memoryStore();
  let clock = NOW.getTime();
  const now = () => new Date(clock);
  const qonto = fakeQonto((since, page, n) => {
    clock += 1000;
    return { transactions: [tx(`t${n}`, new Date(Date.UTC(2025, 0, 1 + n)).toISOString())], nextPage: 2 };
  });
  const res = await runBankSync({ store, qonto, classifier: null, model: "m", now, budgetMs: 1500 });
  assert.equal(res.status, "partial");
  assert.equal(qonto.calls.length, 2);
  assert.equal(store.s.backfillDone, false);
  assert.equal(store.s.cursor, "2025-01-03T00:00:00.000Z");
});

test("backfillDone becomes true when a page returns nextPage null", async () => {
  const store = memoryStore();
  const qonto = fakeQonto((since, page, n) =>
    n === 1
      ? { transactions: [tx("a", "2025-01-02T00:00:00.000Z")], nextPage: 2 }
      : { transactions: [tx("b", "2025-01-03T00:00:00.000Z")], nextPage: null });
  await runBankSync({ store, qonto, classifier: null, model: "m", now: fixedNow });
  assert.equal(store.s.backfillDone, true);
});

test("store failure releases the lock, records the error, keeps backfillDone", async () => {
  const store = memoryStore({ state: { backfillDone: true } });
  store.state = async () => { throw new Error("Bank store: read sync state failed: boom"); };
  await assert.rejects(
    runBankSync({ store, qonto: listQonto([]), classifier: null, model: "m", now: fixedNow }),
    /boom/,
  );
  assert.equal(store.s.lockedUntil, null);
  assert.equal(store.s.backfillDone, true);
  assert.match(store.s.lastError, /boom/);
});
