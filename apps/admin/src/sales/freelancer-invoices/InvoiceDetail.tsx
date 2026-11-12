import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Upload } from "lucide-react";
import { cn } from "cn";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@quicksort-sas/ui";
import { PageAlerts } from "../../ui";
import { errorText, FreelancerInvoicesError } from "./api";
import type { Billing, FreelancerInvoicesApi, InvoiceEvent, InvoiceView, MonthRow } from "./api";
import { centsInput, craCheck, dayCount, dayMonth, euro, EVENT_LABELS, FLAG_LABELS, parseEuros, statusCell } from "./format";
import type { Tone } from "./format";

const PAID_ELSEWHERE = "This payment is already linked to another invoice. Unlink it there, or record it as one payment for several invoices.";
const NOTE_MIN = 3;
/** The API's cap (apps/admin/api/freelancer-invoices.ts). */
const MAX_PDF_BYTES = 3 * 1024 * 1024;

/** The file as base64, without the data-URL prefix. */
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

export const toneClass: Record<Tone, string> = {
  ok: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};

type FieldEdit = {
  number: string; issueDate: string; dueDate: string; periodMonth: string;
  amountHt: string; vat: string; amountTtc: string; isCreditNote: boolean;
};
const toEdit = (i: InvoiceView): FieldEdit => ({
  number: i.number ?? "",
  issueDate: i.issueDate ?? "",
  dueDate: i.dueDate ?? "",
  periodMonth: (i.periodMonth ?? "").slice(0, 7),
  amountHt: centsInput(i.amountHtCents),
  vat: centsInput(i.vatCents),
  amountTtc: centsInput(i.amountTtcCents),
  isCreditNote: i.isCreditNote,
});

/** Only what changed, in the API's field names; null when an amount does not parse. */
function changedFields(inv: InvoiceView, e: FieldEdit): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const orNull = (s: string) => (s.trim() ? s.trim() : null);
  if (e.number.trim() !== (inv.number ?? "")) out.number = e.number.trim();
  if (orNull(e.issueDate) !== inv.issueDate) out.issueDate = orNull(e.issueDate);
  if (orNull(e.dueDate) !== inv.dueDate) out.dueDate = orNull(e.dueDate);
  const period = e.periodMonth ? `${e.periodMonth}-01` : null;
  if (period !== inv.periodMonth) out.periodMonth = period;
  for (const [key, text, current] of [
    ["amountHtCents", e.amountHt, inv.amountHtCents],
    ["vatCents", e.vat, inv.vatCents],
    ["amountTtcCents", e.amountTtc, inv.amountTtcCents],
  ] as const) {
    const cents = parseEuros(text);
    if (cents === undefined) return null;
    if (cents !== current) out[key] = cents;
  }
  if (e.isCreditNote !== inv.isCreditNote) out.isCreditNote = e.isCreditNote;
  return out;
}

/**
 * Freelancer invoices → detail panel. One invoice (or, for a missing invoice,
 * just the freelancer's month): the PDF, its editable fields, the CRA
 * breakdown, suggested payments, the review, billing details and history.
 */
export function InvoiceDetail({
  api, name, row, invoice, others = [], onClose, onChanged,
}: {
  api: FreelancerInvoicesApi;
  name: string;
  /** The freelancer's month; null for an invoice without a period. */
  row: MonthRow | null;
  /** Null when the invoice is missing. */
  invoice: InvoiceView | null;
  /** The same freelancer's other unpaid, non-rejected invoices: one debit may pay several. */
  others?: InvoiceView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  // Per suggested debit, the other invoices it also pays.
  const [alsoPays, setAlsoPays] = useState<Record<string, string[]>>({});
  const [edit, setEdit] = useState<FieldEdit | null>(invoice ? toEdit(invoice) : null);
  const [billing, setBilling] = useState<Billing | null>(row ? row.billing : null);
  const [emails, setEmails] = useState(row ? row.billing.extraEmails.join(", ") : "");
  const [events, setEvents] = useState<InvoiceEvent[] | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const locked = busy !== null;

  // A reload brings a new version: start the form again from it.
  const version = invoice?.version;
  useEffect(() => { if (invoice) setEdit(toEdit(invoice)); }, [invoice?.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const invoiceId = invoice?.id;
  const loadEvents = useCallback(async () => {
    if (!invoiceId) return;
    try { setEvents((await api.get<{ events: InvoiceEvent[] }>({ resource: "events", id: invoiceId })).events); }
    catch (e) { setError(errorText(e, "Could not load the history.")); }
  }, [api, invoiceId]);
  useEffect(() => { void loadEvents(); }, [loadEvents, version]);

  async function act(name: string, fn: () => Promise<unknown>, done: string | (() => string), pay = false) {
    if (busy) return;
    setBusy(name); setError(""); setMessage("");
    try {
      await fn();
      if (name === "accept" || name === "reject") setNote("");
      setMessage(typeof done === "function" ? done() : done);
      onChanged();
      void loadEvents();
    } catch (e) {
      setError(pay && e instanceof FreelancerInvoicesError && e.status === 409 ? PAID_ELSEWHERE : errorText(e));
    } finally { setBusy(null); }
  }

  // An invoice the freelancer could not send (portal closed, mail missed), filed for them.
  async function uploadPdf(file: File) {
    if (!row) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError("Only PDF invoices are accepted."); return; }
    if (file.size > MAX_PDF_BYTES) { setError("The invoice is larger than 3 MB."); return; }
    let duplicate = false;
    await act("upload", async () => {
      const data = await toBase64(file);
      duplicate = (await api.post<{ duplicate: boolean }>("upload", { employeeId: row.employeeId, fileName: file.name, mimeType: "application/pdf", data })).duplicate;
    }, () => (duplicate ? "This invoice is already on file." : "Invoice uploaded. It is read and checked like an emailed one."));
  }

  async function openPdf() {
    if (!invoice || busy) return;
    // Opened before the request so the browser does not block it as a popup.
    const tab = window.open("", "_blank");
    setBusy("pdf"); setError("");
    try {
      const { url } = await api.get<{ url: string }>({ resource: "pdf", id: invoice.id });
      if (tab) { tab.opener = null; tab.location.href = url; } else window.location.assign(url);
    } catch (e) { tab?.close(); setError(errorText(e, "Could not open the PDF.")); }
    finally { setBusy(null); }
  }

  const fields = invoice && edit ? changedFields(invoice, edit) : null;
  const fieldsInvalid = !!invoice && !!edit && fields === null;
  const fieldsDirty = !!fields && Object.keys(fields).length > 0;
  const noteOk = note.trim().length >= NOTE_MIN;
  const status = invoice ? statusCell(invoice) : { text: "Missing", tone: "danger" as Tone };
  const check = craCheck(row);
  const emailList = emails.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
  const billingDirty = !!row && !!billing && (
    billing.companyName !== row.billing.companyName || billing.siret !== row.billing.siret || billing.iban !== row.billing.iban
    || emailList.join(",") !== row.billing.extraEmails.join(","));

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !locked) onClose(); }}>
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-[640px]">
        <SheetHeader className="gap-2">
          <span className="label-mono pr-10">{invoice ? `${invoice.source === "email" ? "Email" : "Portal"} · received ${dayMonth(invoice.createdAt)}` : "No invoice received"}</span>
          <SheetTitle className="text-2xl">{name || "Freelancer"}</SheetTitle>
          <SheetDescription render={<div />} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {invoice && <span className="num text-foreground">{invoice.number || "No number"}</span>}
            {invoice?.isCreditNote && <Badge variant="outline">Credit note</Badge>}
            <span className={toneClass[status.tone]}>{status.text}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 *:shrink-0">
          <PageAlerts error={error} message={message} />

          {invoice && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" disabled={locked || !invoice.documentId} onClick={() => void openPdf()}>
                <ExternalLink data-icon="inline-start" /> {busy === "pdf" ? "Opening…" : invoice.documentId ? "Open PDF" : "No PDF on file"}
              </Button>
              {invoice.flags.map((f) => <Badge key={f} variant="warning">{FLAG_LABELS[f] ?? f}</Badge>)}
            </div>
          )}

          {invoice && invoice.display.status !== "paid" && invoice.review !== "rejected" && (
            <Section title="Payment" description={invoice.suggestions.length ? "Debits from Qonto that may pay this invoice." : "No matching debit in Qonto yet."}>
              {invoice.suggestions.map((s) => (
                <div key={s.transactionId} className="flex flex-col gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{s.counterparty || "Unknown payee"}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="num">{euro(Math.abs(s.amountCents))}</span> · {dayMonth(s.settledAt)}{s.why ? ` · ${s.why}` : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={locked}
                      onClick={() => {
                        const extra = alsoPays[s.transactionId] ?? [];
                        void act(`confirm:${s.transactionId}`, () => extra.length
                          ? api.post("link_debit", { invoiceIds: [invoice.id, ...extra], transactionId: s.transactionId })
                          : api.post("confirm_match", { invoiceId: invoice.id, transactionId: s.transactionId }),
                        extra.length ? `Payment recorded for ${extra.length + 1} invoices.` : "Payment confirmed.", true);
                      }}>
                      {busy === `confirm:${s.transactionId}` ? "Confirming…" : (alsoPays[s.transactionId]?.length ? `Confirm for ${alsoPays[s.transactionId].length + 1} invoices` : "Confirm")}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={locked}
                      onClick={() => void act(`dismiss:${s.transactionId}`, () => api.post("dismiss_match", { invoiceId: invoice.id, transactionId: s.transactionId }), "Suggestion dismissed.")}>
                      Dismiss
                    </Button>
                  </div>
                </div>
                {others.length > 0 && (
                  <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" aria-label={`Also pays (${s.counterparty || "this debit"})`}>
                    <legend className="mb-1 p-0 text-xs text-muted-foreground">Also pays… (one payment for several invoices)</legend>
                    {others.map((o) => {
                      const picked = alsoPays[s.transactionId] ?? [];
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-xs">
                          <Checkbox checked={picked.includes(o.id)} disabled={locked}
                            onCheckedChange={(v) => setAlsoPays((prev) => ({
                              ...prev,
                              [s.transactionId]: v === true ? [...picked.filter((id) => id !== o.id), o.id] : picked.filter((id) => id !== o.id),
                            }))} />
                          <span className="num">{o.number || "No number"}</span>
                          <span className="text-muted-foreground">{euro(o.amountTtcCents)} TTC{o.periodMonth ? "" : " · no period"}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
                </div>
              ))}
            </Section>
          )}

          {invoice?.display.status === "paid" && (
            <Section title="Payment" description={`Paid ${dayMonth(invoice.paidAt)} from Qonto.`}>
              <div>
                <Button variant="outline" size="sm" disabled={locked}
                  onClick={() => void act("unlink", () => api.post("unlink", { invoiceId: invoice.id }), "Payment unlinked.")}>
                  {busy === "unlink" ? "Unlinking…" : "Unlink payment"}
                </Button>
              </div>
            </Section>
          )}

          {invoice && invoice.review !== "rejected" && (
            <Section title="Review"
              description={invoice.review === "ok"
                ? (invoice.reviewNote ? `Approved: ${invoice.reviewNote}` : "Approved.")
                : invoice.display.warning ? "The invoices of this month don't match the CRA. Accept the difference or reject the invoice, with a note." : "Approve the invoice or reject it, with a note."}>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="fi-note">Review note</FieldLabel>
                <Textarea id="fi-note" className="min-h-16 text-sm md:text-sm" value={note} maxLength={500} disabled={locked} onChange={(e) => setNote(e.target.value)} />
                <FieldDescription className="text-xs">At least {NOTE_MIN} characters.</FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                {invoice.review === "to_check" && (
                  <Button disabled={locked || !noteOk}
                    onClick={() => void act("accept", () => api.post("accept_difference", { id: invoice.id, note: note.trim() }), "Invoice approved.")}>
                    {busy === "accept" ? "Saving…" : invoice.display.warning ? "Accept difference" : "Approve"}
                  </Button>
                )}
                <Button variant="outline" className="text-destructive hover:text-destructive" disabled={locked || !noteOk}
                  onClick={() => void act("reject", () => api.post("reject", { id: invoice.id, note: note.trim() }), "Invoice rejected.")}>
                  {busy === "reject" ? "Rejecting…" : "Reject"}
                </Button>
              </div>
            </Section>
          )}
          {invoice?.review === "rejected" && (
            <p className="m-0 text-sm text-muted-foreground">Rejected{invoice.reviewNote ? `: ${invoice.reviewNote}` : "."}</p>
          )}

          {row && (
            <Section title="CRA check" description={<span className={toneClass[check.tone]}>{check.text}</span>}>
              <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">Client days in the CRA</dt>
                <dd className="num m-0 text-right">{row.expected ? dayCount(row.expected.days) : "—"}</dd>
                {row.rates.map((r) => (
                  <Fragment key={r.startDate}>
                    <dt className="text-muted-foreground">TJM{row.rates.length > 1 ? ` from ${dayMonth(r.startDate)}` : ""}</dt>
                    <dd className="num m-0 text-right">{euro(r.dailyRate * 100)}</dd>
                  </Fragment>
                ))}
                {row.missingRate && (<><dt className="text-warning">TJM</dt><dd className="m-0 text-right text-warning">No TJM on file</dd></>)}
                <dt className="text-muted-foreground">Expected HT</dt>
                <dd className="num m-0 text-right">{euro(row.check.expectedCents)}</dd>
                <dt className="text-muted-foreground">Invoiced HT (credit notes deducted)</dt>
                <dd className="num m-0 text-right">{euro(row.check.invoicedHtCents)}</dd>
                <dt className="text-muted-foreground">Difference</dt>
                <dd className={cn("num m-0 text-right", row.check.ok ? "text-success" : "text-warning")}>{row.check.diffCents == null ? "—" : euro(row.check.diffCents)}</dd>
              </dl>
            </Section>
          )}

          {invoice && edit && (
            <Section title="Details" description="Read from the PDF. Saving sends the invoice back to To check.">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="fi-number" label="Invoice number" value={edit.number} disabled={locked} onChange={(v) => setEdit({ ...edit, number: v })} />
                <TextField id="fi-period" label="Month worked" type="month" value={edit.periodMonth} disabled={locked} onChange={(v) => setEdit({ ...edit, periodMonth: v })} />
                <TextField id="fi-issue" label="Issue date" type="date" value={edit.issueDate} disabled={locked} onChange={(v) => setEdit({ ...edit, issueDate: v })} />
                <TextField id="fi-due" label="Due date" type="date" value={edit.dueDate} disabled={locked} onChange={(v) => setEdit({ ...edit, dueDate: v })} />
                <TextField id="fi-ht" label="Amount HT (€)" inputMode="decimal" value={edit.amountHt} disabled={locked} onChange={(v) => setEdit({ ...edit, amountHt: v })} />
                <TextField id="fi-vat" label="VAT (€)" inputMode="decimal" value={edit.vat} disabled={locked} onChange={(v) => setEdit({ ...edit, vat: v })} />
                <TextField id="fi-ttc" label="Amount TTC (€)" inputMode="decimal" value={edit.amountTtc} disabled={locked} onChange={(v) => setEdit({ ...edit, amountTtc: v })} />
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox checked={edit.isCreditNote} disabled={locked} onCheckedChange={(v) => setEdit({ ...edit, isCreditNote: v === true })} />
                  Credit note
                </label>
              </div>
              {fieldsInvalid && <p role="alert" className="m-0 text-xs text-destructive">Type amounts in euros, like 8450 or 8450.50.</p>}
              <div>
                <Button variant="outline" size="sm" disabled={locked || !fieldsDirty}
                  onClick={() => void act("fields", () => api.post("update_fields", { id: invoice.id, version: invoice.version, fields }), "Details saved.")}>
                  {busy === "fields" ? "Saving…" : "Save details"}
                </Button>
              </div>
            </Section>
          )}

          {row && (
            <Section title="Upload an invoice" description="A PDF the freelancer could not send, such as the last one after they left. It is read and checked like an emailed one.">
              <div>
                <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="hidden"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void uploadPdf(file);
                  }} />
                <Button variant="outline" size="sm" disabled={locked} onClick={() => pdfInput.current?.click()}>
                  <Upload data-icon="inline-start" /> {busy === "upload" ? "Uploading…" : "Upload invoice"}
                </Button>
              </div>
            </Section>
          )}

          {row && billing && (
            <Section title="Billing details" description="Who we pay. Extra emails are other addresses this freelancer sends invoices from.">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="fi-company" label="Company name" value={billing.companyName} disabled={locked} onChange={(v) => setBilling({ ...billing, companyName: v })} />
                <TextField id="fi-siret" label="SIRET" value={billing.siret} disabled={locked} onChange={(v) => setBilling({ ...billing, siret: v })} />
                <TextField id="fi-iban" label="IBAN" value={billing.iban} disabled={locked} onChange={(v) => setBilling({ ...billing, iban: v })} />
                <TextField id="fi-emails" label="Extra emails" value={emails} disabled={locked} onChange={setEmails} placeholder="billing@company.fr" />
              </div>
              <div>
                <Button variant="outline" size="sm" disabled={locked || !billingDirty}
                  onClick={() => void act("billing", () => api.post("save_billing", {
                    employeeId: row.employeeId, companyName: billing.companyName.trim(), siret: billing.siret.trim(), iban: billing.iban.trim(), extraEmails: emailList,
                  }), "Billing details saved.")}>
                  {busy === "billing" ? "Saving…" : "Save billing details"}
                </Button>
              </div>
            </Section>
          )}

          {invoice && (
            <Section title="History">
              {!events ? (
                <p role="status" className="m-0 text-sm text-muted-foreground">Loading…</p>
              ) : events.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex flex-wrap justify-between gap-x-3">
                      <span>{EVENT_LABELS[ev.kind] ?? ev.kind}{typeof ev.detail?.note === "string" && ev.detail.note ? `: ${ev.detail.note}` : ""}</span>
                      <span className="text-xs text-muted-foreground">{dayMonth(ev.created_at)} · {ev.actor_email}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function TextField({ id, label, value, onChange, disabled, type = "text", inputMode, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
  type?: string; inputMode?: "decimal"; placeholder?: string;
}) {
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type={type} inputMode={inputMode} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
