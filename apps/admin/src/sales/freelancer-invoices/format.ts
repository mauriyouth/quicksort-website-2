import type { InvoiceView, MonthRow } from "./api";

/** Euros from cents, en-GB like the rest of the copy: €8,450, or €8,450.50 when there are cents. */
export function euro(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const value = cents / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
  }).format(value);
}

/** "2 Nov" */
export function dayMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  // A plain date is a calendar day; a timestamp reads as the day in Paris, like the server.
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: iso.length === 10 ? "UTC" : "Europe/Paris" });
}

export function dayCount(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} d`;
}

/** Euros typed by an admin ("8450", "8 450,50") to cents; "" is null, anything else undefined (invalid). */
export function parseEuros(text: string): number | null | undefined {
  const s = text.replace(/[\s  €]/g, "").replace(",", ".");
  if (!s) return null;
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

export function centsInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

export type Tone = "ok" | "warning" | "danger" | "muted";

/** The CRA check cell of mockup A: "✓ 12 d × €700" or "⚠ CRA says €8,450 (13 d × €650)". */
export function craCheck(row: MonthRow | null): { text: string; tone: Tone } {
  if (!row) return { text: "No period set", tone: "muted" };
  if (row.missingRate) return { text: "No TJM on file", tone: "warning" };
  const { check, expected } = row;
  if (check.reason === "unreadable") return { text: "Amount unreadable", tone: "warning" };
  if (check.reason === "no_cra" || !expected) return { text: "No CRA filed", tone: "muted" };
  const single = new Set(row.rates.map((r) => r.dailyRate)).size === 1 ? row.rates[0].dailyRate : null;
  const days = dayCount(expected.days);
  if (check.ok) return { text: single != null ? `✓ ${days} × ${euro(single * 100)}` : `✓ ${days} · ${euro(expected.cents)}`, tone: "ok" };
  return { text: `⚠ CRA says ${euro(expected.cents)} (${single != null ? `${days} × ${euro(single * 100)}` : days})`, tone: "warning" };
}

/** The Status cell: "Paid 8 Nov", "To pay · due 4 Dec" (danger when overdue), "To check", "Rejected". */
export function statusCell(inv: InvoiceView): { text: string; tone: Tone } {
  const d = inv.display;
  if (d.status === "paid") return { text: `Paid ${dayMonth(inv.paidAt)}`, tone: "ok" };
  if (d.status === "rejected") return { text: "Rejected", tone: "muted" };
  if (d.status === "to_check") return { text: "To check", tone: "warning" };
  return { text: inv.dueDate ? `To pay · due ${dayMonth(inv.dueDate)}` : "To pay", tone: d.overdue ? "danger" : "muted" };
}

export const FLAG_LABELS: Record<string, string> = {
  unreadable: "Couldn't read the amount or period",
  not_invoice: "May not be an invoice",
  iban_changed: "IBAN differs from the billing details",
};

export const EVENT_LABELS: Record<string, string> = {
  received: "Received",
  duplicate_received: "Duplicate received",
  fields_updated: "Details edited",
  difference_accepted: "Difference accepted",
  rejected: "Rejected",
  match_suggested: "Payment suggested",
  match_dismissed: "Suggestion dismissed",
  paid_confirmed: "Payment confirmed",
  paid_linked: "Payment linked",
  paid_unlinked: "Payment unlinked",
  paid_auto: "Paid (matched automatically)",
  review_auto_ok: "Approved (CRA matches)",
  billing_prefilled: "Billing details filled from the payment",
  billing_cleared: "Billing details from the payment cleared",
};
