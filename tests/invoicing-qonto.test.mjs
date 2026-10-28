import { test } from "node:test";
import assert from "node:assert/strict";
import { createQontoProvider } from "../apps/admin/server/invoicing/qonto.ts";
import { ProviderError } from "../apps/admin/server/invoicing/provider.ts";

const config = { login: "acme-1234", secretKey: "sk", iban: "FR7600000000000000000000000" };

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

const draft = {
  clientId: "c1", issueDate: "2026-10-01", dueDate: "2026-10-31", currency: "EUR",
  periodStart: "2026-09-01", periodEnd: "2026-09-30", purchaseOrder: "",
  lines: [{ title: "Dev", description: "Sept", quantity: "10", unit: "day", unitPrice: "650.00", vatRate: "0.2" }],
};

test("createDraft sends draft payload with iban and auth header", async () => {
  const { impl, calls } = fakeFetch([json({ client_invoice: { id: "i1", status: "draft", currency: "EUR", total_amount: { value: "1.00" }, vat_amount: { value: "0.00" } } }, 201)]);
  const p = createQontoProvider(config, impl);
  await p.createDraft(draft);
  const c = calls[0];
  assert.equal(c.url, "https://thirdparty.qonto.com/v2/client_invoices");
  assert.equal(c.method, "POST");
  assert.equal(c.headers.authorization, "acme-1234:sk");
  const body = JSON.parse(c.body);
  assert.equal(body.status, "draft");
  assert.deepEqual(body.items[0].unit_price, { value: "650.00", currency: "EUR" });
  assert.deepEqual(body.payment_methods, { iban: config.iban });
  assert.equal("purchase_order" in body, false);
});

test("staging config uses sandbox url and staging header", async () => {
  const { impl, calls } = fakeFetch([json({ organization: { bank_accounts: [{ iban: "FR1", name: "Main" }] } })]);
  const p = createQontoProvider({ ...config, stagingToken: "stg" }, impl);
  const accounts = await p.listPaymentAccounts();
  assert.deepEqual(accounts, [{ iban: "FR1", name: "Main" }]);
  assert.equal(calls[0].url, "https://thirdparty-sandbox.staging.qonto.co/v2/organization");
  assert.equal(calls[0].headers["X-Qonto-Staging-Token"], "stg");
});

test("listClients follows pagination and merges extra emails", async () => {
  const { impl, calls } = fakeFetch([
    json({ clients: [{ id: "1", name: "A", email: "a@x.fr", extra_emails: ["b@x.fr", "a@x.fr"], currency: "EUR" }, { id: "2", name: "B", email: "", currency: "EUR" }], meta: { next_page: 2 } }),
    json({ clients: [{ id: "3", name: "C", email: "c@x.fr", tax_identification_number: "T1", vat_number: "V1", currency: "EUR" }], meta: { next_page: null } }),
  ]);
  const clients = await createQontoProvider(config, impl).listClients();
  assert.equal(clients.length, 3);
  assert.deepEqual(clients[0].emails, ["a@x.fr", "b@x.fr"]);
  assert.deepEqual(clients[1].emails, []);
  assert.equal(clients[2].taxId, "T1");
  assert.match(calls[1].url, /page=2/);
});

test("listInvoices maps unpaid to finalized and computes HT", async () => {
  const { impl } = fakeFetch([
    json({ client_invoices: [{ id: "i1", number: "F-1", status: "unpaid", currency: "EUR", total_amount: { value: "1200.00", currency: "EUR" }, vat_amount: { value: "200.00", currency: "EUR" }, client: { id: "c1", email: "a@x.fr" }, items: [] }], meta: { next_page: null } }),
  ]);
  const [inv] = await createQontoProvider(config, impl).listInvoices();
  assert.equal(inv.status, "finalized");
  assert.equal(inv.totalHt, "1000.00");
  assert.equal(inv.totalTtc, "1200.00");
  assert.deepEqual(inv.clientEmails, ["a@x.fr"]);
});

test("422 surfaces detail without secret", async () => {
  const { impl } = fakeFetch([json({ errors: [{ status: "422", code: "x", detail: "due_date must be after issue_date" }] }, 422)]);
  await assert.rejects(createQontoProvider(config, impl).createDraft(draft), (e) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.message, "due_date must be after issue_date");
    assert.equal(e.status, 422);
    assert.ok(!e.message.includes("sk"));
    return true;
  });
});
