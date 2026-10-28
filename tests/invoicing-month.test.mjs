import { test } from "node:test";
import assert from "node:assert/strict";
import { toInvoiceRows, missingWorkingDays } from "../apps/admin/server/invoicing/month.ts";

const project = {
  id: "p1", title: "Proj", currency: "EUR", pricing_model: "regie",
  client_id: "c1", intermediary_client_id: null,
  tjm_profiles: [{ name: "Data Engineer", tjm: 650, end_date: null }],
};
const assignment = { project_id: "p1", employee_id: "e1", pricing_line: "Data Engineer", start_date: "2026-01-01", end_date: null, status: "active" };
const product = { title: "Prestation", description: "", unit: "day", vat_rate: 0.2 };
const employee = { id: "e1", full_name: "Jane Doe", start_date: "2020-01-01", end_date: null };
const WEEKDAYS = [2,3,4,5,6,9,10,11,12,13,16,17,18,19,20,23,24,25,26,27,30];
const day = (d) => `2026-11-${String(d).padStart(2, "0")}`;
const entry = (d) => ({ day: day(d), part: "full", status: "client_project", project_id: "p1" });
// 18 days: Nov 2..27 minus holiday = pick first 18 weekdays except 11
const eighteen = WEEKDAYS.filter((d) => d !== 11).slice(0, 18).map(entry);

function input(over = {}) {
  return {
    month: "2026-11", startMonth: "2026-11-01", employees: [employee],
    craByEmployee: { e1: { version: 4, entries: eighteen } },
    assignments: [assignment], projects: [project], extensionsByProject: {},
    clients: [{ id: "c1", name: "Client One" }, { id: "c2", name: "Intermediary" }],
    linkedClientIds: new Set(["c1"]),
    productsByProject: { p1: { "Data Engineer": product } },
    invoices: [], ...over,
  };
}

test("before start month returns nothing", () => {
  assert.deepEqual(toInvoiceRows(input({ month: "2026-10" })), []);
  assert.deepEqual(toInvoiceRows(input({ startMonth: null })), []);
});

test("row with amount and invoiced status", () => {
  const rows = toInvoiceRows(input({
    invoices: [{ id: "i1", project_id: "p1", employee_id: "e1", period_month: "2026-11", status: "draft", source: "cra", cra_version: 3, total_ht: 11700, number: null }],
  }));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.days, 18);
  assert.equal(r.amountHt, "11700.00");
  assert.equal(r.status, "draft");
  assert.equal(r.invoiceId, "i1");
  assert.equal(r.craChanged, true);
  assert.deepEqual(r.blockers, []);
});

test("intermediary is billed and must be linked", () => {
  const rows = toInvoiceRows(input({ projects: [{ ...project, intermediary_client_id: "c2" }] }));
  assert.equal(rows[0].billedClientId, "c2");
  assert.ok(rows[0].blockers.includes("client_not_linked"));
});

test("missing working days excludes holidays", () => {
  const entries = WEEKDAYS.filter((d) => d !== 11 && d !== 12).map(entry);
  assert.deepEqual(missingWorkingDays("2026-11", entries, { start_date: "2020-01-01", end_date: null }), ["2026-11-12"]);
});
