import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, FilePlus2, RefreshCw } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import { errorText, useInvoicingApi } from "./api";
import { InvoiceDraftPanel } from "./InvoiceDraftPanel";
import { InvoicingSettings } from "./InvoicingSettings";
import {
  blockerLabel, dateTime, days, invoiceRowLabel, invoiceStatusLabel, money, monthLabel, previousMonth, shiftMonth, shortDate, sourceLabel,
} from "./format";
import type { DraftResponse, Invoice, InvoicesList, InvoicingSettings as Settings, InvoiceResponse, ToInvoiceRow } from "./types";
import "../sales.css";
import "../project-form.css";
import "./invoicing.css";

type Tab = "to-invoice" | "invoices" | "unassigned" | "settings";
const BASE = "/sales/invoicing";
const TAB_PATHS: Record<Tab, string> = { "to-invoice": BASE, invoices: `${BASE}/invoices`, unassigned: `${BASE}/unassigned`, settings: `${BASE}/settings` };
const STATUS_FILTERS = ["Draft", "Validated", "Overdue", "Paid", "Canceled"] as const;
type Panel = { invoiceId: string; craChanged: boolean; warning: string };

const rowKey = (r: ToInvoiceRow) => `${r.projectId}:${r.employeeId}`;
const canCreate = (r: ToInvoiceRow) => r.status === "not_invoiced" && r.blockers.length === 0;
const unassigned = (i: Invoice) => i.source === "imported" && !i.project_id && !i.ignored;

function tabFromPath(pathname: string): Tab {
  const rest = pathname.replace(/\/+$/, "").slice(BASE.length);
  if (rest.startsWith("/invoices")) return "invoices";
  if (rest.startsWith("/unassigned")) return "unassigned";
  if (rest.startsWith("/settings")) return "settings";
  return "to-invoice";
}

/**
 * Sales → Invoicing. Monthly CRA-based invoicing through Qonto:
 * To invoice (consultant-months ready to bill), Invoices (everything in
 * Qonto, synced), Unassigned (Qonto imports to attach to a project) and
 * Settings (connection + client/service links).
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

  // To invoice
  const [month, setMonth] = useState(previousMonth());
  const [rows, setRows] = useState<ToInvoiceRow[] | null>(null);
  const [rowsError, setRowsError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Invoices + Unassigned
  const [list, setList] = useState<InvoicesList | null>(null);
  const [listError, setListError] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});

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
    setMessage(projectId ? "Invoice attached to the project." : "Invoice marked as not project-related.");
    void loadList();
  }

  async function refreshList() {
    if (busy) return;
    setBusy("refresh");
    await loadList(true);
    setBusy(null);
  }

  const invoices = list?.invoices ?? [];
  const unassignedList = invoices.filter(unassigned);
  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of invoices) if (i.billed_client_id) m.set(i.billed_client_id, i.client_name ?? "Unknown client");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);
  const projectOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of invoices) if (i.project_id) m.set(i.project_id, i.project_title ?? "Unknown project");
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);
  const filtered = invoices.filter((i) => {
    if (statusFilter && invoiceStatusLabel(i.status, i.due_date) !== statusFilter) return false;
    if (clientFilter && i.billed_client_id !== clientFilter) return false;
    if (projectFilter && i.project_id !== projectFilter) return false;
    if (monthFilter && (i.period_month ?? i.issue_date ?? "").slice(0, 7) !== monthFilter) return false;
    return true;
  });

  const eligible = (rows ?? []).filter(canCreate);
  const locked = busy !== null;
  const notConnected = settings && !settings.hasSecret;

  const fixLink = (r: ToInvoiceRow, b: string) => {
    if (b === "client_not_linked") return `${TAB_PATHS.settings}?focus=client-${r.billedClientId}`;
    if (b === "product_not_linked") return `${TAB_PATHS.settings}?focus=project-${r.projectId}`;
    if (b === "cra_incomplete") return "/hr/cra";
    return `/sales/projects/${r.projectId}`;
  };

  const tabs: [Tab, string, number | null][] = [
    ["to-invoice", "To invoice", rows ? rows.filter((r) => r.status === "not_invoiced").length : null],
    ["invoices", "Invoices", list ? invoices.length : null],
    ["unassigned", "Unassigned", list ? unassignedList.length : null],
    ["settings", "Settings", null],
  ];

  return (
    <div className="inv-page">
      <header className="projects-head">
        <div className="projects-head-text">
          <h1>Invoicing</h1>
          <p className="projects-lede">Monthly régie invoices from CRA timesheets, created and sent through Qonto</p>
        </div>
      </header>

      <Notice error>{error}</Notice>
      <Notice>{warning}</Notice>
      <Notice>{message}</Notice>
      {notConnected && tab !== "settings" && (
        <Notice>Qonto is not connected yet. <Link to={TAB_PATHS.settings}>Open Invoicing settings</Link> to add the API credentials.</Notice>
      )}

      <section className="projects-card">
        <div className="projects-toolbar">
          <div className="projects-tabs" role="tablist" aria-label="Invoicing views">
            {tabs.map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id}
                className={`projects-tab${tab === id ? " on" : ""}`} onClick={() => navigate(TAB_PATHS[id])}>
                {label}{count !== null && <span className="count">{count}</span>}
              </button>
            ))}
          </div>
          <div className="projects-toolbar-right">
            {tab === "to-invoice" && (
              <>
                <div className="inv-month">
                  <button type="button" className="projects-row-btn icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} disabled={locked}>‹</button>
                  <input type="month" aria-label="Month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} disabled={locked} />
                  <button type="button" className="projects-row-btn icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} disabled={locked}>›</button>
                </div>
                <button type="button" className="projects-row-btn" disabled={locked || selected.size === 0} onClick={() => void createSelected()}>
                  <FilePlus2 size={16} /> {busy === "create:bulk" ? "Creating…" : `Create ${selected.size || ""} draft${selected.size === 1 ? "" : "s"}`}
                </button>
                <button type="button" className="projects-refresh" aria-label="Reload" title="Reload" disabled={locked} onClick={() => void loadRows(month)}>
                  <RefreshCw size={18} />
                </button>
              </>
            )}
            {(tab === "invoices" || tab === "unassigned") && (
              <>
                <span className="inv-sync">Last sync {dateTime(list?.lastSyncedAt)}</span>
                <button type="button" className="projects-row-btn" disabled={locked} onClick={() => void refreshList()}>
                  <RefreshCw size={16} /> {busy === "refresh" ? "Syncing…" : "Refresh from Qonto"}
                </button>
              </>
            )}
          </div>
        </div>

        {(tab === "invoices" || tab === "unassigned") && list?.syncError && (
          <div className="inv-sync-error" role="alert"><AlertTriangle size={16} /> Qonto sync failed: {list.syncError} The list below may be out of date.</div>
        )}

        {tab === "to-invoice" && (
          <div className="inv-panel">
            {rowsError && <Notice error>{rowsError}</Notice>}
            {!rows ? (
              !rowsError && <p className="inv-empty">Loading {monthLabel(month)}…</p>
            ) : rows.length === 0 ? (
              <p className="inv-empty">
                {settings && !settings.startMonth
                  ? "Set the invoicing start month in Settings first."
                  : settings?.startMonth && month < settings.startMonth
                    ? `Invoicing starts in ${monthLabel(settings.startMonth)}.`
                    : `No régie CRA days in ${monthLabel(month)}.`}
              </p>
            ) : (
              <div className="projects-table-scroll">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th className="inv-col-check">
                        <input type="checkbox" aria-label="Select all ready rows" disabled={locked || eligible.length === 0}
                          checked={eligible.length > 0 && eligible.every((r) => selected.has(rowKey(r)))}
                          onChange={(e) => setSelected(e.target.checked ? new Set(eligible.map(rowKey)) : new Set())} />
                      </th>
                      <th>Consultant</th><th>Project</th><th>Billed client</th><th className="num">Days</th><th className="num">Amount HT</th><th>Status</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const k = rowKey(r);
                      return (
                        <tr key={k}>
                          <td className="inv-col-check">
                            {canCreate(r) && (
                              <input type="checkbox" aria-label={`Select ${r.consultantName}`} disabled={locked} checked={selected.has(k)}
                                onChange={(e) => setSelected((prev) => { const n = new Set(prev); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
                            )}
                          </td>
                          <td><strong>{r.consultantName || "—"}</strong></td>
                          <td><Link to={`/sales/projects/${r.projectId}`}>{r.projectTitle}</Link></td>
                          <td>{r.billedClientName || "—"}</td>
                          <td className="num">{days(r.days)}</td>
                          <td className="num">{r.amountHt !== null ? money(r.amountHt) : "—"}</td>
                          <td>
                            <div className="inv-row-status">
                              <span className={`inv-status inv-status--${r.status === "not_invoiced" ? "none" : invoiceStatusLabel(r.status, null).toLowerCase()}`}>
                                {r.status === "not_invoiced" ? "Not invoiced" : invoiceStatusLabel(r.status, null)}
                              </span>
                              {r.craChanged && <span className="inv-flag">CRA changed</span>}
                            </div>
                            {[...r.blockers, ...r.warnings].map((b) => (
                              <Link key={b} className={`inv-blocker${r.blockers.includes(b as never) ? "" : " inv-blocker--warn"}`} to={fixLink(r, b)}>
                                {blockerLabel(b)}
                              </Link>
                            ))}
                          </td>
                          <td className="inv-col-actions">
                            {r.invoiceId ? (
                              <button type="button" className="projects-row-btn" disabled={locked}
                                onClick={() => setPanel({ invoiceId: r.invoiceId as string, craChanged: r.craChanged, warning: "" })}>
                                Open
                              </button>
                            ) : (
                              <button type="button" className="projects-row-btn" disabled={locked || !canCreate(r)} onClick={() => void createOne(r)}>
                                {busy === `create:${k}` ? "Creating…" : "Create draft"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "invoices" && (
          <div className="inv-panel">
            <div className="inv-filters">
              <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label="Client" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
                <option value="">All clients</option>
                {clientOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select aria-label="Project" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                <option value="">All projects</option>
                {projectOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <input type="month" aria-label="Month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
              {(statusFilter || clientFilter || projectFilter || monthFilter) && (
                <button type="button" className="projects-row-btn" onClick={() => { setStatusFilter(""); setClientFilter(""); setProjectFilter(""); setMonthFilter(""); }}>
                  Clear filters
                </button>
              )}
            </div>
            {listError && <Notice error>{listError}</Notice>}
            {!list ? (
              !listError && <p className="inv-empty">Loading invoices…</p>
            ) : filtered.length === 0 ? (
              <p className="inv-empty">{invoices.length ? "No invoice matches these filters." : "No invoices yet."}</p>
            ) : (
              <div className="projects-table-scroll">
                <table className="inv-table">
                  <thead>
                    <tr><th>Invoice</th><th>Source</th><th>Client</th><th>Project</th><th>Period</th><th>Due</th><th className="num">Total TTC</th><th /></tr>
                  </thead>
                  <tbody>
                    {filtered.map((i) => {
                      const label = invoiceRowLabel(i);
                      return (
                        <tr key={i.id}>
                          <td>
                            <div className="inv-row-status">
                              <strong>{i.number || "—"}</strong>
                              <span className={`inv-status inv-status--${label.split(" ")[0].toLowerCase()}`}>{label}</span>
                            </div>
                          </td>
                          <td><span className={`inv-source inv-source--${i.source}`}>{sourceLabel(i.source)}</span></td>
                          <td>{i.client_name || "—"}</td>
                          <td>
                            {i.project_title || <span className="inv-muted">{i.ignored ? "Not project-related" : "Unassigned"}</span>}
                            {i.consultant_name && <span className="inv-sub">{i.consultant_name}</span>}
                          </td>
                          <td>{monthLabel(i.period_month ?? i.issue_date)}</td>
                          <td>{shortDate(i.due_date)}</td>
                          <td className="num">{money(i.total_ttc, i.currency)}</td>
                          <td className="inv-col-actions">
                            <button type="button" className="projects-row-btn" disabled={locked} onClick={() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" })}>
                              {i.status === "draft" && !i.provider_invoice_id ? "Delete…" : "Open"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "unassigned" && (
          <div className="inv-panel">
            <p className="inv-hint">Invoices created directly in Qonto that no project claims yet. Attach each to its project, or mark it as not project-related.</p>
            {listError && <Notice error>{listError}</Notice>}
            {!list ? (
              !listError && <p className="inv-empty">Loading invoices…</p>
            ) : unassignedList.length === 0 ? (
              <p className="inv-empty">Nothing to assign.</p>
            ) : (
              <div className="projects-table-scroll">
                <table className="inv-table">
                  <thead>
                    <tr><th>Invoice</th><th>Client</th><th>Issued</th><th className="num">Total TTC</th><th>Project</th><th /></tr>
                  </thead>
                  <tbody>
                    {unassignedList.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <div className="inv-row-status">
                            <button type="button" className="inv-link" onClick={() => setPanel({ invoiceId: i.id, craChanged: false, warning: "" })}>{i.number || "Draft"}</button>
                            <span className={`inv-status inv-status--${invoiceRowLabel(i).split(" ")[0].toLowerCase()}`}>{invoiceRowLabel(i)}</span>
                          </div>
                        </td>
                        <td>{i.client_name || "—"}</td>
                        <td>{shortDate(i.issue_date)}</td>
                        <td className="num">{money(i.total_ttc, i.currency)}</td>
                        <td>
                          <select aria-label="Project" value={assignTo[i.id] ?? ""} disabled={locked}
                            onChange={(e) => setAssignTo((prev) => ({ ...prev, [i.id]: e.target.value }))}>
                            <option value="">Choose a project</option>
                            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                          </select>
                        </td>
                        <td className="inv-col-actions">
                          <div className="inv-actions">
                            <button type="button" className="projects-row-btn" disabled={locked || !assignTo[i.id]} onClick={() => void assign(i, assignTo[i.id])}>
                              {busy === `assign:${i.id}` ? "Saving…" : "Assign"}
                            </button>
                            <button type="button" className="projects-row-btn" disabled={locked} onClick={() => void assign(i, null)}>
                              Not project-related
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
