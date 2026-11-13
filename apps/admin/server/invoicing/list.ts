// Server-side filtering, aggregates and paging for the Invoices / Unassigned list.
// Works on decorated invoice rows (project_title, client_name, consultant_name set).

type Row = Record<string, any>;

export const STATUS_LABELS = ["Draft", "Validated", "Paid", "Overdue", "Canceled"] as const;
export type StatusLabel = (typeof STATUS_LABELS)[number];

export type ListParams = {
  tab: "invoices" | "unassigned";
  q: string;
  status: StatusLabel | "";
  client: string; // billed_client_id, "none" for invoices without a client, "" for all
  month: string; // YYYY-MM billing month, "" for all
  from: string; // issue date YYYY-MM-DD, inclusive
  to: string;
  page: number;
  perPage: number;
  group: "month" | "client"; // how the page is ordered and headed
};

type Sum = { count: number; ttc: number };

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const sum = (rows: Row[]): Sum => ({ count: rows.length, ttc: Math.round(rows.reduce((a, i) => a + num(i.total_ttc), 0) * 100) / 100 });

export const billingMonth = (i: Row): string => String(i.period_month ?? i.issue_date ?? "").slice(0, 7);
export const clientKey = (i: Row): string => String(i.billed_client_id ?? "");
export const isUnassigned = (i: Row) => i.source === "imported" && !i.project_id && !i.ignored;
export function statusLabel(i: Row, today: string): StatusLabel {
  if (i.status === "draft") return "Draft";
  if (i.status === "paid") return "Paid";
  if (i.status === "canceled") return "Canceled";
  return i.due_date && String(i.due_date).slice(0, 10) < today ? "Overdue" : "Validated";
}

export function queryInvoices(all: Row[], p: ListParams, today: string) {
  const q = p.q.trim().toLowerCase();
  const [lo, hi] = p.from && p.to && p.from > p.to ? [p.to, p.from] : [p.from, p.to];

  // Every filter but status: the status chips and KPIs count against this set.
  const base = all.filter((i) => {
    if (p.tab === "unassigned" && !isUnassigned(i)) return false;
    const issued = String(i.issue_date ?? "").slice(0, 10);
    if (lo && (!issued || issued < lo)) return false;
    if (hi && (!issued || issued > hi)) return false;
    if (p.month && billingMonth(i) !== p.month) return false;
    if (p.client === "none" && i.billed_client_id) return false;
    if (p.client && p.client !== "none" && i.billed_client_id !== p.client) return false;
    if (q && ![i.number, i.client_name, i.project_title, i.purchase_order, i.consultant_name].join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  const labelled = base.map((i) => ({ i, s: statusLabel(i, today) }));
  const by = (s: StatusLabel) => labelled.filter((x) => x.s === s).map((x) => x.i);

  const newestFirst = (a: Row, b: Row) =>
    billingMonth(b).localeCompare(billingMonth(a)) || String(b.issue_date ?? "").localeCompare(String(a.issue_date ?? ""));
  // By client: A→Z, invoices without a client last, newest first inside each client.
  const byClient = (a: Row, b: Row) =>
    Number(!a.billed_client_id) - Number(!b.billed_client_id) ||
    String(a.client_name ?? "").localeCompare(String(b.client_name ?? "")) ||
    clientKey(a).localeCompare(clientKey(b)) ||
    newestFirst(a, b);
  const groupKey = p.group === "client" ? clientKey : billingMonth;
  const filtered = labelled.filter((x) => !p.status || x.s === p.status).map((x) => x.i)
    .sort(p.group === "client" ? byClient : newestFirst);

  const pages = Math.max(1, Math.ceil(filtered.length / p.perPage));
  const page = Math.min(Math.max(1, p.page), pages);
  const start = (page - 1) * p.perPage;
  const invoices = filtered.slice(start, start + p.perPage);

  // Group headers on this page (month or client) show the whole group's count and live total, even when it spans pages.
  const groups: Record<string, Sum> = {};
  for (const key of new Set(invoices.map(groupKey))) {
    const inGroup = filtered.filter((i) => groupKey(i) === key);
    groups[key] = { count: inGroup.length, ttc: sum(inGroup.filter((i) => i.status !== "canceled")).ttc };
  }

  const clients = new Map<string, string>();
  for (const i of all) if (i.billed_client_id) clients.set(i.billed_client_id, i.client_name ?? "Unknown client");

  return {
    invoices,
    total: filtered.length,
    page,
    perPage: p.perPage,
    pages,
    statusCounts: Object.fromEntries([["all", base.length], ...STATUS_LABELS.map((s) => [s, by(s).length])]) as Record<StatusLabel | "all", number>,
    kpis: {
      paid: sum(by("Paid")),
      unpaid: sum([...by("Validated"), ...by("Overdue")]),
      overdue: sum(by("Overdue")),
      unassigned: sum(base.filter(isUnassigned)),
    },
    group: p.group,
    groups,
    options: {
      clients: [...clients.entries()].sort((a, b) => a[1].localeCompare(b[1])),
      months: [...new Set(all.map(billingMonth).filter(Boolean))].sort().reverse(),
    },
    counts: { invoices: all.length, unassigned: all.filter(isUnassigned).length },
  };
}

/** Qonto imports that can cover a CRA consultant-month: same project first, then the client's unassigned ones. */
export function linkCandidates(all: Row[], t: { projectId: string; billedClientId: string | null; month: string }) {
  return all
    .filter((i) => i.source === "imported" && i.status !== "canceled" && !i.employee_id &&
      (i.project_id ? i.project_id === t.projectId : i.billed_client_id === t.billedClientId))
    .sort((a, b) =>
      Number(b.project_id === t.projectId) - Number(a.project_id === t.projectId) ||
      Number(String(b.period_month ?? "").startsWith(t.month)) - Number(String(a.period_month ?? "").startsWith(t.month)) ||
      String(b.issue_date ?? "").localeCompare(String(a.issue_date ?? "")));
}
