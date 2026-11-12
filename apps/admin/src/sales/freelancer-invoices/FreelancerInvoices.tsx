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
import { parisToday, rowOpener } from "../invoicing/format";
import { errorText, useFreelancerInvoicesApi } from "./api";
import type { InvoiceView, MonthRow, YearResponse } from "./api";
import { craCheck, dayMonth, euro, statusCell } from "./format";
import { InvoiceDetail, toneClass } from "./InvoiceDetail";
import { MailboxSettings } from "./MailboxSettings";

const BASE = "/sales/freelancer-invoices";
type Filter = "all" | "to-check" | "to-pay" | "paid" | "missing";
const FILTERS: [Filter, string][] = [["all", "All"], ["to-check", "To check"], ["to-pay", "To pay"], ["paid", "Paid"], ["missing", "Missing"]];

/** One table line: an invoice of a freelancer month, an invoice with no period, or a missing invoice. */
type Line = { key: string; employeeId: string; name: string; month: string | null; row: MonthRow | null; invoice: InvoiceView | null };
/** A freelancer and their lines: invoices without a period first, then the latest month first. */
type Group = { employeeId: string; name: string; company: string; lines: Line[] };

function linesOf(data: YearResponse): Line[] {
  const lines: Line[] = [];
  for (const u of data.unassigned) lines.push({ key: u.id, employeeId: u.employeeId, name: u.name, month: null, row: null, invoice: u });
  for (const { month, rows } of [...data.months].reverse()) {
    for (const row of rows) {
      for (const invoice of row.invoices) lines.push({ key: invoice.id, employeeId: row.employeeId, name: row.name, month, row, invoice });
      if (row.missing) lines.push({ key: `missing:${row.employeeId}:${month}`, employeeId: row.employeeId, name: row.name, month, row, invoice: null });
    }
  }
  return lines;
}

function groupsOf(lines: Line[]): Group[] {
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const g = groups.get(l.employeeId) ?? { employeeId: l.employeeId, name: l.name, company: "", lines: [] };
    if (!g.company && l.row?.billing.companyName) g.company = l.row.billing.companyName;
    g.lines.push(l);
    groups.set(l.employeeId, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name) || a.employeeId.localeCompare(b.employeeId));
}

/** "Oct 2026": the month column stays narrow. */
const shortMonth = (month: string) => new Date(`${month.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** Header figures of a freelancer over the year: invoiced HT, still to pay TTC, months missing. */
function summaryOf(g: Group): string {
  const live = g.lines.flatMap((l) => (l.invoice && l.invoice.display.status !== "rejected" ? [l.invoice] : []));
  const invoiced = live.reduce((sum, i) => sum + (i.amountHtCents ?? 0), 0);
  const toPay = live.filter((i) => i.display.status === "to_pay").reduce((sum, i) => sum + (i.amountTtcCents ?? 0), 0);
  const missing = g.lines.filter((l) => !l.invoice).length;
  return [
    `${euro(invoiced)} HT invoiced`,
    toPay ? `${euro(toPay)} TTC to pay` : "",
    missing ? `${missing} missing` : "",
  ].filter(Boolean).join(" · ");
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

  const [year, setYear] = useState(() => Number(parisToday().slice(0, 4)));
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<YearResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // Only the latest year may land: an older, slower answer must not overwrite it.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError("");
    try {
      const r = await api.get<YearResponse>({ resource: "year", year: String(year) });
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine === seq.current) { setData(null); setError(errorText(e, "Could not load the invoices.")); }
    } finally { if (mine === seq.current) setLoading(false); }
  }, [api, year]);
  useEffect(() => { if (!settingsOpen) void load(); }, [load, settingsOpen]);

  const lines = data ? linesOf(data) : [];
  const shown = lines.filter(inFilter[filter]);
  const groups = groupsOf(shown);
  // Totals read every line of the freelancer, whatever the tab.
  const all = new Map(groupsOf(lines).map((g) => [g.employeeId, g]));
  const count = (f: Filter) => lines.filter(inFilter[f]).length;
  // The open line is read from the latest data, so the panel follows each reload.
  const current = open ? lines.find((l) => l.key === open) ?? null : null;

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeading
        title="Freelancer invoices"
        action={!settingsOpen && (
          <div className="flex flex-wrap items-center gap-2">
            <ButtonGroup aria-label="Year">
              <Button variant="outline" size="icon" aria-label="Previous year" onClick={() => setYear(year - 1)}><ChevronLeft /></Button>
              <ButtonGroupText className="w-20 justify-center bg-transparent">{year}</ButtonGroupText>
              <Button variant="outline" size="icon" aria-label="Next year" onClick={() => setYear(year + 1)}><ChevronRight /></Button>
            </ButtonGroup>
            <Button variant="outline" size="icon" aria-label="Reload" title="Reload" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          </div>
        )}
      >
        Invoices each freelancer sent, month by month, checked against their CRA and paid from Qonto.
      </PageHeading>

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <Tabs className="min-w-0 flex-1" value={settingsOpen ? null : filter} onValueChange={(v) => {
          if (typeof v !== "string") return;
          setFilter(v as Filter);
          if (settingsOpen) navigate(BASE);
        }}>
          <TabsList variant="line" aria-label="Invoice status" className="h-auto min-h-10 max-w-full flex-wrap justify-start gap-x-5 gap-y-1">
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
        <Card aria-label={`Freelancer invoices · ${year}`}>
          <CardContent className="flex flex-col gap-4">
            <PageAlerts error={error} />
            {!data ? (
              !error && <p role="status" className="m-0 text-sm text-muted-foreground">Loading {year}…</p>
            ) : shown.length === 0 ? (
              <EmptyState title={lines.length === 0 ? `No freelancer invoice or CRA in ${year}.` : `Nothing here for ${year}.`} />
            ) : (
              <Table aria-label={`Freelancer invoices · ${year}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden @xl:table-cell">Month</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead numeric>Amount</TableHead>
                    <TableHead className="hidden @2xl:table-cell">CRA check</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => [
                    <TableRow key={`group:${g.employeeId}`} className="hover:bg-transparent" aria-label={g.name || "Freelancer"}>
                      <TableCell colSpan={5} className="whitespace-normal bg-muted/40 pt-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <div>
                            <span className="font-medium">{g.name || "—"}</span>
                            {g.company && <span className="text-xs text-muted-foreground"> · {g.company}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{summaryOf(all.get(g.employeeId) ?? g)}</div>
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...g.lines.map((l) => {
                    const inv = l.invoice;
                    const check = craCheck(l.row);
                    const status = inv ? statusCell(inv) : { text: "Missing", tone: "danger" as const };
                    const monthCell = l.month ? shortMonth(l.month) : <span className="text-warning">No period</span>;
                    const checkCell = (
                      <>
                        {check.text}
                        {inv?.review === "ok" && check.tone === "warning" && <div className="text-xs text-muted-foreground">Difference accepted</div>}
                      </>
                    );
                    return (
                      <TableRow key={l.key} className={cn("cursor-pointer", inv?.display.status === "rejected" && "text-muted-foreground")}
                        aria-label={`${l.name || "Freelancer"} · ${inv ? inv.number || "invoice" : "missing invoice"}`}
                        {...rowOpener(() => setOpen(l.key))}>
                        <TableCell className="hidden whitespace-nowrap @xl:table-cell">{monthCell}</TableCell>
                        <TableCell className="whitespace-normal">
                          <div className="mb-0.5 text-xs font-medium @xl:hidden">{monthCell}</div>
                          {inv ? (
                            <>
                              <div className={cn("num font-medium break-words", inv.display.status === "rejected" && "line-through")}>{inv.number || "No number"}</div>
                              <div className="text-xs text-muted-foreground">
                                {inv.isCreditNote ? "Credit note" : inv.issueDate ? `Issued ${dayMonth(inv.issueDate)}` : "No date"}
                                {inv.flags.length > 0 && <span className="text-warning"> · {inv.flags.length === 1 ? "1 flag" : `${inv.flags.length} flags`}</span>}
                              </div>
                              <div className="text-xs text-muted-foreground">{inv.source} · {dayMonth(inv.createdAt)}</div>
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
                        <TableCell className={cn("hidden whitespace-normal text-[13px] @2xl:table-cell", toneClass[check.tone])}>{checkCell}</TableCell>
                        <TableCell className={cn("whitespace-normal text-[13px]", toneClass[status.tone])}>
                          {status.text}
                          {inv?.display.status === "paid" && inv.review === "to_check" && <div className="text-xs text-warning">To check</div>}
                          {inv && inv.display.status !== "paid" && inv.suggestions.length > 0 && <div className="text-xs text-muted-foreground">Payment to confirm</div>}
                          <div className={cn("mt-1 text-xs @2xl:hidden", toneClass[check.tone])}>{checkCell}</div>
                        </TableCell>
                      </TableRow>
                    );
                  }),
                  ])}
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
