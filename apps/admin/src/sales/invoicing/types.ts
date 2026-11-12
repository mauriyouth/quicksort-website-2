// Browser-side copies of the /api/invoicing response shapes
// (server/invoicing/*.ts). Kept here so the server modules never land in
// the browser bundle.

export type InvoiceStatus = "draft" | "finalized" | "paid" | "canceled";

export type Blocker = "client_not_linked" | "no_pricing_line" | "no_rate" | "product_not_linked";
export type RowWarning = "cra_incomplete";

export type ToInvoiceRow = {
  projectId: string;
  projectTitle: string;
  employeeId: string;
  personId: string | null;
  consultantName: string;
  billedClientId: string;
  billedClientName: string;
  days: number;
  amountHt: string | null;
  status: "not_invoiced" | InvoiceStatus;
  invoiceId: string | null;
  craChanged: boolean;
  blockers: Blocker[];
  warnings: RowWarning[];
};

export type Invoice = {
  id: string;
  provider: string;
  provider_invoice_id: string | null;
  number: string | null;
  status: InvoiceStatus;
  source: "cra" | "imported";
  project_id: string | null;
  billed_client_id: string | null;
  provider_client_id: string | null;
  employee_id: string | null;
  period_month: string | null;
  cra_version: number | null;
  issue_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  finalized_at: string | null;
  sent_at: string | null;
  currency: string;
  total_ht: number | string;
  total_vat: number | string;
  total_ttc: number | string;
  purchase_order: string;
  invoice_url: string | null;
  ignored: boolean;
  created_at: string;
  updated_at: string;
  // Added by the server's decorate()
  project_title?: string | null;
  client_name?: string | null;
  consultant_name?: string | null;
  consultant_person_id?: string | null;
};

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  position: number;
  title: string;
  description: string;
  quantity: number | string;
  unit: string;
  unit_price: number | string;
  vat_rate: number | string;
  pricing_line: string;
  computed_quantity: number | string | null;
  computed_unit_price: number | string | null;
};

export type InvoiceEvent = { id: string; kind: string; actor: string | null; detail: Record<string, unknown>; created_at: string };

export type InvoiceDetail = {
  invoice: Invoice; lines: InvoiceLine[]; events: InvoiceEvent[]; recipients: string[] | null;
  // Imported invoices on a project: the consultants staffed on it.
  consultants?: { id: string; name: string }[];
};
export type InvoicesList = { invoices: Invoice[]; lastSyncedAt: string | null; syncError?: string };

export type InvoicingSettings = {
  provider: "qonto";
  login: string;
  iban: string;
  staging: boolean;
  dueDays: number;
  startMonth: string | null;
  lastSyncedAt: string | null;
  hasSecret: boolean;
};

export type ProviderClient = { id: string; name: string; emails: string[]; vatNumber: string | null; taxId: string | null; currency: string };
export type ProviderProduct = { id: string; title: string; description: string; unit: string | null; unitPrice: string | null; vatRate: string };
export type PaymentAccount = { iban: string; name: string };
export type ClientLink = { client_id: string; provider: string; provider_client_id: string; provider_client_name: string };
export type ProductLink = {
  project_id: string; pricing_line: string; provider: string; provider_product_id: string;
  title: string; description: string; unit: string; vat_rate: number | string;
};

/** Every mutating response may carry a `warning` (joined server warnings). */
export type WithWarning<T> = T & { warning?: string };
export type DraftResponse = WithWarning<{ invoice: Invoice; lines: InvoiceLine[]; existing?: boolean }>;
export type InvoiceResponse = WithWarning<{ invoice: Invoice }>;
