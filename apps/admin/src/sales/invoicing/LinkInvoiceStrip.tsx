import { useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
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
    <div className="inv-assign-strip">
      <span>Already billed in Qonto? Link {target.consultantName ? <strong>{target.consultantName}</strong> : "this CRA"} · {monthLabel(month)} to</span>
      {invoices === null ? (
        !error && <span className="inv-muted">Loading invoices…</span>
      ) : candidates.length === 0 ? (
        <span className="inv-muted">No Qonto invoice without a consultant for this client.</span>
      ) : (
        <>
          <span className="inv-select">
            <select aria-label="Qonto invoice" autoFocus value={choice} disabled={locked} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose an invoice</option>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number || "Draft"} · {shortDate(i.issue_date)} · {money(i.total_ttc, i.currency)} TTC
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
          <button type="button" className="inv-btn sm" disabled={locked || !choice} onClick={() => void link()}>
            {busy ? "Linking…" : "Link"}
          </button>
        </>
      )}
      {error && <span className="inv-error-text">{error}</span>}
      <button type="button" className="inv-range-clear" aria-label="Close" disabled={busy} onClick={onClose}><X size={16} /></button>
    </div>
  );
}
