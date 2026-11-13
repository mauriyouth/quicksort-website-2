import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ingestInvoicePdf } from "../apps/admin/server/freelancer-invoices/intake.ts";
import { createSupabaseFreelancerInvoiceStore } from "../apps/admin/server/freelancer-invoices/store.ts";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const IBAN = "FR7630006000011234567890189";

// In-memory FreelancerInvoiceStore mirroring the Supabase store semantics
// (unique (employee_id, sha256) and (employee_id, number) where number <> ''
// and review <> 'rejected').
function memoryStore({ billing = null } = {}) {
  const invoices = [];
  const documents = [];
  const events = [];
  const billings = new Map(billing ? [[EMPLOYEE, { companyName: "", siret: "", iban: "", ...billing }]] : []);
  let seq = 0;
  let raceOnce = null;
  const store = {
    invoices,
    documents,
    events,
    billings,
    // Simulates a concurrent insert of `row` just before ours (unique race).
    raceWith(row) { raceOnce = row; },
    async findDuplicate(employeeId, sha256, number) {
      const hit = invoices.find((i) => i.employeeId === employeeId && (i.sha256 === sha256 || (number !== "" && i.number === number && i.review !== "rejected")));
      return hit ? hit.id : null;
    },
    async insertInvoice(row) {
      if (raceOnce) {
        invoices.push({ ...raceOnce, id: `inv-${++seq}` });
        raceOnce = null;
      }
      const clash = invoices.some((i) => i.employeeId === row.employeeId && (i.sha256 === row.sha256 || (row.number !== "" && i.number === row.number && i.review !== "rejected")));
      if (clash) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      const id = `inv-${++seq}`;
      invoices.push({ ...row, id });
      return id;
    },
    async invoiceFolder(storage, personId) {
      return storage.ensureFolder("people", [`NGAM Amadou – ${personId.slice(0, 8)}`, "09_Factures"]);
    },
    async registerDocument(input) {
      const id = `doc-${++seq}`;
      documents.push({ ...input, id, status: "active" });
      return id;
    },
    async archiveDocument(documentId) {
      const doc = documents.find((d) => d.id === documentId);
      if (doc) doc.status = "archived";
    },
    async billing(employeeId) {
      const b = billings.get(employeeId);
      return { employeeId, personName: "Amadou Ngam", companyName: b?.companyName ?? "", iban: b?.iban ?? "" };
    },
    async prefillBilling(employeeId, patch) {
      const b = billings.get(employeeId) ?? { companyName: "", siret: "", iban: "" };
      for (const [k, v] of Object.entries(patch)) if (v && !b[k]) b[k] = v;
      billings.set(employeeId, b);
    },
    async logEvent(invoiceId, kind, actorEmail, detail) {
      events.push({ invoiceId, kind, actorEmail, detail });
    },
    async personFor() {
      return { personId: PERSON, fullName: "Amadou Ngam" };
    },
  };
  return store;
}

function fakeStorage() {
  const uploads = [];
  const trashed = [];
  return {
    provider: "gdrive",
    uploads,
    trashed,
    async ensureFolder(root, path) {
      return { id: `folder:${root}/${path.join("/")}`, name: path.at(-1), link: null };
    },
    async ensureChild(parent, name) {
      return { id: `${parent.id}/${name}`, name, link: null };
    },
    async uploadFile(folder, file, bytes) {
      const id = `file-${uploads.length + 1}`;
      uploads.push({ folder, file, bytes });
      return { id, name: file.name, mimeType: file.mimeType, size: bytes.length, modifiedAt: null, link: null, folderIds: [folder.id], sha256: null, isFolder: false };
    },
    async trash(fileId) { trashed.push(fileId); },
  };
}

function fields(over = {}) {
  return {
    number: "F-2026-10",
    issueDate: "2026-11-02",
    dueDate: null,
    periodMonth: "2026-10-01",
    amountHtCents: 840000,
    vatCents: 168000,
    amountTtcCents: 1008000,
    isCreditNote: false,
    issuerName: "Ngam Conseil SASU",
    issuerSiret: "12345678900012",
    issuerIban: IBAN,
    looksLikeInvoice: true,
    ...over,
  };
}

function deps(store, storage, extracted = fields()) {
  const calls = { extract: 0 };
  return {
    calls,
    deps: {
      store,
      storage,
      extract: async () => { calls.extract++; return typeof extracted === "function" ? extracted() : extracted; },
      now: () => new Date("2026-11-10T09:00:00Z"),
    },
  };
}

const input = (bytes, over = {}) => ({ employeeId: EMPLOYEE, bytes, fileName: "facture-octobre.pdf", source: "portal", actorEmail: "amadou@example.com", ...over });
const pdf = (text) => new TextEncoder().encode(`%PDF-1.4 ${text}`);

test("a new PDF is filed once, inserted to check, logged and prefills billing", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage);
  const bytes = pdf("october");
  const result = await ingestInvoicePdf(d, input(bytes));

  assert.equal(result.duplicate, false);
  assert.equal(storage.uploads.length, 1);
  assert.equal(storage.uploads[0].file.mimeType, "application/pdf");
  assert.match(storage.uploads[0].folder.id, /09_Factures$/);
  assert.equal(store.documents.length, 1);
  assert.equal(store.documents[0].personId, PERSON);
  assert.equal(store.documents[0].fileId, "file-1");

  assert.equal(store.invoices.length, 1);
  const inv = store.invoices[0];
  assert.equal(inv.id, result.invoiceId);
  assert.equal(inv.review, "to_check");
  assert.deepEqual(inv.flags, []);
  assert.equal(inv.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(inv.documentId, store.documents[0].id);
  assert.equal(inv.number, "F-2026-10");
  assert.equal(inv.amountHtCents, 840000);
  assert.equal(inv.amountTtcCents, 1008000);
  assert.equal(inv.dueDate, "2026-12-02");
  assert.equal(inv.source, "portal");
  assert.deepEqual(inv.extraction, fields());

  assert.deepEqual(store.events.map((e) => e.kind), ["received"]);
  assert.equal(store.events[0].invoiceId, result.invoiceId);
  assert.equal(store.billings.get(EMPLOYEE).iban, IBAN);
  assert.equal(store.billings.get(EMPLOYEE).siret, "12345678900012");
  assert.equal(store.billings.get(EMPLOYEE).companyName, "Ngam Conseil SASU");
});

test("the same bytes again are a duplicate: no second upload or extraction", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d, calls } = deps(store, storage);
  const bytes = pdf("october");
  const first = await ingestInvoicePdf(d, input(bytes));
  const again = await ingestInvoicePdf(d, input(bytes, { source: "email", gmailMessageId: "m-2" }));

  assert.deepEqual(again, { invoiceId: first.invoiceId, duplicate: true, skipped: false });
  assert.equal(storage.uploads.length, 1);
  assert.equal(calls.extract, 1);
  assert.equal(store.invoices.length, 1);
  assert.deepEqual(store.events.map((e) => e.kind), ["received", "duplicate_received"]);
  assert.equal(store.events[1].invoiceId, first.invoiceId);
});

test("different bytes with the same invoice number are a duplicate", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage);
  const first = await ingestInvoicePdf(d, input(pdf("october")));
  const again = await ingestInvoicePdf(d, input(pdf("october, re-exported")));

  assert.deepEqual(again, { invoiceId: first.invoiceId, duplicate: true, skipped: false });
  assert.equal(storage.uploads.length, 1);
  assert.equal(store.invoices.length, 1);
  assert.equal(store.events.at(-1).kind, "duplicate_received");
});

test("a corrected invoice reusing a rejected invoice's number is a new invoice", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage, fields({ number: "FAC-12" }));
  const first = await ingestInvoicePdf(d, input(pdf("october")));
  store.invoices[0].review = "rejected";
  const corrected = await ingestInvoicePdf(d, input(pdf("october, corrected")));

  assert.equal(corrected.duplicate, false);
  assert.notEqual(corrected.invoiceId, first.invoiceId);
  assert.deepEqual(store.invoices.map((i) => [i.number, i.review]), [["FAC-12", "rejected"], ["FAC-12", "to_check"]]);
  // The rejected file itself is still a duplicate.
  const again = await ingestInvoicePdf(d, input(pdf("october")));
  assert.deepEqual(again, { invoiceId: first.invoiceId, duplicate: true, skipped: false });
});

test("the Supabase store ignores rejected invoices when matching by number, not by file", async () => {
  const queries = [];
  const client = {
    from(table) {
      const q = { table, filters: [] };
      queries.push(q);
      const b = {
        select: () => b,
        eq: (c, v) => { q.filters.push(["eq", c, v]); return b; },
        neq: (c, v) => { q.filters.push(["neq", c, v]); return b; },
        limit: () => b,
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return b;
    },
  };
  const store = createSupabaseFreelancerInvoiceStore(client);
  assert.equal(await store.findDuplicate(EMPLOYEE, "sha", "FAC-12"), null);
  const [byHash, byNumber] = queries;
  assert.ok(!byHash.filters.some(([op, c]) => op === "neq" && c === "review"));
  assert.deepEqual(byNumber.filters.find(([, c]) => c === "review"), ["neq", "review", "rejected"]);
});

test("an invoice without a readable period is inserted to check, flagged unreadable", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage, fields({ periodMonth: null }));
  await ingestInvoicePdf(d, input(pdf("no period")));

  assert.equal(store.invoices.length, 1);
  const inv = store.invoices[0];
  assert.equal(inv.review, "to_check");
  assert.equal(inv.periodMonth, null);
  assert.deepEqual(inv.flags, ["unreadable"]);
});

test("an issuer IBAN different from the stored one is flagged and not overwritten", async () => {
  const stored = "FR1420041010050500013M02606";
  const store = memoryStore({ billing: { companyName: "Ngam Conseil", iban: stored } });
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage, fields({ issuerIban: IBAN }));
  await ingestInvoicePdf(d, input(pdf("new bank")));

  const inv = store.invoices[0];
  assert.equal(inv.review, "to_check");
  assert.ok(inv.flags.includes("iban_changed"));
  assert.equal(store.billings.get(EMPLOYEE).iban, stored);
  assert.equal(store.billings.get(EMPLOYEE).companyName, "Ngam Conseil");
  assert.equal(store.billings.get(EMPLOYEE).siret, "12345678900012");
});

test("a stored IBAN written with spaces or lowercase is not a change", async () => {
  const store = memoryStore({ billing: { iban: "fr76 3000 6000 0112 3456 7890 189" } });
  const { deps: d } = deps(store, fakeStorage());
  await ingestInvoicePdf(d, input(pdf("same bank")));
  assert.deepEqual(store.invoices[0].flags, []);
});

test("a document that is not an invoice is flagged and does not prefill billing", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage(), fields({ looksLikeInvoice: false, number: "", amountHtCents: null, vatCents: null, amountTtcCents: null }));
  await ingestInvoicePdf(d, input(pdf("a CV")));
  assert.deepEqual(store.invoices[0].flags, ["not_invoice", "unreadable"]);
  assert.equal(store.billings.has(EMPLOYEE), false);
});

test("an email attachment that is not an invoice is skipped: nothing uploaded or stored", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage, fields({ looksLikeInvoice: false, number: "", amountHtCents: null }));
  const result = await ingestInvoicePdf(d, input(pdf("a timesheet"), { source: "email", gmailMessageId: "msg-7", actorEmail: "mailbox-sync" }));
  assert.deepEqual(result, { invoiceId: null, duplicate: false, skipped: true });
  assert.equal(store.invoices.length, 0);
  assert.equal(storage.uploads.length, 0);
});

test("an email attachment whose read failed is still stored, flagged unreadable", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage(), fields({ looksLikeInvoice: false, extractionFailed: true }));
  const result = await ingestInvoicePdf(d, input(pdf("garbled"), { source: "email", gmailMessageId: "msg-8", actorEmail: "mailbox-sync" }));
  assert.equal(result.skipped, false);
  assert.deepEqual(store.invoices[0].flags, ["unreadable"]);
});

test("a failed extraction is flagged unreadable, not as a non-invoice", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage(), fields({ looksLikeInvoice: false, extractionFailed: true }));
  await ingestInvoicePdf(d, input(pdf("garbled")));
  assert.deepEqual(store.invoices[0].flags, ["unreadable"]);
});

test("a credit note keeps its negative amounts", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage(), fields({ number: "AV-1", isCreditNote: true, amountHtCents: -40000, vatCents: -8000, amountTtcCents: -48000 }));
  await ingestInvoicePdf(d, input(pdf("avoir")));
  const inv = store.invoices[0];
  assert.equal(inv.isCreditNote, true);
  assert.equal(inv.amountHtCents, -40000);
  assert.equal(inv.amountTtcCents, -48000);
});

test("a printed due date wins over issue date + 30 days", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage(), fields({ dueDate: "2026-11-15" }));
  await ingestInvoicePdf(d, input(pdf("due")));
  assert.equal(store.invoices[0].dueDate, "2026-11-15");
});

test("an email invoice keeps its Gmail message id", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage());
  await ingestInvoicePdf(d, input(pdf("mail"), { source: "email", gmailMessageId: "msg-42", actorEmail: "system" }));
  assert.equal(store.invoices[0].source, "email");
  assert.equal(store.invoices[0].gmailMessageId, "msg-42");
});

test("losing a unique race resolves to the winner as a duplicate and undoes the upload", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const bytes = pdf("race");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  store.raceWith({ employeeId: EMPLOYEE, sha256, number: "F-2026-10" });
  const { deps: d } = deps(store, storage);
  const result = await ingestInvoicePdf(d, input(bytes));

  assert.equal(result.duplicate, true);
  assert.equal(result.invoiceId, store.invoices[0].id);
  assert.equal(store.invoices.length, 1);
  assert.deepEqual(storage.trashed, ["file-1"]);
  assert.equal(store.documents[0].status, "archived");
  assert.deepEqual(store.events.map((e) => e.kind), ["duplicate_received"]);
});

test("a store error other than a unique violation is thrown", async () => {
  const store = memoryStore();
  store.insertInvoice = async () => { throw Object.assign(new Error("boom"), { code: "XX000" }); };
  const { deps: d } = deps(store, fakeStorage());
  await assert.rejects(ingestInvoicePdf(d, input(pdf("x"))), /boom/);
});

test("a refused registration trashes the uploaded file and inserts nothing", async () => {
  const store = memoryStore();
  store.registerDocument = async () => { throw new Error("register refused"); };
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage);
  await assert.rejects(ingestInvoicePdf(d, input(pdf("refused"))), /register refused/);
  assert.deepEqual(storage.trashed, ["file-1"]);
  assert.equal(store.invoices.length, 0);
});

test("a billing read failure happens before anything is uploaded", async () => {
  const store = memoryStore();
  store.billing = async () => { throw new Error("billing down"); };
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage);
  await assert.rejects(ingestInvoicePdf(d, input(pdf("billing"))), /billing down/);
  assert.equal(storage.uploads.length, 0);
  assert.equal(store.documents.length, 0);
});

test("prefill and the received event are best effort once the invoice is stored", async () => {
  const store = memoryStore();
  store.prefillBilling = async () => { throw new Error("prefill down"); };
  store.logEvent = async () => { throw new Error("events down"); };
  const { deps: d } = deps(store, fakeStorage());
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const result = await ingestInvoicePdf(d, input(pdf("best effort")));
    assert.equal(result.duplicate, false);
    assert.equal(store.invoices.length, 1);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
});

test("an extraction that throws stores a blank invoice flagged unreadable", async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const { deps: d } = deps(store, storage, () => { throw new Error("Moonshot request failed (HTTP 503)."); });
  const result = await ingestInvoicePdf(d, input(pdf("kimi down")));

  assert.equal(result.duplicate, false);
  assert.equal(storage.uploads.length, 1);
  const inv = store.invoices[0];
  assert.equal(inv.review, "to_check");
  assert.deepEqual(inv.flags, ["unreadable"]);
  assert.equal(inv.number, "");
  assert.equal(inv.periodMonth, null);
  assert.equal(inv.amountHtCents, null);
  assert.equal(inv.amountTtcCents, null);
  assert.equal(inv.dueDate, null);
  assert.deepEqual(inv.extraction, { error: "Moonshot request failed (HTTP 503)." });
  assert.equal(store.billings.has(EMPLOYEE), false);
  assert.deepEqual(store.events.map((e) => e.kind), ["received"]);
});

test("registration carries the actor and employee for the audit row", async () => {
  const store = memoryStore();
  const { deps: d } = deps(store, fakeStorage());
  await ingestInvoicePdf(d, input(pdf("audit")));
  assert.equal(store.documents[0].actorEmail, "amadou@example.com");
  assert.equal(store.documents[0].employeeId, EMPLOYEE);
});
