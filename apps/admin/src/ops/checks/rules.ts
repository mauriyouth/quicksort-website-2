/**
 * Operations → Checks: data consistency across CRA, staffing, invoices and
 * payslips. `monthChecks` and `openChecks` are pure (unit-tested); the page
 * only loads rows and renders the issues.
 *
 * Rules:
 * - A month is "closed" once today is past it. Invoices and payslips are only
 *   expected for closed months; the current month's CRA is checked up to
 *   yesterday.
 * - Everyone employed during the month files a CRA (freelancers included).
 * - A CRA client day needs a confirmed / active / completed staffing on that
 *   project covering the day.
 * - Every consultant-month with client days on a régie project needs a
 *   non-canceled invoice for that project, consultant and service month
 *   (from the invoicing start month on, when one is set).
 */
import { frenchHolidays } from "../../cra/domain.ts";
import { payrollMonth, type FiledPayslipDoc, type StaffEmployment } from "../../payslips/month.ts";

export type CheckKind =
  | "cra_missing"
  | "cra_incomplete"
  | "cra_unstaffed_days"
  | "cra_outside_employment"
  | "staffed_no_days"
  | "invoice_missing"
  | "invoice_draft"
  | "invoice_cra_changed"
  | "invoice_without_days"
  | "payslip_missing"
  | "invoice_unassigned"
  | "invoice_overdue";

export type CheckGroup = "cra" | "invoices" | "payslips";
export type Severity = "error" | "warning";

export const CHECK_META: Record<CheckKind, { group: CheckGroup; severity: Severity; label: string }> = {
  cra_missing: { group: "cra", severity: "error", label: "CRA missing" },
  cra_incomplete: { group: "cra", severity: "warning", label: "CRA incomplete" },
  cra_unstaffed_days: { group: "cra", severity: "error", label: "Days on an unstaffed project" },
  cra_outside_employment: { group: "cra", severity: "error", label: "Days outside employment" },
  staffed_no_days: { group: "cra", severity: "warning", label: "Staffed, no days logged" },
  invoice_missing: { group: "invoices", severity: "error", label: "Invoice missing" },
  invoice_draft: { group: "invoices", severity: "warning", label: "Invoice still a draft" },
  invoice_cra_changed: { group: "invoices", severity: "warning", label: "CRA changed after invoicing" },
  invoice_without_days: { group: "invoices", severity: "warning", label: "Invoice without CRA days" },
  payslip_missing: { group: "payslips", severity: "error", label: "Payslip missing" },
  invoice_unassigned: { group: "invoices", severity: "warning", label: "Invoice not fully linked" },
  invoice_overdue: { group: "invoices", severity: "error", label: "Payment overdue" },
};

export type Issue = {
  /** Stable key for React lists. */
  key: string;
  kind: CheckKind;
  /** "YYYY-MM" the issue belongs to, null for open (cross-month) issues. */
  month: string | null;
  personId: string | null;
  name: string;
  projectId: string | null;
  projectTitle: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  detail: string;
};

export type CheckEmployee = { id: string; person_id: string; contract_type?: string | null; start_date: string; end_date: string | null };
export type CheckAssignment = { employee_id: string; project_id: string; start_date: string; end_date: string | null; status: string };
export type CheckProject = { id: string; title: string; pricing_model: string };
export type CheckCra = { employee_id: string; day: string; part?: string | null; status: string; project_id: string | null };
export type CheckCraMonth = { employee_id: string; month: string; version: number | string };
export type CheckInvoice = {
  id: string;
  number: string | null;
  status: string;
  source: string;
  project_id: string | null;
  employee_id: string | null;
  period_month: string | null;
  cra_version: number | string | null;
  due_date: string | null;
  issue_date: string | null;
  total_ht: number | string;
  ignored: boolean | null;
  invoice_url: string | null;
};

export type CheckSources = {
  employees: CheckEmployee[];
  people: { id: string; full_name: string }[];
  assignments: CheckAssignment[];
  projects: CheckProject[];
  cra: CheckCra[];
  craMonths: CheckCraMonth[];
  invoices: CheckInvoice[];
  /** Payroll, when it could be loaded (null skips the payslip checks). */
  payroll: { staff: StaffEmployment[]; payslips: FiledPayslipDoc[] } | null;
  /** First "YYYY-MM" invoices are expected for (invoicing start month), null = every month. */
  invoicingStart: string | null;
  /** First "YYYY-MM" CRA rows were loaded for; earlier months are not checked. */
  craFrom: string;
};

const STAFFED = new Set(["confirmed", "active", "completed"]);
const pad = (n: number) => String(n).padStart(2, "0");

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

const lastDay = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

/** Working days (Mon–Fri, not a French public holiday) between two ISO days, inclusive. */
export function workingDays(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  const holidays: Record<string, Record<string, string>> = {};
  for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) break;
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const year = day.slice(0, 4);
    holidays[year] ??= frenchHolidays(Number(year));
    if (holidays[year][day]) continue;
    out.push(day);
  }
  return out;
}

const dayAmount = (part: string | null | undefined) => (part === "am" || part === "pm" ? 0.5 : 1);
const fmtDays = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
function listDays(days: string[]): string {
  const shown = days.slice(0, 5).map(shortDay).join(", ");
  return days.length > 5 ? `${shown} +${days.length - 5}` : shown;
}

function blank(kind: CheckKind, month: string | null, key: string): Issue {
  return { key: `${kind}:${month ?? "open"}:${key}`, kind, month, personId: null, name: "", projectId: null, projectTitle: "", invoiceId: null, invoiceNumber: null, invoiceUrl: null, detail: "" };
}

function context(src: CheckSources) {
  const names = new Map(src.people.map((p) => [p.id, p.full_name]));
  const employees = new Map(src.employees.map((e) => [e.id, e]));
  const projects = new Map(src.projects.map((p) => [p.id, p]));
  const person = (employeeId: string | null) => {
    const e = employeeId ? employees.get(employeeId) : undefined;
    return { personId: e?.person_id ?? null, name: (e && names.get(e.person_id)) || "Unknown person" };
  };
  return { employees, projects, person };
}

/** Issues for one "YYYY-MM" month. `today` is an ISO day. */
export function monthChecks(month: string, src: CheckSources, today: string): Issue[] {
  const current = today.slice(0, 7);
  if (month > current || month < src.craFrom) return [];
  const closed = month < current;
  const start = `${month}-01`;
  const end = lastDay(month);
  // The current month is checked up to yesterday.
  const until = closed ? end : new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const { projects, person } = context(src);
  const issues: Issue[] = [];

  const entriesByEmployee = new Map<string, CheckCra[]>();
  for (const e of src.cra) {
    if (e.day < start || e.day > end) continue;
    const list = entriesByEmployee.get(e.employee_id) ?? [];
    list.push(e);
    entriesByEmployee.set(e.employee_id, list);
  }

  // ── CRA ──
  for (const emp of src.employees) {
    const from = emp.start_date > start ? emp.start_date : start;
    const to = emp.end_date && emp.end_date < until ? emp.end_date : until;
    const expected = workingDays(from, to);
    const entries = entriesByEmployee.get(emp.id) ?? [];
    const who = person(emp.id);
    if (!entries.length) {
      if (expected.length) {
        issues.push({ ...blank("cra_missing", month, emp.id), ...who, detail: `${fmtDays(expected.length)} to report${closed ? "" : " so far"}.` });
      }
      continue;
    }
    const cover = new Map<string, number>();
    for (const e of entries) cover.set(e.day, (cover.get(e.day) ?? 0) + dayAmount(e.part));
    const missing = expected.filter((d) => (cover.get(d) ?? 0) < 1);
    if (missing.length) {
      issues.push({ ...blank("cra_incomplete", month, emp.id), ...who, detail: `${fmtDays(missing.length)} not filled: ${listDays(missing)}.` });
    }
    const outside = [...new Set(entries.map((e) => e.day))]
      .filter((d) => d < emp.start_date || (!!emp.end_date && d > emp.end_date))
      .sort();
    if (outside.length) {
      issues.push({ ...blank("cra_outside_employment", month, emp.id), ...who, detail: `${fmtDays(outside.length)} logged outside the employment (${emp.start_date} → ${emp.end_date ?? "…"}): ${listDays(outside)}.` });
    }
    // Client days with no staffing covering them, per project.
    const unstaffed = new Map<string, string[]>();
    for (const e of entries) {
      if (e.status !== "client_project" || !e.project_id) continue;
      const staffed = src.assignments.some((a) =>
        a.employee_id === emp.id && a.project_id === e.project_id && STAFFED.has(a.status) &&
        a.start_date <= e.day && (!a.end_date || a.end_date >= e.day));
      if (!staffed) unstaffed.set(e.project_id, [...(unstaffed.get(e.project_id) ?? []), e.day]);
    }
    for (const [projectId, days] of unstaffed) {
      issues.push({
        ...blank("cra_unstaffed_days", month, `${emp.id}:${projectId}`), ...who, projectId, projectTitle: projects.get(projectId)?.title ?? "Unknown project",
        detail: `${fmtDays(days.length)} on a project without a confirmed staffing those days: ${listDays(days.sort())}.`,
      });
    }
  }

  // Staffed on a régie project for the closed month, CRA filed, but no day on it.
  if (closed) {
    const seen = new Set<string>();
    for (const a of src.assignments) {
      if (!STAFFED.has(a.status)) continue;
      const project = projects.get(a.project_id);
      if (!project || project.pricing_model !== "regie") continue;
      const key = `${a.employee_id}:${a.project_id}`;
      if (seen.has(key)) continue;
      const from = a.start_date > start ? a.start_date : start;
      const to = a.end_date && a.end_date < end ? a.end_date : end;
      if (!workingDays(from, to).length) continue;
      const entries = entriesByEmployee.get(a.employee_id);
      if (!entries?.length) continue; // reported as a missing CRA
      if (entries.some((e) => e.project_id === a.project_id)) continue;
      seen.add(key);
      issues.push({
        ...blank("staffed_no_days", month, key), ...person(a.employee_id), projectId: a.project_id, projectTitle: project.title,
        detail: `Staffed ${from} → ${to} but the CRA has no day on this project.`,
      });
    }
  }

  // ── Invoices ──
  const live = src.invoices.filter((i) => i.status !== "canceled" && !i.ignored && (i.period_month ?? "").slice(0, 7) === month);
  if (closed && (!src.invoicingStart || month >= src.invoicingStart)) {
    const days = new Map<string, number>();
    for (const [employeeId, entries] of entriesByEmployee) {
      for (const e of entries) {
        if (e.status !== "client_project" || !e.project_id) continue;
        if (projects.get(e.project_id)?.pricing_model !== "regie") continue;
        const key = `${employeeId}:${e.project_id}`;
        days.set(key, (days.get(key) ?? 0) + dayAmount(e.part));
      }
    }
    for (const [key, n] of days) {
      const [employeeId, projectId] = key.split(":");
      if (live.some((i) => i.project_id === projectId && i.employee_id === employeeId)) continue;
      issues.push({
        ...blank("invoice_missing", month, key), ...person(employeeId), projectId, projectTitle: projects.get(projectId)?.title ?? "Unknown project",
        detail: `${fmtDays(n)} in the CRA, no invoice for this consultant and month.`,
      });
    }
  }
  const versions = new Map(src.craMonths.filter((m) => m.month.slice(0, 7) === month).map((m) => [m.employee_id, Number(m.version)]));
  for (const inv of live) {
    const base = {
      ...person(inv.employee_id), projectId: inv.project_id,
      projectTitle: inv.project_id ? (projects.get(inv.project_id)?.title ?? "Unknown project") : "",
      invoiceId: inv.id, invoiceNumber: inv.number, invoiceUrl: inv.invoice_url,
    };
    if (closed && inv.status === "draft") {
      issues.push({ ...blank("invoice_draft", month, inv.id), ...base, detail: "Finalize and send it, or delete it." });
    }
    if (inv.source === "cra" && inv.employee_id && inv.cra_version != null && versions.has(inv.employee_id) &&
        Number(inv.cra_version) !== versions.get(inv.employee_id)) {
      issues.push({ ...blank("invoice_cra_changed", month, inv.id), ...base, detail: `Invoiced from CRA version ${inv.cra_version}, the CRA is now at version ${versions.get(inv.employee_id)}.` });
    }
    if (inv.project_id && inv.employee_id && projects.get(inv.project_id)?.pricing_model === "regie") {
      const logged = (entriesByEmployee.get(inv.employee_id) ?? []).some((e) => e.project_id === inv.project_id);
      if (!logged) {
        issues.push({ ...blank("invoice_without_days", month, inv.id), ...base, detail: "The consultant's CRA has no day on this project for the month." });
      }
    }
  }

  // ── Payslips ──
  if (closed && src.payroll) {
    for (const r of payrollMonth(month, src.payroll.staff, src.payroll.payslips)) {
      if (!r.employed || r.payslips.length) continue;
      issues.push({ ...blank("payslip_missing", month, r.personId), personId: r.personId, name: r.name, detail: "No payslip filed for this month." });
    }
  }

  return issues;
}

/** Issues that are not tied to a month: overdue payments, invoices not linked. */
export function openChecks(src: CheckSources, today: string): Issue[] {
  const { projects, person } = context(src);
  const issues: Issue[] = [];
  for (const inv of src.invoices) {
    if (inv.ignored || inv.status === "canceled") continue;
    const base = {
      ...(inv.employee_id ? person(inv.employee_id) : { personId: null, name: "" }), projectId: inv.project_id,
      projectTitle: inv.project_id ? (projects.get(inv.project_id)?.title ?? "Unknown project") : "",
      invoiceId: inv.id, invoiceNumber: inv.number, invoiceUrl: inv.invoice_url,
    };
    if (inv.status === "finalized" && inv.due_date && inv.due_date < today) {
      const late = Math.round((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
      issues.push({ ...blank("invoice_overdue", null, inv.id), ...base, detail: `Due ${inv.due_date}, ${late} day${late === 1 ? "" : "s"} late · ${Number(inv.total_ht).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} € HT.` });
    }
    if (inv.status === "draft") continue;
    // Régie invoices are matched to a consultant-month; others only need a project.
    const regie = !!inv.project_id && projects.get(inv.project_id)?.pricing_model === "regie";
    const gaps = [!inv.project_id && "project", regie && !inv.employee_id && "consultant", regie && !inv.period_month && "service month"].filter(Boolean);
    if (gaps.length) {
      issues.push({ ...blank("invoice_unassigned", null, inv.id), ...base, detail: `No ${gaps.join(", ")} set${inv.issue_date ? ` · issued ${inv.issue_date}` : ""}.` });
    }
  }
  return issues;
}
