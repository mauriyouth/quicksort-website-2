import { storedPricingLines } from "../../src/sales/pricing-lines.ts";
import type { DraftLine } from "./provider.ts";

export type CraEntry = { day: string; part: "full" | "am" | "pm"; status: string; project_id: string | null };
export type AssignmentRef = { project_id: string; employee_id: string; pricing_line: string; start_date: string; end_date: string | null; status: string };
export type ProjectRef = { id: string; tjm_profiles: unknown; currency: string };
export type ExtensionRef = { start_date: string | null; status: string; tjm_profiles: unknown };
export type ProductRef = { title: string; description: string; unit: string; vat_rate: number };
export type BuiltLine = DraftLine & { pricingLine: string; computedQuantity: number; computedUnitPrice: number };
export type DraftResult =
  | { ok: true; lines: BuiltLine[]; totals: { ht: string; vat: string; ttc: string } }
  | { ok: false; blocker: "no_days" | "no_pricing_line" | "no_rate" | "product_not_linked"; pricingLine?: string };

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const BILLABLE_STATUSES = new Set(["confirmed", "active", "completed"]);

export function monthLabelFr(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_FR[Number(m) - 1] ?? m} ${y}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function monthPeriod(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function projectDayAmounts(entries: CraEntry[], projectId: string): { day: string; amount: number }[] {
  const byDay = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "client_project" || e.project_id !== projectId) continue;
    byDay.set(e.day, (byDay.get(e.day) ?? 0) + (e.part === "full" ? 1 : 0.5));
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, amount]) => ({ day, amount }));
}

export function resolvePricingLine(assignment: AssignmentRef, project: ProjectRef): string | null {
  if (assignment.pricing_line) return assignment.pricing_line;
  const lines = storedPricingLines(project.tjm_profiles);
  return lines.length === 1 ? lines[0].name : null;
}

export function rateOn(day: string, pricingLine: string, project: ProjectRef, extensions: ExtensionRef[]): number | null {
  const candidates = extensions
    .filter((x) => x.status === "signed" && x.start_date && x.start_date <= day)
    .filter((x) => storedPricingLines(x.tjm_profiles).some((l) => l.name === pricingLine))
    .sort((a, b) => ((a.start_date as string) < (b.start_date as string) ? 1 : -1));
  const source = candidates.length ? candidates[0].tjm_profiles : project.tjm_profiles;
  const line = storedPricingLines(source).find((l) => l.name === pricingLine);
  return line ? line.tjm : null;
}

export function draftTotals(lines: DraftLine[]): { ht: string; vat: string; ttc: string } {
  let ht = 0;
  let vat = 0;
  for (const l of lines) {
    // Integer arithmetic only (half-up rounding) to avoid float drift.
    const qm = Math.round(Number(l.quantity) * 1e4);
    const pc = Math.round(Number(l.unitPrice) * 100);
    const bp = Math.round(Number(l.vatRate) * 10000);
    const lineHt = Math.floor((qm * pc + 5000) / 10000);
    ht += lineHt;
    vat += Math.floor((lineHt * bp * 2 + 10000) / 20000);
  }
  const f = (c: number) => (c / 100).toFixed(2);
  return { ht: f(ht), vat: f(vat), ttc: f(ht + vat) };
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtQty = (n: number) => String(Math.round(n * 10) / 10);

export function buildDraftLines(input: {
  month: string;
  consultantName: string;
  projectId: string;
  entries: CraEntry[];
  assignments: AssignmentRef[];
  project: ProjectRef;
  extensions: ExtensionRef[];
  products: Record<string, ProductRef>;
}): DraftResult {
  const days = projectDayAmounts(input.entries, input.projectId);
  if (!days.length) return { ok: false, blocker: "no_days" };

  type Group = { pricingLine: string; rate: number; qty: number; first: string; last: string };
  const groups: Group[] = [];
  for (const { day, amount } of days) {
    const assignment = input.assignments.find(
      (a) =>
        a.project_id === input.projectId &&
        BILLABLE_STATUSES.has(a.status) &&
        a.start_date <= day &&
        (!a.end_date || a.end_date >= day),
    );
    const pricingLine = assignment ? resolvePricingLine(assignment, input.project) : null;
    if (!pricingLine) return { ok: false, blocker: "no_pricing_line" };
    const rate = rateOn(day, pricingLine, input.project, input.extensions);
    if (rate === null) return { ok: false, blocker: "no_rate", pricingLine };
    const g = groups.find((x) => x.pricingLine === pricingLine && x.rate === rate);
    if (g) {
      g.qty += amount;
      g.last = day;
    } else {
      groups.push({ pricingLine, rate, qty: amount, first: day, last: day });
    }
  }

  const label = monthLabelFr(input.month);
  const lines: BuiltLine[] = [];
  for (const g of groups) {
    const product = input.products[g.pricingLine];
    if (!product) return { ok: false, blocker: "product_not_linked", pricingLine: g.pricingLine };
    const multi = groups.filter((x) => x.pricingLine === g.pricingLine).length > 1;
    const range = multi ? ` (du ${ddmm(g.first)} au ${ddmm(g.last)})` : "";
    lines.push({
      title: product.title.slice(0, 40),
      // The Qonto service's own text wins; the consultant line only fills an empty description.
      description: `${product.description || `Consultant : ${input.consultantName} — ${label}`}${range}`,
      quantity: fmtQty(g.qty),
      unit: product.unit,
      unitPrice: g.rate.toFixed(2),
      vatRate: String(product.vat_rate),
      pricingLine: g.pricingLine,
      computedQuantity: g.qty,
      computedUnitPrice: g.rate,
    });
  }
  return { ok: true, lines, totals: draftTotals(lines) };
}
