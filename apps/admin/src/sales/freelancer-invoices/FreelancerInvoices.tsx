import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { cn } from "cn";
import {
  Button,
  ButtonGroup,
  ButtonGroupText,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts, PageHeading } from "../../ui";
import { monthLabel, previousMonth, rowOpener, shiftMonth } from "../invoicing/format";
import { errorText, useFreelancerInvoicesApi } from "./api";
import type { InvoiceView, MonthResponse, MonthRow } from "./api";
import { craCheck, dayMonth, euro, statusCell } from "./format";
import { InvoiceDetail, toneClass } from "./InvoiceDetail";
import { MailboxSettings } from "./MailboxSettings";

const BASE = "/sales/freelancer-invoices";
type Filter = "all" | "to-check" | "to-pay" | "paid" | "missing";
const FILTERS: [Filter, string][] = [["all", "All"], ["to-check", "To check"], ["to-pay", "To pay"], ["paid", "Paid"], ["missing", "Missing"]];

/** One table line: an invoice of a freelancer month, an invoice with no period, or a missing invoice. */
type Line = { key: string; name: string; row: MonthRow | null; invoice: InvoiceView | null };

function linesOf(data: MonthResponse): Line[] {
  const lines: Line[] = [];
  for (const row of data.rows) {
    for (const invoice of row.invoices) lines.push({ key: invoice.id, name: row.name, row, invoice });
    if (row.missing) lines.push({ key: `missing:${row.employeeId}`, name: row.name, row, invoice: null });
  }
  for (const u of data.unassigned) lines.push({ key: u.id, name: u.name, row: null, invoice: u });
  return lines;
}

// A paid invoice still to review shows under both Paid and To check; one with no period always needs a look.
const inFilter: Record<Filter, (l: Line) => boolean> = {
  all: () => true,
  "to-check": (l) => !!l.invoice && l.invoice.display.status !== "rejected" && (l.row === null || l.invoice.review === "to_check"),
  "to-pay": (l) => l.invoice?.display.status === "to_pay",
  paid: (l) => l.invoice?.display.status === "paid",
  missing: (l) => l.invoice === null,
};

/**
 * Sales → Freelancer invoices. The invoices freelancers send us for a month,
 * checked against their CRA × TJM and matched to Qonto debits; Settings
 * holds the mailbox they arrive in.
 */
export function FreelancerInvoices() {
  const api = useFreelancerInvoicesApi();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsOpen = location.pathname.replace(/\/+$/, "").startsWith(`${BASE}/settings`);

  const [month, setMonth] = useState(previousMonth);
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<MonthResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Only the latest month may land: an older, slower answer must not overwrite it.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await api.get<MonthResponse>({ resource: "month", month: `${month}-01` });
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine === seq.current) { setData(null); setError(errorText(e, "Could not load the month.")); }
    } finally { if (mine === seq.current) setLoading(false); }
  }, [api, month]);
  useEffect(() => { if (!settingsOpen) void load(); }, [load, settingsOpen]);

  const lines = data ? linesOf(data) : [];
  const shown = lines.filter(inFilter[filter]);
  const count = (f: Filter) => lines.filter(inFilter[f]).length;
  // The open line is read from the latest data, so the panel follows each reload.
  const current = open ? lines.find((l) => l.key === open) ?? null : null;

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeading
        title="Freelancer invoices"
        action={!settingsOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <ButtonGroup aria-label="Month worked">
              <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
              <ButtonGroupText className="w-36 justify-center bg-transparent">{monthLabel(month)}</ButtonGroupText>
              <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
            </ButtonGroup>
            <Button variant="outline" size="icon" aria-label="Reload" title="Reload" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          </div>
        )}
      >
        Invoices freelancers sent for the month, checked against their CRA and paid from Qonto.
      </PageHeading>

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <Tabs value={settingsOpen ? null : filter} onValueChange={(v) => {
          if (typeof v !== "string") return;
          setFilter(v as Filter);
          if (settingsOpen) navigate(BASE);
        }}>
          <TabsList variant="line" aria-label="Invoice status" className="h-10 max-w-full gap-5 overflow-x-auto">
            {FILTERS.map(([id, label]) => (
              <TabsTrigger key={id} value={id}>{data ? `${label} (${count(id)})` : label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant={settingsOpen ? "secondary" : "ghost"} size="icon-sm" className="mb-1" aria-label="Mailbox settings" title="Mailbox settings"
          aria-pressed={settingsOpen} onClick={() => navigate(settingsOpen ? BASE : `${BASE}/settings`)}>
          <SettingsIcon />
        </Button>
      </div>

      {settingsOpen ? (
        <MailboxSettings api={api} onSynced={() => void load()} />
      ) : (
        <Card aria-label={`Freelancer invoices · ${monthLabel(month)}`}>
          <CardContent className="flex flex-col gap-4">
            <PageAlerts error={error} />
            {!data ? (
              !error && <p role="status" className="m-0 text-sm text-muted-foreground">Loading {monthLabel(month)}…</p>
            ) : shown.length === 0 ? (
              <EmptyState title={lines.length === 0 ? `No freelancer worked in ${monthLabel(month)}.` : "Nothing here for this month."} />
            ) : (
              <Table aria-label={`Freelancer invoices · ${monthLabel(month)}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Freelancer</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    <TableHead>CRA check</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((l) => {
                    const inv = l.invoice;
                    const check = craCheck(l.row);
                    const status = inv ? statusCell(inv) : { text: "Missing", tone: "danger" as const };
                    const received = inv ? `${inv.source} · ${dayMonth(inv.createdAt)}` : "—";
                    return (
                      <TableRow key={l.key} className={cn("cursor-pointer", inv?.display.status === "rejected" && "text-muted-foreground")}
                        aria-label={`${l.name || "Freelancer"} · ${inv ? inv.number || "invoice" : "missing invoice"}`}
                        {...rowOpener(() => setOpen(l.key))}>
                        <TableCell className="whitespace-normal">
                          <div className="font-medium">{l.name || "—"}</div>
                          {l.row?.billing.companyName && <div className="text-xs text-muted-foreground">{l.row.billing.companyName}</div>}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {inv ? (
                            <>
                              <div className={cn("num font-medium", inv.display.status === "rejected" && "line-through")}>{inv.number || "No number"}</div>
                              <div className="text-xs whitespace-nowrap text-muted-foreground">
                                {inv.isCreditNote ? "Credit note" : inv.issueDate ? `Issued ${dayMonth(inv.issueDate)}` : "No date"}
                                {inv.flags.length > 0 && <span className="text-warning"> · {inv.flags.length === 1 ? "1 flag" : `${inv.flags.length} flags`}</span>}
                              </div>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell numeric>
                          {inv ? (
                            <>
                              <div className="font-medium">{euro(inv.amountHtCents)} <span className="text-xs font-normal text-muted-foreground">HT</span></div>
                              <div className="text-xs text-muted-foreground">{euro(inv.amountTtcCents)} TTC</div>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className={cn("whitespace-normal text-[13px]", toneClass[check.tone])}>
                          {check.text}
                          {inv?.review === "ok" && check.tone === "warning" && <div className="text-xs text-muted-foreground">Difference accepted</div>}
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{received}</TableCell>
                        <TableCell className={cn("whitespace-normal text-[13px]", toneClass[status.tone])}>
                          {status.text}
                          {inv?.display.status === "paid" && inv.review === "to_check" && <div className="text-xs text-warning">To check</div>}
                          {inv && inv.display.status !== "paid" && inv.suggestions.length > 0 && <div className="text-xs text-muted-foreground">Payment to confirm</div>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {current && (
        <InvoiceDetail
          key={current.key}
          api={api}
          name={current.name}
          row={current.row}
          others={current.invoice ? lines.flatMap((l) => (
            l.invoice && l.invoice.id !== current.invoice?.id && l.invoice.employeeId === current.invoice?.employeeId
              && !l.invoice.paidAt && l.invoice.display.status !== "rejected" ? [l.invoice] : [])) : []}
          invoice={current.invoice}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
