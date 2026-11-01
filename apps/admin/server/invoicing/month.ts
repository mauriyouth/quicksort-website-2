import { frenchHolidays } from "../../src/cra/domain.ts";
import { buildDraftLines, monthPeriod, projectDayAmounts } from "./draft.ts";
import type { AssignmentRef, CraEntry, ExtensionRef, ProductRef, ProjectRef } from "./draft.ts";
import type { InvoiceStatus } from "./provider.ts";

export type InvoiceRowRef = {
  id: string; project_id: string | null; employee_id: string | null; period_month: string | null;
  status: InvoiceStatus; source: "cra" | "imported"; cra_version: number | null; total_ht: number; number: string | null;
};
export type ToInvoiceRow = {
  projectId: string; projectTitle: string; employeeId: string; personId: string | null; consultantName: string;
  billedClientId: string; billedClientName: string; days: number; amountHt: string | null;
  status: "not_invoiced" | InvoiceStatus; invoiceId: string | null; craChanged: boolean;
  blockers: ("client_not_linked" | "no_pricing_line" | "no_rate" | "product_not_linked")[];
  warnings: "cra_incomplete"[];
};

export function missingWorkingDays(
  month: string,
  entries: CraEntry[],
  employment: { start_date: string; end_date: string | null },
): string[] {
  const { start, end } = monthPeriod(month);
  const holidays = frenchHolidays(Number(month.slice(0, 4)));
  const cover = new Map<string, { full: boolean; am: boolean; pm: boolean }>();
  for (const e of entries) {
    const c = cover.get(e.day) ?? { full: false, am: false, pm: false };
    c[e.part] = true;
    cover.set(e.day, c);
  }
  const out: string[] = [];
  const last = Number(end.slice(8, 10));
  for (let d = 1; d <= last; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidays[day]) continue;
    if (day < employment.start_date || (employment.end_date && day > employment.end_date)) continue;
    const c = cover.get(day);
    if (c && (c.full || (c.am && c.pm))) continue;
    out.push(day);
  }
  return out;
}

export function toInvoiceRows(input: {
  month: string;
  startMonth: string | null;
  employees: { id: string; person_id?: string | null; full_name: string; start_date: string; end_date: string | null }[];
  craByEmployee: Record<string, { version: number; entries: CraEntry[] }>;
  assignments: AssignmentRef[];
  projects: (ProjectRef & { title: string; pricing_model: string; client_id: string; intermediary_client_id: string | null })[];
  extensionsByProject: Record<string, ExtensionRef[]>;
  clients: { id: string; name: string }[];
  linkedClientIds: Set<string>;
  productsByProject: Record<string, Record<string, ProductRef>>;
  invoices: InvoiceRowRef[];
}): ToInvoiceRow[] {
  if (!input.startMonth || input.month < input.startMonth.slice(0, 7)) return [];
  const rows: ToInvoiceRow[] = [];
  for (const emp of input.employees) {
    const cra = input.craByEmployee[emp.id];
    if (!cra) continue;
    const incomplete = missingWorkingDays(input.month, cra.entries, emp).length > 0;
    for (const project of input.projects) {
      if (project.pricing_model !== "regie") continue;
      const days = projectDayAmounts(cra.entries, project.id).reduce((s, d) => s + d.amount, 0);
      if (days <= 0) continue;
      const billedClientId = project.intermediary_client_id ?? project.client_id;
      const blockers: ToInvoiceRow["blockers"] = [];
      if (!input.linkedClientIds.has(billedClientId)) blockers.push("client_not_linked");
      const built = buildDraftLines({
        month: input.month,
        consultantName: emp.full_name,
        projectId: project.id,
        entries: cra.entries,
        assignments: input.assignments.filter((a) => a.employee_id === emp.id),
        project,
        extensions: input.extensionsByProject[project.id] ?? [],
        products: input.productsByProject[project.id] ?? {},
      });
      let amountHt: string | null = null;
      if (built.ok) amountHt = built.totals.ht;
      else if (built.blocker !== "no_days") blockers.push(built.blocker);
      // The CRA invoice, else a Qonto import linked to this consultant-month.
      const covers = (i: InvoiceRowRef) => i.status !== "canceled" && i.project_id === project.id &&
        i.employee_id === emp.id && (i.period_month ?? "").slice(0, 7) === input.month;
      const invoice = input.invoices.find((i) => i.source === "cra" && covers(i)) ?? input.invoices.find((i) => i.source === "imported" && covers(i));
      rows.push({
        projectId: project.id,
        projectTitle: project.title,
        employeeId: emp.id,
        personId: emp.person_id ?? null,
        consultantName: emp.full_name,
        billedClientId,
        billedClientName: input.clients.find((c) => c.id === billedClientId)?.name ?? "",
        days,
        amountHt,
        status: invoice ? invoice.status : "not_invoiced",
        invoiceId: invoice ? invoice.id : null,
        craChanged: !!invoice && invoice.source === "cra" && invoice.cra_version !== cra.version,
        blockers,
        warnings: incomplete ? ["cra_incomplete"] : [],
      });
    }
  }
  return rows;
}
