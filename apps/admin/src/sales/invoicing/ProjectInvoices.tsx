import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Notice } from "@quicksort/hr-ui";
import { errorText, useInvoicingApi } from "./api";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { blockerLabel, days, invoiceRowLabel, money, monthLabel, shortDate } from "./format";
import type { DraftResponse, Invoice, ToInvoiceRow } from "./types";
import "./invoicing.css";

type ProjectRow = ToInvoiceRow & { month: string };
type ProjectResponse = {
  invoices: Invoice[];
  totals: { invoicedHt: number | string; paidTtc: number | string; outstandingTtc: number | string };
  rows: ProjectRow[];
};
type Panel = { invoiceId: string; craChanged: boolean; warning: string };

/**
 * Invoices card on a régie project sheet: totals, the project's invoices,
 * and the consultant-months not invoiced yet (with Create draft). Opening
 * an invoice reuses the Invoicing page's draft panel.
 */
export function ProjectInvoices({ projectId }: { projectId: string }) {
  const api = useInvoicingApi();
  const [data, setData] = useState<ProjectResponse | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<ProjectResponse>({ resource: "project", projectId }));
      setError("");
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
            <div className="projects-table-scroll">
              <table className="inv-table">
                <thead>
                  <tr><th>Invoice</th><th>Consultant</th><th>Period</th><th>Due</th><th className="num">Total TTC</th><th /></tr>
                </thead>
                <tbody>
                  {data.invoices.map((i) => {
                    const label = invoiceRowLabel(i);
                    return (
                      <tr key={i.id}>
                        <td>
                          <div className="inv-row-status">
                            <strong>{i.number || "—"}</strong>
                            <span className={`inv-status inv-status--${label.split(" ")[0].toLowerCase()}`}>{label}</span>
                          </div>
                        </td>
                        <td>{i.consultant_name || "—"}</td>
                        <td>{monthLabel(i.period_month ?? i.issue_date)}</td>
                        <td>{shortDate(i.due_date)}</td>
                        <td className="num">{money(i.total_ttc, i.currency)}</td>
                        <td className="inv-col-actions">
                          <button type="button" className="projects-row-btn" disabled={busy !== null}
                            onClick={() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" })}>
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pending.length > 0 && (
            <>
              <h3 className="inv-sub-title">Not invoiced yet</h3>
              <div className="projects-table-scroll">
                <table className="inv-table">
                  <thead>
                    <tr><th>Consultant</th><th>Period</th><th className="num">Days</th><th className="num">Amount HT</th><th>Status</th><th /></tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => {
                      const month = r.month;
                      const ready = r.blockers.length === 0;
                      return (
                        <tr key={`${r.employeeId}:${month}`}>
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
                            <button type="button" className="projects-row-btn" disabled={busy !== null || !ready} onClick={() => void create(r)}>
                              {busy === `${r.employeeId}:${month}` ? "Creating…" : "Create draft"}
                            </button>
                          </td>
                        </tr>
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
