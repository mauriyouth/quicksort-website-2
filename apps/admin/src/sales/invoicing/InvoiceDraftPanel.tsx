import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, Send, Trash2, X } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { errorText, InvoicingError, type InvoicingApi } from "./api";
import { dateTime, invoiceRowLabel, lineTotals, money, monthLabel, shortDate, sourceLabel } from "./format";
import type { DraftResponse, InvoiceDetail, InvoiceLine, InvoiceResponse } from "./types";

type LineEdit = { id: string; quantity: string; unitPrice: string; description: string };
type Confirm = "validate" | "delete" | "cancel" | "send" | "resend" | null;
const RECIPIENTS_UNREAD = "Couldn't read the client's invoice emails from Qonto — refresh and try again.";

const QTY = /^\d{1,6}(\.\d{1,4})?$/;
const PRICE = /^\d{1,9}(\.\d{1,2})?$/;

const toEdit = (l: InvoiceLine): LineEdit => ({
  id: l.id,
  quantity: String(Number(l.quantity)),
  unitPrice: Number(l.unit_price).toFixed(2),
  description: l.description ?? "",
});
const differs = (a: number | string | null | undefined, b: number | string) => a !== null && a !== undefined && Number(a) !== Number(b);

/**
 * Side sheet for one invoice: edit a CRA draft (quantities, prices,
 * descriptions, due date, PO), regenerate it from the CRA, validate it
 * (in-page confirmation with the TTC), then send / open / cancel it.
 * Every action button is disabled while any request is in flight.
 */
export function InvoiceDraftPanel({
  api,
  invoiceId,
  craChanged = false,
  initialWarning = "",
  onClose,
  onChanged,
}: {
  api: InvoicingApi;
  invoiceId: string;
  craChanged?: boolean;
  initialWarning?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [lines, setLines] = useState<LineEdit[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState(initialWarning);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [regenerated, setRegenerated] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const apply = useCallback((next: InvoiceDetail) => {
    setDetail(next);
    setLines(next.lines.map(toEdit));
    setDueDate(next.invoice.due_date ?? "");
    setPurchaseOrder(next.invoice.purchase_order ?? "");
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get<InvoiceDetail>({ resource: "invoice", id: invoiceId }));
    } catch (e) {
      setError(errorText(e, "Could not load the invoice."));
    }
  }, [api, invoiceId, apply]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (confirm) setConfirm(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, confirm, onClose]);

  const invoice = detail?.invoice;
  const currency = invoice?.currency || "EUR";
  const notInQonto = invoice?.status === "draft" && !invoice.provider_invoice_id;
  const editable = invoice?.status === "draft" && invoice.source === "cra" && !!invoice.provider_invoice_id;
  const validated = invoice?.status === "finalized" || invoice?.status === "paid";

  const dirty = useMemo(() => {
    if (!detail || !editable) return false;
    if ((detail.invoice.due_date ?? "") !== dueDate || (detail.invoice.purchase_order ?? "") !== purchaseOrder) return true;
    return detail.lines.some((l) => {
      const e = lines.find((x) => x.id === l.id);
      return !!e && (Number(e.quantity) !== Number(l.quantity) || Number(e.unitPrice) !== Number(l.unit_price) || e.description !== (l.description ?? ""));
    });
  }, [detail, editable, lines, dueDate, purchaseOrder]);

  const invalid = editable && lines.some((l) => !QTY.test(l.quantity.trim()) || Number(l.quantity) <= 0 || !PRICE.test(l.unitPrice.trim()));

  const totals = useMemo(() => {
    if (!detail) return null;
    if (editable && dirty && !invalid) {
      return lineTotals(detail.lines.map((l) => {
        const e = lines.find((x) => x.id === l.id);
        return { quantity: e?.quantity ?? l.quantity, unitPrice: e?.unitPrice ?? l.unit_price, vatRate: l.vat_rate };
      }));
    }
    return { ht: Number(detail.invoice.total_ht), vat: Number(detail.invoice.total_vat), ttc: Number(detail.invoice.total_ttc) };
  }, [detail, editable, dirty, invalid, lines]);

  async function run<T>(name: string, fn: () => Promise<T>, after?: (result: T) => void | Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setMessage("");
    setWarning("");
    try {
      const result = await fn();
      const w = (result as { warning?: unknown })?.warning;
      if (typeof w === "string" && w) setWarning(w);
      await after?.(result);
      onChanged();
    } catch (e) {
      const line = e instanceof InvoicingError && e.blocker && e.body.pricingLine ? ` (${String(e.body.pricingLine)})` : "";
      setError(`${errorText(e)}${line}`);
      // The server may have moved on (e.g. already sent, already validated): show its current state.
      if (e instanceof InvoicingError && e.status === 409) await load();
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const save = () => run("save", () => api.post<DraftResponse>("update_draft", {
    invoiceId,
    dueDate,
    purchaseOrder: purchaseOrder.trim(),
    lines: lines.map((l) => ({ id: l.id, quantity: l.quantity.trim(), unitPrice: l.unitPrice.trim(), description: l.description })),
  }), async (r) => { await load(); if (!r.warning) setMessage("Draft saved in Qonto."); });

  const regenerate = () => run("regenerate", () => api.post<DraftResponse>("regenerate_draft", { invoiceId }), async (r) => {
    setRegenerated(true);
    await load();
    if (!r.warning) setMessage("Draft regenerated from the CRA.");
  });

  const remove = () => run("delete", () => api.post<{ deleted: boolean }>("delete_draft", { invoiceId }), () => {
    setDeleted(true);
    setMessage("Draft deleted.");
  });

  const validate = () => run("validate", () => api.post<InvoiceResponse>("finalize", { invoiceId }), async (r) => {
    await load();
    setMessage(`Invoice validated${r.invoice?.number ? ` as ${r.invoice.number}` : ""}.`);
  });

  const send = (resend: boolean) => run("send", () => api.post<InvoiceResponse & { sent: boolean }>("send", { invoiceId, ...(resend ? { resend: true } : {}) }), async () => {
    await load();
    setMessage("Invoice sent.");
  });

  const cancel = () => run("cancel", () => api.post<InvoiceResponse>("cancel", { invoiceId }), async () => {
    await load();
    setMessage("Invoice canceled in Qonto.");
  });

  const setLine = (id: string, patch: Partial<LineEdit>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const locked = busy !== null;

  return (
    <div className="inv-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <aside className="inv-sheet" role="dialog" aria-modal="true" aria-labelledby="inv-sheet-title">
        <header className="inv-sheet-head">
          <div className="inv-sheet-head-text">
            <span className="inv-eyebrow">
              {invoice ? `${sourceLabel(invoice.source)} · ${monthLabel(invoice.period_month ?? invoice.issue_date)}` : "Invoice"}
            </span>
            <h2 id="inv-sheet-title">
              {invoice ? invoice.number || (invoice.status === "draft" ? "Draft invoice" : "Invoice") : "Loading…"}
            </h2>
            {invoice && (
              <div className="inv-sheet-meta">
                <span className={`inv-status inv-status--${invoiceRowLabel(invoice).split(" ")[0].toLowerCase()}`}>{invoiceRowLabel(invoice)}</span>
                {invoice.consultant_name && <span>{invoice.consultant_name}</span>}
                {invoice.project_title && <span>{invoice.project_title}</span>}
                {invoice.client_name && <span>Billed to {invoice.client_name}</span>}
              </div>
            )}
          </div>
          <button type="button" className="projects-refresh" aria-label="Close" title="Close" onClick={onClose} disabled={locked}>
            <X size={18} />
          </button>
        </header>

        <div className="inv-sheet-body">
          <Notice error>{error}</Notice>
          <Notice>{warning}</Notice>
          <Notice>{message}</Notice>

          {deleted ? (
            <p className="inv-muted">This draft no longer exists.</p>
          ) : !detail || !invoice ? (
            !error && <p className="inv-muted">Loading the invoice…</p>
          ) : (
            <>
              {craChanged && !regenerated && editable && (
                <div className="inv-banner" role="status">
                  <span>CRA changed — regenerate this draft so it matches the timesheet.</span>
                  <button type="button" className="pj-btn pj-btn-ghost" disabled={locked} onClick={regenerate}>
                    <RefreshCw size={14} /> {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
                  </button>
                </div>
              )}
              {notInQonto && (
                <div className="inv-banner" role="status">
                  <span>This draft was never created in Qonto (the request was interrupted). Delete it, then create the draft again.</span>
                </div>
              )}
              {invoice.source === "imported" && invoice.status === "draft" && (
                <div className="inv-banner" role="status">
                  <span>Imported from Qonto, not created from a CRA. Check that it is not a duplicate of a CRA draft before validating it; edit its lines in Qonto.</span>
                </div>
              )}

              <section className="pj-card">
                <div className="pj-card-head">
                  <div>
                    <h3 className="pj-card-title">Lines</h3>
                    {editable && <p className="pj-card-desc">Values that differ from the CRA computation are highlighted.</p>}
                  </div>
                </div>
                {detail.lines.length === 0 ? (
                  <p className="inv-muted">
                    {invoice.source === "imported" ? "Lines of imported invoices are kept in Qonto." : "No lines saved here. Regenerate the draft."}
                  </p>
                ) : (
                  <div className="inv-lines">
                    {detail.lines.map((l) => {
                      const e = lines.find((x) => x.id === l.id) ?? toEdit(l);
                      const qtyOff = differs(l.computed_quantity, e.quantity);
                      const priceOff = differs(l.computed_unit_price, e.unitPrice);
                      return (
                        <div className="inv-line" key={l.id}>
                          <div className="inv-line-title">
                            <strong>{l.title}</strong>
                            {l.pricing_line && <span className="inv-muted">{l.pricing_line}</span>}
                          </div>
                          {editable ? (
                            <>
                              <div className="inv-line-grid">
                                <label className={`pj-field${qtyOff ? " inv-changed" : ""}`}>
                                  <span className="pj-label">Quantity ({l.unit})</span>
                                  <input inputMode="decimal" value={e.quantity} disabled={locked}
                                    onChange={(ev) => setLine(l.id, { quantity: ev.target.value })} />
                                  {qtyOff && <span className="pj-field-help">CRA: {Number(l.computed_quantity)}</span>}
                                </label>
                                <label className={`pj-field${priceOff ? " inv-changed" : ""}`}>
                                  <span className="pj-label">Unit price HT</span>
                                  <input inputMode="decimal" value={e.unitPrice} disabled={locked}
                                    onChange={(ev) => setLine(l.id, { unitPrice: ev.target.value })} />
                                  {priceOff && <span className="pj-field-help">TJM: {money(l.computed_unit_price, currency)}</span>}
                                </label>
                                <div className="pj-field">
                                  <span className="pj-label">VAT</span>
                                  <span className="inv-static">{Math.round(Number(l.vat_rate) * 1000) / 10} %</span>
                                </div>
                              </div>
                              <label className="pj-field">
                                <span className="pj-label">Description</span>
                                <textarea rows={3} value={e.description} disabled={locked}
                                  onChange={(ev) => setLine(l.id, { description: ev.target.value })} />
                              </label>
                            </>
                          ) : (
                            <div className="inv-line-read">
                              <span>{Number(l.quantity)} {l.unit} × {money(l.unit_price, currency)}</span>
                              <span className="inv-muted">VAT {Math.round(Number(l.vat_rate) * 1000) / 10} %</span>
                              {l.description && <p className="inv-line-desc">{l.description}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="pj-card">
                <div className="pj-grid pj-grid-2">
                  {editable ? (
                    <>
                      <label className="pj-field">
                        <span className="pj-label">Due date</span>
                        <input type="date" value={dueDate} min={invoice.issue_date ?? undefined} disabled={locked}
                          onChange={(e) => setDueDate(e.target.value)} />
                      </label>
                      <label className="pj-field">
                        <span className="pj-label">Purchase order <span className="pj-label-opt">(optional)</span></span>
                        <input value={purchaseOrder} maxLength={200} disabled={locked} onChange={(e) => setPurchaseOrder(e.target.value)} />
                      </label>
                    </>
                  ) : (
                    <>
                      <div className="pj-field"><span className="pj-label">Issue date</span><span className="inv-static">{shortDate(invoice.issue_date)}</span></div>
                      <div className="pj-field"><span className="pj-label">Due date</span><span className="inv-static">{shortDate(invoice.due_date)}</span></div>
                      {invoice.purchase_order && <div className="pj-field"><span className="pj-label">Purchase order</span><span className="inv-static">{invoice.purchase_order}</span></div>}
                      {invoice.sent_at && <div className="pj-field"><span className="pj-label">Sent</span><span className="inv-static">{dateTime(invoice.sent_at)}</span></div>}
                      {invoice.paid_at && <div className="pj-field"><span className="pj-label">Paid</span><span className="inv-static">{shortDate(invoice.paid_at)}</span></div>}
                    </>
                  )}
                </div>
                {totals && (
                  <dl className="inv-totals">
                    <div><dt>Total HT</dt><dd>{money(totals.ht, currency)}</dd></div>
                    <div><dt>VAT</dt><dd>{money(totals.vat, currency)}</dd></div>
                    <div className="inv-totals-ttc"><dt>Total TTC{dirty ? " (unsaved)" : ""}</dt><dd>{money(totals.ttc, currency)}</dd></div>
                  </dl>
                )}
                {invalid && <p className="inv-error-text">Quantities must be positive (up to 4 decimals) and prices have at most 2 decimals.</p>}
              </section>

              {validated && (
                <section className="pj-card">
                  <div className="pj-card-head">
                    <div>
                      <h3 className="pj-card-title">Send</h3>
                      <p className="pj-card-desc">
                        {detail.recipients === null
                          ? RECIPIENTS_UNREAD
                          : detail.recipients.length
                            ? `To ${detail.recipients.join(", ")}`
                            : "This client has no invoice email in Qonto."}
                      </p>
                    </div>
                  </div>
                  {invoice.sent_at && <p className="inv-muted">Already sent on {dateTime(invoice.sent_at)}.</p>}
                </section>
              )}

              {detail.events.length > 0 && (
                <section className="inv-history">
                  <h3 className="pj-card-title">History</h3>
                  <ul>
                    {detail.events.map((ev) => (
                      <li key={ev.id}><span>{ev.kind.replace(/_/g, " ")}</span><span className="inv-muted">{dateTime(ev.created_at)}</span></li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {detail && invoice && !deleted && (
          <footer className="inv-sheet-foot">
            {invoice.status === "draft" && (
              <button type="button" className="pj-btn pj-btn-ghost inv-danger" disabled={locked} onClick={() => setConfirm("delete")}>
                <Trash2 size={14} /> Delete draft
              </button>
            )}
            {editable && (
              <button type="button" className="pj-btn pj-btn-ghost" disabled={locked} onClick={regenerate}>
                <RefreshCw size={14} /> {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
              </button>
            )}
            {editable && (
              <button type="button" className="pj-btn pj-btn-ghost" disabled={locked || !dirty || invalid} onClick={save}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </button>
            )}
            {invoice.status === "draft" && invoice.provider_invoice_id && (
              <button type="button" className="pj-btn pj-btn-primary" disabled={locked || dirty}
                title={dirty ? "Save your changes before validating." : undefined} onClick={() => setConfirm("validate")}>
                {busy === "validate" ? "Validating…" : "Validate"}
              </button>
            )}
            {invoice.status === "finalized" && (
              <button type="button" className="pj-btn pj-btn-ghost inv-danger" disabled={locked} onClick={() => setConfirm("cancel")}>
                {busy === "cancel" ? "Canceling…" : "Cancel invoice"}
              </button>
            )}
            {invoice.invoice_url && (
              <a className="pj-btn pj-btn-ghost" href={invoice.invoice_url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Open in Qonto
              </a>
            )}
            {validated && (
              <button type="button" className="pj-btn pj-btn-primary" disabled={locked || !detail.recipients || detail.recipients.length === 0}
                title={detail.recipients === null ? RECIPIENTS_UNREAD : undefined}
                onClick={() => setConfirm(invoice.sent_at ? "resend" : "send")}>
                <Send size={14} /> {busy === "send" ? "Sending…" : invoice.sent_at ? "Resend" : "Send"}
              </button>
            )}
          </footer>
        )}

        {confirm && invoice && totals && (
          <div className="inv-confirm-backdrop">
            <div className="inv-confirm" role="alertdialog" aria-modal="true" aria-labelledby="inv-confirm-title">
              {confirm === "validate" && (
                <>
                  <h3 id="inv-confirm-title">Validate this invoice?</h3>
                  <p>Qonto will assign a number and the invoice can no longer be edited, only canceled.</p>
                  {invoice.source === "imported" && <p className="inv-error-text">This draft was imported from Qonto, not created from a CRA.</p>}
                  <p className="inv-confirm-amount">{money(invoice.total_ttc, currency)} <span>TTC</span></p>
                </>
              )}
              {confirm === "delete" && (
                <>
                  <h3 id="inv-confirm-title">Delete this draft?</h3>
                  <p>{invoice.provider_invoice_id ? "It is deleted in Qonto and here." : "It only exists here; nothing is sent to Qonto."}</p>
                </>
              )}
              {confirm === "cancel" && (
                <>
                  <h3 id="inv-confirm-title">Cancel invoice {invoice.number}?</h3>
                  <p>The {money(invoice.total_ttc, currency)} TTC invoice is canceled in Qonto. This cannot be undone.</p>
                </>
              )}
              {confirm === "send" && (
                <>
                  <h3 id="inv-confirm-title">Send invoice {invoice.number}?</h3>
                  <p>Qonto emails the {money(invoice.total_ttc, currency)} TTC invoice to:</p>
                  <ul className="inv-confirm-list">
                    {(detail?.recipients ?? []).map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </>
              )}
              {confirm === "resend" && (
                <>
                  <h3 id="inv-confirm-title">Send this invoice again?</h3>
                  <p>It was already sent on {dateTime(invoice.sent_at)}. It will be emailed again to {detail?.recipients?.join(", ") || "the client's Qonto emails"}.</p>
                </>
              )}
              <div className="inv-confirm-actions">
                <button type="button" className="pj-btn pj-btn-ghost" disabled={locked} onClick={() => setConfirm(null)}>Back</button>
                <button
                  type="button"
                  className={`pj-btn ${confirm === "validate" || confirm === "send" || confirm === "resend" ? "pj-btn-primary" : "pj-btn-ghost inv-danger"}`}
                  disabled={locked}
                  onClick={() => {
                    if (confirm === "validate") void validate();
                    else if (confirm === "delete") void remove();
                    else if (confirm === "cancel") void cancel();
                    else void send(confirm === "resend");
                  }}
                >
                  {locked
                    ? "Working…"
                    : confirm === "validate" ? "Validate" : confirm === "delete" ? "Delete draft" : confirm === "cancel" ? "Cancel invoice" : confirm === "send" ? "Send" : "Send again"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
