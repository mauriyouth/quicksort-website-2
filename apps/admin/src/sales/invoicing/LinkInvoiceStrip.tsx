import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button, NativeSelect, NativeSelectOption } from "@quicksort-sas/ui";
import { errorText, type InvoicingApi } from "./api";
import { money, monthLabel, shortDate } from "./format";
import type { Invoice, InvoicesList } from "./types";

type Target = { projectId: string; employeeId: string; billedClientId: string; consultantName: string };

/**
 * Inline strip under a CRA consultant-month that is not invoiced yet: pick a
 * Qonto import (no consultant yet, same project or same client) that already
 * bills it, so the month stops showing as "to invoice".
 */
export function LinkInvoiceStrip({
  api,
  target,
  month,
  disabled = false,
  onLinked,
  onClose,
}: {
  api: InvoicingApi;
  target: Target;
  month: string;
  disabled?: boolean;
  onLinked: (invoice: Invoice) => void;
  onClose: () => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.get<InvoicesList>({ resource: "invoices" })
      .then((r) => { if (live) setInvoices(r.invoices); })
      .catch((e) => { if (live) setError(errorText(e, "Could not load the Qonto invoices.")); });
    return () => { live = false; };
  }, [api]);

  // Same project first, then the client's unassigned imports; invoices of this month on top.
  const candidates = useMemo(() => (invoices ?? [])
    .filter((i) => i.source === "imported" && i.status !== "canceled" && !i.employee_id &&
      (i.project_id ? i.project_id === target.projectId : i.billed_client_id === target.billedClientId))
    .sort((a, b) =>
      Number(b.project_id === target.projectId) - Number(a.project_id === target.projectId) ||
      Number((b.period_month ?? "").startsWith(month)) - Number((a.period_month ?? "").startsWith(month)) ||
      (b.issue_date ?? "").localeCompare(a.issue_date ?? "")), [invoices, target.projectId, target.billedClientId, month]);

  async function link() {
    if (!choice || busy) return;
    setBusy(true); setError("");
    try {
      const r = await api.post<{ invoice: Invoice }>("link_invoice", { invoiceId: choice, projectId: target.projectId, employeeId: target.employeeId, month });
      onLinked(r.invoice);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  const locked = disabled || busy;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        Already billed in Qonto? Link {target.consultantName ? <strong className="font-medium text-foreground">{target.consultantName}</strong> : "this CRA"} · {monthLabel(month)} to
      </span>
      {invoices === null ? (
        !error && <span className="text-xs text-muted-foreground">Loading invoices…</span>
      ) : candidates.length === 0 ? (
        <span className="text-xs text-muted-foreground">No Qonto invoice without a consultant for this client.</span>
      ) : (
        <>
          <NativeSelect size="sm" className="max-w-full" aria-label="Qonto invoice" autoFocus value={choice} disabled={locked} onChange={(e) => setChoice(e.target.value)}>
            <NativeSelectOption value="">Choose an invoice</NativeSelectOption>
            {candidates.map((i) => (
              <NativeSelectOption key={i.id} value={i.id}>
                {i.number || "Draft"} · {shortDate(i.issue_date)} · {money(i.total_ttc, i.currency)} TTC
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button size="sm" disabled={locked || !choice} onClick={() => void link()}>
            {busy ? "Linking…" : "Link"}
          </Button>
        </>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" disabled={busy} onClick={onClose}><X /></Button>
    </div>
  );
}
