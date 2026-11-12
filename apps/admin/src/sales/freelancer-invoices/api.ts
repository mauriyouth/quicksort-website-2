import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSession } from "@clerk/react";

const PATH = "/api/freelancer-invoices";

/** A failed /api/freelancer-invoices call, with the HTTP status. */
export class FreelancerInvoicesError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FreelancerInvoicesError";
    this.status = status;
  }
}

export function errorText(error: unknown, fallback = "The freelancer invoice request failed. Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Client for /api/freelancer-invoices, authenticated with the Clerk session's
 * Supabase token (same pattern as useInvoicingApi). Never retried here.
 */
export function useFreelancerInvoicesApi() {
  const { session } = useSession();
  // Clerk replaces the session object on refresh/focus: key on its id, read it from a ref.
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const sessionId = session?.id;
  const request = useCallback(async <T,>(method: "GET" | "POST", query: string, body?: object): Promise<T> => {
    const token = await sessionRef.current?.getToken({ template: "supabase" });
    if (!token) throw new Error("Sign in again to manage freelancer invoices.");
    const response = await fetch(`${PATH}${query}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Freelancer invoices are unavailable. Deploy the updated admin app first.");
    }
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new FreelancerInvoicesError(typeof result.error === "string" && result.error ? result.error : "The freelancer invoice request failed.", response.status);
    }
    return result as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return useMemo(() => ({
    get<T>(params: Record<string, string>): Promise<T> {
      return request<T>("GET", `?${new URLSearchParams(params).toString()}`);
    },
    post<T>(action: string, body: object = {}): Promise<T> {
      return request<T>("POST", "", { action, ...body });
    },
  }), [request]);
}

export type FreelancerInvoicesApi = ReturnType<typeof useFreelancerInvoicesApi>;

// Response shapes of /api/freelancer-invoices (see apps/admin/api/freelancer-invoices.ts).
/** A Qonto debit as the panel shows it; amountCents is positive (money out). */
export type DebitInfo = { transactionId: string; amountCents: number; settledAt: string; counterparty: string; label: string; reference: string; iban: string | null };
export type Suggestion = DebitInfo & { why: string };
export type Payment = DebitInfo & { matchedBy: "automatic" | "confirmed" | "manual"; decidedBy: string; alsoPays: string[] };
export type DisplayStatus = { status: "to_check" | "to_pay" | "paid" | "rejected"; warning: boolean; overdue: boolean };
export type InvoiceView = {
  id: string;
  employeeId: string;
  number: string;
  issueDate: string | null;
  periodMonth: string | null;
  dueDate: string | null;
  amountHtCents: number | null;
  vatCents: number | null;
  amountTtcCents: number | null;
  isCreditNote: boolean;
  flags: string[];
  review: "to_check" | "ok" | "rejected";
  reviewNote: string;
  paidAt: string | null;
  paidByTransactionId: string | null;
  source: "portal" | "email";
  createdAt: string;
  version: number;
  documentId: string | null;
  display: DisplayStatus;
  suggestions: Suggestion[];
  payment: Payment | null;
};
export type Billing = { companyName: string; siret: string; iban: string; extraEmails: string[] };
export type MonthCheck = {
  invoicedHtCents: number;
  expectedCents: number | null;
  diffCents: number | null;
  ok: boolean;
  reason: "match" | "mismatch" | "no_cra" | "unreadable";
};
export type MonthRow = {
  employeeId: string;
  name: string;
  expected: { days: number; cents: number } | null;
  missingRate: boolean;
  rates: { dailyRate: number; startDate: string; endDate: string | null }[];
  check: MonthCheck;
  invoices: InvoiceView[];
  missing: boolean;
  billing: Billing;
};
export type UnassignedInvoice = InvoiceView & { name: string };
export type MonthResponse = { rows: MonthRow[]; unassigned: UnassignedInvoice[] };
export type YearResponse = { months: { month: string; rows: MonthRow[] }[]; unassigned: UnassignedInvoice[] };
export type InvoiceEvent = { id: string; kind: string; actor_email: string; detail: Record<string, unknown> | null; created_at: string };
export type MailboxSettingsResponse = {
  mailbox: string;
  backfillFrom: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  driveServiceAccountEmail: string | null;
};
export type SyncResult = {
  poll: { messages: number; invoices: number; duplicates: number; notInvoices?: number; skipped: number; failed: number; abandoned: number; partial: boolean } | { skipped: string };
  matched: number;
  suggested: number;
  reviewed: number;
};
