/**
 * Real-data side of the business plan: aggregates invoices, staffing, CRA,
 * salaries and exits into per-month actuals, and derives "from data"
 * seeds for the hypotheses. `aggregateActuals` is pure (unit-tested);
 * the loaders below only fetch rows.
 *
 * Conventions (documented on the page footer too):
 * - Structure staff are an explicit list (business_plan_structure), each
 *   with a period (empty start = hire date, empty end = exit date). Outside
 *   that period the person is a consultant; inside it, working days on a
 *   mission (weighted by allocation) are consultant days, the rest structure.
 *   Every other non-freelance employee is a consultant, in inter-contract
 *   when unstaffed. "Salaires structure" = salary × CJM multiplier × share of
 *   the month's working days spent in structure, measured or projected.
 * - Staffed = a confirmed / active / completed assignment overlapping the
 *   month. "Ventes" = such assignments starting in the month (there is no
 *   won date on deals, so first staffing stands in for the sale).
 * - Revenue = finalized + paid invoices (not ignored) by period month
 *   (issue date for imported invoices without one). Collections = paid
 *   invoices by paid_at month.
 * - Freelance cost = CRA client days × daily rate; a staffed freelancer
 *   with no CRA that month falls back to open days × allocation.
 * - Salaried cost = monthly salary × CJM multiplier (employer-cost proxy).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Assignment, Employee, Salary, StaffingProject } from "../../hr/domain.ts";
import { storedPricingLines, openDaysBetween } from "../../sales/pricing-lines.ts";
import type { ActualMonth, FixedActuals, FixedChargeLine, Hypotheses, VatActual } from "./model.ts";

export type InvoiceRow = {
  status: string;
  period_month: string | null;
  issue_date: string | null;
  paid_at: string | null;
  total_ht: number | string;
  /** VAT of the invoice, € — for the VAT cash line (collected when paid). */
  total_vat?: number | string | null;
  ignored?: boolean | null;
  /** Optional, for the revenue and collections drill-downs. */
  id?: string;
  number?: string | null;
  project_id?: string | null;
  billed_client_id?: string | null;
  employee_id?: string | null;
  invoice_url?: string | null;
};
export type CraRow = { employee_id: string; day: string; part?: string | null };
export type ExtensionRow = {
  project_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  tjm_profiles: unknown;
};

export type PlanSources = {
  employees: Employee[];
  salaries: Salary[];
  assignments: Assignment[];
  projects: StaffingProject[];
  extensions: ExtensionRow[];
  invoices: InvoiceRow[];
  cra: CraRow[];
  cjmMultiplier: number;
  /** Optional, for names in the drill-down panels. */
  people?: { id: string; full_name: string }[];
  clients?: { id: string; name: string }[];
  /** Employments counted as structure staff, not consultants, over a period. */
  structureStaff: StructureEntry[];
};

/** A structure listing: null start = hire date, null end = exit date. */
export type StructureEntry = { employee_id: string; start_date?: string | null; end_date?: string | null };

/** One invoice behind a closed month's revenue (drill-down). */
export type InvoiceLine = {
  id: string;
  number: string;
  client: string;
  project: string;
  consultant: string;
  status: string;
  issueDate: string | null;
  paidAt: string | null;
  amount: number;
  /** True when the invoice has no period month and is counted by issue date. */
  byIssueDate: boolean;
  /** Service month (YYYY-MM-01), null when the invoice has none. */
  periodMonth: string | null;
  url: string | null;
};

/** One salaried consultant's line in a closed month (drill-down). */
export type SalaryLine = {
  employeeId: string;
  name: string;
  contractType: string;
  /** Gross monthly salary on file for the month (null = none on file). */
  salary: number | null;
  /** Loaded cost = salary × CJM multiplier. */
  cost: number;
  staffed: boolean;
  /** Planned or recorded exit date, if any. */
  exitDate: string | null;
  /** [counted, total] working days when only part of the month is counted. */
  days?: [number, number];
  /** Listed in structure: working days of the period spent on a mission this month. */
  missionDays?: number;
};

/** One freelancer's line in a closed month (drill-down). */
export type FreelanceLine = {
  employeeId: string;
  name: string;
  /** Billable days counted for the month. */
  days: number;
  /** True when no CRA was filed: days estimated from open days × allocation. */
  estimated: boolean;
  /** Daily buy rate on file (null = none on file). */
  rate: number | null;
  cost: number;
  staffed: boolean;
  exitDate: string | null;
};

export type Seeds = Partial<Hypotheses>;

export type Aggregate = {
  /** Actuals for each month of the year (null for open months). */
  months: (ActualMonth | null)[];
  /** Hypothesis values measured from data (only those with a source). */
  seeds: Seeds;
  /** Departures already planned in open months (exits on file). */
  plannedDeparts: number[];
  /** Trailing-12-month average of new missions per month. */
  avgVentes: number;
  /** Per-consultant salary lines behind each closed month (null when open). */
  salaryLines: (SalaryLine[] | null)[];
  /** Salaried consultants employed today — the base the forecast projects from. */
  currentSalaried: SalaryLine[];
  /** Per-freelancer lines behind each closed month (null when open). */
  freelanceLines: (FreelanceLine[] | null)[];
  /** Freelancers on the books today — the base the forecast projects from. */
  currentFreelancers: FreelanceLine[];
  /** Invoices behind each closed month's revenue (null when open). */
  invoiceLines: (InvoiceLine[] | null)[];
  /** Paid invoices behind each closed month's collections, by payment month (null when open). */
  encLines: (InvoiceLine[] | null)[];
  /** Loaded structure salaries for every month (measured or projected). */
  structure: number[];
  /** Structure staff behind each month's figure. */
  structureLines: SalaryLine[][];
};

const STAFFED = ["confirmed", "active", "completed"];
const pad = (n: number) => String(n).padStart(2, "0");
export const monthKey = (year: number, m: number) => `${year}-${pad(m + 1)}`;
const monthStart = (year: number, m: number) => `${monthKey(year, m)}-01`;
const monthEnd = (year: number, m: number) =>
  `${monthKey(year, m)}-${pad(new Date(year, m + 1, 0).getDate())}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const overlaps = (start: string | null, end: string | null, from: string, to: string) =>
  !!start && start <= to && (!end || end >= from);

function salaryOn(salaries: Salary[], employeeId: string, day: string): Salary | undefined {
  return salaries.find(
    (s) => s.employee_id === employeeId && s.start_date <= day && (!s.end_date || s.end_date >= day),
  );
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const cents = (v: number | string) => Math.round(Number(v) * 100);

export function aggregateActuals(src: PlanSources, year: number, openFrom: number, today: Date): Aggregate {
  const isFree = new Map(src.employees.map((e) => [e.id, e.contract_type === "Freelance"]));
  // Interns cost far less than salaried staff (gratification + very low employer
  // charges), so they get their own employer-cost ratio instead of the CJM multiplier.
  const multFor = (e: { contract_type: string | null }) =>
    e.contract_type === "Internship" ? 1.4 : src.cjmMultiplier;
  const staffedRows = src.assignments.filter((a) => STAFFED.includes(a.status));
  const staffedIn = (id: string, from: string, to: string) =>
    staffedRows.some((a) => a.employee_id === id && overlaps(a.start_date, a.end_date, from, to));

  // Structure periods, bounded by the employment.
  const listing = new Map(src.structureStaff.map((s) => [s.employee_id, s]));
  const exitOf = (e: Employee) => e.end_date ?? e.planned_exit_date;
  const structureWindow = (e: Employee): [string, string | null] | null => {
    const s = listing.get(e.id);
    if (!s || isFree.get(e.id)) return null;
    const start = s.start_date && s.start_date > e.start_date ? s.start_date : e.start_date;
    const exit = exitOf(e);
    return [start, s.end_date && (!exit || s.end_date < exit) ? s.end_date : exit];
  };
  const inStructureOn = (e: Employee, day: string) => {
    const w = structureWindow(e);
    return !!w && overlaps(w[0], w[1], day, day);
  };
  /** Working days of [start, end] on a mission, each capped at 100 % allocation. */
  const missionDays = (id: string, start: string, end: string) => {
    const rows = staffedRows.filter((a) => a.employee_id === id && overlaps(a.start_date, a.end_date, start, end));
    if (!rows.length) return 0;
    let total = 0;
    for (const d = new Date(`${start}T12:00:00`), last = new Date(`${end}T12:00:00`); d <= last; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const day = isoDay(d);
      const pct = rows
        .filter((a) => overlaps(a.start_date, a.end_date, day, day))
        .reduce((t, a) => t + (a.allocation_pct || 100), 0);
      total += Math.min(100, pct) / 100;
    }
    return total;
  };
  /** Structure and mission working days of an employment in [from, to]. */
  const structureSplit = (e: Employee, from: string, to: string) => {
    const w = structureWindow(e);
    if (!w || !overlaps(w[0], w[1], from, to)) return null;
    const first = w[0] > from ? w[0] : from;
    const last = w[1] && w[1] < to ? w[1] : to;
    const inPeriod = openDaysBetween(first, last);
    const mission = Math.min(inPeriod, missionDays(e.id, first, last));
    return { inPeriod, mission, full: first === from && last === to };
  };
  /** Working days of [start, end] ∩ [from, to] (0 when disjoint). */
  const daysWithin = (start: string, end: string | null, from: string, to: string) => {
    if (!overlaps(start, end, from, to)) return 0;
    return openDaysBetween(start > from ? start : from, end && end < to ? end : to);
  };

  // Invoices → revenue by period, collections by payment month (in cents).
  const caByMonth = new Map<string, number>();
  const encByMonth = new Map<string, number>();
  const invByMonth = new Map<string, InvoiceRow[]>();
  const paidByMonth = new Map<string, InvoiceRow[]>();
  for (const inv of src.invoices) {
    if (inv.ignored) continue;
    if (inv.status === "finalized" || inv.status === "paid") {
      const key = (inv.period_month || inv.issue_date || "").slice(0, 7);
      if (key) {
        caByMonth.set(key, (caByMonth.get(key) || 0) + cents(inv.total_ht));
        invByMonth.set(key, [...(invByMonth.get(key) || []), inv]);
      }
    }
    if (inv.status === "paid" && inv.paid_at) {
      const key = inv.paid_at.slice(0, 7);
      encByMonth.set(key, (encByMonth.get(key) || 0) + cents(inv.total_ht));
      paidByMonth.set(key, [...(paidByMonth.get(key) || []), inv]);
    }
  }

  // CRA client days per employee per month (half-days count 0.5).
  const craDays = new Map<string, Map<string, number>>();
  for (const e of src.cra) {
    const key = e.day.slice(0, 7);
    const byEmp = craDays.get(key) || new Map<string, number>();
    byEmp.set(e.employee_id, (byEmp.get(e.employee_id) || 0) + (e.part === "am" || e.part === "pm" ? 0.5 : 1));
    craDays.set(key, byEmp);
  }

  const nameOf = new Map((src.people ?? []).map((p) => [p.id, p.full_name]));
  const displayName = (e: Employee) =>
    nameOf.get(e.person_id) || [e.role, e.matricule].filter(Boolean).join(" · ") || "Consultant sans nom";
  const employeeById = new Map(src.employees.map((e) => [e.id, e]));
  const clientName = new Map((src.clients ?? []).map((c) => [c.id, c.name]));
  const projectTitle = new Map(src.projects.map((p) => [p.id, p]));
  const invoiceLine = (inv: InvoiceRow, i: number): InvoiceLine => {
    const project = inv.project_id ? projectTitle.get(inv.project_id) : undefined;
    const clientId = inv.billed_client_id ?? project?.client_id ?? null;
    const e = inv.employee_id ? employeeById.get(inv.employee_id) : undefined;
    return {
      id: inv.id ?? `${i}`,
      number: inv.number || "",
      client: (clientId && clientName.get(clientId)) || "",
      project: project?.title || "",
      consultant: e ? displayName(e) : "",
      status: inv.status,
      issueDate: inv.issue_date,
      paidAt: inv.paid_at ? inv.paid_at.slice(0, 10) : null,
      amount: cents(inv.total_ht) / 100,
      byIssueDate: !inv.period_month,
      periodMonth: inv.period_month ? inv.period_month.slice(0, 10) : null,
      url: inv.invoice_url ?? null,
    };
  };
  const months: (ActualMonth | null)[] = [];
  const invoiceLines: (InvoiceLine[] | null)[] = [];
  const encLines: (InvoiceLine[] | null)[] = [];
  const salaryLines: (SalaryLine[] | null)[] = [];
  const freelanceLines: (FreelanceLine[] | null)[] = [];
  for (let m = 0; m < 12; m++) {
    if (m >= openFrom) {
      months.push(null);
      invoiceLines.push(null);
      encLines.push(null);
      salaryLines.push(null);
      freelanceLines.push(null);
      continue;
    }
    const key = monthKey(year, m), from = monthStart(year, m), to = monthEnd(year, m);
    const inMonth = staffedRows.filter((a) => overlaps(a.start_date, a.end_date, from, to));
    const staffed = new Set(inMonth.map((a) => a.employee_id));
    invoiceLines.push(
      (invByMonth.get(key) || []).map(invoiceLine).sort((a, b) => b.amount - a.amount || a.number.localeCompare(b.number)),
    );
    encLines.push(
      (paidByMonth.get(key) || []).map(invoiceLine).sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? "") || b.amount - a.amount),
    );

    let free = 0;
    const days = craDays.get(key);
    const fLines: FreelanceLine[] = [];
    for (const empId of staffed) {
      if (!isFree.get(empId)) continue;
      const rate = salaryOn(src.salaries, empId, to)?.daily_rate
        ?? salaryOn(src.salaries, empId, from)?.daily_rate ?? null;
      let d = days?.get(empId) ?? 0;
      const estimated = !d;
      if (!d)
        d = inMonth
          .filter((a) => a.employee_id === empId)
          .reduce((s, a) => {
            const start = a.start_date > from ? a.start_date : from;
            const end = a.end_date && a.end_date < to ? a.end_date : to;
            return s + (openDaysBetween(start, end) * a.allocation_pct) / 100;
          }, 0);
      free += d * (rate ?? 0);
      const e = employeeById.get(empId);
      fLines.push({
        employeeId: empId,
        name: e ? displayName(e) : "Freelance",
        days: d,
        estimated,
        rate,
        cost: d * (rate ?? 0),
        staffed: true,
        exitDate: e ? e.end_date ?? e.planned_exit_date : null,
      });
    }
    fLines.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
    freelanceLines.push(fLines);

    let sal = 0, inter = 0;
    const lines: SalaryLine[] = [];
    for (const e of src.employees) {
      if (isFree.get(e.id)) continue;
      if (!overlaps(e.start_date, e.end_date, from, to)) continue;
      // Structure staff count here for their mission days and outside their period.
      const split = structureSplit(e, from, to);
      let days: [number, number] | undefined;
      if (split) {
        const employed = daysWithin(e.start_date, exitOf(e), from, to);
        const consultant = employed - split.inPeriod + split.mission;
        if (consultant <= 0) continue;
        if (consultant < employed) days = [consultant, employed];
      }
      const s = salaryOn(src.salaries, e.id, to) ?? salaryOn(src.salaries, e.id, from);
      const salary = s?.salary_monthly ?? null;
      const cost = (salary ?? 0) * multFor(e) * (days ? days[0] / days[1] : 1);
      sal += cost;
      if (!staffed.has(e.id)) inter += cost;
      lines.push({
        employeeId: e.id,
        name: displayName(e),
        contractType: e.contract_type || "",
        salary,
        cost,
        staffed: staffed.has(e.id),
        exitDate: e.end_date ?? e.planned_exit_date,
        ...(days ? { days } : {}),
        ...(split?.mission ? { missionDays: split.mission } : {}),
      });
    }
    lines.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
    salaryLines.push(lines);

    const ventes = staffedRows.filter((a) => a.start_date >= from && a.start_date <= to).length;
    const departs = src.employees.filter((e) => {
      const exit = e.end_date ?? e.planned_exit_date;
      return !!exit && exit >= from && exit <= to && (isFree.get(e.id) || !inStructureOn(e, exit) || staffedIn(e.id, from, to));
    }).length;

    months.push({
      cons: staffed.size,
      ca: (caByMonth.get(key) || 0) / 100,
      free,
      sal,
      inter,
      ventes,
      departs,
      enc: (encByMonth.get(key) || 0) / 100,
    });
  }

  // Structure staff, every month of their period. Closed months use the
  // salary on file for the month; open months the latest salary known.
  // Mission days (known or planned) go to the consultants instead.
  const nowDay = isoDay(today);
  const structureLines: SalaryLine[][] = [];
  for (let m = 0; m < 12; m++) {
    const from = monthStart(year, m), to = monthEnd(year, m);
    const open = m >= openFrom;
    const lines: SalaryLine[] = [];
    for (const e of src.employees) {
      const split = structureSplit(e, from, to);
      if (!split) continue;
      const s = salaryOn(src.salaries, e.id, to) ?? salaryOn(src.salaries, e.id, from)
        ?? (open ? salaryOn(src.salaries, e.id, nowDay) : undefined);
      const salary = s?.salary_monthly ?? null;
      // Prorate on working days: period starting or ending mid-month, mission days.
      const total = openDaysBetween(from, to);
      const worked = (split.full ? total : split.inPeriod) - split.mission;
      const share = total > 0 ? worked / total : 1;
      lines.push({
        employeeId: e.id,
        name: displayName(e),
        contractType: e.contract_type || "",
        salary,
        cost: (salary ?? 0) * multFor(e) * share,
        staffed: worked <= 0,
        exitDate: exitOf(e),
        ...(worked < total ? { days: [worked, total] as [number, number] } : {}),
        ...(split.mission ? { missionDays: split.mission } : {}),
      });
    }
    lines.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
    structureLines.push(lines);
  }
  const structure = structureLines.map((lines) => lines.reduce((t, l) => t + l.cost, 0));

  // Planned exits in open months (forecast departures seed).
  const plannedDeparts = Array.from({ length: 12 }, (_, m) => {
    if (m < openFrom) return 0;
    const from = monthStart(year, m), to = monthEnd(year, m);
    return src.employees.filter((e) => {
      const exit = e.planned_exit_date ?? e.end_date;
      return e.status !== "ended" && !!exit && exit >= from && exit <= to && (isFree.get(e.id) || !inStructureOn(e, exit) || staffedIn(e.id, from, to));
    }).length;
  });

  // Seeds, measured as of today.
  const now = isoDay(today);
  const yearAgo = isoDay(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  const current = staffedRows.filter((a) => a.status !== "completed" && overlaps(a.start_date, a.end_date, now, now));
  const staffedNow = [...new Set(current.map((a) => a.employee_id))];
  const seeds: Seeds = {};
  if (staffedNow.length) {
    seeds.consDebut = staffedNow.length;
    const nFree = staffedNow.filter((id) => isFree.get(id)).length;
    seeds.pctFree = Math.round((nFree / staffedNow.length) * 100);
  }
  const projectById = new Map(src.projects.map((p) => [p.id, p]));
  const rates: { tjm: number; w: number }[] = [];
  for (const a of current) {
    const ext = src.extensions.find(
      (x) => x.project_id === a.project_id && x.status === "signed" && overlaps(x.start_date, x.end_date, now, now),
    );
    const lines = storedPricingLines(ext?.tjm_profiles ?? projectById.get(a.project_id)?.tjm_profiles);
    const line = lines.find((l) => l.name === a.pricing_line) ?? (lines.length === 1 ? lines[0] : undefined);
    if (line && line.tjm > 0) rates.push({ tjm: line.tjm, w: a.allocation_pct || 100 });
  }
  if (rates.length) {
    const w = rates.reduce((s, r) => s + r.w, 0);
    seeds.tjm = Math.round(rates.reduce((s, r) => s + r.tjm * r.w, 0) / w);
  }
  const freeRates = staffedNow
    .filter((id) => isFree.get(id))
    .map((id) => salaryOn(src.salaries, id, now)?.daily_rate ?? 0)
    .filter((v) => v > 0);
  const coutFree = avg(freeRates);
  if (coutFree !== null) seeds.coutFree = Math.round(coutFree);
  const salaried = staffedNow
    .filter((id) => !isFree.get(id))
    .map((id) => salaryOn(src.salaries, id, now)?.salary_monthly ?? 0)
    .filter((v) => v > 0);
  const salaire = avg(salaried);
  if (salaire !== null) seeds.salaire = Math.round((salaire * src.cjmMultiplier) / 100) * 100;
  const delays = src.invoices
    .filter((i) => !i.ignored && i.status === "paid" && i.paid_at && i.issue_date && i.paid_at.slice(0, 10) >= yearAgo)
    .map((i) => (Date.parse(i.paid_at!.slice(0, 10)) - Date.parse(i.issue_date!)) / 86400000)
    .filter((d) => d >= 0);
  const dso = avg(delays);
  if (dso !== null) seeds.dso = Math.round(dso);

  const staffedToday = new Set(staffedNow);
  const consultantNow = (e: Employee) => !inStructureOn(e, now) || staffedToday.has(e.id);
  const currentSalaried: SalaryLine[] = src.employees
    .filter((e) => !isFree.get(e.id) && consultantNow(e) && e.status !== "ended" && overlaps(e.start_date, e.end_date, now, now))
    .map((e) => {
      const salary = salaryOn(src.salaries, e.id, now)?.salary_monthly ?? null;
      return {
        employeeId: e.id,
        name: displayName(e),
        contractType: e.contract_type || "",
        salary,
        cost: (salary ?? 0) * multFor(e),
        staffed: staffedToday.has(e.id),
        exitDate: e.end_date ?? e.planned_exit_date,
      };
    })
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

  const currentFreelancers: FreelanceLine[] = src.employees
    .filter((e) => isFree.get(e.id) && e.status !== "ended" && overlaps(e.start_date, e.end_date, now, now))
    .map((e) => ({
      employeeId: e.id,
      name: displayName(e),
      days: 0,
      estimated: false,
      rate: salaryOn(src.salaries, e.id, now)?.daily_rate ?? null,
      cost: 0,
      staffed: staffedToday.has(e.id),
      exitDate: e.end_date ?? e.planned_exit_date,
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a.name.localeCompare(b.name));

  const recentStarts = staffedRows.filter((a) => a.start_date > yearAgo && a.start_date <= now).length;

  return { months, seeds, plannedDeparts, avgVentes: Math.round(recentStarts / 12), salaryLines, currentSalaried, freelanceLines, currentFreelancers, invoiceLines, encLines, structure, structureLines };
}

/* ── Loaders ────────────────────────────────────────────────────────── */

const PAGE = 1000;

/** Page past PostgREST's 1000-row cap. */
async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(offset, offset + PAGE - 1);
    if (page.error) throw page.error;
    const data = (page.data || []) as T[];
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/** Invoices — not in the generated Database types, read untyped. */
export function loadInvoices(client: SupabaseClient): Promise<InvoiceRow[]> {
  return paged<InvoiceRow>((from, to) =>
    client
      .from("invoices")
      .select("id, number, status, period_month, issue_date, paid_at, total_ht, total_vat, ignored, project_id, billed_client_id, employee_id, invoice_url")
      .in("status", ["finalized", "paid"])
      .range(from, to),
  );
}

/** Client-project CRA days for one year (half-day `part` optional). */
export async function loadCra(client: SupabaseClient, year: number): Promise<CraRow[]> {
  const run = (cols: string) =>
    paged<CraRow>((from, to) =>
      client
        .from("cra_entries")
        .select(cols)
        .eq("status", "client_project")
        .gte("day", `${year}-01-01`)
        .lte("day", `${year}-12-31`)
        .range(from, to),
    );
  try {
    return await run("employee_id, day, part");
  } catch {
    // Databases without the half-day migration: every entry is a full day.
    return run("employee_id, day");
  }
}

export function loadExtensions(client: SupabaseClient): Promise<ExtensionRow[]> {
  return paged<ExtensionRow>((from, to) =>
    client
      .from("sales_project_extensions")
      .select("project_id, status, start_date, end_date, tjm_profiles")
      .eq("status", "signed")
      .range(from, to),
  );
}

/** Structure staff and their periods (empty when the table is missing). */
export async function loadStructureStaff(client: SupabaseClient): Promise<StructureEntry[]> {
  const result = await client.from("business_plan_structure").select("employee_id, start_date, end_date");
  if (!result.error) return (result.data || []) as StructureEntry[];
  // Databases without the period migration: whole employment.
  const fallback = await client.from("business_plan_structure").select("employee_id");
  if (fallback.error) throw result.error;
  return (fallback.data || []) as StructureEntry[];
}

/** Adds, updates (entry) or removes (null) a structure listing. */
export async function setStructure(
  client: SupabaseClient,
  employeeId: string,
  entry: StructureEntry | null,
  actorEmail: string,
): Promise<void> {
  const result = entry
    ? await client.from("business_plan_structure").upsert({
        employee_id: employeeId,
        start_date: entry.start_date || null,
        end_date: entry.end_date || null,
        added_by: actorEmail,
      })
    : await client.from("business_plan_structure").delete().eq("employee_id", employeeId);
  if (result.error) throw result.error;
}

/* ── Saved plan ─────────────────────────────────────────────────────── */

export type SavedPlan = {
  year: number;
  hypotheses: Partial<Record<keyof Hypotheses, number>>;
  monthly: { ventes?: (number | null)[]; departs?: (number | null)[] };
  updated_at: string | null;
  updated_by: string;
};

export async function loadSavedPlan(client: SupabaseClient, year: number): Promise<SavedPlan | null> {
  const result = await client
    .from("business_plans")
    .select("year, hypotheses, monthly, updated_at, updated_by")
    .eq("year", year)
    .maybeSingle();
  if (result.error) throw result.error;
  return (result.data as SavedPlan | null) ?? null;
}

export async function saveSavedPlan(
  client: SupabaseClient,
  plan: Omit<SavedPlan, "updated_at">,
): Promise<string> {
  const updated_at = new Date().toISOString();
  const result = await client.from("business_plans").upsert({ ...plan, updated_at });
  if (result.error) throw result.error;
  return updated_at;
}

export type BankRow = {
  id: string;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  line: FixedChargeLine | null;
  amount_ht_cents: number;
  status: string;
  needs_review: boolean;
  label: string;
  counterparty: string;
  settled_at: string | null;
  emitted_at: string | null;
  amount_cents: number;
  ai_line: string | null;
  manual_line: string | null;
  ai_confidence: number | null;
  /** Qonto reference — VAT remittances read "TVA-<période>-3310CA3". */
  reference?: string | null;
  /** VAT on the debit, cents (0 when Qonto has none). */
  vat_cents?: number;
};

/** A VAT payment to the state (CA3/CA12 return), recognised by its Qonto reference. */
export function isVatRemittance(r: Pick<BankRow, "reference">): boolean {
  return /^TVA-/i.test(r.reference ?? "");
}

const bankDate = (r: BankRow) => r.settled_at ?? r.emitted_at ?? "";

/**
 * Fixed charges per month from classified Qonto debits (completed only).
 * A month is covered when it is closed (< openFrom) and not before
 * `coverageStart`; other months are null (the plan falls back to hypotheses).
 */
export function aggregateFixedCharges(
  rows: BankRow[],
  year: number,
  openFrom: number,
  coverageStart: string | null,
): {
  fixed: (FixedActuals | null)[];
  lines: (BankRow[] | null)[];
  review: number[];
  unclassified: (BankRow[] | null)[];
  /** Completed debits Kimi has not classified yet (line null), per covered month; 0 elsewhere. */
  unclassifiedCount: number[];
} {
  const fixed: (FixedActuals | null)[] = [];
  const unclassifiedCount: number[] = [];
  const lines: (BankRow[] | null)[] = [];
  const review: number[] = [];
  const unclassified: (BankRow[] | null)[] = [];
  for (let m = 0; m < 12; m++) {
    const month = `${year}-${pad(m + 1)}-01`;
    if (!(m < openFrom && coverageStart != null && month >= coverageStart)) {
      fixed.push(null); lines.push(null); unclassified.push(null); review.push(0); unclassifiedCount.push(0);
      continue;
    }
    const mine = rows
      .filter((r) => r.status === "completed" && r.month === month)
      .sort((a, b) => bankDate(a).localeCompare(bankDate(b)));
    const cents = { loyer: 0, outils: 0, marketing: 0, honoraires: 0, divers: 0 };
    for (const r of mine) if (r.line && r.line !== "hors_charges_fixes" && !isVatRemittance(r)) cents[r.line] += r.amount_ht_cents;
    fixed.push({
      loyer: cents.loyer / 100, outils: cents.outils / 100, marketing: cents.marketing / 100,
      honoraires: cents.honoraires / 100, divers: cents.divers / 100,
    });
    lines.push(mine);
    unclassified.push(mine.filter((r) => r.line == null || r.line === "hors_charges_fixes"));
    review.push(mine.filter((r) => r.needs_review).length);
    unclassifiedCount.push(mine.filter((r) => r.line == null).length);
  }
  return { fixed, lines, review, unclassified, unclassifiedCount };
}

/**
 * Real VAT cash flows per closed month covered by Qonto (same coverage rule
 * as aggregateFixedCharges; other months are null and get estimated):
 * collected = VAT of invoices paid in the month, deductible = VAT on the
 * month's completed debits, remitted = VAT payments to the state.
 */
export function aggregateVat(
  invoices: InvoiceRow[],
  rows: BankRow[],
  year: number,
  openFrom: number,
  coverageStart: string | null,
): { vat: (VatActual | null)[]; remittances: (BankRow[] | null)[] } {
  const vat: (VatActual | null)[] = [];
  const remittances: (BankRow[] | null)[] = [];
  for (let m = 0; m < 12; m++) {
    const month = `${year}-${pad(m + 1)}-01`;
    if (!(m < openFrom && coverageStart != null && month >= coverageStart)) {
      vat.push(null); remittances.push(null);
      continue;
    }
    const key = month.slice(0, 7);
    let collected = 0;
    for (const inv of invoices)
      if (!inv.ignored && inv.status === "paid" && inv.paid_at?.slice(0, 7) === key) collected += cents(inv.total_vat ?? 0);
    const mine = rows.filter((r) => r.status === "completed" && r.month === month);
    const paid = mine.filter(isVatRemittance).sort((a, b) => bankDate(a).localeCompare(bankDate(b)));
    let deductible = 0;
    for (const r of mine) if (!isVatRemittance(r)) deductible += r.vat_cents ?? 0;
    vat.push({ collected: collected / 100, deductible: deductible / 100, remitted: paid.reduce((t, r) => t + r.amount_cents, 0) / 100 });
    remittances.push(paid);
  }
  return { vat, remittances };
}
