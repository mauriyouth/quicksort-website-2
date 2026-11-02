export type InvoiceStatus = "draft" | "finalized" | "paid" | "canceled";
export type ProviderClient = { id: string; name: string; emails: string[]; vatNumber: string | null; taxId: string | null; currency: string };
export type ProviderProduct = { id: string; title: string; description: string; unit: string | null; unitPrice: string | null; vatRate: string };
export type PaymentAccount = { iban: string; name: string };
export type DraftLine = { title: string; description: string; quantity: string; unit: string; unitPrice: string; vatRate: string };
export type InvoiceDraft = { clientId: string; issueDate: string; dueDate: string; currency: string; periodStart: string; periodEnd: string; purchaseOrder: string; lines: DraftLine[] };
export type ProviderInvoice = {
  id: string; number: string | null; status: InvoiceStatus; clientId: string | null; clientEmails: string[];
  issueDate: string | null; dueDate: string | null; periodStart: string | null; periodEnd: string | null;
  currency: string; totalHt: string; totalVat: string; totalTtc: string;
  paidAt: string | null; finalizedAt: string | null; invoiceUrl: string | null; purchaseOrder: string; lines: DraftLine[];
};

export class ProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export interface InvoicingProvider {
  readonly name: string;
  listPaymentAccounts(): Promise<PaymentAccount[]>;
  listClients(): Promise<ProviderClient[]>;
  listProducts(): Promise<ProviderProduct[]>;
  listInvoices(): Promise<ProviderInvoice[]>;
  getInvoice(id: string): Promise<ProviderInvoice>;
  createDraft(draft: InvoiceDraft): Promise<ProviderInvoice>;
  updateDraft(id: string, draft: InvoiceDraft): Promise<ProviderInvoice>;
  deleteDraft(id: string): Promise<void>;
  finalize(id: string): Promise<ProviderInvoice>;
  send(id: string, message: { to: string[]; subject: string; body: string }): Promise<void>;
  cancel(id: string): Promise<ProviderInvoice>;
}
