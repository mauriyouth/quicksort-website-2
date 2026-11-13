import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Link2, RefreshCw, Send, Trash2 } from "lucide-react";
import { cn } from "cn";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { PageAlerts, linkButton } from "../../ui";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { errorText, InvoicingError, type InvoicingApi } from "./api";
import { addDays, billingMonthOptions, dateTime, invoiceRowLabel, lineTotals, money, monthLabel, parisToday, shortDate, sourceLabel } from "./format";
import type { DraftResponse, InvoiceDetail, InvoiceLine, InvoiceResponse } from "./types";

// Payment-term shortcuts, counted from the issue date.
const DUE_PRESETS = [15, 30, 45, 60];

type LineEdit = { id: string; quantity: string; unitPrice: string; description: string };
type Confirm = "validate" | "delete" | "cancel" | "send" | "resend" | null;
const RECIPIENTS_UNREAD = "Couldn't read the client's invoice emails from Qonto. Refresh and try again.";

const QTY = /^\d{1,6}(\.\d{1,4})?$/;
const PRICE = /^\d{1,9}(\.\d{1,2})?$/;

const toEdit = (l: InvoiceLine): LineEdit => ({
  id: l.id,
  quantity: String(Number(l.quantity)),
  unitPrice: Number(l.unit_price).toFixed(2),
  description: l.description ?? "",
});
/** Optional prev/next through a list of invoices (← / → when focus is not in a field). */
export type InvoiceNav = { index: number; total: number; onPrev?: () => void; onNext?: () => void };

// Arrow keys belong to these elements (text editing, selects, toggle groups, tabs).
const OWNS_ARROWS = "input,textarea,select,[contenteditable=true],[role=group],[role=radiogroup],[role=toolbar],[role=tablist],[role=menu],[role=listbox]";

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
  nav,
}: {
  api: InvoicingApi;
  invoiceId: string;
  craChanged?: boolean;
  initialWarning?: string;
  onClose: () => void;
  onChanged: () => void;
  nav?: InvoiceNav;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [lines, setLines] = useState<LineEdit[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [periodMonth, setPeriodMonth] = useState("");
  const [consultantId, setConsultantId] = useState("");
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
    setPeriodMonth((next.invoice.period_month ?? "").slice(0, 7));
    setConsultantId(next.invoice.employee_id ?? "");
  }, []);

  // Browsing with ← / → swaps invoiceId in place (the sheet stays open), so a late response for
  // the previous invoice must not land on the new one.
  const current = useRef(invoiceId);
  current.current = invoiceId;
  const load = useCallback(async () => {
    try {
      const next = await api.get<InvoiceDetail>({ resource: "invoice", id: invoiceId });
      if (current.current === invoiceId) apply(next);
    } catch (e) {
      if (current.current === invoiceId) setError(errorText(e, "Could not load the invoice."));
    }
  }, [api, invoiceId, apply]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else {
      setDetail(null); setError(""); setWarning(""); setMessage("");
      setConfirm(null); setRegenerated(false); setDeleted(false);
    }
    void load();
  }, [load]);

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

  // Imported invoices: which consultant-month of the CRA this invoice covers. Both fields save together.
  const savedPeriod = (invoice?.period_month ?? "").slice(0, 7);
  const savedConsultant = invoice?.employee_id ?? "";
  const canAssign = invoice?.source === "imported" && !!invoice.project_id;
  const periodChanged = periodMonth !== savedPeriod;
  const consultantChanged = canAssign && consultantId !== savedConsultant;
  const linkDirty = periodChanged || consultantChanged;

  const saveLink = () => run("link", async () => {
    const warnings: string[] = [];
    if (periodChanged) {
      const r = await api.post<InvoiceResponse>("set_period", { invoiceId, month: periodMonth || null });
      if (r.warning) warnings.push(r.warning);
      // Keep the month saved even if the consultant step below fails.
      setDetail((d) => (d ? { ...d, invoice: { ...d.invoice, period_month: periodMonth ? `${periodMonth}-01` : null } } : d));
    }
    if (consultantChanged) {
      const r = await api.post<InvoiceResponse>("assign_consultant", { invoiceId, employeeId: consultantId || null });
      if (r.warning) warnings.push(r.warning);
    }
    return { warning: warnings.join(" ") };
  }, async (r) => {
    await load();
    if (!r.warning) setMessage("CRA link saved.");
  });

  const resetLink = () => { setPeriodMonth(savedPeriod); setConsultantId(savedConsultant); };

  const periodOptions = useMemo(() => billingMonthOptions(invoice?.issue_date, invoice?.period_month), [invoice?.issue_date, invoice?.period_month]);

  // Moving to another invoice would drop unsaved edits, so it waits until they are saved or reset.
  const navBlocked = busy !== null || confirm !== null || dirty || linkDirty;
  const navHint = dirty || linkDirty ? "Save or reset your changes first" : undefined;
  const goPrev = !navBlocked ? nav?.onPrev : undefined;
  const goNext = !navBlocked ? nav?.onNext : undefined;
  useEffect(() => {
    if (!nav) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.target instanceof Element && e.target.closest(OWNS_ARROWS)) return;
      const go = e.key === "ArrowLeft" ? goPrev : goNext;
      if (!go) return;
      e.preventDefault();
      go();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [nav, goPrev, goNext]);

  const setLine = (id: string, patch: Partial<LineEdit>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const locked = busy !== null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !locked) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-[760px]">
        <SheetHeader className="gap-2">
          <div className="flex items-center gap-3 pr-10">
            <span className="label-mono">
              {invoice ? `${sourceLabel(invoice.source)} · ${monthLabel(invoice.period_month ?? invoice.issue_date)}` : "Invoice"}
            </span>
            {nav && nav.total > 1 && (
              <div className="ml-auto flex items-center gap-1" aria-label="Browse invoices">
                <Button variant="ghost" size="icon-sm" aria-label="Previous invoice" aria-keyshortcuts="ArrowLeft"
                  title={navHint ?? "Previous (←)"} disabled={!goPrev} onClick={goPrev}><ChevronLeft /></Button>
                <span className="num min-w-12 text-center text-xs text-muted-foreground">
                  {nav.index >= 0 ? `${nav.index + 1} / ${nav.total}` : `– / ${nav.total}`}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Next invoice" aria-keyshortcuts="ArrowRight"
                  title={navHint ?? "Next (→)"} disabled={!goNext} onClick={goNext}><ChevronRight /></Button>
              </div>
            )}
          </div>
          <SheetTitle className="text-2xl">
            {invoice ? invoice.number || (invoice.status === "draft" ? "Draft invoice" : "Invoice") : "Loading…"}
          </SheetTitle>
          {invoice && (
            <SheetDescription render={<div />} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <InvoiceStatusBadge label={invoiceRowLabel(invoice)} />
              {invoice.consultant_name && (craHref(invoice)
                ? <Link className="text-foreground underline-offset-4 hover:underline" to={craHref(invoice)!} title="Open the CRA this invoice covers">{invoice.consultant_name}</Link>
                : <span className="text-foreground">{invoice.consultant_name}</span>)}
              {invoice.project_title && <span>{invoice.project_title}</span>}
              {invoice.client_name && <span>Billed to {invoice.client_name}</span>}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 *:shrink-0">
          <PageAlerts error={error} />
          {warning && <Alert variant="warning" role="status"><AlertDescription>{warning}</AlertDescription></Alert>}
          <PageAlerts message={message} />

          {deleted ? (
            <p className="m-0 text-sm text-muted-foreground">This draft no longer exists.</p>
          ) : !detail || !invoice ? (
            !error && <p role="status" className="m-0 text-sm text-muted-foreground">Loading the invoice…</p>
          ) : (
            <>
              {craChanged && !regenerated && editable && (
                <Alert variant="warning" role="status">
                  <AlertDescription>CRA changed. Regenerate this draft so it matches the timesheet.</AlertDescription>
                  <AlertAction>
                    <Button variant="outline" size="sm" disabled={locked} onClick={regenerate}>
                      <RefreshCw data-icon="inline-start" /> {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
                    </Button>
                  </AlertAction>
                </Alert>
              )}
              {notInQonto && (
                <Alert variant="warning" role="status">
                  <AlertDescription>This draft was never created in Qonto (the request was interrupted). Delete it, then create the draft again.</AlertDescription>
                </Alert>
              )}
              {invoice.source === "imported" && invoice.status === "draft" && (
                <Alert variant="warning" role="status">
                  <AlertDescription>Imported from Qonto, not created from a CRA. Check that it is not a duplicate of a CRA draft before validating it; edit its lines in Qonto.</AlertDescription>
                </Alert>
              )}

              {invoice.source === "imported" && (
                <Card size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Link2 className="size-4 text-muted-foreground" aria-hidden /> CRA link</CardTitle>
                    <CardDescription>
                      <CraLinkSummary invoice={invoice} consultants={detail.consultants} />
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor="inv-consultant">Consultant</FieldLabel>
                        <NativeSelect id="inv-consultant" className="w-full" value={consultantId}
                          disabled={locked || !canAssign || !detail.consultants?.length} onChange={(e) => setConsultantId(e.target.value)}>
                          <NativeSelectOption value="">Not assigned</NativeSelectOption>
                          {(detail.consultants ?? []).map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
                        </NativeSelect>
                        <FieldDescription className="text-xs">
                          {!canAssign
                            ? "Attach the invoice to a project first: link it from a CRA row in the list."
                            : detail.consultants?.length ? "Staffed on this project." : "Nobody is staffed on this project yet."}
                        </FieldDescription>
                      </Field>
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor="inv-period">Billing month</FieldLabel>
                        <NativeSelect id="inv-period" className="w-full" value={periodMonth} disabled={locked} onChange={(e) => setPeriodMonth(e.target.value)}>
                          <NativeSelectOption value="">Issue month{invoice.issue_date ? ` (${monthLabel(invoice.issue_date)})` : ""}</NativeSelectOption>
                          {periodOptions.map((m) => <NativeSelectOption key={m} value={m}>{monthLabel(m)}</NativeSelectOption>)}
                        </NativeSelect>
                        <FieldDescription className="text-xs">The month the work was done.</FieldDescription>
                      </Field>
                    </div>
                    {linkDirty && (
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                        <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
                        <Button variant="ghost" size="sm" disabled={locked} onClick={resetLink}>Reset</Button>
                        <Button size="sm" disabled={locked} onClick={() => void saveLink()}>
                          {busy === "link" ? "Saving…" : "Save link"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card size="sm">
                <CardHeader>
                  <CardTitle>Lines</CardTitle>
                  {editable && <CardDescription>Values that differ from the CRA computation are highlighted.</CardDescription>}
                </CardHeader>
                <CardContent>
                  {detail.lines.length === 0 ? (
                    <p className="m-0 text-sm text-muted-foreground">
                      {invoice.source === "imported" ? "Lines of imported invoices are kept in Qonto." : "No lines saved here. Regenerate the draft."}
                    </p>
                  ) : (
                    <div className="flex flex-col divide-y divide-border">
                      {detail.lines.map((l) => {
                        const e = lines.find((x) => x.id === l.id) ?? toEdit(l);
                        const qtyOff = differs(l.computed_quantity, e.quantity);
                        const priceOff = differs(l.computed_unit_price, e.unitPrice);
                        return (
                          <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" key={l.id}>
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                              <span className="font-medium">{l.title}</span>
                              {l.pricing_line && <span className="text-xs text-muted-foreground">{l.pricing_line}</span>}
                            </div>
                            {editable ? (
                              <>
                                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem]">
                                  <Field className="gap-1.5">
                                    <FieldLabel htmlFor={`inv-qty-${l.id}`}>Quantity ({l.unit})</FieldLabel>
                                    <Input id={`inv-qty-${l.id}`} inputMode="decimal" value={e.quantity} disabled={locked}
                                      className={cn("num", qtyOff && changedInput)}
                                      onChange={(ev) => setLine(l.id, { quantity: ev.target.value })} />
                                    {qtyOff && <FieldDescription className="num text-xs">CRA: {Number(l.computed_quantity)}</FieldDescription>}
                                  </Field>
                                  <Field className="gap-1.5">
                                    <FieldLabel htmlFor={`inv-price-${l.id}`}>Unit price HT</FieldLabel>
                                    <Input id={`inv-price-${l.id}`} inputMode="decimal" value={e.unitPrice} disabled={locked}
                                      className={cn("num", priceOff && changedInput)}
                                      onChange={(ev) => setLine(l.id, { unitPrice: ev.target.value })} />
                                    {priceOff && <FieldDescription className="num text-xs">TJM: {money(l.computed_unit_price, currency)}</FieldDescription>}
                                  </Field>
                                  <Field className="gap-1.5">
                                    <span className="text-sm font-medium">VAT</span>
                                    <span className="num flex h-10 items-center text-sm text-muted-foreground">{Math.round(Number(l.vat_rate) * 1000) / 10} %</span>
                                  </Field>
                                </div>
                                <Field className="gap-1.5">
                                  <FieldLabel htmlFor={`inv-desc-${l.id}`}>Description</FieldLabel>
                                  <Textarea id={`inv-desc-${l.id}`} className="min-h-20 text-sm md:text-sm" value={e.description} disabled={locked}
                                    onChange={(ev) => setLine(l.id, { description: ev.target.value })} />
                                </Field>
                              </>
                            ) : (
                              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                                <span className="num">{Number(l.quantity)} {l.unit} × {money(l.unit_price, currency)}</span>
                                <span className="text-muted-foreground">VAT {Math.round(Number(l.vat_rate) * 1000) / 10} %</span>
                                {l.description && <p className="m-0 w-full whitespace-pre-line text-muted-foreground">{l.description}</p>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card size="sm">
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {editable ? (
                      <>
                        <Field className="gap-1.5">
                          <FieldLabel htmlFor="inv-due-date">Due date</FieldLabel>
                          <Input id="inv-due-date" type="date" value={dueDate} min={invoice.issue_date ?? undefined} disabled={locked}
                            onChange={(e) => setDueDate(e.target.value)} />
                          <ToggleGroup variant="outline" size="sm" aria-label="Payment terms" className="mt-1"
                            value={DUE_PRESETS.filter((n) => dueDate === addDays(invoice.issue_date ?? parisToday(), n)).map(String)}
                            onValueChange={(v) => { const n = Number(v[0]); if (v[0]) setDueDate(addDays(invoice.issue_date ?? parisToday(), n)); }}>
                            {DUE_PRESETS.map((n) => (
                              <ToggleGroupItem key={n} value={String(n)} disabled={locked} title={`Due ${shortDate(addDays(invoice.issue_date ?? parisToday(), n))}`}>
                                J+{n}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </Field>
                        <Field className="gap-1.5">
                          <FieldLabel htmlFor="inv-po">Purchase order <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                          <Input id="inv-po" value={purchaseOrder} maxLength={200} disabled={locked} onChange={(e) => setPurchaseOrder(e.target.value)} />
                        </Field>
                      </>
                    ) : (
                      <>
                        <ReadField label="Issue date">{shortDate(invoice.issue_date)}</ReadField>
                        <ReadField label="Due date">{shortDate(invoice.due_date)}</ReadField>
                        {invoice.purchase_order && <ReadField label="Purchase order">{invoice.purchase_order}</ReadField>}
                        {invoice.sent_at && <ReadField label="Sent">{dateTime(invoice.sent_at)}</ReadField>}
                        {invoice.paid_at && <ReadField label="Paid">{shortDate(invoice.paid_at)}</ReadField>}
                      </>
                    )}
                  </div>
                  {totals && (
                    <dl className="m-0 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Total HT</dt><dd className="num m-0">{money(totals.ht, currency)}</dd></div>
                      <div className="flex justify-between gap-4"><dt className="text-muted-foreground">VAT</dt><dd className="num m-0">{money(totals.vat, currency)}</dd></div>
                      <div className="flex items-baseline justify-between gap-4 pt-1 text-base font-medium">
                        <dt>Total TTC{dirty ? <span className="font-normal text-muted-foreground"> (unsaved)</span> : ""}</dt>
                        <dd className="num m-0">{money(totals.ttc, currency)}</dd>
                      </div>
                    </dl>
                  )}
                  {invalid && <p role="alert" className="m-0 text-sm text-destructive">Quantities must be positive (up to 4 decimals) and prices have at most 2 decimals.</p>}
                </CardContent>
              </Card>

              {validated && (
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>Send</CardTitle>
                    <CardDescription>
                      {detail.recipients === null
                        ? RECIPIENTS_UNREAD
                        : detail.recipients.length
                          ? `To ${detail.recipients.join(", ")}`
                          : "This client has no invoice email in Qonto."}
                    </CardDescription>
                  </CardHeader>
                  {invoice.sent_at && <CardContent><p className="m-0 text-sm text-muted-foreground">Already sent on {dateTime(invoice.sent_at)}.</p></CardContent>}
                </Card>
              )}

              {detail.events.length > 0 && (
                <section aria-labelledby="inv-history-title" className="flex flex-col gap-2">
                  <h3 id="inv-history-title" className="label-mono m-0">History</h3>
                  <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-sm">
                    {detail.events.map((ev) => (
                      <li key={ev.id} className="flex justify-between gap-4 py-2 first:pt-0">
                        <span className="first-letter:uppercase">{ev.kind.replace(/_/g, " ")}</span>
                        <span className="num shrink-0 text-xs text-muted-foreground">{dateTime(ev.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {detail && invoice && !deleted && (
          <SheetFooter className="flex-row flex-wrap justify-end">
            {invoice.status === "draft" && (
              <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={locked} onClick={() => setConfirm("delete")}>
                <Trash2 data-icon="inline-start" /> Delete draft
              </Button>
            )}
            {editable && (
              <Button variant="outline" disabled={locked} onClick={regenerate}>
                <RefreshCw data-icon="inline-start" /> {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
              </Button>
            )}
            {editable && (
              <Button variant="outline" disabled={locked || !dirty || invalid} data-save-shortcut onClick={save}>
                {busy === "save" ? "Saving…" : "Save changes"}
              </Button>
            )}
            {invoice.status === "draft" && invoice.provider_invoice_id && (
              <Button disabled={locked || dirty}
                title={dirty ? "Save your changes before validating." : undefined} onClick={() => setConfirm("validate")}>
                {busy === "validate" ? "Validating…" : "Validate"}
              </Button>
            )}
            {invoice.status === "finalized" && (
              <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" disabled={locked} onClick={() => setConfirm("cancel")}>
                {busy === "cancel" ? "Canceling…" : "Cancel invoice"}
              </Button>
            )}
            {invoice.invoice_url && (
              <a className={linkButton({ variant: "outline" })} href={invoice.invoice_url} target="_blank" rel="noreferrer">
                <ExternalLink data-icon="inline-start" /> Open in Qonto
              </a>
            )}
            {validated && (
              <Button disabled={locked || !detail.recipients || detail.recipients.length === 0}
                title={detail.recipients === null ? RECIPIENTS_UNREAD : undefined}
                onClick={() => setConfirm(invoice.sent_at ? "resend" : "send")}>
                <Send data-icon="inline-start" /> {busy === "send" ? "Sending…" : invoice.sent_at ? "Resend" : "Send"}
              </Button>
            )}
          </SheetFooter>
        )}

        <AlertDialog open={!!(confirm && invoice && totals)} onOpenChange={(open) => { if (!open && !locked) setConfirm(null); }}>
          <AlertDialogContent>
            {confirm && invoice && (
              <>
                <AlertDialogHeader>
                  {confirm === "validate" && (
                    <>
                      <AlertDialogTitle>Validate this invoice?</AlertDialogTitle>
                      <AlertDialogDescription>Qonto will assign a number and the invoice can no longer be edited, only canceled.</AlertDialogDescription>
                      {invoice.source === "imported" && <p className="m-0 text-sm text-destructive">This draft was imported from Qonto, not created from a CRA.</p>}
                      <p className="num m-0 pt-2 text-2xl font-medium">{money(invoice.total_ttc, currency)} <span className="text-sm text-muted-foreground">TTC</span></p>
                    </>
                  )}
                  {confirm === "delete" && (
                    <>
                      <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                      <AlertDialogDescription>{invoice.provider_invoice_id ? "It is deleted in Qonto and here." : "It only exists here; nothing is sent to Qonto."}</AlertDialogDescription>
                    </>
                  )}
                  {confirm === "cancel" && (
                    <>
                      <AlertDialogTitle>Cancel invoice {invoice.number}?</AlertDialogTitle>
                      <AlertDialogDescription>The {money(invoice.total_ttc, currency)} TTC invoice is canceled in Qonto. This cannot be undone.</AlertDialogDescription>
                    </>
                  )}
                  {confirm === "send" && (
                    <>
                      <AlertDialogTitle>Send invoice {invoice.number}?</AlertDialogTitle>
                      <AlertDialogDescription>Qonto emails the {money(invoice.total_ttc, currency)} TTC invoice to:</AlertDialogDescription>
                      <ul className="m-0 list-none p-0 text-sm">
                        {(detail?.recipients ?? []).map((r) => <li key={r} className="num">{r}</li>)}
                      </ul>
                    </>
                  )}
                  {confirm === "resend" && (
                    <>
                      <AlertDialogTitle>Send this invoice again?</AlertDialogTitle>
                      <AlertDialogDescription>It was already sent on {dateTime(invoice.sent_at)}. It will be emailed again to {detail?.recipients?.join(", ") || "the client's Qonto emails"}.</AlertDialogDescription>
                    </>
                  )}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={locked}>Back</AlertDialogCancel>
                  <Button
                    variant={confirm === "validate" || confirm === "send" || confirm === "resend" ? "default" : "destructive"}
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
                  </Button>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

// Edited values that differ from the CRA computation.
const changedInput = "border-warning ring-2 ring-warning/20 hover:border-warning";

// The person-record CRA page for the consultant-month an invoice bills.
function craHref(invoice: InvoiceDetail["invoice"]): string | null {
  const month = (invoice.period_month ?? invoice.issue_date)?.slice(0, 7);
  if (!invoice.consultant_person_id || !month) return null;
  return `/hr/people/${encodeURIComponent(invoice.consultant_person_id)}/cra/${month.replace("-", "/")}`;
}

// What an imported invoice currently covers in the CRA, as a link to it.
function CraLinkSummary({ invoice, consultants }: { invoice: InvoiceDetail["invoice"]; consultants: InvoiceDetail["consultants"] }) {
  const name = invoice.consultant_name ?? consultants?.find((c) => c.id === invoice.employee_id)?.name;
  if (!invoice.employee_id || !name) return <>Not linked to a consultant.</>;
  const label = `${name} · ${monthLabel(invoice.period_month ?? invoice.issue_date)} CRA`;
  const href = craHref(invoice);
  return href
    ? <Link className="text-foreground underline underline-offset-4" to={href}>{label}</Link>
    : <>{label}</>;
}

function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-muted-foreground">{children}</span>
    </div>
  );
}
