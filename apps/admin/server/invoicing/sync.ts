import type { InvoiceStatus, ProviderInvoice } from "./provider.ts";

export type LinkContext = {
  clientLinks: { client_id: string; provider_client_id: string }[];
  projects: {
    id: string; title: string; pricing_model: string; client_id: string; intermediary_client_id: string | null;
    start_date: string | null; end_date: string | null; extension_end_dates: (string | null)[];
  }[];
};

export function billedClientFor(remote: ProviderInvoice, ctx: LinkContext): string | null {
  if (!remote.clientId) return null;
  return ctx.clientLinks.find((l) => l.provider_client_id === remote.clientId)?.client_id ?? null;
}

// Case, accents and runs of spaces don't count when comparing titles.
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// A single code-like word mixing letters and digits, e.g. "TWCF2025QSFXD1025".
function isReference(title: string): boolean {
  const t = title.trim();
  return /^[A-Za-z0-9-]{6,}$/.test(t) && /[A-Za-z]/.test(t) && /\d/.test(t);
}

// The project whose title appears in an invoice line title; the longest title wins, a tie matches nothing.
// When the Qonto client is linked, only that client's projects (as main client or intermediary) count.
function titleMatch(remote: ProviderInvoice, ctx: LinkContext, billed: string | null): string | null | undefined {
  const lines = remote.lines.map((l) => normalize(l.title));
  let best: { id: string; length: number; tied: boolean } | null = null;
  for (const p of ctx.projects) {
    if (billed && p.client_id !== billed && p.intermediary_client_id !== billed) continue;
    const title = normalize(p.title ?? "");
    if (!title || !lines.some((l) => l.includes(title))) continue;
    if (!best || title.length > best.length) best = { id: p.id, length: title.length, tied: false };
    else if (title.length === best.length) best.tied = true;
  }
  if (!best) return undefined;
  return best.tied ? null : best.id;
}

export function autoLinkProject(remote: ProviderInvoice, ctx: LinkContext): string | null {
  const billed = billedClientFor(remote, ctx);
  const byTitle = titleMatch(remote, ctx, billed);
  if (byTitle !== undefined) return byTitle;
  // A line titled with a project reference we don't know bills another project: don't guess one by date.
  if (remote.lines.some((l) => isReference(l.title))) return null;
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
  existing: {
    id: string; provider_invoice_id: string | null; status: InvoiceStatus; project_id: string | null;
    source?: string; ignored?: boolean;
  }[],
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
      // Imported invoices still unassigned get another chance; manual and ignored ones are left alone.
      const link = known.source === "imported" && !known.project_id && !known.ignored ? autoLinkProject(r, ctx) : null;
      updates.push({ id: known.id, patch: link ? { ...shared, project_id: link } : shared });
    } else {
      inserts.push({
        source: "imported",
        provider_invoice_id: r.id,
        provider_client_id: r.clientId,
        billed_client_id: billedClientFor(r, ctx),
        project_id: autoLinkProject(r, ctx),
        // Listed under the month of the work (Qonto's performance start), editable afterwards.
        period_month: r.periodStart ? `${r.periodStart.slice(0, 7)}-01` : null,
        ...shared,
      });
    }
  }
  const removedDraftIds = existing
    .filter((e) => e.status === "draft" && e.provider_invoice_id && !remoteIds.has(e.provider_invoice_id))
    .map((e) => e.id);
  return { inserts, updates, removedDraftIds };
}
