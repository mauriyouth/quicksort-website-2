import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle, AlertTriangle, ArrowUpRight, Check, Clock, ChevronDown, ChevronLeft, ChevronRight, FilePlus2, Plus, RefreshCw, RotateCcw, Search, Settings as SettingsIcon, X,
} from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import { DateField } from "../../DateField";
import { errorText, useInvoicingApi } from "./api";
import { LinkInvoiceStrip } from "./LinkInvoiceStrip";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { InvoicingSettings } from "./InvoicingSettings";
import {
  blockerLabel, dateTime, days, invoiceRowLabel, invoiceStatusLabel, money, monthLabel, parisToday, rate as rateLabel, rowOpener, previousMonth, shiftMonth, shortDate,
} from "./format";
import type { StatusLabel } from "./format";
import type { DraftResponse, Invoice, InvoicesList, InvoicingSettings as Settings, InvoiceResponse, ToInvoiceRow } from "./types";
import "../sales.css";
import "../project-form.css";
import "./invoicing.css";

type Tab = "to-invoice" | "invoices" | "unassigned" | "settings";
const BASE = "/sales/invoicing";
const TAB_PATHS: Record<Tab, string> = { "to-invoice": BASE, invoices: `${BASE}/invoices`, unassigned: `${BASE}/unassigned`, settings: `${BASE}/settings` };
const STATUS_FILTERS: StatusLabel[] = ["Draft", "Validated", "Paid", "Overdue", "Canceled"];
const PER_PAGE = [25, 50, 100];
type Panel = { invoiceId: string; craChanged: boolean; warning: string };

const rowKey = (r: ToInvoiceRow) => `${r.projectId}:${r.employeeId}`;
const canCreate = (r: ToInvoiceRow) => r.status === "not_invoiced" && r.blockers.length === 0;
const unassigned = (i: Invoice) => i.source === "imported" && !i.project_id && !i.ignored;
const billingMonth = (i: Invoice) => (i.period_month ?? i.issue_date ?? "").slice(0, 7);
const statusOf = (i: Invoice) => invoiceStatusLabel(i.status, i.due_date);
const num = (v: number | string | null | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const sumTtc = (l: Invoice[]) => l.reduce((a, i) => a + num(i.total_ttc), 0);
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

function StatusBadge({ label }: { label: string }) {
  const key = label.split(" ")[0].toLowerCase();
  return (
    <span className={`inv-status inv-status--${key}`}>
      {key === "paid" ? <Check size={14} aria-hidden="true" /> : key === "validated" ? <Clock size={13} aria-hidden="true" /> : key === "overdue" ? <AlertCircle size={13} aria-hidden="true" /> : null}
      {label}
    </span>
  );
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
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<string | null>(null);

  // Any filter change sends the list back to its first page.
  useEffect(() => { setPage(1); }, [tab, query, statusFilter, clientFilter, monthFilter, dateFrom, dateTo, perPage]);

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

  const loadList = useCallback(async (refresh = false) => {
    setListError("");
    try { setList(await api.get<InvoicesList>({ resource: "invoices", ...(refresh ? { refresh: "1" } : {}) })); }
    catch (e) { setListError(errorText(e, "Could not load invoices.")); }
  }, [api]);

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
  const invoices = useMemo(() => list?.invoices ?? [], [list]);
  const unassignedList = invoices.filter(unassigned);
  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of invoices) if (i.billed_client_id) m.set(i.billed_client_id, i.client_name ?? "Unknown client");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);
  const monthOptions = useMemo(() => [...new Set(invoices.map(billingMonth).filter(Boolean))].sort().reverse(), [invoices]);

  // Every filter but status — the status chips count against this set.
  const [lo, hi] = dateFrom && dateTo && dateFrom > dateTo ? [dateTo, dateFrom] : [dateFrom, dateTo];
  const base = invoices.filter((i) => {
    if (tab === "unassigned" && !unassigned(i)) return false;
    const issued = (i.issue_date ?? "").slice(0, 10);
    if (lo && (!issued || issued < lo)) return false;
    if (hi && (!issued || issued > hi)) return false;
    if (monthFilter && billingMonth(i) !== monthFilter) return false;
    if (clientFilter === "none" && i.billed_client_id) return false;
    if (clientFilter && clientFilter !== "none" && i.billed_client_id !== clientFilter) return false;
    if (q && ![i.number, i.client_name, i.project_title, i.purchase_order, i.consultant_name].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const filtered = base
    .filter((i) => !statusFilter || statusOf(i) === statusFilter)
    .sort((a, b) => billingMonth(b).localeCompare(billingMonth(a)) || (b.issue_date ?? "").localeCompare(a.issue_date ?? ""));
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const start = (current - 1) * perPage;
  const pageList = filtered.slice(start, start + perPage);
  const groups: { key: string; items: Invoice[] }[] = [];
  for (const i of pageList) {
    const key = billingMonth(i);
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
    ["invoices", "Invoices", list ? invoices.length : null],
    ["unassigned", "Unassigned", list ? unassignedList.length : null],
  ];

  const scope = monthFilter ? monthLabel(monthFilter)
    : lo && hi ? `${shortDate(lo)} – ${shortDate(hi)}` : lo ? `since ${shortDate(lo)}` : hi ? `until ${shortDate(hi)}` : "all time";
  const byStatus = (s: StatusLabel) => base.filter((i) => statusOf(i) === s);
  const paidF = byStatus("Paid"), validatedF = byStatus("Validated"), overdueF = byStatus("Overdue");
  const unassignedF = base.filter(unassigned);
  const kpis: { label: string; value: string; sub: string; strong?: boolean }[] = tab === "to-invoice"
    ? [
      { label: "To invoice", value: money(sumHt(pending)), sub: `${plural(pending.length, "timesheet")} · ${monthLabel(month).split(" ")[0]}`, strong: pending.length > 0 },
      { label: "Invoiced", value: money(sumHt(invoiced)), sub: plural(invoiced.length, "invoice") },
      { label: "Month total HT", value: money(monthTotal), sub: `${days(monthDays)} · ${plural(new Set((rows ?? []).map((r) => r.employeeId)).size, "consultant")}` },
      { label: "Average daily rate", value: monthDays ? rateLabel(Math.round(monthTotal / monthDays)) : "—", sub: `Across ${days(monthDays)}` },
    ]
    : [
      { label: "Collected", value: money(sumTtc(paidF)), sub: `${paidF.length} paid · ${scope}` },
      { label: "Not paid", value: money(sumTtc([...validatedF, ...overdueF])), sub: `${plural(validatedF.length + overdueF.length, "invoice")} · ${overdueF.length} overdue` },
      { label: "Overdue", value: money(sumTtc(overdueF)), sub: `${plural(overdueF.length, "invoice")} past due date`, strong: overdueF.length > 0 },
      { label: "Needs a project", value: money(sumTtc(unassignedF)), sub: `${plural(unassignedF.length, "invoice")} to assign` },
    ];

  return (
    <div className="inv-page">
      <header className="inv-head">
        <div className="inv-head-text">
          <h1>Invoicing</h1>
          <p className="projects-lede">Monthly régie invoices from CRA timesheets → drafted and sent through Qonto</p>
        </div>
        <div className="inv-head-actions">
          {tab === "to-invoice" && (
            <div className="inv-month" role="group" aria-label="Billing month">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} disabled={locked}><ChevronLeft size={18} /></button>
              <span>{monthLabel(month)}</span>
              <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={locked}><ChevronRight size={18} /></button>
            </div>
          )}
          <span className="inv-sync">Last sync {dateTime(list?.lastSyncedAt)}{list ? ` · ${plural(invoices.length, "invoice")}` : ""}</span>
          <button type="button" className="inv-btn" disabled={locked} onClick={() => void syncQonto()}>
            <RefreshCw size={16} className={busy === "refresh" ? "inv-spin" : undefined} /> {busy === "refresh" ? "Syncing…" : "Sync Qonto"}
          </button>
        </div>
      </header>

      <Notice error>{error}</Notice>
      <Notice>{warning}</Notice>
      <Notice>{message}</Notice>
      {notConnected && tab !== "settings" && (
        <Notice>Qonto is not connected yet. <Link to={TAB_PATHS.settings}>Open Invoicing settings</Link> to add the API credentials.</Notice>
      )}

      {tab !== "settings" && (
        <section className="inv-kpis" aria-label="Summary">
          {kpis.map((k) => (
            <div key={k.label} className={`inv-kpi${k.strong ? " strong" : ""}`}>
              <span className="inv-kpi-label">{k.label}</span>
              <span className="inv-kpi-value">{k.value}</span>
              <span className="inv-kpi-sub">{k.sub}</span>
            </div>
          ))}
        </section>
      )}

      <section className="projects-card" aria-label="Billing">
        <div className="projects-toolbar">
          <div className="projects-tabs" role="tablist" aria-label="Invoicing views">
            {tabs.map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={`projects-tab${tab === id ? " on" : ""}`} onClick={() => navigate(id === "to-invoice" ? monthPath(month) : TAB_PATHS[id])}>
                {label}{count !== null && <span className="inv-count">{count}</span>}
              </button>
            ))}
          </div>
          <div className="projects-toolbar-right">
            {tab !== "settings" && (
              <label className="projects-search">
                <Search size={16} aria-hidden="true" />
                <span className="projects-search-label">Search</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "to-invoice" ? "Search consultant or project" : "Search invoice, client or PO"} />
              </label>
            )}
            <button type="button" className={`projects-refresh${tab === "settings" ? " on" : ""}`} aria-label="Invoicing settings" title="Invoicing settings"
              aria-pressed={tab === "settings"} onClick={() => navigate(tab === "settings" ? monthPath(month) : TAB_PATHS.settings)}>
              <SettingsIcon size={18} />
            </button>
            {tab === "to-invoice" && invoiced.length > 0 && (
              <button type="button" className="inv-text-btn" aria-pressed={showInvoiced} onClick={() => setShowInvoiced((v) => !v)}>
                {showInvoiced ? "Hide invoiced" : `Show invoiced (${invoiced.length})`}
              </button>
            )}
            {tab === "to-invoice" && (
              <button type="button" className="inv-cta" disabled={locked || selected.size === 0} onClick={() => void createSelected()}>
                <FilePlus2 size={16} /> {busy === "create:bulk" ? "Creating…" : selected.size ? `Create ${plural(selected.size, "draft")}` : "Create drafts"}
              </button>
            )}
          </div>
        </div>

        {listView && list?.syncError && (
          <div className="inv-sync-error" role="alert"><AlertTriangle size={16} /> Qonto sync failed: {list.syncError} The list below may be out of date.</div>
        )}

        {tab === "to-invoice" && (
          <>
            {rowsError && <div className="inv-panel"><Notice error>{rowsError}</Notice></div>}
            {!rows ? (
              !rowsError && <p className="projects-empty">Loading {monthLabel(month)}…</p>
            ) : rows.length === 0 ? (
              <p className="projects-empty">
                {settings && !settings.startMonth
                  ? "Set the invoicing start month in Settings first."
                  : settings?.startMonth && month < settings.startMonth
                    ? `Invoicing starts in ${monthLabel(settings.startMonth)}.`
                    : `No régie CRA days in ${monthLabel(month)}.`}
              </p>
            ) : shownRows.length === 0 ? (
              <p className="projects-empty">
                All of {monthLabel(month)} is invoiced.{" "}
                <button type="button" className="inv-text-btn" onClick={() => setShowInvoiced(true)}>Show {plural(invoiced.length, "invoiced timesheet")}</button>
              </p>
            ) : (
              <div className="projects-table-scroll inv-scroll">
                <div className="inv-grid inv-grid--ts">
                  <div className="inv-grid-head">
                    <div className="inv-cell-check">
                      <input type="checkbox" aria-label="Select all ready rows" disabled={locked || eligible.length === 0}
                        checked={eligible.length > 0 && eligible.every((r) => selected.has(rowKey(r)))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(eligible.map(rowKey)) : new Set())} />
                    </div>
                    <div>Consultant · Project</div><div>Billed client</div><div className="num">Days</div><div className="num">Daily rate</div>
                    <div className="num">Amount HT</div><div>Status</div><div><span className="projects-search-label">Action</span></div>
                  </div>
                  {visibleRows.length === 0 && <p className="projects-empty">No consultant matches “{query}”.</p>}
                  {visibleRows.map((r) => {
                    const k = rowKey(r);
                    const isPending = r.status === "not_invoiced";
                    const rate = r.amountHt !== null && r.days ? Math.round((num(r.amountHt) / r.days) * 100) / 100 : null;
                    return (
                      <Fragment key={k}>
                      <div className={`inv-grid-row${isPending ? " pending" : ""}`}>
                        <div className="inv-cell-check">
                          {canCreate(r) && (
                            <input type="checkbox" aria-label={`Select ${r.consultantName}`} disabled={locked} checked={selected.has(k)}
                              onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                          )}
                        </div>
                        <div className="inv-who">
                          <span className="inv-avatar" aria-hidden="true">{initials(r.consultantName)}</span>
                          <span className="inv-who-text">
                            {r.personId && r.consultantName
                              ? <Link className="inv-name" to={`/hr/people/${r.personId}`}>{r.consultantName}</Link>
                              : <span className="inv-name">{r.consultantName || "—"}</span>}
                            <Link className="inv-meta" to={`/sales/projects/${r.projectId}`}>{r.projectTitle}</Link>
                          </span>
                        </div>
                        <div className="inv-dim">{r.billedClientName || "—"}</div>
                        <div className="num">
                          {r.personId ? <Link className="inv-plain" to={`/hr/people/${r.personId}/cra/${month.replace("-", "/")}`} title="Open the CRA for this month">{days(r.days)}</Link> : days(r.days)}
                        </div>
                        <div className="num inv-dim">{rate !== null ? rateLabel(rate) : "—"}</div>
                        <div className="num inv-strong">{r.amountHt !== null ? money(r.amountHt) : "—"}</div>
                        <div className="inv-status-cell">
                          <div className="inv-row-status">
                            {r.status === "not_invoiced"
                              ? <span className="inv-status inv-status--none"><span className="inv-dot" />To invoice</span>
                              : <StatusBadge label={invoiceStatusLabel(r.status, null)} />}
                            {r.craChanged && <span className="inv-flag">CRA changed</span>}
                          </div>
                          {[...r.blockers, ...r.warnings].map((b) => (
                            <Link key={b} className={`inv-blocker${r.blockers.includes(b as never) ? "" : " inv-blocker--warn"}`} to={fixLink(r, b)}>
                              {blockerLabel(b)}
                            </Link>
                          ))}
                        </div>
                        <div className="inv-cell-action">
                          {r.invoiceId ? (
                            <button type="button" className="inv-open" disabled={locked}
                              onClick={() => setPanel({ invoiceId: r.invoiceId as string, craChanged: r.craChanged, warning: "" })}>
                              Open<ArrowUpRight size={14} />
                            </button>
                          ) : (
                            <div className="inv-action-stack">
                              <button type="button" className="inv-btn sm" disabled={locked || !canCreate(r)} onClick={() => void createOne(r)}>
                                {busy === `create:${k}` ? "Creating…" : "Create draft"}
                              </button>
                              <button type="button" className="inv-text-btn sm" disabled={locked} aria-expanded={linking === k}
                                onClick={() => setLinking(linking === k ? null : k)}>
                                Link Qonto invoice
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      {linking === k && (
                        <LinkInvoiceStrip api={api} month={month} disabled={locked} target={r} onClose={() => setLinking(null)}
                          onLinked={(inv) => { setLinking(null); setMessage(`${inv.number || "The invoice"} now covers this CRA.`); refreshAll(); }} />
                      )}
                      </Fragment>
                    );
                  })}
                  <div className="inv-grid-foot">
                    <div />
                    <div className="inv-span-2 inv-muted-cell">{plural(visibleRows.length, "timesheet")}</div>
                    <div className="num inv-strong">{days(footDays)}</div>
                    <div />
                    <div className="num inv-total">{money(sumHt(visibleRows))}</div>
                    <div className="inv-span-2 inv-muted-cell">HT · VAT applied in Qonto</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {listView && (
          <>
            <div className="inv-filters" role="group" aria-label="Filters">
              <div className="inv-field" role="group" aria-label="Issue date range">
                <span className="inv-field-label">Issue date</span>
                <div className="inv-range-row">
                  <div className="inv-range">
                    <DateField aria-label="Issued from" placeholder="From" value={dateFrom} max={dateTo || undefined} onChange={setDateFrom} />
                    <span aria-hidden="true" className="inv-dim">→</span>
                    <DateField aria-label="Issued until" placeholder="To" value={dateTo} min={dateFrom || undefined} onChange={setDateTo} />
                  </div>
                  <div className="inv-presets" role="group" aria-label="Quick ranges">
                    {presets.map((p) => {
                      const on = dateFrom === p.from && dateTo === p.to;
                      return (
                        <button key={p.label} type="button" className={`inv-preset${on ? " on" : ""}`} aria-pressed={on}
                          onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>{p.label}</button>
                      );
                    })}
                  </div>
                  <div className="inv-filters-end">
                    <span className="inv-dim">{plural(filtered.length, "invoice")}{hasFilters ? " match" : ""}</span>
                    {hasFilters && (
                      <button type="button" className="inv-text-btn" onClick={resetFilters}><RotateCcw size={14} /> Reset filters</button>
                    )}
                  </div>
                </div>
              </div>
              <label className="inv-field">
                <span className="inv-field-label">Billing month</span>
                <span className="inv-select">
                  <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                    <option value="">All months</option>
                    {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
              </label>
              <label className="inv-field">
                <span className="inv-field-label">Client</span>
                <span className="inv-select">
                  <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                    <option value="">All clients</option>
                    {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    <option value="none">No client</option>
                  </select>
                  <ChevronDown size={16} aria-hidden="true" />
                </span>
              </label>
              <div className="inv-field" role="group" aria-label="Status">
                <span className="inv-field-label">Status</span>
                <div className="inv-chips">
                  {(["", ...STATUS_FILTERS] as const).filter((s) => s !== "Draft" || statusFilter === s || byStatus(s).length > 0).map((s) => (
                    <button key={s || "all"} type="button" className={`inv-chip${statusFilter === s ? " on" : ""}`} aria-pressed={statusFilter === s}
                      onClick={() => setStatusFilter(s)}>
                      {s || "All"}<span>{s ? byStatus(s).length : base.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tab === "unassigned" && (
              <p className="inv-hint">Invoices created directly in Qonto that no project claims yet. Attach each to its project, or mark it as not project-related.</p>
            )}
            {listError && <div className="inv-panel"><Notice error>{listError}</Notice></div>}

            <div className="projects-table-scroll inv-scroll">
              <div className="inv-grid inv-grid--inv">
                <div className="inv-grid-head">
                  <div>Invoice</div><div>Client</div><div>Project / PO</div><div>Issued</div><div className="num">Amount TTC</div><div>Status</div>
                </div>
                {!list ? (
                  !listError && <p className="projects-empty">Loading invoices…</p>
                ) : filtered.length === 0 ? (
                  <div className="inv-empty-state">
                    <strong>{invoices.length === 0 ? "No invoices yet" : tab === "unassigned" && !hasFilters ? "Nothing to assign" : "No invoices match these filters"}</strong>
                    {hasFilters && (
                      <>
                        <span className="inv-dim">Try another month or widen the date range</span>
                        <button type="button" className="inv-btn sm" onClick={resetFilters}>Reset filters</button>
                      </>
                    )}
                  </div>
                ) : groups.map((g) => {
                  const all = filtered.filter((i) => billingMonth(i) === g.key);
                  const live = all.filter((i) => i.status !== "canceled");
                  return (
                    <Fragment key={g.key || "none"}>
                      <div className="inv-group">
                        <div>
                          <span className="inv-group-label">{g.key ? monthLabel(g.key) : "No date"}</span>
                          <span className="inv-group-count">
                            {plural(all.length, "invoice")}{all.length > g.items.length ? " · continues on another page" : ""}
                          </span>
                        </div>
                        <span className="inv-group-total">{money(sumTtc(live))}</span>
                      </div>
                      {g.items.map((i) => {
                        const label = invoiceRowLabel(i);
                        const status = statusOf(i);
                        const canceled = i.status === "canceled";
                        const due = i.due_date?.slice(0, 10);
                        const late = status === "Overdue" && due ? daysBetween(due, today) : 0;
                        return (
                          <Fragment key={i.id}>
                            <div className={`inv-grid-row inv-row-open${canceled ? " canceled" : ""}`} aria-label={`Open ${i.number || "draft invoice"}`}
                              {...rowOpener(() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" }), locked)}>
                              <div className="inv-who-text">
                                <span className="inv-num">{i.number || "Draft"}</span>
                                <span className="inv-meta">
                                  {i.source === "cra" ? "from CRA" : "via Qonto import"}
                                  {i.consultant_name && <> · {i.consultant_person_id ? <Link className="inv-plain" to={`/hr/people/${i.consultant_person_id}`}>{i.consultant_name}</Link> : i.consultant_name}</>}
                                </span>
                              </div>
                              <div className={i.client_name ? undefined : "inv-dim"}>{i.client_name || "No client"}</div>
                              <div className="inv-who-text">
                                {i.project_id ? (
                                  <>
                                    <Link className="inv-plain" to={`/sales/projects/${i.project_id}`}>{i.project_title || "Project"}</Link>
                                    {i.purchase_order && <span className="inv-mono">{i.purchase_order}</span>}
                                  </>
                                ) : i.ignored ? (
                                  <span className="inv-dim">Not project-related</span>
                                ) : canceled ? (
                                  <span className="inv-dim">—</span>
                                ) : (
                                  <button type="button" className={`inv-assign${assigning === i.id ? " on" : ""}`} aria-label={`Assign a project to ${i.number || "this invoice"}`}
                                    aria-expanded={assigning === i.id} disabled={locked} onClick={() => setAssigning(assigning === i.id ? null : i.id)}>
                                    <Plus size={14} /> Assign project
                                  </button>
                                )}
                              </div>
                              <div className="inv-who-text">
                                <span className="inv-dim-2">{shortDate(i.issue_date)}</span>
                                {(status === "Validated" || status === "Overdue") && due && (
                                  <span className={status === "Overdue" ? "inv-late" : "inv-due"}>
                                    Due {shortDate(due)}{late > 0 ? ` · ${plural(late, "day")} late` : ""}
                                  </span>
                                )}
                              </div>
                              <div className="num inv-strong inv-amount">{money(i.total_ttc, i.currency)}</div>
                              <div><StatusBadge label={label} /></div>
                            </div>
                            {assigning === i.id && (
                              <div className="inv-assign-strip">
                                <span>Attach <strong>{i.number || "this invoice"}</strong> to</span>
                                <span className="inv-select">
                                  <select aria-label="Project" autoFocus value={assignTo[i.id] ?? ""} disabled={locked}
                                    onChange={(e) => setAssignTo((prev) => ({ ...prev, [i.id]: e.target.value }))}>
                                    <option value="">Choose a project</option>
                                    {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                                  </select>
                                  <ChevronDown size={16} aria-hidden="true" />
                                </span>
                                <button type="button" className="inv-btn sm" disabled={locked || !assignTo[i.id]} onClick={() => void assign(i, assignTo[i.id])}>
                                  {busy === `assign:${i.id}` ? "Saving…" : "Assign"}
                                </button>
                                <button type="button" className="inv-text-btn" disabled={locked} onClick={() => void assign(i, null)}>Not project-related</button>
                                <button type="button" className="inv-range-clear" aria-label="Close" onClick={() => setAssigning(null)}><X size={16} /></button>
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </div>

            <nav className="inv-pager" aria-label="Pagination">
              <div className="inv-pager-left">
                <span className="inv-dim-2">{filtered.length === 0 ? "0 invoices" : `${start + 1}–${Math.min(start + perPage, filtered.length)} of ${filtered.length}`}</span>
                <label className="inv-pager-size">Rows per page
                  <span className="inv-select sm">
                    <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
                      {PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" />
                  </span>
                </label>
              </div>
              <div className="inv-pager-pages">
                <button type="button" className="inv-page-arrow" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}><ChevronLeft size={18} /></button>
                {pageNumbers(current, pages).map((n, idx) => n === 0
                  ? <span key={`gap-${idx}`} className="inv-page-gap" aria-hidden="true">…</span>
                  : (
                    <button key={n} type="button" className={`inv-page${n === current ? " on" : ""}`} aria-label={`Page ${n}`}
                      aria-current={n === current ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>
                  ))}
                <button type="button" className="inv-page-arrow" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={18} /></button>
              </div>
            </nav>
          </>
        )}

        {tab === "settings" && (
          <div className="inv-panel">
            <InvoicingSettings api={api} focus={focus} onSaved={() => { void loadSettings(); refreshAll(); }} />
          </div>
        )}
      </section>

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
