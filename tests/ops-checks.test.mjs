import { test } from "node:test";
import assert from "node:assert/strict";
import { monthChecks, openChecks, workingDays, shiftMonth } from "../apps/admin/src/ops/checks/rules.ts";

const TODAY = "2026-11-11";
const emp = (id, person, extra = {}) => ({ id, person_id: person, contract_type: "CDI", start_date: "2026-01-01", end_date: null, ...extra });
const fullMonth = (employee_id, month, project_id = "p1") =>
  workingDays(`${month}-01`, `${month}-31`.replace(/-31$/, `-${new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()}`))
    .map((day) => ({ employee_id, day, part: "full", status: project_id ? "client_project" : "internal", project_id }));

function sources(over = {}) {
  return {
    employees: [emp("e1", "a")],
    people: [{ id: "a", full_name: "Alice" }, { id: "b", full_name: "Bob" }],
    assignments: [{ employee_id: "e1", project_id: "p1", start_date: "2026-01-01", end_date: null, status: "active" }],
    projects: [{ id: "p1", title: "Régie A", pricing_model: "regie" }, { id: "p2", title: "Forfait B", pricing_model: "forfait" }],
    cra: [],
    craMonths: [],
    invoices: [],
    payroll: null,
    invoicingStart: null,
    craFrom: "2026-01",
    ...over,
  };
}
const kinds = (issues) => issues.map((i) => i.kind).sort();
const invoice = (over = {}) => ({
  id: "i1", number: "F-1", status: "finalized", source: "cra", project_id: "p1", employee_id: "e1", period_month: "2026-10-01",
  cra_version: 1, due_date: "2026-12-01", issue_date: "2026-11-02", total_ht: 1000, ignored: false, invoice_url: null, ...over,
});

test("working days skip weekends and French holidays", () => {
  // November 2026: 21 weekdays, minus 11/11 (Wednesday). 1 Nov is a Sunday.
  assert.equal(workingDays("2026-11-01", "2026-11-30").length, 20);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("a clean month has no issue", () => {
  const src = sources({ cra: fullMonth("e1", "2026-10"), craMonths: [{ employee_id: "e1", month: "2026-10-01", version: 1 }], invoices: [invoice()] });
  assert.deepEqual(monthChecks("2026-10", src, TODAY), []);
});

test("missing CRA, missing invoice, missing payslip", () => {
  const src = sources({
    employees: [emp("e1", "a"), emp("e2", "b")],
    cra: fullMonth("e1", "2026-10"),
    payroll: { staff: [{ person_id: "a", full_name: "Alice", matricule: "1", start_date: "2026-01-01", end_date: null }], payslips: [] },
  });
  const issues = monthChecks("2026-10", src, TODAY);
  assert.deepEqual(kinds(issues), ["cra_missing", "invoice_missing", "payslip_missing"]);
  assert.equal(issues.find((i) => i.kind === "cra_missing").name, "Bob");
  assert.match(issues.find((i) => i.kind === "invoice_missing").detail, /22 days/);
});

test("incomplete CRA lists the gaps; half days count as half", () => {
  const cra = fullMonth("e1", "2026-10").filter((e) => e.day !== "2026-10-05");
  cra.find((e) => e.day === "2026-10-06").part = "am";
  const issues = monthChecks("2026-10", sources({ cra, invoices: [invoice()] }), TODAY);
  assert.deepEqual(kinds(issues), ["cra_incomplete"]);
  assert.match(issues[0].detail, /2 days not filled: 05\/10, 06\/10/);
});

test("current month: CRA checked up to yesterday, no invoice or payslip expected", () => {
  const cra = fullMonth("e1", "2026-11").filter((e) => e.day < "2026-11-10");
  assert.deepEqual(monthChecks("2026-11", sources({ cra }), TODAY).map((i) => i.detail), ["1 day not filled: 10/11."]);
  assert.deepEqual(monthChecks("2026-12", sources(), TODAY), []);
});

test("days on an unstaffed project and outside employment", () => {
  const cra = fullMonth("e1", "2026-10", "p2");
  const src = sources({ employees: [emp("e1", "a", { end_date: "2026-10-15" })], cra, invoices: [] });
  const issues = monthChecks("2026-10", src, TODAY);
  assert.deepEqual(kinds(issues), ["cra_outside_employment", "cra_unstaffed_days", "staffed_no_days"]);
  assert.equal(issues.find((i) => i.kind === "cra_unstaffed_days").projectTitle, "Forfait B");
});

test("invoice issues: draft, CRA changed, invoice without days, invoicing start month", () => {
  const src = sources({
    cra: fullMonth("e1", "2026-10", null),
    craMonths: [{ employee_id: "e1", month: "2026-10-01", version: 3 }],
    invoices: [invoice({ status: "draft", cra_version: 2 })],
  });
  assert.deepEqual(kinds(monthChecks("2026-10", src, TODAY)), ["invoice_cra_changed", "invoice_draft", "invoice_without_days", "staffed_no_days"]);
  const before = sources({ cra: fullMonth("e1", "2026-09"), invoicingStart: "2026-10" });
  assert.deepEqual(monthChecks("2026-09", before, TODAY), []);
});

test("open checks: overdue and not fully linked invoices", () => {
  const src = sources({
    invoices: [
      invoice({ id: "late", due_date: "2026-11-01" }),
      invoice({ id: "paid", status: "paid", due_date: "2026-10-01" }),
      invoice({ id: "orphan", source: "imported", project_id: null, employee_id: null, period_month: null }),
      invoice({ id: "regie-no-consultant", source: "imported", employee_id: null }),
      invoice({ id: "forfait", source: "imported", project_id: "p2", employee_id: null, period_month: null }),
      invoice({ id: "skip", project_id: null, ignored: true }),
    ],
  });
  const issues = openChecks(src, TODAY);
  assert.deepEqual(issues.map((i) => `${i.kind}:${i.invoiceId}`), [
    "invoice_overdue:late", "invoice_unassigned:orphan", "invoice_unassigned:regie-no-consultant",
  ]);
  assert.match(issues[0].detail, /10 days late/);
  assert.match(issues[1].detail, /No project set/);
});
