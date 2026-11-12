import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedCraCents, monthCheck, displayStatus, dueDate } from "../apps/admin/server/freelancer-invoices/check.ts";

const rate = (dailyRate, startDate, endDate = null, rateKind = "daily") => ({ dailyRate, startDate, endDate, rateKind });
const cra = (day, part = "full", status = "client_project") => ({ day, part, status, projectId: status === "client_project" ? "p1" : null });
const inv = (o = {}) => ({
  id: "i", employeeId: "e", number: "1", issueDate: "2026-10-31", periodMonth: "2026-10-01", dueDate: null,
  amountHtCents: 100000, vatCents: 0, amountTtcCents: 100000, isCreditNote: false, flags: [], review: "ok",
  reviewNote: "", paidAt: null, paidByTransactionId: null, source: "portal", createdAt: "2026-11-01T00:00:00Z", ...o,
});

test("expectedCraCents: 12 full + 2 am at 700", () => {
  const days = [];
  for (let d = 1; d <= 12; d++) days.push(cra(`2026-10-${String(d).padStart(2, "0")}`));
  days.push(cra("2026-10-13", "am"), cra("2026-10-14", "am"));
  const r = expectedCraCents(days, [rate(700, "2026-01-01")]);
  assert.equal(r.days, 13);
  assert.equal(r.cents, 910000);
  assert.equal(r.missingRate, false);
});

test("expectedCraCents: rate change prices each day at its own rate", () => {
  const rates = [rate(650, "2026-01-01", "2026-10-14"), rate(700, "2026-10-15")];
  const r = expectedCraCents([cra("2026-10-14"), cra("2026-10-15")], rates);
  assert.equal(r.cents, 135000);
});

test("expectedCraCents: latest start wins on overlap, monthly rows ignored", () => {
  const rates = [rate(600, "2026-01-01"), rate(700, "2026-06-01"), rate(null, "2026-09-01", null, "monthly")];
  assert.equal(expectedCraCents([cra("2026-10-01")], rates).cents, 70000);
});

test("expectedCraCents: internal and paid_leave ignored", () => {
  const r = expectedCraCents([cra("2026-10-01", "full", "internal"), cra("2026-10-02", "full", "paid_leave"), cra("2026-10-05")], [rate(700, "2026-01-01")]);
  assert.deepEqual(r, { days: 1, cents: 70000, missingRate: false });
});

test("expectedCraCents: no daily rate gives missingRate", () => {
  const r = expectedCraCents([cra("2026-10-05")], [rate(null, "2026-01-01", null, "monthly")]);
  assert.equal(r.missingRate, true);
  assert.equal(r.cents, 0);
});

test("monthCheck: within 1 EUR matches", () => {
  const r = monthCheck([inv({ amountHtCents: 840050 })], { cents: 840000, days: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.reason, "match");
  assert.equal(r.diffCents, 50);
});

test("monthCheck: mismatch", () => {
  const r = monthCheck([inv({ amountHtCents: 910000 })], { cents: 845000, days: 12 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "mismatch");
  assert.equal(r.diffCents, 65000);
});

test("monthCheck: several invoices add up", () => {
  const r = monthCheck([inv({ amountHtCents: 500000 }), inv({ amountHtCents: 340000 })], { cents: 840000, days: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.invoicedHtCents, 840000);
});

test("monthCheck: credit note is negative", () => {
  const r = monthCheck([inv({ amountHtCents: 880000 }), inv({ amountHtCents: 40000, isCreditNote: true })], { cents: 840000, days: 12 });
  assert.equal(r.ok, true);
  const r2 = monthCheck([inv({ amountHtCents: 880000 }), inv({ amountHtCents: -40000, isCreditNote: true })], { cents: 840000, days: 12 });
  assert.equal(r2.ok, true);
});

test("monthCheck: rejected excluded", () => {
  const r = monthCheck([inv({ amountHtCents: 840000 }), inv({ amountHtCents: 999999, review: "rejected" })], { cents: 840000, days: 12 });
  assert.equal(r.ok, true);
});

test("monthCheck: no CRA", () => {
  const r = monthCheck([inv()], null);
  assert.equal(r.reason, "no_cra");
  assert.equal(r.ok, false);
  assert.equal(r.expectedCents, null);
});

test("monthCheck: unreadable amount", () => {
  const r = monthCheck([inv({ amountHtCents: null })], { cents: 840000, days: 12 });
  assert.equal(r.reason, "unreadable");
  assert.equal(r.ok, false);
  assert.equal(monthCheck([inv({ amountHtCents: null, review: "rejected" })], { cents: 0, days: 0 }).reason, "match");
});

test("displayStatus", () => {
  assert.deepEqual(displayStatus(inv({ paidAt: "2026-11-05" }), false, "2026-11-11"), { status: "paid", warning: true, overdue: false });
  assert.deepEqual(displayStatus(inv({ dueDate: "2026-10-01" }), true, "2026-11-11"), { status: "to_pay", warning: false, overdue: true });
  assert.equal(displayStatus(inv({ dueDate: "2026-11-11" }), true, "2026-11-11").overdue, false);
  assert.equal(displayStatus(inv({ review: "to_check" }), true, "2026-11-11").status, "to_check");
  assert.equal(displayStatus(inv({ review: "rejected" }), true, "2026-11-11").status, "rejected");
});

test("dueDate", () => {
  assert.equal(dueDate("2026-10-31", null), "2026-11-30");
  assert.equal(dueDate("2026-10-31", "2026-11-15"), "2026-11-15");
  assert.equal(dueDate(null, null), null);
});
