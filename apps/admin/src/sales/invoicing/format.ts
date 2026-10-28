import type { Blocker, Invoice, InvoiceStatus, RowWarning } from "./types";

export type StatusLabel = "Draft" | "Validated" | "Overdue" | "Paid" | "Canceled";

/** Today in Paris (YYYY-MM-DD), the same calendar the server uses. */
export function parisToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function invoiceStatusLabel(status: InvoiceStatus, dueDate: string | null | undefined): StatusLabel {
  if (status === "draft") return "Draft";
  if (status === "paid") return "Paid";
  if (status === "canceled") return "Canceled";
  return dueDate && dueDate.slice(0, 10) < parisToday() ? "Overdue" : "Validated";
}

/** Status label for a list row: a CRA draft without a Qonto id is an interrupted create. */
export function invoiceRowLabel(inv: Pick<Invoice, "status" | "due_date" | "provider_invoice_id">): string {
  if (inv.status === "draft" && !inv.provider_invoice_id) return "Draft (not in Qonto)";
  return invoiceStatusLabel(inv.status, inv.due_date);
}

export function sourceLabel(source: Invoice["source"]): string {
  return source === "cra" ? "CRA" : "Qonto import";
}

const BLOCKERS: Record<Blocker | RowWarning, string> = {
  client_not_linked: "Link this client to Qonto",
  no_pricing_line: "Pick a pricing line on the staffing",
  no_rate: "No TJM for these dates",
  product_not_linked: "Link this pricing line to a Qonto service",
  cra_incomplete: "CRA has unfilled working days",
};
export function blockerLabel(blocker: Blocker | RowWarning | string): string {
  return BLOCKERS[blocker as Blocker] ?? "This draft cannot be created yet";
}

export function money(value: number | string | null | undefined, currency = "EUR"): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0);
}

export function days(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} j`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function monthLabel(month: string | null | undefined): string {
  if (!month) return "—";
  const d = new Date(`${month.slice(0, 7)}-01T12:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function previousMonth(): string {
  return shiftMonth(parisToday().slice(0, 7), -1);
}

/** Same integer arithmetic as the server's draftTotals (half-up, per-line VAT). */
export function lineTotals(lines: { quantity: number | string; unitPrice: number | string; vatRate: number | string }[]) {
  let ht = 0, vat = 0;
  for (const l of lines) {
    const qm = Math.round(Number(l.quantity) * 1e4);
    const pc = Math.round(Number(l.unitPrice) * 100);
    const bp = Math.round(Number(l.vatRate) * 10000);
    if (!Number.isFinite(qm) || !Number.isFinite(pc) || !Number.isFinite(bp)) continue;
    const lineHt = Math.floor((qm * pc + 5000) / 10000);
    ht += lineHt;
    vat += Math.floor((lineHt * bp * 2 + 10000) / 20000);
  }
  return { ht: ht / 100, vat: vat / 100, ttc: (ht + vat) / 100 };
}
