import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowUpRight, ChevronLeft, ChevronRight, FilePlus2, Plus, RefreshCw, RotateCcw, Search, Settings as SettingsIcon, X,
} from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupText,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatSource,
  StatUnit,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import { EmptyState, PageAlerts, PageHeading } from "../../ui";
import { DateField } from "../../DateField";
import { errorText, useInvoicingApi } from "./api";
import { LinkInvoiceStrip } from "./LinkInvoiceStrip";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { InvoicingSettings } from "./InvoicingSettings";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import {
  blockerLabel, dateTime, days, invoiceRowLabel, invoiceStatusLabel, money, monthLabel, parisToday, rate as rateLabel, rowOpener, previousMonth, shiftMonth, shortDate,
} from "./format";
import type { StatusLabel } from "./format";
import type { DraftResponse, Invoice, InvoicesList, InvoicingSettings as Settings, InvoiceResponse, ToInvoiceRow } from "./types";

type Tab = "to-invoice" | "invoices" | "unassigned" | "settings";
const BASE = "/sales/invoicing";
const TAB_PATHS: Record<Tab, string> = { "to-invoice": BASE, invoices: `${BASE}/invoices`, unassigned: `${BASE}/unassigned`, settings: `${BASE}/settings` };
const STATUS_FILTERS: StatusLabel[] = ["Draft", "Validated", "Paid", "Overdue", "Canceled"];
const PER_PAGE = [25, 50, 100];
type Panel = { invoiceId: string; craChanged: boolean; warning: string };

const rowKey = (r: ToInvoiceRow) => `${r.projectId}:${r.employeeId}`;
const canCreate = (r: ToInvoiceRow) => r.status === "not_invoiced" && r.blockers.length === 0;
const billingMonth = (i: Invoice) => (i.period_month ?? i.issue_date ?? "").slice(0, 7);
type GroupBy = "client" | "month";
const GROUP_BY_KEY = "invoicing.groupBy";
function storedGroupBy(): GroupBy {
  try { return localStorage.getItem(GROUP_BY_KEY) === "month" ? "month" : "client"; } catch { return "client"; }
}
const statusOf = (i: Invoice) => invoiceStatusLabel(i.status, i.due_date);
const num = (v: number | string | null | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "—";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

function tabFromPath(pathname: string): Tab {
  const rest = pathname.replace(/\/+$/, "").slice(BASE.length);
  if (rest.startsWith("/invoices")) return "invoices";
  if (rest.startsWith("/unassigned")) return "unassigned";
  if (rest.startsWith("/settings")) return "settings";
  return "to-invoice";
}
// The To invoice month lives in the path, like the CRA: /sales/invoicing/2026/10.
function monthFromPath(pathname: string): string | null {
  const m = pathname.slice(BASE.length).match(/^\/(\d{4})\/(0[1-9]|1[0-2])\/?$/);
  return m ? `${m[1]}-${m[2]}` : null;
}
const monthPath = (month: string) => `${BASE}/${month.replace("-", "/")}`;

/** Quick issue-date ranges: all time, this year, its quarters so far, last year. */
function rangePresets(today: string) {
  const y = Number(today.slice(0, 4));
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const quarters = Array.from({ length: q }, (_, i) => q - i).map((n) => ({
    label: `Q${n} ${y}`,
    from: `${y}-${String(n * 3 - 2).padStart(2, "0")}-01`,
    to: `${y}-${String(n * 3).padStart(2, "0")}-${n === 1 || n === 4 ? "31" : "30"}`,
  }));
  return [
    { label: "All time", from: "", to: "" },
    { label: String(y), from: `${y}-01-01`, to: `${y}-12-31` },
    ...quarters,
    { label: String(y - 1), from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** 1 … 4 5 6 … 12 — zero marks a gap. */
function pageNumbers(page: number, pages: number): number[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  if (page > 3) out.push(0);
  for (let x = Math.max(2, page - 1); x <= Math.min(pages - 1, page + 1); x++) out.push(x);
  if (page < pages - 2) out.push(0);
  out.push(pages);
  return out;
}

/**
 * Sales → Invoicing. Monthly CRA-based invoicing through Qonto:
 * To invoice (consultant-months ready to bill), Invoices (everything in
 * Qonto, synced), Unassigned (Qonto imports to attach to a project) and
 * Settings (connection + client/service links, behind the gear button).
 */
export function Invoicing() {
  const api = useInvoicingApi();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = tabFromPath(location.pathname);
  const focus = new URLSearchParams(location.search).get("focus");

  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [query, setQuery] = useState("");

  // To invoice
  const pathMonth = monthFromPath(location.pathname);
  const [month, setMonthState] = useState(() => pathMonth ?? previousMonth());
  const setMonth = (m: string) => navigate(monthPath(m));
  useEffect(() => {
    if (pathMonth) setMonthState(pathMonth);
    else if (tab === "to-invoice") navigate(`${monthPath(month)}${location.search}`, { replace: true });
  }, [pathMonth, tab, month, location.search, navigate]);
  const [rows, setRows] = useState<ToInvoiceRow[] | null>(null);
  const [rowsError, setRowsError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showInvoiced, setShowInvoiced] = useState(false);

  // Invoices + Unassigned
  const [list, setList] = useState<InvoicesList | null>(null);
  const [listError, setListError] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusLabel | "">("");
  const [clientFilter, setClientFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [groupBy, setGroupByState] = useState<GroupBy>(storedGroupBy);
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); try { localStorage.setItem(GROUP_BY_KEY, g); } catch { /* per-viewer convenience only */ } };
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);

  // The server filters the list; wait for typing to settle before asking it.
  const [listQuery, setListQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setListQuery(query.trim()), 250); return () => clearTimeout(t); }, [query]);

  // Any filter change sends the list back to its first page. Reset while rendering, not in an
  // effect, so the list is fetched once with page 1 rather than once more with the stale page.
  const filterKey = [tab, listQuery, statusFilter, clientFilter, monthFilter, dateFrom, dateTo, perPage, groupBy].join("|");
  const [pagedFor, setPagedFor] = useState(filterKey);
  if (pagedFor !== filterKey) { setPagedFor(filterKey); setPage(1); }

  const loadSettings = useCallback(async () => {
    try { setSettings(await api.get<Settings>({ resource: "settings" })); }
    catch (e) { setError(errorText(e, "Could not load invoicing settings.")); }
  }, [api]);

  const loadRows = useCallback(async (m: string) => {
    setRowsError("");
    try {
      const r = await api.get<{ rows: ToInvoiceRow[] }>({ resource: "month", month: m });
      setRows(r.rows);
      setSelected((prev) => new Set([...prev].filter((k) => r.rows.some((x) => rowKey(x) === k && canCreate(x)))));
    } catch (e) { setRows(null); setRowsError(errorText(e, "Could not load the month.")); }
  }, [api]);

  // Only the latest request may land: an older, slower page must not overwrite a newer filter.
  const listSeq = useRef(0);
  const listTab = tab === "unassigned" ? "unassigned" : "invoices";
  const loadList = useCallback(async (refresh = false) => {
    const seq = ++listSeq.current;
    setListError("");
    try {
      const r = await api.get<InvoicesList>({
        resource: "invoices", tab: listTab, q: listQuery, status: statusFilter, client: clientFilter, month: monthFilter,
        from: dateFrom, to: dateTo, page: String(page), perPage: String(perPage), group: groupBy, ...(refresh ? { refresh: "1" } : {}),
      });
      if (seq === listSeq.current) setList(r);
    } catch (e) { if (seq === listSeq.current) setListError(errorText(e, "Could not load invoices.")); }
  }, [api, listTab, listQuery, statusFilter, clientFilter, monthFilter, dateFrom, dateTo, page, perPage, groupBy]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadRows(month); }, [loadRows, month]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    void (async () => {
      const { data, error: e } = await db().from("sales_projects").select("id,title").order("title");
      if (e) setError(errorMessage(e)); else setProjects(data ?? []);
    })();
  }, []);

  const refreshAll = useCallback(() => { void loadRows(month); void loadList(); }, [loadRows, loadList, month]);

  async function act<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(name); setError(""); setMessage(""); setWarning("");
    try {
      const result = await fn();
      const w = (result as { warning?: unknown })?.warning;
      if (typeof w === "string" && w) setWarning(w);
      return result;
    } catch (e) { setError(errorText(e)); return null; }
    finally { setBusy(null); }
  }

  async function createOne(r: ToInvoiceRow) {
    const res = await act(`create:${rowKey(r)}`, () => api.post<DraftResponse>("create_draft", { projectId: r.projectId, employeeId: r.employeeId, month }));
    if (!res) return;
    setPanel({ invoiceId: res.invoice.id, craChanged: false, warning: res.warning ?? "" });
    setWarning("");
    if (res.existing) setMessage("A draft already existed for this consultant-month; it is open now.");
    refreshAll();
  }

  async function createSelected() {
    if (busy || !rows) return;
    const targets = rows.filter((r) => selected.has(rowKey(r)) && canCreate(r));
    if (!targets.length) return;
    setBusy("create:bulk"); setError(""); setMessage(""); setWarning("");
    const failures: string[] = [];
    const warnings: string[] = [];
    let created = 0;
    // One at a time, never retried: each create talks to Qonto.
    for (const r of targets) {
      try {
        const res = await api.post<DraftResponse>("create_draft", { projectId: r.projectId, employeeId: r.employeeId, month });
        created += 1;
        if (res.warning) warnings.push(`${r.consultantName}: ${res.warning}`);
      } catch (e) { failures.push(`${r.consultantName} · ${r.projectTitle}: ${errorText(e)}`); }
    }
    setBusy(null);
    setSelected(new Set());
    if (created) setMessage(`${created} draft${created > 1 ? "s" : ""} created in Qonto.`);
    if (warnings.length) setWarning(warnings.join(" "));
    if (failures.length) setError(failures.join(" "));
    refreshAll();
  }

  async function assign(inv: Invoice, projectId: string | null) {
    const res = await act(`assign:${inv.id}`, () =>
      api.post<InvoiceResponse>("assign", { invoiceId: inv.id, projectId, ...(projectId ? {} : { ignored: true }) }));
    if (!res) return;
    setAssigning(null);
    setMessage(projectId ? "Invoice attached to the project." : "Invoice marked as not project-related.");
    void loadList();
  }

  async function syncQonto() {
    if (busy) return;
    setBusy("refresh");
    await Promise.all([loadList(true), loadRows(month)]);
    setBusy(null);
  }

  const today = parisToday();
  const presets = useMemo(() => rangePresets(today), [today]);
  const q = query.trim().toLowerCase();
  // One page, already filtered and sorted by the server.
  const pageList = useMemo(() => list?.invoices ?? [], [list]);
  const clientOptions = list?.options.clients ?? [];
  const monthOptions = list?.options.months ?? [];
  const [lo, hi] = dateFrom && dateTo && dateFrom > dateTo ? [dateTo, dateFrom] : [dateFrom, dateTo];
  const total = list?.total ?? 0;
  const pages = list?.pages ?? 1;
  const current = list?.page ?? page;
  const start = (current - 1) * (list?.perPage ?? perPage);
  const statusCount = (s: StatusLabel | "all") => list?.statusCounts[s] ?? 0;
  const groups: { key: string; items: Invoice[] }[] = [];
  // Group by what the server ordered the page by (it may still be answering an older toggle).
  const pageGroupBy = list?.group ?? groupBy;
  for (const i of pageList) {
    const key = pageGroupBy === "client" ? (i.billed_client_id ?? "") : billingMonth(i);
    if (groups[groups.length - 1]?.key === key) groups[groups.length - 1].items.push(i);
    else groups.push({ key, items: [i] });
  }
  const hasRange = Boolean(dateFrom || dateTo);
  const hasFilters = hasRange || Boolean(statusFilter || clientFilter || monthFilter || q);
  const resetFilters = () => { setQuery(""); setStatusFilter(""); setClientFilter(""); setMonthFilter(""); setDateFrom(""); setDateTo(""); };

  // To invoice
  // Billed rows stay out of the way unless asked for, so a fully invoiced month reads as empty.
  const shownRows = (rows ?? []).filter((r) => showInvoiced || r.status === "not_invoiced");
  const visibleRows = shownRows.filter((r) => !q || [r.consultantName, r.projectTitle, r.billedClientName].join(" ").toLowerCase().includes(q));
  const eligible = visibleRows.filter(canCreate);
  const pending = (rows ?? []).filter((r) => r.status === "not_invoiced");
  const invoiced = (rows ?? []).filter((r) => r.status !== "not_invoiced" && r.status !== "canceled");
  const sumHt = (l: ToInvoiceRow[]) => l.reduce((a, r) => a + num(r.amountHt), 0);
  const monthDays = (rows ?? []).reduce((a, r) => a + r.days, 0);
  const monthTotal = sumHt(rows ?? []);
  const footDays = visibleRows.reduce((a, r) => a + r.days, 0);

  const locked = busy !== null;
  const notConnected = settings && !settings.hasSecret;
  const listView = tab === "invoices" || tab === "unassigned";

  const fixLink = (r: ToInvoiceRow, b: string) => {
    if (b === "client_not_linked") return `${TAB_PATHS.settings}?focus=client-${r.billedClientId}`;
    if (b === "product_not_linked") return `${TAB_PATHS.settings}?focus=project-${r.projectId}`;
    if (b === "cra_incomplete") return "/hr/cra";
    return `/sales/projects/${r.projectId}`;
  };

  const tabs: [Tab, string, number | null][] = [
    ["to-invoice", "To invoice", rows ? pending.length : null],
    ["invoices", "Invoices", list ? list.counts.invoices : null],
    ["unassigned", "Unassigned", list ? list.counts.unassigned : null],
  ];

  const scope = monthFilter ? monthLabel(monthFilter)
    : lo && hi ? `${shortDate(lo)} to ${shortDate(hi)}` : lo ? `since ${shortDate(lo)}` : hi ? `until ${shortDate(hi)}` : "all time";
  const zero = { count: 0, ttc: 0 };
  const { paid: paidF, unpaid: unpaidF, overdue: overdueF, unassigned: unassignedF } = list?.kpis ?? { paid: zero, unpaid: zero, overdue: zero, unassigned: zero };
  const kpis: { label: string; value: string; sub: string; strong?: boolean }[] = tab === "to-invoice"
    ? [
      { label: "To invoice", value: money(sumHt(pending)), sub: `${plural(pending.length, "timesheet")} · ${monthLabel(month).split(" ")[0]}`, strong: pending.length > 0 },
      { label: "Invoiced", value: money(sumHt(invoiced)), sub: plural(invoiced.length, "invoice") },
      { label: "Month total HT", value: money(monthTotal), sub: `${days(monthDays)} · ${plural(new Set((rows ?? []).map((r) => r.employeeId)).size, "consultant")}` },
      { label: "Average daily rate", value: monthDays ? rateLabel(Math.round(monthTotal / monthDays)) : "—", sub: `Across ${days(monthDays)}` },
    ]
    : [
      { label: "Collected", value: money(paidF.ttc), sub: `${paidF.count} paid · ${scope}` },
      { label: "Not paid", value: money(unpaidF.ttc), sub: `${plural(unpaidF.count, "invoice")} · ${overdueF.count} overdue` },
      { label: "Overdue", value: money(overdueF.ttc), sub: `${plural(overdueF.count, "invoice")} past due date`, strong: overdueF.count > 0 },
      { label: "Needs a project", value: money(unassignedF.ttc), sub: `${plural(unassignedF.count, "invoice")} to assign` },
    ];

  const colsTs = 8;
  // The Client column repeats the group header when grouped by client.
  const showClientCol = pageGroupBy !== "client";
  const colsInv = showClientCol ? 6 : 5;

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeading
        title="Invoicing"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {tab === "to-invoice" && (
              <ButtonGroup aria-label="Billing month">
                <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} disabled={locked}><ChevronLeft /></Button>
                <ButtonGroupText className="w-36 justify-center bg-transparent">{monthLabel(month)}</ButtonGroupText>
                <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={locked}><ChevronRight /></Button>
              </ButtonGroup>
            )}
            <Button variant="outline" disabled={locked} onClick={() => void syncQonto()}>
              <RefreshCw data-icon="inline-start" className={busy === "refresh" ? "animate-spin" : undefined} /> {busy === "refresh" ? "Syncing…" : "Sync Qonto"}
            </Button>
          </div>
        }
      >
        <span className="block text-xs">Last sync {dateTime(list?.lastSyncedAt)}{list ? ` · ${plural(list.counts.invoices, "invoice")}` : ""}</span>
      </PageHeading>

      {(error || warning || message || (notConnected && tab !== "settings")) && (
        <div className="flex flex-col gap-2">
          <PageAlerts error={error} />
          {warning && <Alert variant="warning" role="status"><AlertDescription>{warning}</AlertDescription></Alert>}
          <PageAlerts message={message} />
          {notConnected && tab !== "settings" && (
            <Alert variant="warning" role="status">
              <AlertDescription>Qonto is not connected yet. <Link to={TAB_PATHS.settings}>Open Invoicing settings</Link> to add the API credentials.</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Filters sit above the KPIs: the figures below count what they select. */}
      {listView && (
        <Card aria-label="Invoice filters">
          <CardContent className="flex min-w-0 flex-col gap-4">
            <div className="flex w-full flex-wrap items-center gap-2">
              <InputGroup className="min-w-56 flex-1">
                <InputGroupAddon><Search /></InputGroupAddon>
                <InputGroupInput type="search" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice, client or PO" />
              </InputGroup>
              <NativeSelect aria-label="Billing month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <NativeSelectOption value="">All months</NativeSelectOption>
                {monthOptions.map((m) => <NativeSelectOption key={m} value={m}>{monthLabel(m)}</NativeSelectOption>)}
              </NativeSelect>
              <NativeSelect aria-label="Client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                <NativeSelectOption value="">All clients</NativeSelectOption>
                {clientOptions.map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
                <NativeSelectOption value="none">No client</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filters">
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" role="group" aria-label="Issue date range">
                <span className="label-mono">Issued</span>
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 [&_.date-field-root]:w-[168px] [&_.date-field-trigger]:h-10 [&_.date-field-trigger]:py-0">
                  <DateField aria-label="Issued from" placeholder="From" value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} />
                  <span aria-hidden="true" className="text-muted-foreground">→</span>
                  <DateField aria-label="Issued until" placeholder="To" value={dateTo} min={dateFrom || undefined} onChange={setDateTo} />
                </div>
                <ToggleGroup variant="outline" aria-label="Quick ranges" className="max-w-full overflow-x-auto"
                  value={presets.filter((p) => dateFrom === p.from && dateTo === p.to).map((p) => p.label)}
                  onValueChange={(v) => { const p = presets.find((x) => x.label === v[0]); if (p) { setDateFrom(p.from); setDateTo(p.to); } }}>
                  {presets.map((p) => <ToggleGroupItem key={p.label} value={p.label}>{p.label}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" role="group" aria-label="Status">
                <span className="label-mono">Status</span>
                <ToggleGroup variant="outline" size="sm" aria-label="Status" className="max-w-full overflow-x-auto"
                  value={[statusFilter || "all"]}
                  onValueChange={(v) => { if (v[0]) setStatusFilter(v[0] === "all" ? "" : (v[0] as StatusLabel)); }}>
                  {(["", ...STATUS_FILTERS] as const).filter((s) => s !== "Draft" || statusFilter === s || statusCount(s) > 0).map((s) => (
                    <ToggleGroupItem key={s || "all"} value={s || "all"} className="gap-1.5">
                      {s || "All"}<span className="num text-xs text-muted-foreground">{statusCount(s || "all")}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="flex min-w-0 items-center gap-2" role="group" aria-label="Group by">
                <span className="label-mono">Group by</span>
                <ToggleGroup variant="outline" size="sm" aria-label="Group by" value={[groupBy]}
                  onValueChange={(v) => { if (v[0] === "client" || v[0] === "month") setGroupBy(v[0]); }}>
                  <ToggleGroupItem value="client">Client</ToggleGroupItem>
                  <ToggleGroupItem value="month">Month</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{plural(total, "invoice")}{hasFilters ? " match" : ""}</span>
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={resetFilters}><RotateCcw data-icon="inline-start" /> Reset filters</Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab !== "settings" && (
        <Card aria-label="Summary">
          <CardContent>
            <StatGroup>
              {kpis.map((k) => (
                <Stat key={k.label} size="sm" pivot={tab !== "to-invoice" && k.strong}>
                  <StatValue className="group-data-[size=sm]/stat:text-[22px] @5xl:group-data-[size=sm]/stat:text-[28px]"><Figure value={k.value} /></StatValue>
                  <StatLabel>{k.label}</StatLabel>
                  <StatSource>{k.sub}</StatSource>
                </Stat>
              ))}
            </StatGroup>
          </CardContent>
        </Card>
      )}

      <div className="flex items-end justify-between gap-3 border-b border-border">
        <Tabs value={tab === "settings" ? null : tab} onValueChange={(v) => { if (typeof v === "string" && v !== tab && v in TAB_PATHS) navigate(v === "to-invoice" ? monthPath(month) : TAB_PATHS[v as Tab]); }}>
          <TabsList variant="line" aria-label="Invoicing views" className="h-10 gap-5">
            {tabs.map(([id, label, count]) => (
              <TabsTrigger key={id} value={id} className="gap-1.5">
                {label}
                {count !== null && <span className="num text-xs text-muted-foreground">{count}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button variant={tab === "settings" ? "secondary" : "ghost"} size="icon-sm" className="mb-1" aria-label="Invoicing settings" title="Invoicing settings"
          aria-pressed={tab === "settings"} onClick={() => navigate(tab === "settings" ? monthPath(month) : TAB_PATHS.settings)}>
          <SettingsIcon />
        </Button>
      </div>

      {tab === "to-invoice" && (
        <Card aria-label="To invoice">
          <CardHeader className="flex flex-wrap items-center gap-2">
            <InputGroup className="min-w-56 flex-1">
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput type="search" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search consultant or project" />
            </InputGroup>
            {invoiced.length > 0 && (
              <Toggle variant="outline" pressed={showInvoiced} onPressedChange={() => setShowInvoiced((v) => !v)}>
                {showInvoiced ? "Hide invoiced" : `Show invoiced (${invoiced.length})`}
              </Toggle>
            )}
            <Button variant="pivot" disabled={locked || selected.size === 0} onClick={() => void createSelected()}>
              <FilePlus2 data-icon="inline-start" /> {busy === "create:bulk" ? "Creating…" : selected.size ? `Create ${plural(selected.size, "draft")}` : "Create drafts"}
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <PageAlerts error={rowsError} />
            {!rows ? (
              !rowsError && <p role="status" className="m-0 text-sm text-muted-foreground">Loading {monthLabel(month)}…</p>
            ) : rows.length === 0 ? (
              <EmptyState
                title={settings && !settings.startMonth
                  ? "Set the invoicing start month in Settings first."
                  : settings?.startMonth && month < settings.startMonth
                    ? `Invoicing starts in ${monthLabel(settings.startMonth)}.`
                    : `No régie CRA days in ${monthLabel(month)}.`}
              />
            ) : shownRows.length === 0 ? (
              <EmptyState
                title={`All of ${monthLabel(month)} is invoiced.`}
                action={<Button variant="outline" size="sm" onClick={() => setShowInvoiced(true)}>Show {plural(invoiced.length, "invoiced timesheet")}</Button>}
              />
            ) : (
              <Table aria-label={`To invoice · ${monthLabel(month)}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox aria-label="Select all ready rows" disabled={locked || eligible.length === 0}
                        checked={eligible.length > 0 && eligible.every((r) => selected.has(rowKey(r)))}
                        onCheckedChange={(v) => setSelected(v === true ? new Set(eligible.map(rowKey)) : new Set())} />
                    </TableHead>
                    <TableHead>Consultant · Project</TableHead>
                    <TableHead className="hidden xl:table-cell">Billed client</TableHead>
                    <TableHead numeric>Days</TableHead>
                    <TableHead numeric className="hidden xl:table-cell">Daily rate</TableHead>
                    <TableHead numeric>Amount HT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead><span className="sr-only">Action</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={colsTs} className="h-20 text-center text-muted-foreground">No consultant matches "{query}".</TableCell>
                    </TableRow>
                  )}
                  {visibleRows.map((r) => {
                    const k = rowKey(r);
                    const rate = r.amountHt !== null && r.days ? Math.round((num(r.amountHt) / r.days) * 100) / 100 : null;
                    return (
                      <Fragment key={k}>
                        <TableRow>
                          <TableCell>
                            {canCreate(r) && (
                              <Checkbox aria-label={`Select ${r.consultantName}`} disabled={locked} checked={selected.has(k)}
                                onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v === true) n.add(k); else n.delete(k); return n; })} />
                            )}
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="flex items-center gap-3">
                              <Avatar aria-hidden="true" className="hidden @2xl:flex"><AvatarFallback>{initials(r.consultantName)}</AvatarFallback></Avatar>
                              <div className="flex min-w-0 flex-col">
                                {r.personId && r.consultantName
                                  ? <Link className="font-medium underline-offset-4 hover:underline" to={`/hr/people/${r.personId}`}>{r.consultantName}</Link>
                                  : <span className="font-medium">{r.consultantName || "—"}</span>}
                                <Link className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" to={`/sales/projects/${r.projectId}`}>{r.projectTitle}</Link>
                                <span className="text-xs text-muted-foreground xl:hidden">{r.billedClientName || "—"}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-normal text-muted-foreground xl:table-cell">{r.billedClientName || "—"}</TableCell>
                          <TableCell numeric>
                            {r.personId ? <Link className="underline-offset-4 hover:underline" to={`/hr/people/${r.personId}/cra/${month.replace("-", "/")}`} title="Open the CRA for this month">{days(r.days)}</Link> : days(r.days)}
                          </TableCell>
                          <TableCell numeric className="hidden text-muted-foreground xl:table-cell">{rate !== null ? rateLabel(rate) : "—"}</TableCell>
                          <TableCell numeric className="font-medium">{r.amountHt !== null ? money(r.amountHt) : "—"}</TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="flex flex-wrap items-center gap-1">
                              <InvoiceStatusBadge label={r.status === "not_invoiced" ? "To invoice" : invoiceStatusLabel(r.status, null)} />
                              {r.craChanged && <Badge variant="warning">CRA changed</Badge>}
                            </div>
                            {[...r.blockers, ...r.warnings].map((b) => (
                              <Link key={b} to={fixLink(r, b)}
                                className={cn("mt-1.5 block text-xs underline-offset-4 hover:underline", r.blockers.includes(b as never) ? "text-destructive" : "text-muted-foreground")}>
                                {blockerLabel(b)}
                              </Link>
                            ))}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.invoiceId ? (
                              <Button variant="outline" size="sm" disabled={locked}
                                onClick={() => setPanel({ invoiceId: r.invoiceId as string, craChanged: r.craChanged, warning: "" })}>
                                Open <ArrowUpRight data-icon="inline-end" />
                              </Button>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <Button variant="outline" size="sm" disabled={locked || !canCreate(r)} onClick={() => void createOne(r)}>
                                  {busy === `create:${k}` ? "Creating…" : "Create draft"}
                                </Button>
                                <Button variant="link" size="xs" className="h-auto px-0 text-muted-foreground" disabled={locked} aria-expanded={linking === k}
                                  onClick={() => setLinking(linking === k ? null : k)}>
                                  Link Qonto invoice
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                        {linking === k && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={colsTs} className="whitespace-normal">
                              <LinkInvoiceStrip api={api} month={month} disabled={locked} target={r} onClose={() => setLinking(null)}
                                onLinked={(inv) => { setLinking(null); setMessage(`${inv.number || "The invoice"} now covers this CRA.`); refreshAll(); }} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell />
                    <TableCell className="text-xs font-normal text-muted-foreground">{plural(visibleRows.length, "timesheet")}</TableCell>
                    <TableCell className="hidden xl:table-cell" />
                    <TableCell numeric>{days(footDays)}</TableCell>
                    <TableCell className="hidden xl:table-cell" />
                    <TableCell numeric className="text-sm">{money(sumHt(visibleRows))}</TableCell>
                    <TableCell colSpan={2} className="text-xs font-normal text-muted-foreground">HT · VAT applied in Qonto</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {listView && (
        <Card aria-label={tab === "unassigned" ? "Unassigned invoices" : "Invoices"}>
          {list?.syncError && (
            <CardHeader>
              <Alert variant="warning" role="alert">
                <AlertTriangle aria-hidden="true" />
                <AlertDescription>Qonto sync failed: {list.syncError} The list below may be out of date.</AlertDescription>
              </Alert>
            </CardHeader>
          )}

          <CardContent className="flex flex-col gap-4">
            {tab === "unassigned" && (
              <p className="m-0 text-sm text-muted-foreground">Invoices created directly in Qonto that no project claims yet. Attach each to its project, or mark it as not project-related.</p>
            )}
            <PageAlerts error={listError} />

            {!list ? (
              !listError && <p role="status" className="m-0 text-sm text-muted-foreground">Loading invoices…</p>
            ) : total === 0 ? (
              <EmptyState
                title={list.counts.invoices === 0 ? "No invoices yet" : tab === "unassigned" && !hasFilters ? "Nothing to assign" : "No invoices match these filters"}
                action={hasFilters ? <Button variant="outline" size="sm" onClick={resetFilters}>Reset filters</Button> : undefined}
              >
                {hasFilters ? "Try another month or widen the date range" : undefined}
              </EmptyState>
            ) : (
              <Table aria-label="Invoices">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    {showClientCol && <TableHead className="hidden xl:table-cell">Client</TableHead>}
                    <TableHead>Project / PO</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead numeric>Amount TTC</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const sum = list.groups[g.key] ?? { count: g.items.length, ttc: 0 };
                    const title = pageGroupBy === "client"
                      ? (g.items[0]?.client_name || (g.key ? "Unknown client" : "No client"))
                      : (g.key ? monthLabel(g.key) : "No date");
                    return (
                      <Fragment key={g.key || "none"}>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={colsInv} className="h-10">
                            <div className="flex items-baseline justify-between gap-3">
                              <span>
                                <span className={cn("font-medium", pageGroupBy === "client" && !g.key && "text-muted-foreground")}>{title}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {plural(sum.count, "invoice")}{sum.count > g.items.length ? " · continues on another page" : ""}
                                </span>
                              </span>
                              <span className="num text-[13px] font-medium">{money(sum.ttc)}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                        {g.items.map((i) => {
                          const label = invoiceRowLabel(i);
                          const status = statusOf(i);
                          const canceled = i.status === "canceled";
                          const due = i.due_date?.slice(0, 10);
                          const late = status === "Overdue" && due ? daysBetween(due, today) : 0;
                          return (
                            <Fragment key={i.id}>
                              <TableRow className={cn("cursor-pointer", canceled && "text-muted-foreground", locked && "cursor-default")} aria-label={`Open ${i.number || "draft invoice"}`}
                                {...rowOpener(() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" }), locked)}>
                                <TableCell className="whitespace-normal">
                                  <div className={cn("num font-medium whitespace-nowrap", canceled && "line-through")}>{i.number || "Draft"}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {i.source === "cra" ? "from CRA" : "via Qonto import"}
                                    {i.consultant_name && <> · {i.consultant_person_id ? <Link className="underline-offset-4 hover:text-foreground hover:underline" to={`/hr/people/${i.consultant_person_id}`}>{i.consultant_name}</Link> : i.consultant_name}</>}
                                  </div>
                                  {showClientCol && <div className="text-xs text-muted-foreground xl:hidden">{i.client_name || "No client"}</div>}
                                </TableCell>
                                {showClientCol && <TableCell className={cn("hidden whitespace-normal xl:table-cell", !i.client_name && "text-muted-foreground")}>{i.client_name || "No client"}</TableCell>}
                                <TableCell className="whitespace-normal">
                                  {i.project_id ? (
                                    <>
                                      <Link className="underline-offset-4 hover:underline" to={`/sales/projects/${i.project_id}`}>{i.project_title || "Project"}</Link>
                                      {i.purchase_order && <div className="num text-xs text-muted-foreground">{i.purchase_order}</div>}
                                    </>
                                  ) : i.ignored ? (
                                    <span className="text-muted-foreground">Not project-related</span>
                                  ) : canceled ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <Button variant="outline" size="xs" aria-label={`Assign a project to ${i.number || "this invoice"}`}
                                      aria-expanded={assigning === i.id} disabled={locked} onClick={() => setAssigning(assigning === i.id ? null : i.id)}>
                                      <Plus data-icon="inline-start" /> Assign project
                                    </Button>
                                  )}
                                </TableCell>
                                <TableCell className="whitespace-normal">
                                  <div className="num text-[13px]">{shortDate(i.issue_date)}</div>
                                  {(status === "Validated" || status === "Overdue") && due && (
                                    <div className={cn("text-xs", status === "Overdue" ? "text-destructive" : "text-muted-foreground")}>
                                      Due {shortDate(due)}{late > 0 ? ` · ${plural(late, "day")} late` : ""}
                                    </div>
                                  )}
                                </TableCell>
                                <TableCell numeric className="font-medium">{money(i.total_ttc, i.currency)}</TableCell>
                                <TableCell><InvoiceStatusBadge label={label} /></TableCell>
                              </TableRow>
                              {assigning === i.id && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={colsInv} className="whitespace-normal">
                                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm">
                                      <span className="text-muted-foreground">Attach <strong className="font-medium text-foreground">{i.number || "this invoice"}</strong> to</span>
                                      <NativeSelect size="sm" className="max-w-full" aria-label="Project" autoFocus value={assignTo[i.id] ?? ""} disabled={locked}
                                        onChange={(e) => setAssignTo((prev) => ({ ...prev, [i.id]: e.target.value }))}>
                                        <NativeSelectOption value="">Choose a project</NativeSelectOption>
                                        {projects.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.title}</NativeSelectOption>)}
                                      </NativeSelect>
                                      <Button size="sm" disabled={locked || !assignTo[i.id]} onClick={() => void assign(i, assignTo[i.id])}>
                                        {busy === `assign:${i.id}` ? "Saving…" : "Assign"}
                                      </Button>
                                      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void assign(i, null)}>Not project-related</Button>
                                      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={() => setAssigning(null)}><X /></Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4" aria-label="Pagination">
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="num">{total === 0 ? "0 invoices" : `${start + 1}-${Math.min(start + pageList.length, total)} of ${total}`}</span>
                <label className="flex items-center gap-2">Rows per page
                  <NativeSelect size="sm" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                    {PER_PAGE.map((n) => <NativeSelectOption key={n} value={n}>{n}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
                {pageNumbers(current, pages).map((n, idx) => n === 0
                  ? <span key={`gap-${idx}`} className="px-1 text-muted-foreground" aria-hidden="true">…</span>
                  : (
                    <Button key={n} variant={n === current ? "outline" : "ghost"} size="icon-sm" className="num" aria-label={`Page ${n}`}
                      aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>{n}</Button>
                  ))}
                <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
              </div>
            </nav>
          </CardContent>
        </Card>
      )}

      {tab === "settings" && (
        <InvoicingSettings api={api} focus={focus} onSaved={() => { void loadSettings(); refreshAll(); }} />
      )}

      {panel && (
        <InvoiceDraftPanel
          key={panel.invoiceId}
          api={api}
          invoiceId={panel.invoiceId}
          craChanged={panel.craChanged}
          initialWarning={panel.warning}
          onClose={() => setPanel(null)}
          onChanged={refreshAll}
        />
      )}
    </div>
  );
}

/** A money / rate figure with its € set as the stat unit. */
function Figure({ value }: { value: string }) {
  const m = value.match(/^(.*\S)\s*€$/);
  return m ? <>{m[1]}<StatUnit>€</StatUnit></> : <>{value}</>;
}
