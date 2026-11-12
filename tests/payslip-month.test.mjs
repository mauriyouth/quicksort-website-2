import assert from "node:assert/strict";
import test from "node:test";
import { latestPeriod, payrollMonth, shiftPeriod } from "../apps/admin/src/payslips/month.ts";

const emp = (person_id, full_name, start_date, end_date = null, matricule = "QS-0001") => ({ person_id, full_name, matricule, start_date, end_date });
const slip = (id, person_id, valid_from, title = "Bulletin de paie") => ({ id, person_id, valid_from, title, file_name: `${id}.pdf` });

test("lists everyone employed during the month, filed or missing, by name", () => {
  const staff = [
    emp("p-zoe", "Zoe Last", "2026-01-01", null, "00002"),
    emp("p-ada", "Ada First", "2026-10-20", null, "00001"),     // starts mid-month: counts
    emp("p-old", "Old Leaver", "2025-01-01", "2026-09-30"),     // ended before the month
    emp("p-new", "New Joiner", "2026-11-02"),                   // starts after the month
    emp("p-end", "Ends Midmonth", "2026-01-01", "2026-10-14"),  // ends during the month: counts
  ];
  const rows = payrollMonth("2026-10", staff, [slip("d1", "p-zoe", "2026-10-01"), slip("d0", "p-zoe", "2026-09-01")]);
  assert.deepEqual(rows.map((r) => [r.name, r.payslips.map((p) => p.id)]), [
    ["Ada First", []],
    ["Ends Midmonth", []],
    ["Zoe Last", ["d1"]],
  ]);
  assert.equal(rows.find((r) => r.name === "Zoe Last").matricule, "00002");
});

test("a payslip filed for someone with no employment that month still shows", () => {
  const rows = payrollMonth("2026-10", [emp("p-x", "Ex Employee", "2024-01-01", "2024-12-31", "00007")], [slip("d1", "p-x", "2026-10-01")]);
  assert.deepEqual(rows.map((r) => [r.name, r.employed, r.payslips.length, r.matricule]), [["Ex Employee", false, 1, "00007"]]);
});

test("a person with two employments is one row, preferring the real matricule over QS-", () => {
  const staff = [emp("p-n", "Nader", "2026-04-15", "2026-10-14", "00018"), emp("p-n", "Nader", "2026-10-20", null, "QS-0005")];
  const rows = payrollMonth("2026-10", staff, [slip("a", "p-n", "2026-10-01", "Bulletin de paie Octobre 2026 (2)"), slip("b", "p-n", "2026-10-01", "Bulletin de paie Octobre 2026")]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matricule, "00018");
  assert.deepEqual(rows[0].payslips.map((p) => p.id), ["b", "a"]);
});

test("latestPeriod and shiftPeriod", () => {
  assert.equal(latestPeriod([slip("a", "p", "2025-12-01"), slip("b", "p", "2026-10-01")]), "2026-10");
  assert.equal(latestPeriod([]), null);
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
});
