import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Plus, X } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { errorText, useInvoicingApi, type InvoicingApi } from "./api";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { LinkInvoiceStrip } from "./LinkInvoiceStrip";
import { billingMonthOptions, blockerLabel, days, invoiceRowLabel, money, monthLabel, rowOpener, shiftMonth, shortDate } from "./format";
import type { DraftResponse, Invoice, ToInvoiceRow } from "./types";
import "./invoicing.css";

type ProjectRow = ToInvoiceRow & { month: string };
type Consultant = { id: string; name: string };
type ProjectResponse = {
  invoices: Invoice[];
  consultants: Consultant[];
  totals: { invoicedHt: number | string; paidTtc: number | string; outstandingTtc: number | string };
  rows: ProjectRow[];
};
type Panel = { invoiceId: string; craChanged: boolean; warning: string };

/**
 * Invoices card on a régie project sheet: totals, the project's invoices,
 * and the consultant-months not invoiced yet (with Create draft). Opening
 * an invoice reuses the Invoicing page's draft panel.
 */
export function ProjectInvoices({ projectId, onTotals }: {
  projectId: string;
  /** Invoiced HT (finalized + paid) after every load — the project's Billed stat. */
  onTotals?: (invoicedHt: number) => void;
}) {
  const api = useInvoicingApi();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  // Kept in a ref so an inline callback doesn't re-trigger the load.
  const onTotalsRef = useRef(onTotals);
  onTotalsRef.current = onTotals;

  const load = useCallback(async () => {
    try {
      const res = await api.get<ProjectResponse>({ resource: "project", projectId });
      setData(res);
      setError("");
      onTotalsRef.current?.(Number(res.totals.invoicedHt));
    } catch (e) { setError(errorText(e, "Could not load the project's invoices.")); }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);

    const pending = (data?.rows ?? []).filter((r) => r.status === "not_invoiced");

  async function create(r: ProjectRow) {
    if (busy) return;
    const month = r.month;
    setBusy(`${r.employeeId}:${month}`); setError(""); setMessage(""); setWarning("");
    try {
      const res = await api.post<DraftResponse>("create_draft", { projectId, employeeId: r.employeeId, month });
      setPanel({ invoiceId: res.invoice.id, craChanged: false, warning: res.warning ?? "" });
      if (res.existing) setMessage("A draft already existed for this consultant-month; it is open now.");
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="inv-project">
      <div className="pj-card-head">
        <div>
          <h2 className="pj-card-title">Invoices</h2>
          <p className="pj-card-desc">Monthly régie invoices for this project, created from CRA through Qonto.</p>
        </div>
      </div>

      <Notice error>{error}</Notice>
      <Notice>{warning}</Notice>
      <Notice>{message}</Notice>

      {!data ? (
        !error && <p className="inv-empty">Loading invoices…</p>
      ) : (
        <>
          <dl className="inv-totals">
            <div><dt>Invoiced HT</dt><dd>{money(data.totals.invoicedHt)}</dd></div>
            <div><dt>Paid</dt><dd>{money(data.totals.paidTtc)}</dd></div>
            <div><dt>Outstanding</dt><dd>{money(data.totals.outstandingTtc)}</dd></div>
          </dl>

          {data.invoices.length === 0 ? (
            <p className="inv-empty">No invoices yet.</p>
          ) : (
            <div className="projects-table-scroll inv-scroll">
              <table className="inv-table">
                <thead>
                  <tr><th>Invoice</th><th>Consultant</th><th>Period</th><th>Due</th><th className="num">Total TTC</th></tr>
                </thead>
                <tbody>
                  {data.invoices.map((i) => {
                    const label = invoiceRowLabel(i);
                    const assignable = i.source === "imported" && !i.employee_id && i.status !== "canceled";
                    return (
                      <Fragment key={i.id}>
                      <tr className="inv-row-open" aria-label={`Open ${i.number || "draft invoice"}`}
                        {...rowOpener(() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" }), busy !== null)}>
                        <td>
                          <div className="inv-row-status">
                            <strong>{i.number || "—"}</strong>
                            <span className={`inv-status inv-status--${label.split(" ")[0].toLowerCase()}`}>{label}</span>
                          </div>
                        </td>
                        <td>
                          {assignable ? (
                            <button type="button" className={`inv-assign${assigning === i.id ? " on" : ""}`} aria-expanded={assigning === i.id}
                              aria-label={`Assign a consultant to ${i.number || "this invoice"}`} disabled={busy !== null}
                              onClick={() => setAssigning(assigning === i.id ? null : i.id)}>
                              <Plus size={14} /> Assign consultant
                            </button>
                          ) : (i.consultant_name || "—")}
                        </td>
                        <td>{monthLabel(i.period_month ?? i.issue_date)}</td>
                        <td>{shortDate(i.due_date)}</td>
                        <td className="num">{money(i.total_ttc, i.currency)}</td>
                      </tr>
                      {assigning === i.id && (
                        <tr>
                          <td colSpan={5} className="inv-link-cell">
                            <AssignConsultantStrip api={api} projectId={projectId} invoice={i} consultants={data.consultants}
                              onClose={() => setAssigning(null)}
                              onDone={() => { setAssigning(null); setMessage(`${i.number || "The invoice"} is now assigned.`); void load(); }} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pending.length > 0 && (
            <>
              <h3 className="inv-sub-title">Not invoiced yet</h3>
              <div className="projects-table-scroll inv-scroll">
                <table className="inv-table">
                  <thead>
                    <tr><th>Consultant</th><th>Period</th><th className="num">Days</th><th className="num">Amount HT</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => {
                      const month = r.month;
                      const ready = r.blockers.length === 0;
                      const k = `${r.employeeId}:${month}`;
                      return (
                        <Fragment key={k}>
                        <tr>
                          <td><strong>{r.consultantName || "—"}</strong></td>
                          <td>{monthLabel(month)}</td>
                          <td className="num">{days(r.days)}</td>
                          <td className="num">{r.amountHt !== null ? money(r.amountHt) : "—"}</td>
                          <td>
                            <span className="inv-status inv-status--none">Not invoiced</span>
                            {[...r.blockers, ...r.warnings].map((b) => (
                              <Link key={b} className={`inv-blocker${r.blockers.includes(b as never) ? "" : " inv-blocker--warn"}`}
                                to={b === "client_not_linked" || b === "product_not_linked" ? `/sales/invoicing/settings` : b === "cra_incomplete" ? "/hr/cra" : `/sales/projects/${projectId}`}>
                                {blockerLabel(b)}
                              </Link>
                            ))}
                          </td>
                          <td className="inv-col-actions">
                            <div className="inv-action-stack">
                              <button type="button" className="projects-row-btn" disabled={busy !== null || !ready} onClick={() => void create(r)}>
                                {busy === k ? "Creating…" : "Create draft"}
                              </button>
                              <button type="button" className="inv-text-btn sm" disabled={busy !== null} aria-expanded={linking === k}
                                onClick={() => setLinking(linking === k ? null : k)}>
                                Link Qonto invoice
                              </button>
                            </div>
                          </td>
                        </tr>
                        {linking === k && (
                          <tr>
                            <td colSpan={6} className="inv-link-cell">
                              <LinkInvoiceStrip api={api} month={month} disabled={busy !== null} target={r} onClose={() => setLinking(null)}
                                onLinked={(inv) => { setLinking(null); setMessage(`${inv.number || "The invoice"} now covers this CRA.`); void load(); }} />
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {panel && (
        <InvoiceDraftPanel
          api={api}
          invoiceId={panel.invoiceId}
          craChanged={panel.craChanged}
          initialWarning={panel.warning}
          onClose={() => setPanel(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

/**
 * Inline strip under a Qonto import with no consultant: pick one of the
 * project's consultants and the month worked. The invoice then covers that
 * consultant-month (it leaves "Not invoiced yet").
 */
function AssignConsultantStrip({
  api, projectId, invoice, consultants, onClose, onDone,
}: {
  api: InvoicingApi; projectId: string; invoice: Invoice; consultants: Consultant[]; onClose: () => void; onDone: () => void;
}) {
  // Default to the stored billing month, else the month before the issue date (work is billed the month after).
  const issueMonth = (invoice.issue_date ?? "").slice(0, 7);
  const [employeeId, setEmployeeId] = useState(consultants.length === 1 ? consultants[0].id : "");
  const [month, setMonth] = useState((invoice.period_month ?? "").slice(0, 7) || (issueMonth ? shiftMonth(issueMonth, -1) : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!employeeId || !month || busy) return;
    setBusy(true); setError("");
    try {
      await api.post("link_invoice", { invoiceId: invoice.id, projectId, employeeId, month });
      onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="inv-assign-strip">
      {consultants.length === 0 ? (
        <span className="inv-muted">Nobody is staffed on this project yet.</span>
      ) : (
        <>
          <span>Assign <strong>{invoice.number || "this invoice"}</strong> to</span>
          <span className="inv-select">
            <select aria-label="Consultant" autoFocus value={employeeId} disabled={busy} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose a consultant</option>
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
          <span>for</span>
          <span className="inv-select">
            <select aria-label="Billing month" value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)}>
              {billingMonthOptions(invoice.issue_date, month).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
          <button type="button" className="inv-btn sm" disabled={busy || !employeeId || !month} onClick={() => void save()}>
            {busy ? "Saving…" : "Assign"}
          </button>
        </>
      )}
      {error && <span className="inv-error-text">{error}</span>}
      <button type="button" className="inv-range-clear" aria-label="Close" disabled={busy} onClick={onClose}><X size={16} /></button>
    </div>
  );
}
