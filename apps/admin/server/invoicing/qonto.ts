import { ProviderError } from "./provider.ts";
import type {
  DraftLine, InvoiceDraft, InvoiceStatus, InvoicingProvider, PaymentAccount,
  ProviderClient, ProviderInvoice, ProviderProduct,
} from "./provider.ts";

export type QontoConfig = { login: string; secretKey: string; iban: string; stagingToken?: string };

const PROD_URL = "https://thirdparty.qonto.com";
const SANDBOX_URL = "https://thirdparty-sandbox.staging.qonto.co";

type Json = any;

function toCents(value: unknown): number {
  const s = String(value ?? "0").trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return 0;
  const frac = (m[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = Number(m[2] || "0") * 100 + Number(frac || "0");
  return m[1] ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function amount(a: Json): string {
  return a?.value != null ? String(a.value) : "0.00";
}

function uniqueEmails(...lists: unknown[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const e of Array.isArray(list) ? list : [list]) {
      const v = typeof e === "string" ? e.trim() : "";
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out;
}

function mapStatus(s: string): InvoiceStatus {
  if (s === "unpaid") return "finalized";
  if (s === "draft" || s === "paid" || s === "canceled") return s;
  return "finalized";
}

function mapLine(i: Json): DraftLine {
  return {
    title: i?.title ?? "",
    description: i?.description ?? "",
    quantity: String(i?.quantity ?? ""),
    unit: i?.unit ?? "",
    unitPrice: amount(i?.unit_price),
    vatRate: String(i?.vat_rate ?? "0"),
  };
}

function mapInvoice(inv: Json): ProviderInvoice {
  const ttc = amount(inv.total_amount);
  const vat = amount(inv.vat_amount);
  return {
    id: inv.id,
    number: inv.number ?? null,
    status: mapStatus(inv.status),
    clientId: inv.client?.id ?? inv.client_id ?? null,
    clientEmails: uniqueEmails(inv.client?.email, inv.client?.extra_emails),
    issueDate: inv.issue_date ?? null,
    dueDate: inv.due_date ?? null,
    periodStart: inv.performance_start_date ?? null,
    periodEnd: inv.performance_end_date ?? null,
    currency: inv.currency ?? inv.total_amount?.currency ?? "EUR",
    totalHt: fromCents(toCents(ttc) - toCents(vat)),
    totalVat: vat,
    totalTtc: ttc,
    paidAt: inv.paid_at ?? null,
    finalizedAt: inv.finalized_at ?? null,
    invoiceUrl: inv.invoice_url ?? null,
    purchaseOrder: inv.purchase_order ?? "",
    lines: Array.isArray(inv.items) ? inv.items.map(mapLine) : [],
  };
}

export function createQontoProvider(config: QontoConfig, fetchImpl: typeof fetch = fetch): InvoicingProvider {
  const base = config.stagingToken ? SANDBOX_URL : PROD_URL;

  async function request(method: string, path: string, body?: unknown): Promise<Json> {
    const headers: Record<string, string> = {
      authorization: `${config.login}:${config.secretKey}`,
      accept: "application/json",
    };
    if (config.stagingToken) headers["X-Qonto-Staging-Token"] = config.stagingToken;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: Json = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const details = Array.isArray(data?.errors)
        ? data.errors.map((e: Json) => e?.detail).filter((d: unknown) => typeof d === "string" && d)
        : [];
      throw new ProviderError(details.length ? details.join("; ") : `Qonto request failed (${res.status}).`, res.status);
    }
    return data;
  }

  async function paged(path: string, key: string): Promise<Json[]> {
    const out: Json[] = [];
    const sep = path.includes("?") ? "&" : "?";
    let page: number | null = 1;
    while (page) {
      const data: Json = await request("GET", `${path}${sep}per_page=100&page=${page}`);
      out.push(...(Array.isArray(data?.[key]) ? data[key] : []));
      page = data?.meta?.next_page ?? null;
    }
    return out;
  }

  function draftBody(d: InvoiceDraft): Record<string, unknown> {
    const body: Record<string, unknown> = {
      client_id: d.clientId,
      issue_date: d.issueDate,
      due_date: d.dueDate,
      currency: d.currency,
      performance_start_date: d.periodStart,
      performance_end_date: d.periodEnd,
      payment_methods: { iban: config.iban },
      items: d.lines.map((l) => ({
        title: l.title,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: { value: l.unitPrice, currency: d.currency },
        vat_rate: l.vatRate,
      })),
    };
    if (d.purchaseOrder) body.purchase_order = d.purchaseOrder;
    return body;
  }

  const one = (data: Json) => {
    if (!data?.client_invoice) throw new ProviderError("Qonto returned an unexpected response.", 502);
    return mapInvoice(data.client_invoice);
  };

  return {
    name: "qonto",
    async listPaymentAccounts() {
      const data = await request("GET", "/v2/organization");
      const accounts: Json[] = data?.organization?.bank_accounts ?? [];
      return accounts.map((a): PaymentAccount => ({ iban: a.iban, name: a.name ?? "" }));
    },
    async listClients() {
      return (await paged("/v2/clients", "clients")).map((c): ProviderClient => ({
        id: c.id,
        name: c.name ?? "",
        emails: uniqueEmails(c.email, c.extra_emails),
        vatNumber: c.vat_number || null,
        taxId: c.tax_identification_number || null,
        currency: c.currency ?? "EUR",
      }));
    },
    async listProducts() {
      return (await paged("/v2/products", "products")).map((p): ProviderProduct => ({
        id: p.id,
        title: p.title ?? "",
        description: p.description ?? "",
        unit: p.unit ?? null,
        unitPrice: p.unit_price ? amount(p.unit_price) : null,
        vatRate: String(p.vat_rate ?? "0"),
      }));
    },
    async listInvoices() {
      return (await paged("/v2/client_invoices?exclude_imported=false", "client_invoices")).map(mapInvoice);
    },
    async getInvoice(id) {
      return one(await request("GET", `/v2/client_invoices/${encodeURIComponent(id)}`));
    },
    async createDraft(d) {
      return one(await request("POST", "/v2/client_invoices", { status: "draft", ...draftBody(d) }));
    },
    async updateDraft(id, d) {
      return one(await request("PATCH", `/v2/client_invoices/${encodeURIComponent(id)}`, draftBody(d)));
    },
    async deleteDraft(id) {
      await request("DELETE", `/v2/client_invoices/${encodeURIComponent(id)}`);
    },
    async finalize(id) {
      return one(await request("POST", `/v2/client_invoices/${encodeURIComponent(id)}/finalize`));
    },
    async send(id, m) {
      await request("POST", `/v2/client_invoices/${encodeURIComponent(id)}/send`, {
        send_to: m.to, email_title: m.subject, email_body: m.body, copy_to_self: true,
      });
    },
    async cancel(id) {
      return one(await request("POST", `/v2/client_invoices/${encodeURIComponent(id)}/mark_as_canceled`));
    },
  };
}
