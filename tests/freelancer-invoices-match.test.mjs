import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPayments, debitIban, nameMatches } from "../apps/admin/server/freelancer-invoices/match.ts";

const IBAN = "FR7630001007941234567890185";
const inv = (o = {}) => ({
  id: "oct", employeeId: "e1", number: "1", issueDate: "2026-10-31", periodMonth: "2026-10-01", dueDate: null,
  amountHtCents: 700000, vatCents: 140000, amountTtcCents: 840000, isCreditNote: false, flags: [], review: "ok",
  reviewNote: "", paidAt: null, paidByTransactionId: null, source: "portal", createdAt: "2026-11-01T00:00:00Z", ...o,
});
const sep = (o = {}) => inv({ id: "sep", number: "0", issueDate: "2026-09-30", periodMonth: "2026-09-01", ...o });
const debit = (o = {}) => ({ id: "t1", settledAt: "2026-11-08T09:00:00.000Z", amountCents: -840000, counterparty: "Someone Else", iban: IBAN, ...o });
const billing = (o = {}) => ({ employeeId: "e1", personName: "Karim Benali", companyName: "Acme Consulting", iban: IBAN, ...o });
const sortPairs = (xs) => [...xs].sort((a, b) => `${a.invoiceId}${a.transactionId}`.localeCompare(`${b.invoiceId}${b.transactionId}`));

test("IBAN match is confident", () => {
  const r = matchPayments([inv()], [debit()], [billing()], []);
  assert.deepEqual(r, { confident: [{ invoiceId: "oct", transactionId: "t1" }], probable: [] });
});

test("IBAN is compared after normalization", () => {
  const r = matchPayments([inv()], [debit({ iban: "fr76 3000 1007 9412 3456 7890 185" })], [billing()], []);
  assert.equal(r.confident.length, 1);
});

test("company name match with empty billing IBAN is confident", () => {
  const r = matchPayments([inv()], [debit({ iban: null, counterparty: "ACME CONSULTING SASU" })], [billing({ iban: "" })], []);
  assert.deepEqual(r, { confident: [{ invoiceId: "oct", transactionId: "t1" }], probable: [] });
});

test("fuzzy person name is probable name_fuzzy", () => {
  const r = matchPayments([inv()], [debit({ iban: null, counterparty: "K. Benali" })], [billing({ iban: "" })], []);
  assert.deepEqual(r, { confident: [], probable: [{ invoiceId: "oct", transactionId: "t1", why: "name_fuzzy" }] });
});

test("exact name but a different IBAN on both sides is not confident", () => {
  const r = matchPayments([inv()], [debit({ iban: "FR7600000000000000000000000", counterparty: "Acme Consulting" })], [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [{ invoiceId: "oct", transactionId: "t1", why: "name_fuzzy" }] });
});

test("unrelated counterparty gives nothing", () => {
  const r = matchPayments([inv()], [debit({ iban: null, counterparty: "Total Energies" })], [billing({ iban: "" })], []);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("debit settled before the invoice date gives no candidate", () => {
  const r = matchPayments([inv()], [debit({ settledAt: "2026-10-30T10:00:00Z" })], [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("settled date is the Paris calendar date", () => {
  // 2026-10-30T23:30Z is 2026-10-31 00:30 in Paris (CET, UTC+1): same day as the invoice.
  const r = matchPayments([inv()], [debit({ settledAt: "2026-10-30T23:30:00Z" })], [billing()], []);
  assert.equal(r.confident.length, 1);
});

test("repeated amounts: no confident match, every pair ambiguous", () => {
  const debits = [debit({ id: "oct07", settledAt: "2026-10-07T09:00:00Z" }), debit({ id: "nov08" })];
  const r = matchPayments([sep(), inv()], debits, [billing()], []);
  assert.deepEqual(r.confident, []);
  assert.deepEqual(sortPairs(r.probable), [
    { invoiceId: "oct", transactionId: "nov08", why: "ambiguous" },
    { invoiceId: "sep", transactionId: "nov08", why: "ambiguous" },
    { invoiceId: "sep", transactionId: "oct07", why: "ambiguous" },
  ]);
});

test("steady state: Sep paid and confirmed, Oct matches Nov-08 confidently", () => {
  const debits = [debit({ id: "oct07", settledAt: "2026-10-07T09:00:00Z" }), debit({ id: "nov08" })];
  const r = matchPayments(
    [sep({ paidAt: "2026-10-07T09:00:00Z", paidByTransactionId: "oct07" }), inv()],
    debits, [billing()], [{ invoiceId: "sep", transactionId: "oct07", state: "confirmed" }],
  );
  assert.deepEqual(r, { confident: [{ invoiceId: "oct", transactionId: "nov08" }], probable: [] });
});

test("one debit claimed by two open invoices is ambiguous, not confident", () => {
  // Nov-08 is the only exact-amount debit for Oct, but Sep could claim it too.
  const r = matchPayments([sep(), inv()], [debit({ id: "nov08" })], [billing()], []);
  assert.deepEqual(r.confident, []);
  assert.deepEqual(sortPairs(r.probable), [
    { invoiceId: "oct", transactionId: "nov08", why: "ambiguous" },
    { invoiceId: "sep", transactionId: "nov08", why: "ambiguous" },
  ]);
});

test("amount_differs is proposed for the nearest debit only", () => {
  const debits = [
    debit({ id: "early", settledAt: "2026-10-20T09:00:00Z", amountCents: -800000 }),
    debit({ id: "near", settledAt: "2026-11-05T09:00:00Z", amountCents: -800000 }),
    debit({ id: "far", settledAt: "2026-12-05T09:00:00Z", amountCents: -800000 }),
  ];
  const r = matchPayments([inv()], debits, [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [{ invoiceId: "oct", transactionId: "near", why: "amount_differs" }] });
});

test("one debit for two months: amount_differs for each, nothing confident", () => {
  const r = matchPayments([sep(), inv()], [debit({ amountCents: -1680000 })], [billing()], []);
  assert.deepEqual(r.confident, []);
  assert.deepEqual(sortPairs(r.probable), [
    { invoiceId: "oct", transactionId: "t1", why: "amount_differs" },
    { invoiceId: "sep", transactionId: "t1", why: "amount_differs" },
  ]);
});

test("amount_differs needs an exact identity", () => {
  const r = matchPayments([inv()], [debit({ iban: null, counterparty: "K. Benali", amountCents: -800000 })], [billing({ iban: "" })], []);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("dismissed pair is never proposed again", () => {
  const r = matchPayments([inv()], [debit()], [billing()], [{ invoiceId: "oct", transactionId: "t1", state: "dismissed" }]);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("debit confirmed for another invoice is not reused", () => {
  const r = matchPayments([inv()], [debit()], [billing()], [{ invoiceId: "other", transactionId: "t1", state: "confirmed" }]);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("rejected, paid, credit-note and incomplete invoices are skipped", () => {
  const invoices = [
    inv({ id: "a", review: "rejected" }),
    inv({ id: "b", paidAt: "2026-11-02T00:00:00Z" }),
    inv({ id: "c", isCreditNote: true, amountTtcCents: -840000 }),
    inv({ id: "d", amountTtcCents: -840000 }),
    inv({ id: "e", issueDate: null }),
    inv({ id: "f", amountTtcCents: null }),
  ];
  assert.deepEqual(matchPayments(invoices, [debit()], [billing()], []), { confident: [], probable: [] });
});

test("credits and other freelancers' debits are ignored", () => {
  const r = matchPayments([inv()], [debit({ amountCents: 840000 })], [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [] });
  const noBilling = matchPayments([inv()], [debit()], [billing({ employeeId: "e2" })], []);
  assert.deepEqual(noBilling, { confident: [], probable: [] });
});

test("two exact-amount debits after one invoice are ambiguous", () => {
  const r = matchPayments([inv()], [debit({ id: "a" }), debit({ id: "b", settledAt: "2026-11-20T09:00:00Z" })], [billing()], []);
  assert.deepEqual(r.confident, []);
  assert.deepEqual(sortPairs(r.probable), [
    { invoiceId: "oct", transactionId: "a", why: "ambiguous" },
    { invoiceId: "oct", transactionId: "b", why: "ambiguous" },
  ]);
});

test("two same-date same-amount invoices never get a confident match", () => {
  const r = matchPayments([inv({ id: "x" }), inv({ id: "y", number: "2" })], [debit()], [billing()], []);
  assert.deepEqual(r.confident, []);
  assert.ok(r.probable.every((p) => p.why === "ambiguous"));
});

test("debitIban reads and normalizes the Qonto payload", () => {
  assert.equal(debitIban({ transfer: { counterparty_account_number: "fr76 3000 1234" } }), "FR7630001234");
  assert.equal(debitIban({ transfer: { counterparty_iban: "fr76 9999" } }), "FR769999");
  assert.equal(debitIban({ transfer: {} }), null);
  assert.equal(debitIban({}), null);
  assert.equal(debitIban(null), null);
  assert.equal(debitIban({ transfer: { counterparty_account_number: "  " } }), null);
});

test("nameMatches: exact, fuzzy, none", () => {
  assert.equal(nameMatches("ACME CONSULTING SASU", ["Acme Consulting"]), "exact");
  assert.equal(nameMatches("Hélène Durand EI", ["Helene  Durand"]), "exact");
  assert.equal(nameMatches("K. Benali", ["Karim Benali"]), "fuzzy");
  assert.equal(nameMatches("Benali", ["Karim Benali"]), "fuzzy");
  assert.equal(nameMatches("BENALI KARIM", ["Karim Benali"]), "fuzzy");
  assert.equal(nameMatches("Total Energies", ["Karim Benali", "Acme Consulting"]), "none");
  assert.equal(nameMatches("SAS", ["SARL"]), "none");
  assert.equal(nameMatches("K", ["Karim Benali"]), "none");
  assert.equal(nameMatches("Acme", ["", "Acme Consulting"]), "fuzzy");
});

test("a debit that already paid an invoice is never reused (no existing rows)", () => {
  const paid = inv({ paidAt: "2026-11-08T09:00:00Z", paidByTransactionId: "nov08" });
  const corrected = inv({ id: "oct-v2", number: "2", createdAt: "2026-11-10T00:00:00Z" });
  const r = matchPayments([paid, corrected], [debit({ id: "nov08" })], [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("a debit paid by a rejected invoice is also out of the pool", () => {
  const r = matchPayments([inv({ id: "old", review: "rejected", paidByTransactionId: "t1" }), inv()], [debit()], [billing()], []);
  assert.deepEqual(r, { confident: [], probable: [] });
});

test("amount_differs never picks a debit another invoice claims", () => {
  // nov05 pays Oct exactly; the Sep invoice (7,000) must not get it as amount_differs.
  const sepSmall = sep({ amountHtCents: 583333, vatCents: 116667, amountTtcCents: 700000 });
  const debits = [debit({ id: "nov05", settledAt: "2026-11-05T09:00:00Z" }), debit({ id: "dec05", settledAt: "2026-12-05T09:00:00Z", amountCents: -650000 })];
  const r = matchPayments([sepSmall, inv()], debits, [billing()], []);
  assert.deepEqual(r, {
    confident: [{ invoiceId: "oct", transactionId: "nov05" }],
    probable: [{ invoiceId: "sep", transactionId: "dec05", why: "amount_differs" }],
  });
});

test("pool order uses real time, not the raw settledAt string", () => {
  // "2026-11-05T23:00:00+02:00" (21:00Z) is earlier than "2026-11-05T22:00:00Z" but sorts after it as a string.
  const debits = [
    debit({ id: "later", settledAt: "2026-11-05T22:00:00Z", amountCents: -800000 }),
    debit({ id: "earlier", settledAt: "2026-11-05T23:00:00+02:00", amountCents: -800000 }),
  ];
  const r = matchPayments([inv()], debits, [billing()], []);
  assert.deepEqual(r.probable, [{ invoiceId: "oct", transactionId: "earlier", why: "amount_differs" }]);
});
