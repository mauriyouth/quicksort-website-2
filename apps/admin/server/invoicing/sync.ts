import type { InvoiceStatus, ProviderInvoice } from "./provider.ts";

export type LinkContext = {
  clientLinks: { client_id: string; provider_client_id: string }[];
  projects: {
    id: string; pricing_model: string; client_id: string; intermediary_client_id: string | null;
    start_date: string | null; end_date: string | null; extension_end_dates: (string | null)[];
  }[];
};

export function billedClientFor(remote: ProviderInvoice, ctx: LinkContext): string | null {
  if (!remote.clientId) return null;
  return ctx.clientLinks.find((l) => l.provider_client_id === remote.clientId)?.client_id ?? null;
}

export function autoLinkProject(remote: ProviderInvoice, ctx: LinkContext): string | null {
  const billed = billedClientFor(remote, ctx);
  const d = remote.periodStart ?? remote.issueDate;
  if (!billed || !d) return null;
  const candidates = ctx.projects.filter((p) => {
    if (p.pricing_model !== "regie") return false;
    if ((p.intermediary_client_id ?? p.client_id) !== billed) return false;
    if (!p.start_date || p.start_date > d) return false;
    const ends = [p.end_date, ...p.extension_end_dates];
    // Open-ended if any end is null; otherwise latest end must cover d.
    if (ends.some((e) => e === null)) return true;
    return (ends as string[]).reduce((a, b) => (a > b ? a : b)) >= d;
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

// Rows carry DB column names. `provider` is intentionally not set here: the caller adds it.
export function reconcile(
  existing: { id: string; provider_invoice_id: string | null; status: InvoiceStatus; project_id: string | null }[],
  remote: ProviderInvoice[],
  ctx: LinkContext,
): { inserts: Record<string, unknown>[]; updates: { id: string; patch: Record<string, unknown> }[]; removedDraftIds: string[] } {
  const byProviderId = new Map(existing.filter((e) => e.provider_invoice_id).map((e) => [e.provider_invoice_id as string, e]));
  const remoteIds = new Set(remote.map((r) => r.id));
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const r of remote) {
    const known = byProviderId.get(r.id);
    const shared = {
      status: r.status,
      number: r.number,
      issue_date: r.issueDate,
      due_date: r.dueDate,
      paid_at: r.paidAt,
      finalized_at: r.finalizedAt,
      currency: r.currency,
      total_ht: r.totalHt,
      total_vat: r.totalVat,
      total_ttc: r.totalTtc,
      purchase_order: r.purchaseOrder,
      invoice_url: r.invoiceUrl,
    };
    if (known) {
      updates.push({ id: known.id, patch: shared });
    } else {
      inserts.push({
        source: "imported",
        provider_invoice_id: r.id,
        provider_client_id: r.clientId,
        billed_client_id: billedClientFor(r, ctx),
        project_id: autoLinkProject(r, ctx),
        ...shared,
      });
    }
  }
  const removedDraftIds = existing
    .filter((e) => e.status === "draft" && e.provider_invoice_id && !remoteIds.has(e.provider_invoice_id))
    .map((e) => e.id);
  return { inserts, updates, removedDraftIds };
}
