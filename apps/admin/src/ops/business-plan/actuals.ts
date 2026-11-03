/**
 * Real-data side of the business plan: aggregates invoices, staffing, CRA,
 * salaries and exits into per-month actuals, and derives "from data"
 * seeds for the hypotheses. `aggregateActuals` is pure (unit-tested);
 * the loaders below only fetch rows.
 *
 * Conventions (documented on the page footer too):
 * - Structure staff are an explicit list (business_plan_structure);
 *   every other non-freelance employee is a consultant, in inter-contract
 *   when unstaffed. "Salaires structure" = the listed staff employed in the
 *   month × salary × CJM multiplier, measured or projected, prorated on
 *   working days in arrival and exit months.
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
import type { ActualMonth, Hypotheses } from "./model.ts";

export type InvoiceRow = {
  status: string;
  period_month: string | null;
  issue_date: string | null;
  paid_at: string | null;
  total_ht: number | string;
  ignored?: boolean | null;
  /** Optional, for the revenue drill-down. */
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
  /** Employments counted as structure staff, not consultants. */
  structureIds: string[];
};

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
  /** Structure lines only: [worked, total] working days when the month is partial. */
  days?: [number, number];
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
  const inStructure = new Set(src.structureIds);
  const consultants = new Set(src.employees.filter((e) => !inStructure.has(e.id)).map((e) => e.id));
  const staffedRows = src.assignments.filter((a) => STAFFED.includes(a.status));

  // Invoices → revenue by period, collections by payment month (in cents).
  const caByMonth = new Map<string, number>();
  const encByMonth = new Map<string, number>();
  const invByMonth = new Map<string, InvoiceRow[]>();
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
      url: inv.invoice_url ?? null,
    };
  };
  const months: (ActualMonth | null)[] = [];
  const invoiceLines: (InvoiceLine[] | null)[] = [];
  const salaryLines: (SalaryLine[] | null)[] = [];
  const freelanceLines: (FreelanceLine[] | null)[] = [];
  for (let m = 0; m < 12; m++) {
    if (m >= openFrom) {
      months.push(null);
      invoiceLines.push(null);
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
      if (isFree.get(e.id) || !consultants.has(e.id)) continue;
      if (!overlaps(e.start_date, e.end_date, from, to)) continue;
      const s = salaryOn(src.salaries, e.id, to) ?? salaryOn(src.salaries, e.id, from);
      const salary = s?.salary_monthly ?? null;
      const cost = (salary ?? 0) * src.cjmMultiplier;
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
      });
    }
    lines.sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));
    salaryLines.push(lines);

    const ventes = staffedRows.filter((a) => a.start_date >= from && a.start_date <= to).length;
    const departs = src.employees.filter((e) => {
      const exit = e.end_date ?? e.planned_exit_date;
      return consultants.has(e.id) && !!exit && exit >= from && exit <= to;
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

  // Structure staff, every month. Closed months use the salary on file for
  // the month; open months the latest salary known, until the exit date.
  const nowDay = isoDay(today);
  const structureLines: SalaryLine[][] = [];
  for (let m = 0; m < 12; m++) {
    const from = monthStart(year, m), to = monthEnd(year, m);
    const open = m >= openFrom;
    const lines: SalaryLine[] = [];
    for (const e of src.employees) {
      if (!inStructure.has(e.id) || isFree.get(e.id)) continue;
      const end = e.end_date ?? e.planned_exit_date;
      if (!overlaps(e.start_date, end, from, to)) continue;
      const s = salaryOn(src.salaries, e.id, to) ?? salaryOn(src.salaries, e.id, from)
        ?? (open ? salaryOn(src.salaries, e.id, nowDay) : undefined);
      const salary = s?.salary_monthly ?? null;
      // Arrival or exit during the month: prorate on working days.
      const first = e.start_date > from ? e.start_date : from;
      const last = end && end < to ? end : to;
      const total = openDaysBetween(from, to);
      const worked = first === from && last === to ? total : openDaysBetween(first, last);
      const share = total > 0 ? worked / total : 1;
      lines.push({
        employeeId: e.id,
        name: displayName(e),
        contractType: e.contract_type || "",
        salary,
        cost: (salary ?? 0) * src.cjmMultiplier * share,
        staffed: false,
        exitDate: end,
        ...(worked < total ? { days: [worked, total] as [number, number] } : {}),
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
      return consultants.has(e.id) && e.status !== "ended" && !!exit && exit >= from && exit <= to;
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
  const currentSalaried: SalaryLine[] = src.employees
    .filter((e) => !isFree.get(e.id) && consultants.has(e.id) && e.status !== "ended" && overlaps(e.start_date, e.end_date, now, now))
    .map((e) => {
      const salary = salaryOn(src.salaries, e.id, now)?.salary_monthly ?? null;
      return {
        employeeId: e.id,
        name: displayName(e),
        contractType: e.contract_type || "",
        salary,
        cost: (salary ?? 0) * src.cjmMultiplier,
        staffed: staffedToday.has(e.id),
        exitDate: e.end_date ?? e.planned_exit_date,
      };
    })
    .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name));

  const currentFreelancers: FreelanceLine[] = src.employees
    .filter((e) => isFree.get(e.id) && consultants.has(e.id) && e.status !== "ended" && overlaps(e.start_date, e.end_date, now, now))
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

  return { months, seeds, plannedDeparts, avgVentes: Math.round(recentStarts / 12), salaryLines, currentSalaried, freelanceLines, currentFreelancers, invoiceLines, structure, structureLines };
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
      .select("id, number, status, period_month, issue_date, paid_at, total_ht, ignored, project_id, billed_client_id, employee_id, invoice_url")
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

/** Employment ids listed as structure staff (empty when the table is missing). */
export async function loadStructureIds(client: SupabaseClient): Promise<string[]> {
  const result = await client.from("business_plan_structure").select("employee_id");
  if (result.error) throw result.error;
  return ((result.data || []) as { employee_id: string }[]).map((r) => r.employee_id);
}

export async function setStructure(client: SupabaseClient, employeeId: string, on: boolean, actorEmail: string): Promise<void> {
  const result = on
    ? await client.from("business_plan_structure").upsert({ employee_id: employeeId, added_by: actorEmail })
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
