import type { CraDay, FreelancerInvoice, RateRow } from "./types.ts";

const MATCH_TOLERANCE_CENTS = 100; // |diff| < 1 EUR

function rateOn(day: string, rates: RateRow[]): number | null {
  let best: RateRow | null = null;
  for (const r of rates) {
    if (r.rateKind !== "daily" || r.dailyRate == null) continue;
    if (r.startDate > day || (r.endDate != null && r.endDate < day)) continue;
    if (!best || r.startDate > best.startDate) best = r;
  }
  return best ? (best.dailyRate as number) : null;
}

export function expectedCraCents(days: CraDay[], rates: RateRow[]): { days: number; cents: number; missingRate: boolean } {
  let total = 0;
  let cents = 0;
  let missingRate = false;
  for (const d of days) {
    if (d.status !== "client_project") continue;
    const weight = d.part === "full" ? 1 : 0.5;
    total += weight;
    const rate = rateOn(d.day, rates);
    if (rate == null) {
      missingRate = true;
      continue;
    }
    cents += Math.round(weight * rate * 100);
  }
  return { days: total, cents, missingRate };
}

export function monthCheck(
  invoices: FreelancerInvoice[],
  expected: { cents: number; days: number } | null,
): {
  invoicedHtCents: number;
  expectedCents: number | null;
  diffCents: number | null;
  ok: boolean;
  reason: "match" | "mismatch" | "no_cra" | "unreadable";
} {
  const live = invoices.filter((i) => i.review !== "rejected");
  let invoicedHtCents = 0;
  let unreadable = false;
  for (const i of live) {
    if (i.amountHtCents == null) {
      unreadable = true;
      continue;
    }
    invoicedHtCents += i.isCreditNote ? -Math.abs(i.amountHtCents) : i.amountHtCents;
  }
  const expectedCents = expected ? expected.cents : null;
  if (unreadable) {
    return { invoicedHtCents, expectedCents, diffCents: null, ok: false, reason: "unreadable" };
  }
  if (!expected) {
    return { invoicedHtCents, expectedCents: null, diffCents: null, ok: false, reason: "no_cra" };
  }
  const diffCents = Math.abs(invoicedHtCents - expected.cents);
  const ok = diffCents < MATCH_TOLERANCE_CENTS;
  return { invoicedHtCents, expectedCents, diffCents, ok, reason: ok ? "match" : "mismatch" };
}

export function displayStatus(
  inv: FreelancerInvoice,
  monthOk: boolean,
  today: string,
): { status: "to_check" | "to_pay" | "paid" | "rejected"; warning: boolean; overdue: boolean } {
  const warning = !monthOk;
  if (inv.review === "rejected") return { status: "rejected", warning, overdue: false };
  if (inv.paidAt) return { status: "paid", warning, overdue: false };
  if (inv.review === "to_check") return { status: "to_check", warning, overdue: false };
  return { status: "to_pay", warning, overdue: inv.dueDate != null && inv.dueDate < today };
}

export function dueDate(issueDate: string | null, printedDue: string | null): string | null {
  if (printedDue) return printedDue;
  if (!issueDate) return null;
  const d = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
}
