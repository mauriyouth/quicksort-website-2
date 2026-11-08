import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quicksort-sas/ui";
import { PageAlerts } from "../../ui";
import { errorText, useInvoicingApi, type InvoicingApi } from "./api";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { LinkInvoiceStrip } from "./LinkInvoiceStrip";
import { billingMonthOptions, blockerLabel, days, invoiceRowLabel, money, monthLabel, rowOpener, shiftMonth, shortDate } from "./format";
import type { DraftResponse, Invoice, ToInvoiceRow } from "./types";

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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="m-0 font-heading text-xl leading-tight font-medium tracking-[-0.02em]">Invoices</h2>
        <p className="m-0 text-sm text-muted-foreground">Monthly régie invoices for this project, created from CRA through Qonto.</p>
      </div>

      {(error || warning || message) && (
        <div className="flex flex-col gap-2">
          <PageAlerts error={error} />
          {warning && <Alert variant="warning" role="status"><AlertDescription>{warning}</AlertDescription></Alert>}
          <PageAlerts message={message} />
        </div>
      )}

      {!data ? (
        !error && <p className="m-0 text-sm text-muted-foreground">Loading invoices…</p>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {([["Invoiced HT", data.totals.invoicedHt], ["Paid", data.totals.paidTtc], ["Outstanding", data.totals.outstandingTtc]] as const).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3.5 py-3">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="num m-0 text-lg font-medium">{money(value)}</dd>
              </div>
            ))}
          </dl>

          {data.invoices.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table aria-label="Project invoices">
              <TableHeader>
                <TableRow><TableHead>Invoice</TableHead><TableHead>Consultant</TableHead><TableHead>Period</TableHead><TableHead>Due</TableHead><TableHead numeric>Total TTC</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.invoices.map((i) => {
                  const label = invoiceRowLabel(i);
                  const assignable = i.source === "imported" && !i.employee_id && i.status !== "canceled";
                  return (
                    <Fragment key={i.id}>
                    <TableRow className={cn("cursor-pointer", busy !== null && "cursor-default")} aria-label={`Open ${i.number || "draft invoice"}`}
                      {...rowOpener(() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" }), busy !== null)}>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <span className="num font-medium">{i.number || "—"}</span>
                          <InvoiceStatusBadge label={label} />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {assignable ? (
                          <Button variant="outline" size="xs" aria-expanded={assigning === i.id}
                            aria-label={`Assign a consultant to ${i.number || "this invoice"}`} disabled={busy !== null}
                            onClick={() => setAssigning(assigning === i.id ? null : i.id)}>
                            <Plus data-icon="inline-start" /> Assign consultant
                          </Button>
                        ) : (i.consultant_name || "—")}
                      </TableCell>
                      <TableCell>{monthLabel(i.period_month ?? i.issue_date)}</TableCell>
                      <TableCell className="num text-[13px]">{shortDate(i.due_date)}</TableCell>
                      <TableCell numeric className="font-medium">{money(i.total_ttc, i.currency)}</TableCell>
                    </TableRow>
                    {assigning === i.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="whitespace-normal">
                          <AssignConsultantStrip api={api} projectId={projectId} invoice={i} consultants={data.consultants}
                            onClose={() => setAssigning(null)}
                            onDone={() => { setAssigning(null); setMessage(`${i.number || "The invoice"} is now assigned.`); void load(); }} />
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {pending.length > 0 && (
            <>
              <h3 className="m-0 mt-2 text-[15px] font-medium">Not invoiced yet</h3>
              <Table aria-label="Not invoiced yet">
                <TableHeader>
                  <TableRow><TableHead>Consultant</TableHead><TableHead>Period</TableHead><TableHead numeric>Days</TableHead><TableHead numeric>Amount HT</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Action</span></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((r) => {
                    const month = r.month;
                    const ready = r.blockers.length === 0;
                    const k = `${r.employeeId}:${month}`;
                    return (
                      <Fragment key={k}>
                      <TableRow>
                        <TableCell className="font-medium whitespace-normal">{r.consultantName || "—"}</TableCell>
                        <TableCell>{monthLabel(month)}</TableCell>
                        <TableCell numeric>{days(r.days)}</TableCell>
                        <TableCell numeric className="font-medium">{r.amountHt !== null ? money(r.amountHt) : "—"}</TableCell>
                        <TableCell className="whitespace-normal">
                          <Badge variant="secondary" className="gap-1.5">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                            Not invoiced
                          </Badge>
                          {[...r.blockers, ...r.warnings].map((b) => (
                            <Link key={b}
                              className={cn("mt-1.5 block text-xs underline-offset-4 hover:underline", r.blockers.includes(b as never) ? "text-destructive" : "text-muted-foreground")}
                              to={b === "client_not_linked" || b === "product_not_linked" ? `/sales/invoicing/settings` : b === "cra_incomplete" ? "/hr/cra" : `/sales/projects/${projectId}`}>
                              {blockerLabel(b)}
                            </Link>
                          ))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <Button variant="outline" size="sm" disabled={busy !== null || !ready} onClick={() => void create(r)}>
                              {busy === k ? "Creating…" : "Create draft"}
                            </Button>
                            <Button variant="link" size="xs" className="h-auto px-0 text-muted-foreground" disabled={busy !== null} aria-expanded={linking === k}
                              onClick={() => setLinking(linking === k ? null : k)}>
                              Link Qonto invoice
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {linking === k && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={6} className="whitespace-normal">
                            <LinkInvoiceStrip api={api} month={month} disabled={busy !== null} target={r} onClose={() => setLinking(null)}
                              onLinked={(inv) => { setLinking(null); setMessage(`${inv.number || "The invoice"} now covers this CRA.`); void load(); }} />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
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
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
      {consultants.length === 0 ? (
        <span className="text-muted-foreground">Nobody is staffed on this project yet.</span>
      ) : (
        <>
          <span className="text-muted-foreground">Assign <strong className="font-medium text-foreground">{invoice.number || "this invoice"}</strong> to</span>
          <NativeSelect size="sm" className="max-w-full" aria-label="Consultant" autoFocus value={employeeId} disabled={busy} onChange={(e) => setEmployeeId(e.target.value)}>
            <NativeSelectOption value="">Choose a consultant</NativeSelectOption>
            {consultants.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
          </NativeSelect>
          <span className="text-muted-foreground">for</span>
          <NativeSelect size="sm" className="max-w-full" aria-label="Billing month" value={month} disabled={busy} onChange={(e) => setMonth(e.target.value)}>
            {billingMonthOptions(invoice.issue_date, month).map((m) => <NativeSelectOption key={m} value={m}>{monthLabel(m)}</NativeSelectOption>)}
          </NativeSelect>
          <Button size="sm" disabled={busy || !employeeId || !month} onClick={() => void save()}>
            {busy ? "Saving…" : "Assign"}
          </Button>
        </>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" disabled={busy} onClick={onClose}><X /></Button>
    </div>
  );
}
