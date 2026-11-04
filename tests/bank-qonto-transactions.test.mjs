import { test } from "node:test";
import assert from "node:assert/strict";
import { createQontoTransactions, mapTransaction } from "../apps/admin/server/bank/qonto-transactions.ts";
import { ProviderError } from "../apps/admin/server/invoicing/provider.ts";

const config = { login: "acme-1234", secretKey: "sk-SECRET-XYZ", iban: "FR7600000000000000000000000" };

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    return next;
  };
  return { impl, calls };
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("listDebitsSince sends iban, side, updated_at_from, sort and paging", async () => {
  const { impl, calls } = fakeFetch([json({
    transactions: [{ id: "t1", amount_cents: 500, settled_at: "2026-02-10T10:00:00Z", updated_at: "2026-02-10T10:00:00Z" }],
    meta: { current_page: 2, next_page: 3 },
  })]);
  const page = await createQontoTransactions(config, impl).listDebitsSince("2025-01-01T00:00:00.000Z", 2);
  const url = calls[0].url;
  assert.ok(url.includes("/v2/transactions"));
  assert.ok(url.includes("iban=FR7600000000000000000000000"));
  assert.ok(url.includes("side=debit"));
  assert.ok(url.includes("updated_at_from=2025-01-01T00%3A00%3A00.000Z"));
  assert.ok(url.includes("sort_by=updated_at%3Aasc"));
  assert.ok(url.includes("per_page=100"));
  assert.ok(url.includes("current_page=2"));
  assert.equal(calls[0].headers.authorization, "acme-1234:sk-SECRET-XYZ");
  assert.equal(page.nextPage, 3);
  assert.equal(page.transactions[0].id, "t1");
});

test("listDebitsSince returns nextPage null on last page", async () => {
  const { impl } = fakeFetch([json({ transactions: [], meta: { next_page: null } })]);
  const page = await createQontoTransactions(config, impl).listDebitsSince("2025-01-01T00:00:00.000Z", 1);
  assert.deepEqual(page, { transactions: [], nextPage: null });
});

test("mapTransaction computes HT from vat_amount_cents", () => {
  const t = mapTransaction({ id: "a", amount_cents: 12000, vat_amount_cents: 2000, settled_at: "2026-03-31T22:30:00Z", updated_at: "2026-04-01T00:00:00Z" });
  assert.equal(t.amountCents, 12000);
  assert.equal(t.vatCents, 2000);
  assert.equal(t.amountHtCents, 10000);
  assert.equal(t.month, "2026-04-01");
});

test("mapTransaction uses vat_amount when cents missing", () => {
  const t = mapTransaction({ id: "a", amount_cents: 12000, vat_amount: 20.5, settled_at: "2026-03-10T10:00:00Z" });
  assert.equal(t.vatCents, 2050);
  assert.equal(t.amountHtCents, 9950);
});

test("mapTransaction without VAT keeps TTC", () => {
  const t = mapTransaction({ id: "a", amount_cents: 4200, settled_at: "2026-03-10T10:00:00Z" });
  assert.equal(t.vatCents, 0);
  assert.equal(t.amountHtCents, t.amountCents);
});

test("mapTransaction falls back to emitted_at when not settled and maps counterparty", () => {
  const raw = {
    id: "a", amount_cents: 100, settled_at: null, emitted_at: "2026-05-15T08:00:00Z",
    clean_counterparty_name: "ACME", label: "L", operation_type: "card", status: "pending",
    updated_at: "2026-05-15T09:00:00Z", category: "software", note: "n", reference: "r",
  };
  const t = mapTransaction(raw);
  assert.equal(t.month, "2026-05-01");
  assert.equal(t.settledAt, null);
  assert.equal(t.emittedAt, "2026-05-15T08:00:00Z");
  assert.equal(t.counterparty, "ACME");
  assert.equal(t.qontoCategory, "software");
  assert.equal(t.qontoUpdatedAt, "2026-05-15T09:00:00Z");
  assert.equal(t.raw, raw);
  assert.equal(mapTransaction({ id: "b", amount_cents: 1, settled_at: "2026-01-01T00:00:00Z" }).qontoCategory, null);
});

test("non-ok response throws ProviderError", async () => {
  const { impl } = fakeFetch([json({ errors: [{ detail: "Unauthorized" }] }, 401)]);
  await assert.rejects(
    () => createQontoTransactions(config, impl).listDebitsSince("2025-01-01T00:00:00.000Z", 1),
    (e) => e instanceof ProviderError && e.status === 401,
  );
});
