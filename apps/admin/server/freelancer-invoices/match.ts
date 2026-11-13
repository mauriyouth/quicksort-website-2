// Matches freelancer invoices to Qonto debits. Pure: no I/O.
// A wrong "paid" is worse than a missing one, so anything short of a single
// exact-amount debit to a clearly identified payee is only "probable".
import type { FreelancerInvoice } from "./types.ts";

// One bank_transactions row. amountCents is negative for debits.
export type Debit = { id: string; settledAt: string; amountCents: number; counterparty: string; iban: string | null };
// Who a freelancer is on a bank statement. iban may be "" when unknown.
export type Billing = { employeeId: string; personName: string; companyName: string; iban: string };
export type Existing = { invoiceId: string; transactionId: string; state: "suggested" | "confirmed" | "dismissed" };

export type MatchPair = { invoiceId: string; transactionId: string };
export type ProbableWhy = "name_fuzzy" | "amount_differs" | "ambiguous";
export type MatchResult = { confident: MatchPair[]; probable: (MatchPair & { why: ProbableWhy })[] };

const LEGAL_SUFFIXES = new Set(["sas", "sasu", "sarl", "eurl", "ei"]);

function normalizeIban(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, "").toUpperCase();
  return v ? v : null;
}

// Beneficiary IBAN of a Qonto transfer (bank_transactions.raw).
export function debitIban(raw: unknown): string | null {
  const transfer = (raw as { transfer?: Record<string, unknown> } | null | undefined)?.transfer;
  if (!transfer || typeof transfer !== "object") return null;
  return normalizeIban(transfer.counterparty_account_number) ?? normalizeIban(transfer.counterparty_iban);
}

function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !LEGAL_SUFFIXES.has(t));
}

// Every token of `short` matches a distinct token of `long` (a single letter
// matches as an initial), and at least one match is a full word.
function tokensCovered(short: string[], long: string[]): boolean {
  const pool = [...long];
  let fullWord = false;
  for (const t of short) {
    let i = pool.indexOf(t);
    if (i >= 0) fullWord = true;
    else if (t.length === 1) i = pool.findIndex((p) => p.startsWith(t));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return fullWord;
}

export function nameMatches(counterparty: string, candidates: string[]): "exact" | "fuzzy" | "none" {
  const cp = nameTokens(counterparty);
  if (cp.length === 0) return "none";
  let best: "fuzzy" | "none" = "none";
  for (const candidate of candidates) {
    const c = nameTokens(candidate ?? "");
    if (c.length === 0) continue;
    if (cp.join(" ") === c.join(" ")) return "exact";
    const [short, long] = cp.length <= c.length ? [cp, c] : [c, cp];
    if (` ${long.join(" ")} `.includes(` ${short.join(" ")} `) || tokensCovered(short, long)) best = "fuzzy";
  }
  return best;
}

const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

function settledParisDate(settledAt: string): string | null {
  const t = Date.parse(settledAt);
  return Number.isNaN(t) ? null : parisDay.format(new Date(t));
}

function identity(debit: Debit, billing: Billing): "exact" | "fuzzy" | "none" {
  const expected = normalizeIban(billing.iban);
  const actual = normalizeIban(debit.iban);
  if (expected && actual && expected === actual) return "exact";
  const name = nameMatches(debit.counterparty ?? "", [billing.companyName, billing.personName]);
  // Both IBANs known and different: a matching name alone is not enough.
  if (expected && actual && name === "exact") return "fuzzy";
  return name;
}

function eligible(inv: FreelancerInvoice): inv is FreelancerInvoice & { issueDate: string; amountTtcCents: number } {
  return inv.review !== "rejected"
    && inv.paidAt == null
    && !inv.isCreditNote
    && inv.issueDate != null
    && inv.amountTtcCents != null
    && inv.amountTtcCents > 0;
}

/**
 * Matches open freelancer invoices to Qonto debits.
 *
 * Contract: callers pass ALL invoices of the freelancers concerned, including
 * paid and rejected ones. Any debit named in an invoice's paidByTransactionId
 * (whatever that invoice's state) or confirmed in `existing` is never reused.
 *
 * Confident needs mutual uniqueness: the invoice has exactly one exact-amount
 * candidate debit, that debit is an exact-amount candidate of exactly one open
 * invoice, and the payee matches by IBAN or exact name. Anything else is left
 * to a human.
 */
export function matchPayments(invoices: FreelancerInvoice[], debits: Debit[], billing: Billing[], existing: Existing[]): MatchResult {
  const confident: MatchResult["confident"] = [];
  const probable: MatchResult["probable"] = [];

  const dismissed = new Set(existing.filter((e) => e.state === "dismissed").map((e) => `${e.invoiceId}|${e.transactionId}`));
  const confirmedDebits = new Set(existing.filter((e) => e.state === "confirmed").map((e) => e.transactionId));
  const confirmedInvoices = new Set(existing.filter((e) => e.state === "confirmed").map((e) => e.invoiceId));
  const billingByEmployee = new Map(billing.map((b) => [b.employeeId, b]));
  const paidDebits = new Set(invoices.map((inv) => inv.paidByTransactionId).filter((id): id is string => !!id));

  // Debits (negative) with a date, not already used to pay or confirmed for any invoice; oldest first.
  const pool = debits
    .filter((d) => d.amountCents < 0 && !confirmedDebits.has(d.id) && !paidDebits.has(d.id))
    .map((d) => ({ debit: d, day: settledParisDate(d.settledAt), at: Date.parse(d.settledAt) }))
    .filter((x): x is { debit: Debit; day: string; at: number } => x.day != null)
    .sort((a, b) => a.at - b.at || a.debit.id.localeCompare(b.debit.id));

  // Open invoices, newest first (only for a stable output order).
  const open = invoices
    .filter(eligible)
    .filter((inv) => !confirmedInvoices.has(inv.id) && billingByEmployee.has(inv.employeeId))
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));

  type Candidate = { debit: Debit; who: "exact" | "fuzzy" };
  const candidatesOf = new Map<string, Candidate[]>();
  const exactAmountOf = new Map<string, Candidate[]>();
  const claimants = new Map<string, number>(); // debit id -> open invoices with it as an exact-amount candidate

  for (const inv of open) {
    const bill = billingByEmployee.get(inv.employeeId) as Billing;
    const candidates: Candidate[] = [];
    for (const x of pool) {
      if (x.day < inv.issueDate || dismissed.has(`${inv.id}|${x.debit.id}`)) continue;
      const who = identity(x.debit, bill);
      if (who !== "none") candidates.push({ debit: x.debit, who });
    }
    const exactAmount = candidates.filter((c) => -c.debit.amountCents === inv.amountTtcCents);
    candidatesOf.set(inv.id, candidates);
    exactAmountOf.set(inv.id, exactAmount);
    for (const c of exactAmount) claimants.set(c.debit.id, (claimants.get(c.debit.id) ?? 0) + 1);
  }

  for (const inv of open) {
    const exactAmount = exactAmountOf.get(inv.id) as Candidate[];

    if (exactAmount.length === 0) {
      // Nearest debit in time to a clearly identified payee, amount aside, that
      // no other invoice claims as an exact-amount candidate (this covers every
      // confident match too, since this invoice claims none).
      const nearest = (candidatesOf.get(inv.id) as Candidate[]).find((c) => c.who === "exact" && !claimants.get(c.debit.id));
      if (nearest) probable.push({ invoiceId: inv.id, transactionId: nearest.debit.id, why: "amount_differs" });
      continue;
    }

    if (exactAmount.length === 1 && claimants.get(exactAmount[0].debit.id) === 1) {
      const only = exactAmount[0];
      if (only.who === "exact") confident.push({ invoiceId: inv.id, transactionId: only.debit.id });
      else probable.push({ invoiceId: inv.id, transactionId: only.debit.id, why: "name_fuzzy" });
      continue;
    }

    for (const c of exactAmount) probable.push({ invoiceId: inv.id, transactionId: c.debit.id, why: "ambiguous" });
  }

  return { confident, probable };
}
