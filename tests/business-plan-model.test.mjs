import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePlan,
  planRows,
  DEFAULT_HYPOTHESES,
  VAT_RATE,
  firstOpenMonth,
  kEur,
  pct,
} from "../apps/admin/src/ops/business-plan/model.ts";
import { aggregateFixedCharges, aggregateVat, isVatRemittance } from "../apps/admin/src/ops/business-plan/actuals.ts";

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
    const fix = STRUCTURE + P.fLoyer + P.fOutils + P.fMarketing + P.fHonoraires + P.fDeplacements + P.fDivers;
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
  for (const key of ["cons", "ca", "prod", "varr", "mb", "eb"])
    o[key].forEach((v, i) => assert.ok(Math.abs(r.series[key][i] - v) < 1e-6, `${key}[${i}]`));
  // Cash = the mockup's HT cash plus the cumulative VAT cash effect (not in the mockup).
  let vat = 0;
  o.treso.forEach((v, i) => { vat += r.series.tva[i]; assert.ok(Math.abs(r.series.treso[i] - (v + vat)) < 1e-6, `treso[${i}]`); });
  assert.equal(r.totals.consFin, 18 + 16 - 6);
  assert.equal(r.totals.ventes, 16);
  assert.equal(r.totals.departs, 6);
  assert.equal(planRows(r).length, 33);
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
  assert.equal(r.series.treso[0], h.tresoDebut + 12345 - fix + r.series.tva[0]);
});

test("corporate tax only on a positive operating result", () => {
  const loss = computePlan({ ...DEFAULT_HYPOTHESES, tjm: 0 }, VENTES.map((_, i) => forecast(i)));
  assert.ok(loss.totals.eb < 0);
  assert.equal(loss.totals.is, 0);
  assert.equal(loss.totals.rn, loss.totals.ex);
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
    structureStaff: [{ employee_id: "boss" }],
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

test("collections drill-down lists paid invoices by payment month", () => {
  const invoices = sources().invoices.map((inv, i) => ({ ...inv, id: `i${i}`, number: `F-${i}` }));
  const { months, encLines } = aggregateActuals(sources({ invoices }), 2026, 10, new Date(2026, 10, 1));
  // Paid on 3 March for January's service: listed under March, not January.
  assert.deepEqual(encLines[2].map((l) => [l.number, l.paidAt, l.periodMonth, l.amount]), [["F-0", "2026-03-03", "2026-01-01", 1000.1]]);
  assert.equal(encLines[2].reduce((s, l) => s + l.amount, 0), months[2].enc);
  assert.equal(encLines[0].length, 0);
  assert.equal(encLines[10], null);
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
  assert.equal(r.series.fix[3], 3000 + DEFAULT_HYPOTHESES.fLoyer + DEFAULT_HYPOTHESES.fOutils + DEFAULT_HYPOTHESES.fMarketing + DEFAULT_HYPOTHESES.fHonoraires + DEFAULT_HYPOTHESES.fDeplacements + DEFAULT_HYPOTHESES.fDivers);
});

test("structure cost is prorated on working days in arrival and exit months", () => {
  const employees = [...sources().employees, emp("s2", { start_date: "2026-03-16" })];
  const salaries = [...sources().salaries, sal("s2", { salary_monthly: 3000 })];
  const { structure, structureLines } = aggregateActuals(sources({ employees, salaries, structureStaff: [{ employee_id: "boss" }, { employee_id: "s2" }] }), 2026, 10, new Date(2026, 10, 1));
  // March 2026: 22 working days, 12 from the 16th.
  const line = structureLines[2].find((l) => l.employeeId === "s2");
  assert.deepEqual(line.days, [12, 22]);
  assert.ok(Math.abs(line.cost - (3000 * 2 * 12) / 22) < 1e-6);
  assert.ok(Math.abs(structure[2] - (12000 + (6000 * 12) / 22)) < 1e-6);
  // A full month has no prorata.
  assert.equal(structureLines[3].find((l) => l.employeeId === "s2").days, undefined);
});

test("structure period: from the hire date by default, consultant outside it", () => {
  // boss: structure from 1 April to 15 June 2026 only.
  const structureStaff = [{ employee_id: "boss", start_date: "2026-04-01", end_date: "2026-06-15" }];
  const { months, structure, structureLines, salaryLines } = aggregateActuals(sources({ structureStaff }), 2026, 10, new Date(2026, 10, 1));
  // Before the period: consultant in inter-contract.
  assert.equal(structure[0], 0);
  assert.equal(months[0].inter, (5000 + 6000) * 2);
  // Inside: structure, not a consultant.
  assert.equal(structure[3], 12000);
  assert.ok(!salaryLines[3].some((l) => l.employeeId === "boss"));
  // June 2026: 22 working days, 11 in structure (1–15), 11 as consultant.
  assert.deepEqual(structureLines[5][0].days, [11, 22]);
  assert.ok(Math.abs(structure[5] - (12000 * 11) / 22) < 1e-6);
  const june = salaryLines[5].find((l) => l.employeeId === "boss");
  assert.deepEqual(june.days, [11, 22]);
  assert.ok(Math.abs(june.cost - (12000 * 11) / 22) < 1e-6);
  // After: consultant again; a planned exit then counts as a consultant departure.
  assert.equal(structure[7], 0);
  assert.ok(salaryLines[7].some((l) => l.employeeId === "boss" && !l.staffed));
});

test("structure staff on a mission: mission working days go to consultants", () => {
  // May 2026: 21 working days; mission 4–29 May = 20 days, so 1 day stays in structure.
  const assignments = [...sources().assignments, asg("boss", "p1", "2026-05-04", "2026-05-29", { status: "completed" })];
  const { months, structure, structureLines, salaryLines, currentSalaried } = aggregateActuals(
    sources({ assignments }), 2026, 10, new Date(2026, 10, 1),
  );
  assert.equal(structure[3], 12000);
  const s = structureLines[4][0];
  assert.deepEqual([s.employeeId, s.days, s.missionDays, s.staffed], ["boss", [1, 21], 20, false]);
  assert.ok(Math.abs(structure[4] - 12000 / 21) < 1e-6);
  const may = salaryLines[4].find((l) => l.employeeId === "boss");
  assert.deepEqual([may.days, may.missionDays, may.staffed], [[20, 21], 20, true]);
  assert.ok(Math.abs(may.cost - (12000 * 20) / 21) < 1e-6);
  // Nothing lost or double-counted.
  assert.ok(Math.abs(structure[4] + may.cost - 12000) < 1e-6);
  assert.equal(months[4].cons, 3); // a, f and boss
  // Back in structure in June; not in today's consultant base.
  assert.equal(structure[5], 12000);
  assert.ok(!currentSalaried.some((l) => l.employeeId === "boss"));
});

test("structure mission days are weighted by allocation", () => {
  // Whole of April 2026 (22 working days) at 50 %: half structure, half consultant.
  const assignments = [...sources().assignments, asg("boss", "p1", "2026-04-01", "2026-04-30", { allocation_pct: 50 })];
  const { structure, structureLines, salaryLines } = aggregateActuals(sources({ assignments }), 2026, 10, new Date(2026, 10, 1));
  assert.equal(structureLines[3][0].missionDays, 11);
  assert.ok(Math.abs(structure[3] - 6000) < 1e-6);
  assert.ok(Math.abs(salaryLines[3].find((l) => l.employeeId === "boss").cost - 6000) < 1e-6);
});

test("inter-contract row opens a drill-down", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)));
  assert.equal(planRows(r).find((row) => row.label === "— dont inter-contrats").key, "inter");
});

test("operating result = EBITDA − depreciation, taxed instead of EBITDA, cash unchanged", () => {
  const months = VENTES.map((_, i) => forecast(i));
  const base = computePlan(DEFAULT_HYPOTHESES, months);
  assert.deepEqual(base.series.ex, base.series.eb); // no depreciation by default
  const r = computePlan({ ...DEFAULT_HYPOTHESES, fAmort: 2000 }, months);
  r.series.ex.forEach((v, i) => assert.ok(Math.abs(v - (r.series.eb[i] - 2000)) < 1e-6));
  assert.ok(Math.abs(r.totals.ex - (base.totals.eb - 24000)) < 1e-6);
  assert.ok(Math.abs(r.totals.is - r.totals.ex * 0.25) < 1e-6);
  assert.ok(Math.abs(r.totals.rn - (r.totals.ex - r.totals.is)) < 1e-6);
  assert.ok(Math.abs(r.totals.exPct - r.totals.ex / r.totals.ca) < 1e-9);
  assert.deepEqual(r.series.treso, base.series.treso);
  assert.deepEqual(planRows(r).find((x) => x.label === "EBIT (résultat d’exploitation)").values, r.series.ex);
});

const bank = (o) => ({
  id: String(Math.random()), month: "2027-03-01", line: "loyer", amount_ht_cents: 100000, status: "completed",
  needs_review: false, label: "", counterparty: "", settled_at: "2027-03-05", emitted_at: null, amount_cents: 120000,
  ai_line: null, manual_line: null, ai_confidence: null, ...o,
});

test("aggregateFixedCharges sums HT completed debits per month and line", () => {
  const r = aggregateFixedCharges([
    bank({ settled_at: "2027-03-20" }), bank({ amount_ht_cents: 50050, settled_at: "2027-03-02" }),
    bank({ status: "declined" }), bank({ line: "hors_charges_fixes", amount_ht_cents: 999 }),
    bank({ line: null, amount_ht_cents: 777 }), bank({ line: "outils", amount_ht_cents: 2000 }),
  ], 2027, 6, "2027-01-01");
  assert.deepEqual(r.fixed[2], { loyer: 1500.5, outils: 20, marketing: 0, honoraires: 0, deplacements: 0, divers: 0 });
  assert.equal(r.lines[2].length, 5);
  assert.equal(r.lines[2][0].settled_at, "2027-03-02");
  assert.equal(r.unclassified[2].length, 2);
});

test("aggregateFixedCharges counts completed debits not yet classified per covered month", () => {
  const r = aggregateFixedCharges([
    bank({ line: null }), bank({ line: null, settled_at: "2027-03-02" }),
    bank({ line: null, status: "declined" }), bank({ line: "hors_charges_fixes" }),
    bank({ line: null, month: "2027-08-01", settled_at: "2027-08-10" }),
  ], 2027, 6, "2027-01-01");
  assert.equal(r.unclassifiedCount.length, 12);
  assert.equal(r.unclassifiedCount[2], 2);
  assert.equal(r.unclassifiedCount[0], 0);
  assert.equal(r.unclassifiedCount[7], 0); // open month: stays on hypotheses
});

test("covered closed month with no transaction is all zeros", () => {
  const r = aggregateFixedCharges([], 2027, 6, "2027-01-01");
  assert.deepEqual(r.fixed[0], { loyer: 0, outils: 0, marketing: 0, honoraires: 0, deplacements: 0, divers: 0 });
  assert.deepEqual(r.lines[0], []);
});

test("month before coverageStart is null", () => {
  const r = aggregateFixedCharges([], 2027, 6, "2027-03-01");
  assert.equal(r.fixed[1], null);
  assert.equal(r.lines[1], null);
  assert.notEqual(r.fixed[2], null);
});

test("coverageStart null gives all null", () => {
  const r = aggregateFixedCharges([bank({})], 2027, 6, null);
  assert.ok(r.fixed.every((x) => x === null));
  assert.ok(r.unclassified.every((x) => x === null));
});

test("open month is null", () => {
  const r = aggregateFixedCharges([bank({})], 2027, 2, "2027-01-01");
  assert.equal(r.fixed[2], null);
  assert.equal(r.review[2], 0);
});

test("review counts needs_review per month", () => {
  const r = aggregateFixedCharges([bank({ needs_review: true }), bank({ needs_review: true }), bank({}), bank({ needs_review: true, status: "declined" })], 2027, 6, "2027-01-01");
  assert.equal(r.review[2], 2);
  assert.equal(r.review[0], 0);
});

test("computePlan uses fixed actuals on closed months and hypotheses on open months", () => {
  const h = DEFAULT_HYPOTHESES;
  const closed = { cons: 3, ca: 50000, free: 10000, sal: 10000, inter: 0, ventes: 0, departs: 0 };
  const fixed = { loyer: 1000, outils: 200, marketing: 300, honoraires: 400, deplacements: 500, divers: 100 };
  const base = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 5000 }]);
  const real = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 5000, fixed }]);
  assert.equal(real.series.fl[0], 1000);
  assert.equal(real.series.fd[0], 100);
  assert.equal(real.series.fix[0], 5000 + 2500);
  assert.equal(real.series.eb[0], real.series.mb[0] - 7500);
  assert.equal(real.series.treso[0], h.tresoDebut + real.series.enc[0] - 0 - real.series.prod[0] - real.series.varr[0] - 7500 + real.series.tva[0]);
  const open = computePlan(h, [{ actual: null, ventes: 0, departs: 0, structure: 5000, fixed }]);
  assert.equal(open.series.fl[0], h.fLoyer);
});

test("planRows tags the five fixed lines with drill keys", () => {
  const h = DEFAULT_HYPOTHESES;
  const rows = planRows(computePlan(h, [forecast(0)]));
  const keys = rows.filter((r) => ["loyer", "outils", "marketing", "honoraires", "deplacements", "divers"].includes(r.key)).map((r) => r.key);
  assert.deepEqual(keys, ["loyer", "outils", "marketing", "honoraires", "deplacements", "divers"]);
  assert.equal(rows.find((r) => r.key === "deplacements").label, "Frais de déplacement");
});

/* ── VAT cash effect ───────────────────────────────────────────────── */

test("VAT remittances are recognised by their Qonto reference", () => {
  assert.equal(isVatRemittance(bank({ reference: "TVA-092022-3310CA3" })), true);
  assert.equal(isVatRemittance(bank({ reference: "PASDSN15092022-082022-87819833200016" })), false);
  assert.equal(isVatRemittance(bank({ reference: "IS-122022-2571" })), false);
  assert.equal(isVatRemittance(bank({ reference: null })), false);
});

test("a VAT remittance never counts as a fixed charge, even if misclassified", () => {
  const r = aggregateFixedCharges([bank({ line: "divers", reference: "TVA-022027-3310CA3", amount_ht_cents: 500000 })], 2027, 6, "2027-01-01");
  assert.equal(r.fixed[2].divers, 0);
});

const inv = (o) => ({ status: "paid", period_month: "2027-02-01", issue_date: "2027-02-28", paid_at: "2027-03-15T10:00:00Z", total_ht: 10000, total_vat: 2000, ...o });

test("aggregateVat: collected from paid invoices, deductible from debits, remitted from VAT payments", () => {
  const r = aggregateVat(
    [inv({}), inv({ total_vat: "500.50" }), inv({ ignored: true }), inv({ status: "finalized", paid_at: null })],
    [
      bank({ vat_cents: 20000 }), bank({ line: "hors_charges_fixes", vat_cents: 5000 }),
      bank({ vat_cents: 9999, status: "declined" }),
      bank({ line: "hors_charges_fixes", reference: "TVA-022027-3310CA3", amount_cents: 300000, vat_cents: 0 }),
    ],
    2027, 6, "2027-01-01",
  );
  assert.deepEqual(r.vat[2], { collected: 2500.5, deductible: 250, remitted: 3000 });
  assert.equal(r.remittances[2].length, 1);
  assert.deepEqual(r.vat[0], { collected: 0, deductible: 0, remitted: 0 });
  assert.equal(r.vat[6], null); // open month
});

test("aggregateVat: months not covered by Qonto are null", () => {
  const r = aggregateVat([inv({})], [], 2027, 6, null);
  assert.ok(r.vat.every((x) => x === null));
  const later = aggregateVat([inv({})], [], 2027, 6, "2027-04-01");
  assert.equal(later.vat[2], null);
});

test("computePlan: real VAT parts on covered closed months", () => {
  const h = DEFAULT_HYPOTHESES;
  const closed = { cons: 3, ca: 50000, free: 10000, sal: 10000, inter: 0, ventes: 0, departs: 0, enc: 40000 };
  const r = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 0, vat: { collected: 8000, deductible: 1500, remitted: 6000 } }]);
  assert.equal(r.series.tvaCol[0], 8000);
  assert.equal(r.series.tvaDed[0], 1500);
  assert.equal(r.series.tvaRem[0], 6000);
  assert.equal(r.series.tva[0], 500);
  assert.equal(r.series.treso[0], h.tresoDebut + 40000 - r.series.prod[0] - r.series.varr[0] - r.series.fix[0] + 500);
});

test("computePlan: forecast VAT collects on collections, deducts on purchases, remits last month's net", () => {
  const h = { ...DEFAULT_HYPOTHESES, dso: 0 };
  const closed = { cons: 3, ca: 50000, free: 10000, sal: 10000, inter: 0, ventes: 0, departs: 0, enc: 40000 };
  const r = computePlan(h, [
    { actual: closed, ventes: 0, departs: 0, structure: 0, vat: { collected: 8000, deductible: 1500, remitted: 6000 } },
    forecast(1),
  ]);
  const S = r.series;
  assert.ok(Math.abs(S.tvaCol[1] - VAT_RATE * S.enc[1]) < 1e-6);
  assert.ok(Math.abs(S.tvaDed[1] - VAT_RATE * (S.free[1] + S.fl[1] + S.fo[1] + S.fm[1] + S.fh[1] + S.fdp[1] + S.fd[1])) < 1e-6);
  assert.equal(S.tvaRem[1], 8000 - 1500); // last month's real net
  assert.ok(Math.abs(S.tva[1] - (S.tvaCol[1] - S.tvaDed[1] - S.tvaRem[1])) < 1e-6);
});

test("computePlan: first month of an all-forecast year remits its own net, never a negative amount", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, [forecast(0)]);
  const S = r.series;
  assert.ok(Math.abs(S.tvaRem[0] - Math.max(0, S.tvaCol[0] - S.tvaDed[0])) < 1e-6);
  const credit = computePlan({ ...DEFAULT_HYPOTHESES, consDebut: 0 }, [{ actual: null, ventes: 0, departs: 0, structure: 0 }]);
  assert.equal(credit.series.tvaRem[0], 0);
});

test("planRows shows the VAT line in the cash section with a drill key", () => {
  const rows = planRows(computePlan(DEFAULT_HYPOTHESES, [forecast(0)]));
  const i = rows.findIndex((r) => r.key === "tva");
  assert.equal(rows[i].label, "TVA (effet trésorerie)");
  assert.equal(rows[i - 1].key, "enc");
  assert.equal(rows[i + 1].label, "Trésorerie fin de mois");
});

test("travel costs: own fixed line, real on closed months, hypothesis otherwise, VAT-deductible", () => {
  const h = { ...DEFAULT_HYPOTHESES, fDeplacements: 2000 };
  const r = aggregateFixedCharges([bank({ line: "deplacements", amount_ht_cents: 123400 })], 2027, 6, "2027-01-01");
  assert.equal(r.fixed[2].deplacements, 1234);
  const closed = { cons: 3, ca: 50000, free: 0, sal: 10000, inter: 0, ventes: 0, departs: 0, enc: 0 };
  const p = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 0, fixed: r.fixed[2] }, forecast(1)]);
  assert.equal(p.series.fdp[0], 1234);
  assert.equal(p.series.fdp[1], 2000);
  assert.ok(Math.abs(p.series.fix[1] - (STRUCTURE + h.fLoyer + h.fOutils + h.fMarketing + h.fHonoraires + 2000 + h.fDivers)) < 1e-6);
  const S = p.series;
  assert.ok(Math.abs(S.tvaDed[1] - VAT_RATE * (S.free[1] + S.fl[1] + S.fo[1] + S.fm[1] + S.fh[1] + S.fdp[1] + S.fd[1])) < 1e-6);
});
