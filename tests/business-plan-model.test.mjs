import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePlan,
  planRows,
  DEFAULT_HYPOTHESES,
  firstOpenMonth,
  kEur,
  pct,
} from "../apps/admin/src/ops/business-plan/model.ts";

const VENTES = [2, 1, 2, 1, 1, 2, 1, 0, 2, 2, 1, 1];
const DEPARTS = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0];
const STRUCTURE = 30000;
const forecast = (i) => ({ actual: null, ventes: VENTES[i], departs: DEPARTS[i], structure: STRUCTURE });

/** The design mockup's renderVals() math, kept verbatim as the oracle. */
function mockup(P, ventes, departs) {
  const occ = P.occ / 100, pf = P.pctFree / 100;
  const R = { cons: [], ca: [], prod: [], varr: [], fix: [], eb: [], mb: [], treso: [] };
  let c = P.consDebut, cash = P.tresoDebut;
  const lag = Math.max(0, Math.round(P.dso / 30));
  for (let i = 0; i < 12; i++) {
    c = Math.max(0, c + ventes[i] - departs[i]);
    const nf = c * pf, ns = c * (1 - pf);
    const ca = nf * P.jours * P.tjm + ns * P.jours * occ * P.tjm;
    const prod = nf * P.jours * P.coutFree + ns * P.salaire;
    const varr = ca * P.commFactor / 100 + ventes[i] * P.primeIC + ventes[i] * P.primeChasseur;
    const mb = ca - prod - varr;
    const fix = STRUCTURE + P.fLoyer + P.fOutils + P.fMarketing + P.fHonoraires + P.fDivers;
    R.cons.push(c); R.ca.push(ca); R.prod.push(prod); R.varr.push(varr); R.mb.push(mb); R.fix.push(fix); R.eb.push(mb - fix);
  }
  for (let i = 0; i < 12; i++) {
    const enc = i - lag >= 0 ? R.ca[i - lag] : R.ca[0];
    cash = cash + enc - R.prod[i] - R.varr[i] - R.fix[i];
    R.treso.push(cash);
  }
  return R;
}

test("all-forecast year reproduces the design mockup", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)));
  const o = mockup(DEFAULT_HYPOTHESES, VENTES, DEPARTS);
  for (const key of ["cons", "ca", "prod", "varr", "mb", "eb", "treso"])
    o[key].forEach((v, i) => assert.ok(Math.abs(r.series[key][i] - v) < 1e-6, `${key}[${i}]`));
  assert.equal(r.totals.consFin, 18 + 16 - 6);
  assert.equal(r.totals.ventes, 16);
  assert.equal(r.totals.departs, 6);
  assert.equal(planRows(r).length, 28);
});

test("actual months override the forecast and headcount carries forward", () => {
  const actual = { cons: 10, ca: 100000, free: 20000, sal: 30000, inter: 5000, ventes: 3, departs: 1, enc: 80000 };
  const months = VENTES.map((_, i) => (i < 3 ? { actual, ventes: 99, departs: 99 } : forecast(i)));
  const r = computePlan(DEFAULT_HYPOTHESES, months);
  assert.deepEqual(r.actual.slice(0, 4), [true, true, true, false]);
  assert.equal(r.series.ca[0], 100000);
  assert.equal(r.series.inter[0], 5000);
  assert.equal(r.series.ventes[0], 3);
  // Primes follow the actual sales count.
  assert.equal(r.series.ic[0], 3 * DEFAULT_HYPOTHESES.primeIC);
  // April forecast starts from March's actual headcount (10), +1 −1.
  assert.equal(r.series.cons[3], 10 + VENTES[3] - DEPARTS[3]);
  // consDebut is ignored once a month is actual.
  assert.equal(r.series.cons[0], 10);
});

test("cash uses actual collections, then the DSO lag", () => {
  const h = { ...DEFAULT_HYPOTHESES, dso: 60, commFactor: 0, primeIC: 0, primeChasseur: 0 };
  const actual = { cons: 5, ca: 50000, free: 0, sal: 0, inter: 0, ventes: 0, departs: 0, enc: 12345 };
  const months = VENTES.map((_, i) => (i < 2 ? { actual: { ...actual, ca: 50000 + i } } : forecast(i)));
  const r = computePlan(h, months);
  assert.equal(r.series.enc[0], 12345);
  assert.equal(r.series.enc[1], 12345);
  // Month 2 (forecast) collects month 0's revenue (2-month lag).
  assert.equal(r.series.enc[2], 50000);
  assert.equal(r.series.enc[3], 50001);
  const fix = r.series.fix[0];
  assert.equal(r.series.treso[0], h.tresoDebut + 12345 - fix);
});

test("corporate tax only on positive EBITDA", () => {
  const loss = computePlan({ ...DEFAULT_HYPOTHESES, tjm: 0 }, VENTES.map((_, i) => forecast(i)));
  assert.ok(loss.totals.eb < 0);
  assert.equal(loss.totals.is, 0);
  assert.equal(loss.totals.rn, loss.totals.eb);
  const win = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)));
  assert.ok(win.totals.eb > 0);
  assert.ok(Math.abs(win.totals.is - win.totals.eb * 0.25) < 1e-6);
});

test("closed-month boundary and formatting", () => {
  const today = new Date(2026, 10, 1);
  assert.equal(firstOpenMonth(2026, today), 10);
  assert.equal(firstOpenMonth(2027, today), 0);
  assert.equal(firstOpenMonth(2025, today), 12);
  assert.equal(kEur(-12600).replace(/\s/g, " "), "−13 k€");
  assert.equal(kEur(1234567).replace(/\s/g, " "), "1,23 M€");
  assert.equal(pct(0.1234), "12,3 %");
});

import { aggregateActuals } from "../apps/admin/src/ops/business-plan/actuals.ts";

const emp = (id, over = {}) => ({ id, contract_type: "CDI", start_date: "2025-01-01", end_date: null, planned_exit_date: null, status: "active", ...over });
const asg = (employee_id, project_id, start_date, end_date = null, over = {}) =>
  ({ id: `${employee_id}-${project_id}`, employee_id, project_id, pricing_line: "Data", allocation_pct: 100, start_date, end_date, status: "active", ...over });
const sal = (employee_id, over) => ({ id: `s-${employee_id}`, employee_id, rate_kind: "monthly", salary_monthly: null, daily_rate: null, start_date: "2025-01-01", end_date: null, ...over });

function sources(over = {}) {
  return {
    employees: [emp("a"), emp("b"), emp("f", { contract_type: "Freelance" }), emp("boss")],
    salaries: [sal("a", { salary_monthly: 4000 }), sal("b", { salary_monthly: 5000 }), sal("f", { rate_kind: "daily", daily_rate: 500 }), sal("boss", { salary_monthly: 6000 })],
    assignments: [asg("a", "p1", "2026-01-05"), asg("f", "p1", "2026-02-02"), asg("b", "p2", "2026-03-01", "2026-03-31", { status: "completed" })],
    projects: [{ id: "p1", tjm_profiles: [{ name: "Data", tjm: 700, end_date: "2027-12-31" }] }, { id: "p2", tjm_profiles: [] }],
    extensions: [],
    invoices: [
      { status: "paid", period_month: "2026-01-01", issue_date: "2026-02-01", paid_at: "2026-03-03T10:00:00Z", total_ht: "1000.10" },
      { status: "finalized", period_month: null, issue_date: "2026-01-20", paid_at: null, total_ht: 500 },
      { status: "finalized", period_month: "2026-01-01", issue_date: "2026-02-01", paid_at: null, total_ht: 999, ignored: true },
    ],
    cra: [{ employee_id: "f", day: "2026-02-03", part: "full" }, { employee_id: "f", day: "2026-02-04", part: "am" }],
    cjmMultiplier: 2,
    structureIds: ["boss"],
    ...over,
  };
}

test("aggregates real data into monthly actuals", () => {
  const { months } = aggregateActuals(sources(), 2026, 10, new Date(2026, 10, 1));
  assert.equal(months.length, 12);
  assert.equal(months[10], null);
  const [jan, feb, mar] = months;
  assert.equal(jan.ca, 1500.1); // period month, issue date fallback, ignored skipped
  assert.equal(jan.cons, 1);
  assert.equal(jan.ventes, 1);
  // a and b are salaried consultants (boss has no assignment → structure).
  assert.equal(jan.sal, (4000 + 5000) * 2);
  assert.equal(jan.inter, 5000 * 2);
  assert.equal(feb.free, 1.5 * 500); // CRA days × daily rate
  assert.equal(mar.enc, 1000.1);
  assert.equal(mar.cons, 3);
  assert.equal(mar.inter, 0);
});

test("freelance cost falls back to open days without CRA", () => {
  const { months } = aggregateActuals(sources({ cra: [] }), 2026, 10, new Date(2026, 10, 1));
  // March 2026 has 22 weekdays.
  assert.equal(months[2].free, 22 * 500);
});

test("departures and planned exits", () => {
  const employees = [emp("a", { end_date: "2026-04-30" }), emp("b", { planned_exit_date: "2026-12-15", status: "offboarding" }), emp("f", { contract_type: "Freelance" }), emp("boss", { end_date: "2026-04-30" })];
  const { months, plannedDeparts } = aggregateActuals(sources({ employees }), 2026, 10, new Date(2026, 10, 1));
  assert.equal(months[3].departs, 1); // boss is not a consultant
  assert.deepEqual(plannedDeparts.slice(10), [0, 1]);
});

test("seeds hypotheses from current data", () => {
  const { seeds } = aggregateActuals(sources(), 2027, 0, new Date(2026, 10, 1));
  assert.equal(seeds.consDebut, 2); // a + f staffed today (b completed)
  assert.equal(seeds.pctFree, 50);
  assert.equal(seeds.tjm, 700);
  assert.equal(seeds.coutFree, 500);
  assert.equal(seeds.salaire, 8000);
  assert.equal(seeds.fStructure, undefined);
  assert.equal(seeds.dso, 30);
});

test("salary drill-down lines add up to the month's salaried cost", () => {
  const people = [{ id: "pa", full_name: "Alice" }, { id: "pb", full_name: "Bob" }];
  const employees = sources().employees.map((e) => ({ ...e, person_id: `p${e.id}` }));
  const { months, salaryLines } = aggregateActuals(sources({ employees, people }), 2026, 10, new Date(2026, 10, 1));
  const jan = salaryLines[0];
  assert.deepEqual(jan.map((l) => [l.name, l.salary, l.cost, l.staffed]), [["Bob", 5000, 10000, false], ["Alice", 4000, 8000, true]]);
  assert.equal(jan.reduce((s, l) => s + l.cost, 0), months[0].sal);
  assert.equal(salaryLines[10], null);
});

test("freelance drill-down lines add up and flag estimated days", () => {
  const people = [{ id: "pf", full_name: "Fanny" }];
  const employees = sources().employees.map((e) => ({ ...e, person_id: `p${e.id}` }));
  const { months, freelanceLines, currentFreelancers } = aggregateActuals(sources({ employees, people }), 2026, 10, new Date(2026, 10, 1));
  assert.deepEqual(freelanceLines[1].map((l) => [l.name, l.days, l.estimated, l.rate, l.cost]), [["Fanny", 1.5, false, 500, 750]]);
  assert.equal(freelanceLines[2][0].estimated, true);
  assert.equal(freelanceLines[2][0].cost, months[2].free);
  assert.equal(freelanceLines[0].length, 0);
  assert.deepEqual(currentFreelancers.map((l) => [l.name, l.rate, l.staffed]), [["Fanny", 500, true]]);
});

test("revenue drill-down lists the invoices behind each closed month", () => {
  const invoices = sources().invoices.map((inv, i) => ({ ...inv, id: `i${i}`, number: `F-${i}`, project_id: "p1", billed_client_id: "c1", employee_id: "a" }));
  const projects = sources().projects.map((p) => ({ ...p, title: "Mission Data", client_id: "c1" }));
  const people = [{ id: "pa", full_name: "Alice" }];
  const employees = sources().employees.map((e) => ({ ...e, person_id: `p${e.id}` }));
  const clients = [{ id: "c1", name: "Acme" }];
  const { months, invoiceLines } = aggregateActuals(sources({ invoices, projects, people, employees, clients }), 2026, 10, new Date(2026, 10, 1));
  const jan = invoiceLines[0];
  assert.deepEqual(jan.map((l) => [l.number, l.client, l.project, l.consultant, l.status, l.amount, l.byIssueDate]), [
    ["F-0", "Acme", "Mission Data", "Alice", "paid", 1000.1, false],
    ["F-1", "Acme", "Mission Data", "Alice", "finalized", 500, true],
  ]);
  assert.equal(jan.reduce((s, l) => s + l.amount, 0), months[0].ca);
  assert.equal(invoiceLines[1].length, 0);
  assert.equal(invoiceLines[10], null);
});

test("structure staff are an explicit list, costed every month", () => {
  const people = [{ id: "pboss", full_name: "Boss" }];
  const employees = sources().employees.map((e) => ({ ...e, person_id: `p${e.id}` }));
  employees[3] = { ...employees[3], planned_exit_date: "2026-11-15" };
  const { months, structure, structureLines } = aggregateActuals(sources({ employees, people }), 2026, 10, new Date(2026, 10, 1));
  // Closed months: salary on file × multiplier.
  assert.equal(structure[0], 6000 * 2);
  assert.deepEqual(structureLines[0].map((l) => [l.name, l.salary, l.cost]), [["Boss", 6000, 12000]]);
  // Forecast: leaves on 15 November (10 of 21 working days), gone in December.
  assert.ok(Math.abs(structure[10] - (12000 * 10) / 21) < 1e-6);
  assert.equal(structure[11], 0);
  assert.equal(structureLines[11].length, 0);
  // Not a consultant: never in the salaried consultants line.
  assert.equal(months[0].sal, (4000 + 5000) * 2);
});

test("a salaried employee without mission outside the structure list is inter-contrat", () => {
  const employees = [...sources().employees, emp("new", { start_date: "2026-01-01" })];
  const salaries = [...sources().salaries, sal("new", { salary_monthly: 3000 })];
  const { months, salaryLines, structure } = aggregateActuals(sources({ employees, salaries }), 2026, 10, new Date(2026, 10, 1));
  assert.equal(months[0].sal, (4000 + 5000 + 3000) * 2);
  assert.equal(months[0].inter, (5000 + 3000) * 2);
  assert.ok(salaryLines[0].some((l) => l.employeeId === "new" && !l.staffed));
  assert.equal(structure[0], 12000);
});

test("forecast months carry the structure cost into the P&L", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => ({ ...forecast(i), structure: i * 1000 })));
  assert.equal(r.series.fs[3], 3000);
  assert.equal(r.series.fix[3], 3000 + DEFAULT_HYPOTHESES.fLoyer + DEFAULT_HYPOTHESES.fOutils + DEFAULT_HYPOTHESES.fMarketing + DEFAULT_HYPOTHESES.fHonoraires + DEFAULT_HYPOTHESES.fDivers);
});

test("structure cost is prorated on working days in arrival and exit months", () => {
  const employees = [...sources().employees, emp("s2", { start_date: "2026-03-16" })];
  const salaries = [...sources().salaries, sal("s2", { salary_monthly: 3000 })];
  const { structure, structureLines } = aggregateActuals(sources({ employees, salaries, structureIds: ["boss", "s2"] }), 2026, 10, new Date(2026, 10, 1));
  // March 2026: 22 working days, 12 from the 16th.
  const line = structureLines[2].find((l) => l.employeeId === "s2");
  assert.deepEqual(line.days, [12, 22]);
  assert.ok(Math.abs(line.cost - (3000 * 2 * 12) / 22) < 1e-6);
  assert.ok(Math.abs(structure[2] - (12000 + (6000 * 12) / 22)) < 1e-6);
  // A full month has no prorata.
  assert.equal(structureLines[3].find((l) => l.employeeId === "s2").days, undefined);
});

test("inter-contract row opens a drill-down", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)));
  assert.equal(planRows(r).find((row) => row.label === "— dont inter-contrats").key, "inter");
});
