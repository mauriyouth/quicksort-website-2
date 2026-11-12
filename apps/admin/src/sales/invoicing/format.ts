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

// fr-FR groups thousands with a narrow no-break space (U+202F), which reads
// as "626500,00 €" at UI sizes; widen it to a full no-break space.
const widen = (s: string) => s.replace(/ /g, " ");

export function money(value: number | string | null | undefined, currency = "EUR"): string {
  const n = Number(value ?? 0);
  return widen(new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0));
}

/** Daily rates read in whole euros (650 €); cents only when there are any. */
export function rate(value: number): string {
  return widen(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })
    .format(value));
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

// Row click/Enter opens the invoice; clicks on the row's own links and controls keep their action.
export function rowOpener(open: () => void, disabled = false) {
  const inControl = (t: EventTarget) => t instanceof Element && !!t.closest("a, button, input, select, textarea, label");
  return {
    tabIndex: 0,
    onClick: (e: { target: EventTarget }) => { if (!disabled && !inControl(e.target)) open(); },
    onKeyDown: (e: { key: string; target: EventTarget; currentTarget: EventTarget; preventDefault: () => void }) => {
      if (disabled || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      open();
    },
  };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// Billing months offered for an invoice: its issue month and the 12 before, newest first; a stored month outside that range stays listed.
export function billingMonthOptions(issueDate: string | null | undefined, stored: string | null | undefined): string[] {
  const anchor = (issueDate ?? parisToday()).slice(0, 7);
  const months = Array.from({ length: 13 }, (_, n) => shiftMonth(anchor, -n));
  const current = (stored ?? "").slice(0, 7);
  return current && !months.includes(current) ? [...months, current].sort().reverse() : months;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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
