import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePlan,
  planRows,
  migrateHypotheses,
  DEFAULT_HYPOTHESES,
  VAT_RATE,
  firstOpenMonth,
  kEur,
  pct,
} from "../apps/admin/src/ops/business-plan/model.ts";
import { monthWorkingDays, workingCalendar, workingDaysBetween } from "../apps/admin/src/ops/business-plan/calendar.ts";
import { aggregateFixedCharges, aggregateVat, chargeItemOf, isVatRemittance, socialCharges, socialChargesOf } from "../apps/admin/src/ops/business-plan/actuals.ts";

const VENTES = [2, 1, 2, 1, 1, 2, 1, 0, 2, 2, 1, 1];
const DEPARTS = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0];
const STRUCTURE = 30000;
/** Consultants at the end of the previous year (start of an all-forecast year). */
const START = 18;
const forecast = (i) => ({ actual: null, ventes: VENTES[i], departs: DEPARTS[i], structure: STRUCTURE });

/** The design mockup's renderVals() math, kept verbatim as the oracle. */
function mockup(P, ventes, departs) {
  const cal = workingCalendar(2026, P), pf = P.pctFree / 100;
  const R = { cons: [], ca: [], prod: [], varr: [], fix: [], eb: [], mb: [], treso: [] };
  let c = START, cash = P.tresoDebut;
  const lag = Math.max(0, Math.round(P.dso / 30));
  for (let i = 0; i < 12; i++) {
    c = Math.max(0, c + ventes[i] - departs[i]);
    const nf = c * pf, ns = c * (1 - pf);
    const jo = cal.jo[i], taci = cal.taci[i];
    const ca = nf * jo * P.tjm + ns * jo * taci * P.tjm;
    // Salaries are gross; employer social charges are added per salaried consultant.
    const cot = ns * (P.salaire * P.tauxCharges / 100 + P.mutuelle + P.ticketsResto + P.medecine / 12);
    const prod = nf * jo * P.coutFree + ns * P.salaire + cot;
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
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)), START, 2026);
  const o = mockup(DEFAULT_HYPOTHESES, VENTES, DEPARTS);
  for (const key of ["cons", "ca", "prod", "varr", "mb", "eb"])
    o[key].forEach((v, i) => assert.ok(Math.abs(r.series[key][i] - v) < 1e-6, `${key}[${i}]`));
  // Cash = the mockup's HT cash plus the cumulative VAT cash effect (not in the mockup).
  let vat = 0;
  o.treso.forEach((v, i) => { vat += r.series.tva[i]; assert.ok(Math.abs(r.series.treso[i] - (v + vat)) < 1e-6, `treso[${i}]`); });
  assert.equal(r.totals.consFin, 18 + 16 - 6);
  assert.equal(r.totals.ventes, 16);
  assert.equal(r.totals.departs, 6);
  assert.equal(planRows(r).length, 50);
});

test("actual months override the forecast and headcount carries forward", () => {
  const actual = { cons: 10, ca: 100000, free: 20000, sal: 30000, inter: 5000, ventes: 3, departs: 1, enc: 80000 };
  const months = VENTES.map((_, i) => (i < 3 ? { actual, ventes: 99, departs: 99 } : forecast(i)));
  const r = computePlan(DEFAULT_HYPOTHESES, months, 99, 2026);
  assert.deepEqual(r.actual.slice(0, 4), [true, true, true, false]);
  assert.equal(r.series.ca[0], 100000);
  assert.equal(r.series.inter[0], 5000);
  assert.equal(r.series.ventes[0], 3);
  // Primes follow the actual sales count.
  assert.equal(r.series.pic[0], 3 * DEFAULT_HYPOTHESES.primeIC);
  // April forecast starts from March's actual headcount (10), +1 −1.
  assert.equal(r.series.cons[3], 10 + VENTES[3] - DEPARTS[3]);
  // The start headcount is ignored once a month is actual.
  assert.equal(r.series.cons[0], 10);
});

test("cash uses actual collections, then the DSO lag", () => {
  const h = { ...DEFAULT_HYPOTHESES, dso: 60, commFactor: 0, primeIC: 0, primeChasseur: 0 };
  const actual = { cons: 5, ca: 50000, free: 0, sal: 0, inter: 0, ventes: 0, departs: 0, enc: 12345 };
  const months = VENTES.map((_, i) => (i < 2 ? { actual: { ...actual, ca: 50000 + i } } : forecast(i)));
  const r = computePlan(h, months, 0, 2026);
  assert.equal(r.series.enc[0], 12345);
  assert.equal(r.series.enc[1], 12345);
  // Month 2 (forecast) collects month 0's revenue (2-month lag).
  assert.equal(r.series.enc[2], 50000);
  assert.equal(r.series.enc[3], 50001);
  const fix = r.series.fix[0];
  assert.equal(r.series.treso[0], h.tresoDebut + 12345 - fix + r.series.tva[0]);
});

test("corporate tax only on a positive operating result", () => {
  const loss = computePlan({ ...DEFAULT_HYPOTHESES, tjm: 0 }, VENTES.map((_, i) => forecast(i)), START, 2026);
  assert.ok(loss.totals.eb < 0);
  assert.equal(loss.totals.is, 0);
  assert.equal(loss.totals.rn, loss.totals.ex);
  const win = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)), START, 2026);
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

test("ventes and départs list the people behind each count", () => {
  const employees = [emp("a", { end_date: "2026-04-30" }), emp("b", { planned_exit_date: "2026-12-15", status: "offboarding" }), emp("f", { contract_type: "Freelance" }), emp("boss", { end_date: "2026-04-30" })];
  const agg = aggregateActuals(sources({ employees }), 2026, 10, new Date(2026, 10, 1));
  agg.months.forEach((mo, m) => {
    if (!mo) return;
    assert.equal(agg.venteLines[m].length, mo.ventes);
    assert.equal(agg.departLines[m].length, mo.departs);
  });
  assert.deepEqual(agg.departLines[3].map((l) => [l.employeeId, l.date, l.planned]), [["a", "2026-04-30", false]]);
  assert.deepEqual(agg.departLines[11].map((l) => [l.employeeId, l.planned]), [["b", true]]);
  assert.ok(agg.venteLines[0][0].project);
});

test("seeds hypotheses from current data", () => {
  const { seeds } = aggregateActuals(sources(), 2027, 0, new Date(2026, 10, 1));
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

/* Freelancer invoices: the real cost, over the CRA × rate estimate. */
const OCT_DAYS = ["01", "02", "05", "06", "07", "08", "09", "12", "13", "14", "15", "16"];
function freelanceOctober(freelancerInvoices) {
  const people = [{ id: "pf", full_name: "Fanny" }, { id: "pg", full_name: "Gus" }];
  const employees = [...sources().employees, emp("g", { contract_type: "Freelance" })].map((e) => ({ ...e, person_id: `p${e.id}` }));
  const salaries = sources().salaries.map((s) => (s.employee_id === "f" ? { ...s, daily_rate: 700 } : s));
  const cra = OCT_DAYS.map((d) => ({ employee_id: "f", day: `2026-10-${d}`, part: "full" }));
  return aggregateActuals(sources({ employees, people, salaries, cra, freelancerInvoices }), 2026, 10, new Date(2026, 10, 1));
}
const fInv = (employee_id, amount_ht_cents, over = {}) => ({ employee_id, period_month: "2026-10-01", amount_ht_cents, review: "ok", ...over });

test("a freelancer's invoice is the month's cost, over CRA × rate", () => {
  const { months, freelanceLines } = freelanceOctober([fInv("f", 900000)]);
  assert.equal(months[9].free, 9000);
  const [line] = freelanceLines[9];
  assert.equal(line.source, "invoice");
  assert.equal(line.invoicedCents, 900000);
  assert.equal(line.cost, 9000);
  assert.equal(line.days, 12);
});

test("without an invoice the CRA × rate stands", () => {
  const { months, freelanceLines } = freelanceOctober([]);
  assert.equal(months[9].free, 8400);
  assert.equal(freelanceLines[9][0].source, "cra");
  assert.equal(freelanceLines[9][0].estimated, false);
  // No CRA in March: the open-days estimate.
  assert.equal(freelanceLines[2][0].source, "estimate");
  assert.equal(freelanceLines[2][0].estimated, true);
});

test("an unstaffed freelancer's invoice still counts", () => {
  const { months, freelanceLines } = freelanceOctober([fInv("g", 50000)]);
  assert.equal(months[9].free, 8400 + 500);
  const gus = freelanceLines[9].find((l) => l.employeeId === "g");
  assert.deepEqual([gus.name, gus.source, gus.cost, gus.staffed], ["Gus", "invoice", 500, false]);
  assert.equal(freelanceLines[9].reduce((s, l) => s + l.cost, 0), months[9].free);
});

test("rejected invoices and invoices without a period are ignored", () => {
  const { months, freelanceLines } = freelanceOctober([
    fInv("f", 900000, { review: "rejected" }),
    fInv("f", 100000, { period_month: null }),
    fInv("g", 50000, { review: "rejected" }),
    fInv("g", null),
  ]);
  assert.equal(months[9].free, 8400);
  assert.deepEqual(freelanceLines[9].map((l) => [l.employeeId, l.source]), [["f", "cra"]]);
});

test("a credit note lowers the invoiced cost", () => {
  const { months } = freelanceOctober([fInv("f", 900000), fInv("f", -100000, { review: "to_check" })]);
  assert.equal(months[9].free, 8000);
});

test("a credit note stored with a positive amount still lowers the cost", () => {
  const { months } = freelanceOctober([fInv("f", 900000), fInv("f", 100000, { is_credit_note: true })]);
  assert.equal(months[9].free, 8000);
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
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => ({ ...forecast(i), structure: i * 1000 })), START, 2026);
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
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)), START, 2026);
  assert.equal(planRows(r).find((row) => row.label === "— dont inter-contrats").key, "inter");
});

test("operating result = EBITDA − depreciation, taxed instead of EBITDA, cash unchanged", () => {
  const months = VENTES.map((_, i) => forecast(i));
  const base = computePlan(DEFAULT_HYPOTHESES, months, START, 2026);
  assert.deepEqual(base.series.ex, base.series.eb); // no depreciation by default
  const r = computePlan({ ...DEFAULT_HYPOTHESES, fAmort: 2000 }, months, START, 2026);
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
  const base = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 5000 }], 0, 2026);
  const real = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 5000, fixed }], 0, 2026);
  assert.equal(real.series.fl[0], 1000);
  assert.equal(real.series.fd[0], 100);
  assert.equal(real.series.fix[0], 5000 + 2500);
  assert.equal(real.series.eb[0], real.series.mb[0] - 7500);
  assert.equal(real.series.treso[0], h.tresoDebut + real.series.enc[0] - 0 - real.series.prod[0] - real.series.varr[0] - 7500 + real.series.tva[0]);
  const open = computePlan(h, [{ actual: null, ventes: 0, departs: 0, structure: 5000, fixed }], 0, 2026);
  assert.equal(open.series.fl[0], h.fLoyer);
});

test("planRows tags the five fixed lines with drill keys", () => {
  const h = DEFAULT_HYPOTHESES;
  const rows = planRows(computePlan(h, [forecast(0)], 0, 2026));
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
  const r = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 0, vat: { collected: 8000, deductible: 1500, remitted: 6000 } }], 0, 2026);
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
  ], 0, 2026);
  const S = r.series;
  assert.ok(Math.abs(S.tvaCol[1] - VAT_RATE * S.enc[1]) < 1e-6);
  assert.ok(Math.abs(S.tvaDed[1] - VAT_RATE * (S.free[1] + S.fl[1] + S.fo[1] + S.fm[1] + S.fh[1] + S.fdp[1] + S.fd[1])) < 1e-6);
  assert.equal(S.tvaRem[1], 8000 - 1500); // last month's real net
  assert.ok(Math.abs(S.tva[1] - (S.tvaCol[1] - S.tvaDed[1] - S.tvaRem[1])) < 1e-6);
});

test("computePlan: first month of an all-forecast year remits its own net, never a negative amount", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, [forecast(0)], 0, 2026);
  const S = r.series;
  assert.ok(Math.abs(S.tvaRem[0] - Math.max(0, S.tvaCol[0] - S.tvaDed[0])) < 1e-6);
  const credit = computePlan(DEFAULT_HYPOTHESES, [{ actual: null, ventes: 0, departs: 0, structure: 0 }], 0, 2026);
  assert.equal(credit.series.tvaRem[0], 0);
});

test("planRows shows the VAT line in the cash section with a drill key", () => {
  const rows = planRows(computePlan(DEFAULT_HYPOTHESES, [forecast(0)], 0, 2026));
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
  const p = computePlan(h, [{ actual: closed, ventes: 0, departs: 0, structure: 0, fixed: r.fixed[2] }, forecast(1)], 0, 2026);
  assert.equal(p.series.fdp[0], 1234);
  assert.equal(p.series.fdp[1], 2000);
  assert.ok(Math.abs(p.series.fix[1] - (STRUCTURE + h.fLoyer + h.fOutils + h.fMarketing + h.fHonoraires + 2000 + h.fDivers)) < 1e-6);
  const S = p.series;
  assert.ok(Math.abs(S.tvaDed[1] - VAT_RATE * (S.free[1] + S.fl[1] + S.fo[1] + S.fm[1] + S.fh[1] + S.fdp[1] + S.fd[1])) < 1e-6);
});

test("revenue can be bucketed by issue date instead of period month", () => {
  const { months, invoiceLines, revenueBasis } = aggregateActuals(sources({ revenueBasis: "issue" }), 2026, 10, new Date(2026, 10, 1));
  assert.equal(revenueBasis, "issue");
  assert.equal(months[0].ca, 500); // only the invoice issued in January
  assert.equal(months[1].ca, 1000.1); // period January, issued in February
  assert.deepEqual(invoiceLines[1].map((l) => [l.amount, l.byIssueDate]), [[1000.1, false]]);
  assert.equal(months[2].enc, 1000.1); // collections are unaffected
  assert.equal(aggregateActuals(sources(), 2026, 10, new Date(2026, 10, 1)).revenueBasis, "period");
});

/* ── Social charges ────────────────────────────────────────────────── */

const H_COT = { ...DEFAULT_HYPOTHESES, tauxCharges: 30, mutuelle: 150, ticketsResto: 160, medecine: 120 };
const sl = (o) => ({ employeeId: "e", name: "", contractType: "CDI", salary: 5000, cost: 5000, staffed: true, exitDate: null, ...o });

test("socialCharges: % of gross plus per-head costs prorated, interns excluded", () => {
  const c = socialCharges([sl({}), sl({ cost: 2500 }), sl({ contractType: "Internship", salary: 1000, cost: 1000 }), sl({ salary: null, cost: 0 })], H_COT);
  assert.equal(c.urssaf, 0.3 * 7500);
  assert.equal(c.mutuelle, 150 * 1.5);
  assert.equal(c.tickets, 160 * 1.5);
  assert.equal(c.medecine, 10 * 1.5);
});

test("default social-charge hypotheses are calibrated on the 2026 accounts", () => {
  assert.equal(DEFAULT_HYPOTHESES.tauxCharges, 30);
  assert.equal(DEFAULT_HYPOTHESES.mutuelle, 150);
  assert.equal(DEFAULT_HYPOTHESES.ticketsResto, 160);
  assert.equal(DEFAULT_HYPOTHESES.medecine, 120);
});

test("computePlan: consultant charges in production costs, structure charges in fixed costs", () => {
  const closed = { cons: 3, ca: 50000, free: 0, sal: 10000, inter: 0, ventes: 0, departs: 0, enc: 0 };
  const cc = { urssaf: 3000, mutuelle: 300, tickets: 320, medecine: 20 };
  const cs = { urssaf: 1500, mutuelle: 150, tickets: 160, medecine: 10 };
  const r = computePlan(H_COT, [{ actual: closed, ventes: 0, departs: 0, structure: 5000, cotConsultants: cc, cotStructure: cs }], 0, 2026);
  const S = r.series;
  assert.equal(S.cotc[0], 3640);
  assert.equal(S.cots[0], 1820);
  assert.equal(S.prod[0], 10000 + 3640);
  assert.equal(S.mb[0], 50000 - 13640 - S.varr[0]);
  assert.equal(S.fix[0], 5000 + 1820 + S.fl[0] + S.fo[0] + S.fm[0] + S.fh[0] + S.fdp[0] + S.fd[0]);
  assert.equal(S.cu[0], 4500); assert.equal(S.cmu[0], 450); assert.equal(S.ctr[0], 480); assert.equal(S.cme[0], 30);
  assert.equal(S.cot[0], 5460);
});

test("computePlan: forecast consultant charges from salaried headcount", () => {
  const r = computePlan({ ...H_COT, pctFree: 40, salaire: 5000 }, [{ actual: null, ventes: 0, departs: 0, structure: 0 }], 10, 2026);
  const ns = 6;
  assert.ok(Math.abs(r.series.cotc[0] - ns * (5000 * 0.3 + 150 + 160 + 10)) < 1e-6);
  assert.equal(r.series.cots[0], 0);
});

test("planRows: gross salary lines, charge lines and the social-charges section", () => {
  const rows = planRows(computePlan(H_COT, [forecast(0)], 0, 2026));
  const labels = rows.map((r) => r.label);
  assert.ok(labels.includes("Salaires consultants (brut)"));
  assert.ok(labels.includes("Salaires structure (brut)"));
  const prodTotal = labels.indexOf("Total coûts de production");
  assert.equal(labels[prodTotal - 1], "Cotisations sociales consultants");
  assert.equal(labels[labels.indexOf("Salaires structure (brut)") + 1], "Cotisations sociales structure");
  const sec = labels.indexOf("Cotisations sociales");
  assert.deepEqual(labels.slice(sec + 1, sec + 6), ["URSSAF et retraite", "Mutuelle", "Tickets restaurant", "Médecine du travail", "Total cotisations sociales"]);
  assert.ok(sec > labels.indexOf("Marge d’exploitation (EBIT / CA)") && sec < labels.indexOf("Trésorerie"));
});

test("socialChargesOf: one person's charges, prorated; interns and missing salaries carry none", () => {
  assert.deepEqual(socialChargesOf(sl({ cost: 2500 }), H_COT), { urssaf: 750, mutuelle: 75, tickets: 80, medecine: 5 });
  assert.deepEqual(socialChargesOf(sl({ contractType: "Internship" }), H_COT), { urssaf: 0, mutuelle: 0, tickets: 0, medecine: 0 });
  assert.deepEqual(socialChargesOf(sl({ salary: null }), H_COT), { urssaf: 0, mutuelle: 0, tickets: 0, medecine: 0 });
});

test("planRows: both social-charge lines open a drill-down", () => {
  const rows = planRows(computePlan(H_COT, [forecast(0)], 0, 2026));
  assert.equal(rows.find((r) => r.label === "Cotisations sociales consultants").key, "cotc");
  assert.equal(rows.find((r) => r.label === "Cotisations sociales structure").key, "cots");
});

test("a forecast year starts from the previous year's December", () => {
  // Previous year: closed through October (12 consultants), then +3 −1 and +2.
  const closed = { cons: 12, ca: 0, free: 0, sal: 0, inter: 0, ventes: 0, departs: 0, enc: 0 };
  const prev = computePlan(DEFAULT_HYPOTHESES, Array.from({ length: 12 }, (_, m) =>
    m < 10 ? { actual: closed, ventes: 0, departs: 0 } : { actual: null, ventes: [3, 2][m - 10], departs: [1, 0][m - 10], structure: 0 }), 0, 2026);
  assert.equal(prev.totals.consFin, 16);
  // Next year carries both headcount and cash forward.
  const next = computePlan({ ...DEFAULT_HYPOTHESES, tresoDebut: prev.totals.treso }, [{ actual: null, ventes: 1, departs: 0, structure: 0 }], prev.totals.consFin, 2026);
  assert.equal(next.series.cons[0], 17);
  assert.equal(next.series.treso[0] - next.series.enc[0] + next.series.prod[0] + next.series.varr[0] + next.series.fix[0] - next.series.tva[0], prev.totals.treso);
});

test("chargeItemOf: social-charge payees by item", () => {
  const t = (counterparty, label = "", reference = null) => chargeItemOf({ counterparty, label, reference });
  assert.equal(t("URSSAF ILE DE FRANCE"), "urssaf");
  assert.equal(t("Malakoff Humanis", "Retraite complémentaire"), "urssaf");
  assert.equal(t("Alan"), "mutuelle");
  assert.equal(t("Malakoff Humanis", "Mutuelle santé"), "mutuelle");
  assert.equal(t("Swile"), "tickets");
  assert.equal(t("Pluxee France"), "tickets");
  assert.equal(t("Service de santé au travail"), "medecine");
  assert.equal(t("Médecine du travail"), "medecine");
  assert.equal(t("Notion Labs"), null);
  assert.equal(t("Planet Alan"), "mutuelle");
  assert.equal(t("DGFIP", "", "TVA-202609-3310CA3"), null);
});

test("planRows: social-charge items open a drill-down", () => {
  const rows = planRows(computePlan(DEFAULT_HYPOTHESES, [forecast(0)], START, 2026));
  assert.deepEqual(
    ["URSSAF et retraite", "Mutuelle", "Tickets restaurant", "Médecine du travail"].map((l) => rows.find((r) => r.label === l).key),
    ["cu", "cmu", "ctr", "cme"],
  );
});

test("businessPlanXlsx exports one year: summary, P&L grid and hypotheses", async () => {
  const { businessPlanXlsx } = await import("../apps/admin/src/ops/business-plan/export-xlsx.ts");
  const { unzipSync, strFromU8 } = await import("../apps/admin/node_modules/fflate/esm/index.mjs");
  const r = computePlan(DEFAULT_HYPOTHESES, Array.from({ length: 12 }, (_, i) => forecast(i)), START, 2026);
  const groups = [{ title: "Activité & prix", fields: [{ key: "tjm", label: "TJM <moyen>", unit: "€" }] }];
  const files = unzipSync(businessPlanXlsx([{ year: 2027, plan: r, h: DEFAULT_HYPOTHESES }], groups));
  for (const f of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"])
    assert.ok(files[f], `missing ${f}`);
  assert.equal(files["xl/worksheets/sheet4.xml"], undefined);
  const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Synthèse", "Business plan 2027", "Hypothèses"]);
  const grid = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(grid, /Chiffre d’affaires/);
  assert.match(grid, /Total 2027/);
  // One row per P&L row plus the two header rows.
  assert.equal((grid.match(/<row /g) ?? []).length, planRows(r).length + 2);
  assert.ok(grid.includes(`<v>${r.totals.ca}</v>`), "yearly revenue total is exported as a number");
  const hyp = strFromU8(files["xl/worksheets/sheet3.xml"]);
  assert.match(hyp, /Activité &amp; prix/);
  assert.match(hyp, /TJM &lt;moyen&gt;/);
  assert.ok(hyp.includes(`<v>${DEFAULT_HYPOTHESES.tjm}</v>`));
});

test("businessPlanXlsx exports three years with a cumulative summary and hypotheses side by side", async () => {
  const { businessPlanXlsx } = await import("../apps/admin/src/ops/business-plan/export-xlsx.ts");
  const { unzipSync, strFromU8 } = await import("../apps/admin/node_modules/fflate/esm/index.mjs");
  const years = [];
  let cons = START, treso = DEFAULT_HYPOTHESES.tresoDebut;
  for (const [i, year] of [2027, 2028, 2029].entries()) {
    const h = { ...DEFAULT_HYPOTHESES, tjm: 650 + 50 * i, tresoDebut: treso };
    const plan = computePlan(h, Array.from({ length: 12 }, (_, m) => forecast(m)), cons, year);
    years.push({ year, plan, h });
    cons = plan.totals.consFin;
    treso = plan.totals.treso;
  }
  const files = unzipSync(businessPlanXlsx(years, [{ title: "Activité", fields: [{ key: "tjm", label: "TJM", unit: "€" }] }]));
  const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, ["Synthèse", "Business plan 2027", "Business plan 2028", "Business plan 2029", "Hypothèses"]);
  const summary = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(summary, /Total 2027–2029/);
  const caAll = years.reduce((a, y) => a + y.plan.totals.ca, 0);
  assert.ok(summary.includes(`<v>${caAll}</v>`), "cumulative revenue");
  assert.ok(summary.includes(`<v>${years[2].plan.totals.treso}</v>`), "last year's closing cash");
  const hyp = strFromU8(files["xl/worksheets/sheet5.xml"]);
  for (const t of [650, 700, 750]) assert.ok(hyp.includes(`<v>${t}</v>`), `TJM ${t}`);
});

/* ── ESN lot 1: working-day calendar ─────────────────────────────────── */

test("calendar: working days exclude weekends and French holidays", () => {
  const jo = monthWorkingDays(2026);
  // Mai 2026 : 21 jours lun–ven, moins 1er mai, 8 mai, Ascension (14) et Pentecôte (25).
  assert.equal(jo[4], 17);
  // Août 2026 : le 15 août tombe un samedi.
  assert.equal(jo[7], 21);
  assert.equal(jo.reduce((a, b) => a + b, 0), 252);
  assert.equal(workingDaysBetween("2026-05-01", "2026-05-08"), 4);
  assert.equal(workingDaysBetween("2026-05-08", "2026-05-01"), 0);
  assert.equal(workingDaysBetween("", "2026-05-01"), 0);
});

test("calendar: leave lowers August and keeps the yearly TACI", () => {
  const cal = workingCalendar(2026, { taci: 75, congesAn: 25, rttAn: 10 });
  assert.equal(cal.abs[7], 12.5);
  assert.ok(Math.abs(cal.abs.reduce((a, b) => a + b, 0) - 35) < 1e-9);
  assert.ok(cal.taci[7] < cal.taci[2]);
  const billed = cal.taci.reduce((s, t, m) => s + t * cal.jo[m], 0);
  assert.ok(Math.abs(billed / cal.jo.reduce((a, b) => a + b, 0) - 0.75) < 1e-9);
});

test("calendar: TACE is flat over the year and follows from the TACI", () => {
  const cal = workingCalendar(2026, { taci: 75, congesAn: 25, rttAn: 10 });
  assert.ok(Math.abs(cal.taciMax - 217 / 252) < 1e-9);
  cal.tace.forEach((t, m) => {
    assert.ok(Math.abs(t - (0.75 * 252) / 217) < 1e-9);
    assert.ok(Math.abs(cal.taci[m] - (t * (cal.jo[m] - cal.abs[m])) / cal.jo[m]) < 1e-9);
  });
});

test("calendar: a TACI above the maximum caps the TACE at 100 %", () => {
  const cal = workingCalendar(2026, { taci: 95, congesAn: 25, rttAn: 10 });
  cal.tace.forEach((t) => assert.equal(t, 1));
  cal.taci.forEach((t, m) => assert.ok(Math.abs(t - (cal.jo[m] - cal.abs[m]) / cal.jo[m]) < 1e-9));
});

/* ── ESN lot 1: model ────────────────────────────────────────────────── */

test("forecast: revenue follows the calendar and the monthly TACI", () => {
  const h = { ...DEFAULT_HYPOTHESES, pctFree: 0 };
  const r = computePlan(h, VENTES.map((_, i) => ({ ...forecast(i), ventes: 0, departs: 0 })), 10, 2026);
  const cal = workingCalendar(2026, h);
  assert.ok(Math.abs(r.series.ca[7] - 10 * cal.jo[7] * cal.taci[7] * h.tjm) < 1e-6);
  assert.ok(r.series.ca[7] < r.series.ca[2]);
  assert.ok(Math.abs(r.totals.taci - h.taci / 100) < 1e-9);
  assert.ok(Math.abs(r.totals.tace - cal.tace[0]) < 1e-9);
  // Intercontrat = 1 − TACI − absences / jours ouvrés, jamais négatif.
  r.series.itc.forEach((v, m) => assert.ok(Math.abs(v - Math.max(0, 1 - cal.taci[m] - cal.abs[m] / cal.jo[m])) < 1e-9));
  assert.ok(Math.abs(r.series.inter[7] - r.series.sal[7] * r.series.itc[7]) < 1e-6);
});

test("forecast: a TACI above the maximum leaves no negative inter-contract", () => {
  const r = computePlan({ ...DEFAULT_HYPOTHESES, taci: 95 }, [forecast(0)], 10, 2026);
  assert.ok(Math.abs(r.series.tace[0] - 1) < 1e-9);
  assert.ok(Math.abs(r.series.itc[0]) < 1e-9);
  assert.ok(r.series.inter[0] >= 0);
});

test("indicators on a closed month come from measured days", () => {
  const actual = { cons: 3, ca: 30000, free: 4000, sal: 9000, inter: 0, ventes: 0, departs: 0, enc: 0,
    jo: 40, jfs: 30, jf: 40, abs: 4, craComplete: true };
  const r = computePlan(DEFAULT_HYPOTHESES, [{ actual, ventes: 0, departs: 0, structure: 0 }], 0, 2026);
  const S = r.series;
  assert.equal(S.taci[0], 0.75);
  assert.equal(S.tace[0], 30 / 36);
  assert.equal(S.itc[0], 0.15);
  assert.equal(S.tjmR[0], 750);
  assert.equal(S.cjm[0], (S.sal[0] + S.cotc[0]) / 40);
  assert.equal(S.mj[0], (S.ca[0] - S.prod[0]) / 40);
  assert.equal(S.ts[0], S.fix[0] / 30000);
  assert.equal(S.cac[0], 10000);
  assert.deepEqual(r.craIncomplete, [false]);
  const partial = computePlan(DEFAULT_HYPOTHESES, [{ actual: { ...actual, craComplete: false }, ventes: 0, departs: 0 }], 0, 2026);
  assert.deepEqual(partial.craIncomplete, [true]);
});

test("indicators are 0, never NaN, on an empty month", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, [{ actual: null, ventes: 0, departs: 0, structure: 0 }], 0, 2026);
  for (const k of ["taci", "tace", "itc", "tjmR", "cjm", "mj", "ts", "cac"]) assert.equal(r.series[k][0], 0, k);
  for (const k of ["taci", "tace", "itc", "cjm"]) assert.ok(Number.isFinite(r.totals[k]), k);
  for (const row of planRows(r)) assert.ok(row.values.every(Number.isFinite) && (row.total === null || Number.isFinite(row.total)), row.label);
});

test("a saved plan from before the TACI keeps its occupancy rate", () => {
  assert.deepEqual(migrateHypotheses({ tjm: 700, jours: 18, occ: 88 }), { tjm: 700, taci: 88 });
  assert.deepEqual(migrateHypotheses({ occ: 88, taci: 80 }), { taci: 80 });
  assert.deepEqual(migrateHypotheses(null), {});
});

test("planRows: ESN indicators section after the operating margin", () => {
  const r = computePlan(DEFAULT_HYPOTHESES, VENTES.map((_, i) => forecast(i)), START, 2026);
  const rows = planRows(r);
  const labels = rows.map((row) => row.label);
  const at = labels.indexOf("Indicateurs ESN");
  assert.equal(labels[at - 1], "Marge d’exploitation (EBIT / CA)");
  assert.deepEqual(labels.slice(at + 1, at + 9), [
    "TACI (taux d’activité congés inclus)", "TACE (taux d’activité congés exclus)", "Taux d’intercontrat",
    "TJM moyen réalisé", "CJM (coût journalier moyen)", "Marge par jour facturé", "Taux de structure", "CA par consultant",
  ]);
  // Ratio rows total to the yearly ratio, not to the sum of the months.
  assert.equal(rows[at + 1].total, r.totals.taci);
  assert.equal(rows[at + 5].total, r.totals.cjm);
});

/* ── ESN lot 1: measured days ────────────────────────────────────────── */

/** March 2026 weekdays (22, no public holiday). */
const MARCH = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30, 31].map((d) => `2026-03-${String(d).padStart(2, "0")}`);
const cra = (employee_id, days, status, part = "full") => days.map((day) => ({ employee_id, day, part, status }));

test("actuals: salaried working, billed and leave days from every CRA status", () => {
  const src = sources({
    employees: [emp("a"), emp("f", { contract_type: "Freelance" })],
    assignments: [asg("a", "p1", "2026-01-05"), asg("f", "p1", "2026-02-02")],
    structureStaff: [],
    cra: [
      ...cra("a", MARCH.slice(0, 15), "client_project"),
      ...cra("a", MARCH.slice(15, 16), "client_project", "am"),
      ...cra("a", MARCH.slice(16, 19), "paid_leave"),
      ...cra("a", MARCH.slice(19, 20), "rtt"),
      ...cra("a", MARCH.slice(20, 22), "internal"),
      ...cra("f", MARCH.slice(0, 10), "client_project"),
      ...cra("f", MARCH.slice(10, 12), "unpaid_leave"),
    ],
  });
  const mar = aggregateActuals(src, 2026, 3, new Date(2026, 3, 15)).months[2];
  assert.equal(mar.jo, 22);
  assert.equal(mar.jfs, 15.5);
  assert.equal(mar.abs, 4);
  assert.equal(mar.craComplete, false); // 21,5 j saisis sur 22
  // Freelance: only client days are billed and paid.
  assert.equal(mar.free, 10 * 500);
  assert.equal(mar.jf, 15.5 + 10);
});

test("actuals: a CRA covering every working day is complete", () => {
  const src = sources({
    employees: [emp("a")], assignments: [asg("a", "p1", "2026-01-05")], structureStaff: [],
    cra: cra("a", MARCH, "client_project"),
  });
  const mar = aggregateActuals(src, 2026, 3, new Date(2026, 3, 15)).months[2];
  assert.equal(mar.craComplete, true);
  assert.equal(mar.jfs, 22);
});

test("actuals: arrival mid-month limits the salaried working days", () => {
  const src = sources({
    employees: [emp("c", { start_date: "2026-03-16" })], salaries: [sal("c", { salary_monthly: 4000 })],
    assignments: [asg("c", "p1", "2026-03-16")], structureStaff: [], cra: [],
  });
  const mar = aggregateActuals(src, 2026, 3, new Date(2026, 3, 15)).months[2];
  assert.equal(mar.jo, workingDaysBetween("2026-03-16", "2026-03-31"));
  assert.equal(mar.jo, 12);
  assert.equal(mar.craComplete, false);
});

test("actuals: structure staff on a mission count only their consultant share", () => {
  // May 2026: 17 working days without holidays; boss spends 20 of the 21 weekdays on a mission.
  const assignments = [...sources().assignments, asg("boss", "p1", "2026-05-04", "2026-05-29", { status: "completed" })];
  const { months } = aggregateActuals(sources({ assignments, cra: [] }), 2026, 10, new Date(2026, 10, 1));
  // a and b: whole month; boss: 20/21 of it.
  assert.ok(Math.abs(months[4].jo - (17 + 17 + (17 * 20) / 21)) < 1e-9);
  // Outside the mission, boss is structure staff only.
  assert.equal(months[5].jo, 22 + 22);
});

test("businessPlanXlsx exports the ESN indicators, with no NaN on an empty plan", async () => {
  const { businessPlanXlsx } = await import("../apps/admin/src/ops/business-plan/export-xlsx.ts");
  const { unzipSync, strFromU8 } = await import("../apps/admin/node_modules/fflate/esm/index.mjs");
  const r = computePlan(DEFAULT_HYPOTHESES, Array.from({ length: 12 }, () => ({ actual: null, ventes: 0, departs: 0, structure: 0 })), 0, 2027);
  const files = unzipSync(businessPlanXlsx([{ year: 2027, plan: r, h: DEFAULT_HYPOTHESES }], []));
  const grid = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(grid, /Indicateurs ESN/);
  assert.match(grid, /TACE \(taux d’activité congés exclus\)/);
  assert.doesNotMatch(grid, /NaN|Infinity/);
});

test("actuals: structure staff's client days on a mission are not scaled down twice", () => {
  // June 2026 (22 working days): boss on a mission 1–5 June, 5 client days, the rest internal.
  const june = (d) => `2026-06-${String(d).padStart(2, "0")}`;
  const rest = [8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26, 29, 30].map(june);
  const src = sources({
    employees: [emp("boss")], assignments: [asg("boss", "p1", "2026-06-01", "2026-06-05", { status: "completed" })],
    cra: [...cra("boss", [1, 2, 3, 4, 5].map(june), "client_project"), ...cra("boss", rest, "internal")],
  });
  const jun = aggregateActuals(src, 2026, 6, new Date(2026, 6, 15)).months[5];
  assert.ok(Math.abs(jun.jo - 5) < 1e-9);
  assert.equal(jun.jfs, 5);
  assert.equal(jun.craComplete, true);
});

test("craIncompleteNote flags the yearly figures built on incomplete closed months", async () => {
  const { craIncompleteNote } = await import("../apps/admin/src/ops/business-plan/model.ts");
  const actual = { cons: 1, ca: 0, free: 0, sal: 0, inter: 0, ventes: 0, departs: 0, enc: 0, jo: 20, jfs: 5, jf: 5, abs: 0 };
  const months = [
    { actual: { ...actual, craComplete: false } }, { actual: { ...actual, craComplete: false } },
    { actual: { ...actual, craComplete: true } }, { actual: null, ventes: 0, departs: 0 },
  ];
  assert.equal(craIncompleteNote(computePlan(DEFAULT_HYPOTHESES, months, 0, 2026)), "CRA incomplet sur 2 mois");
  assert.equal(craIncompleteNote(computePlan(DEFAULT_HYPOTHESES, [months[0]], 0, 2026)), "CRA incomplet sur 1 mois");
  assert.equal(craIncompleteNote(computePlan(DEFAULT_HYPOTHESES, months.slice(2), 0, 2026)), "");
});
