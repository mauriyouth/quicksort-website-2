import { qontoRequest } from "../invoicing/qonto.ts";
import type { QontoConfig } from "../invoicing/qonto.ts";

export type BankTransaction = {
  id: string;
  settledAt: string | null;
  emittedAt: string | null;
  month: string; // YYYY-MM-01, Europe/Paris
  amountCents: number;
  vatCents: number;
  amountHtCents: number;
  currency: string;
  label: string;
  counterparty: string;
  operationType: string;
  qontoCategory: string | null;
  note: string | null;
  reference: string | null;
  status: string;
  qontoUpdatedAt: string;
  raw: unknown;
};

export type TransactionPage = { transactions: BankTransaction[]; nextPage: number | null };

const PER_PAGE = 100;

const parisParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" });

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parisMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid transaction date: ${iso}`);
  const parts = parisParts.formatToParts(d);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}-01`;
}

export function mapTransaction(t: unknown): BankTransaction {
  const x = (t ?? {}) as Record<string, any>;
  const amountCents = Number(x.amount_cents ?? 0);
  const vatCents = x.vat_amount_cents != null
    ? Number(x.vat_amount_cents)
    : x.vat_amount != null ? Math.round(Number(x.vat_amount) * 100) : 0;
  const settledAt = str(x.settled_at);
  const emittedAt = str(x.emitted_at);
  const reference = settledAt ?? emittedAt ?? str(x.updated_at);
  if (!reference) throw new Error(`Transaction ${x.id} has no date.`);
  return {
    id: String(x.id),
    settledAt,
    emittedAt,
    month: parisMonth(reference),
    amountCents,
    vatCents,
    amountHtCents: amountCents - vatCents,
    currency: str(x.currency) ?? "EUR",
    label: str(x.label) ?? "",
    counterparty: str(x.clean_counterparty_name) ?? "",
    operationType: str(x.operation_type) ?? "",
    qontoCategory: str(x.category),
    note: str(x.note),
    reference: str(x.reference),
    status: str(x.status) ?? "",
    qontoUpdatedAt: str(x.updated_at) ?? reference,
    raw: t,
  };
}

const REQUEST_TIMEOUT_MS = 30_000;

export function createQontoTransactions(config: QontoConfig, fetchImpl: typeof fetch = fetch) {
  // Bounded per request so a stalled Qonto call cannot overrun the function.
  const request = qontoRequest(config, (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
  return {
    async listDebitsSince(since: string, page: number): Promise<TransactionPage> {
      const qs = new URLSearchParams({
        iban: config.iban,
        side: "debit",
        updated_at_from: since,
        sort_by: "updated_at:asc",
        per_page: String(PER_PAGE),
        current_page: String(page),
      });
      const data = await request("GET", `/v2/transactions?${qs.toString()}`);
      const list: unknown[] = Array.isArray(data?.transactions) ? data.transactions : [];
      return { transactions: list.map(mapTransaction), nextPage: data?.meta?.next_page ?? null };
    },
  };
}
