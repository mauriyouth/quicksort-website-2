// Invoice lifecycle and sync: the server flow behind api/invoicing.ts.
// Every function takes the request context and returns { status, body }.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, buildDraftLines, draftTotals, monthLabelFr, monthPeriod, resolvePricingLine } from "./draft.ts";
import type { BuiltLine, CraEntry, ProductRef } from "./draft.ts";
import { toInvoiceRows } from "./month.ts";
import { storedPricingLines } from "../../src/sales/pricing-lines.ts";
import type { ToInvoiceRow } from "./month.ts";
import { ProviderError } from "./provider.ts";
import type { DraftLine, InvoiceDraft, InvoicingProvider, ProviderInvoice } from "./provider.ts";
import { reconcile } from "./sync.ts";
import type { InvoicingSettings } from "./settings.ts";

export type LifecycleCtx = {
  client: SupabaseClient;
  provider: () => InvoicingProvider;
  actor: string;
  now: () => Date;
  settings: InvoicingSettings;
};
export type Result = { status: number; body: unknown };
export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

type Row = Record<string, any>;
const SYNC_TTL_MS = 5 * 60 * 1000;
const NO_EMAIL = "This client has no invoice email in Qonto.";
const BLOCKER_MESSAGES: Record<string, string> = {
  no_days: "This consultant has no CRA days on this project for that month.",
  client_not_linked: "Link this client to Qonto first.",
  no_pricing_line: "Pick a pricing line on the staffing first.",
  no_rate: "No TJM covers these dates.",
  product_not_linked: "Link this pricing line to a Qonto service first.",
};

// ---------- small helpers ----------

async function many(query: PromiseLike<{ data: unknown; error: unknown }>, message: string): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return (data as Row[] | null) ?? [];
}
async function maybeOne(query: PromiseLike<{ data: unknown; error: unknown }>, message: string): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(message);
  return (data as Row | null) ?? null;
}

export function parisToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
const ym = (date: unknown) => (typeof date === "string" ? date.slice(0, 7) : "");
const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const money = (c: number) => (c / 100).toFixed(2);
const withWarnings = (body: Row, warnings: string[]) => (warnings.length ? { ...body, warning: warnings.join(" ") } : body);

function toDraftLine(l: DraftLine): DraftLine {
  return { title: l.title, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, vatRate: l.vatRate };
}
function lineRows(invoiceId: string, lines: BuiltLine[]): Row[] {
  return lines.map((l, position) => ({
    invoice_id: invoiceId, position, title: l.title, description: l.description,
    quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unitPrice), vat_rate: Number(l.vatRate),
    pricing_line: l.pricingLine, computed_quantity: l.computedQuantity, computed_unit_price: l.computedUnitPrice,
  }));
}
function storedLine(row: Row): DraftLine {
  return {
    title: row.title, description: row.description ?? "", quantity: String(row.quantity), unit: row.unit,
    unitPrice: Number(row.unit_price).toFixed(2), vatRate: String(row.vat_rate),
  };
}
function totalsPatch(remote: ProviderInvoice): Row {
  return { total_ht: remote.totalHt, total_vat: remote.totalVat, total_ttc: remote.totalTtc };
}
// Qonto computes the stored totals; flag any drift from our own computation.
function totalsWarning(remote: ProviderInvoice, lines: DraftLine[]): string | null {
  const expected = draftTotals(lines);
  if (cents(remote.totalHt) === cents(expected.ht) && cents(remote.totalTtc) === cents(expected.ttc)) return null;
  return `Qonto computed ${remote.totalTtc} TTC where ${expected.ttc} TTC was expected. Check the draft before validating it.`;
}

async function record(ctx: LifecycleCtx, invoiceId: string, kind: string, detail: Row, warnings: string[]) {
  const { error } = await ctx.client.from("invoice_events").insert({ invoice_id: invoiceId, kind, actor: ctx.actor, detail });
  if (error) warnings.push("The invoice history could not be updated.");
}
async function loadInvoice(ctx: LifecycleCtx, id: string): Promise<Row> {
  const row = await maybeOne(ctx.client.from("invoices").select("*").eq("id", id).maybeSingle(), "Could not read the invoice.");
  if (!row) throw new HttpError("Invoice not found.", 404);
  return row;
}
async function loadLines(ctx: LifecycleCtx, invoiceId: string): Promise<Row[]> {
  return many(ctx.client.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("position"), "Could not read the invoice lines.");
}
async function findCraInvoice(ctx: LifecycleCtx, projectId: string, employeeId: string, month: string): Promise<Row | null> {
  const rows = await many(
    ctx.client.from("invoices").select("*").eq("source", "cra").eq("project_id", projectId).eq("employee_id", employeeId)
      .eq("period_month", `${month}-01`).neq("status", "canceled"),
    "Could not read invoices.",
  );
  return rows[0] ?? null;
}
async function updateInvoice(ctx: LifecycleCtx, id: string, patch: Row): Promise<Row | null> {
  const { data, error } = await ctx.client.from("invoices").update({ ...patch, updated_at: ctx.now().toISOString() }).eq("id", id).select().maybeSingle();
  return error ? null : ((data as Row | null) ?? null);
}

// When a finalize/cancel response is unusable, the provider's current state decides.
async function confirmed(
  action: () => Promise<ProviderInvoice>, reload: () => Promise<ProviderInvoice>,
  ok: (r: ProviderInvoice) => boolean, message: string,
): Promise<ProviderInvoice> {
  let first: unknown = null;
  try {
    const r = await action();
    if (r && ok(r)) return r;
  } catch (error) { first = error; }
  let current: ProviderInvoice;
  try { current = await reload(); } catch { throw first ?? new ProviderError(message, 502); }
  if (current && ok(current)) return current;
  throw first ?? new ProviderError(message, 502);
}

// ---------- source data (CRA, staffing, projects, links) ----------

type Sources = {
  projects: Row[]; employees: { id: string; person_id: string | null; full_name: string; start_date: string; end_date: string | null }[];
  entries: Row[]; craMonths: Row[]; assignments: Row[]; extensions: Row[]; clients: Row[];
  clientLinks: Row[]; productLinks: Row[]; invoices: Row[];
};

async function loadSources(ctx: LifecycleCtx, o: { from: string; to: string; projectId?: string; employeeId?: string }): Promise<Sources> {
  const { client } = ctx;
  const start = `${o.from}-01`;
  const until = `${shiftMonth(o.to, 1)}-01`;
  let projectsQ = client.from("sales_projects").select("id,title,client_id,intermediary_client_id,pricing_model,currency,tjm_profiles,start_date,end_date").eq("pricing_model", "regie");
  if (o.projectId) projectsQ = projectsQ.eq("id", o.projectId);
  let assignmentsQ = client.from("employee_project_assignments").select("employee_id,project_id,pricing_line,start_date,end_date,status");
  if (o.projectId) assignmentsQ = assignmentsQ.eq("project_id", o.projectId);
  if (o.employeeId) assignmentsQ = assignmentsQ.eq("employee_id", o.employeeId);
  let employeesQ = client.from("employees").select("id,person_id,start_date,end_date");
  if (o.employeeId) employeesQ = employeesQ.eq("id", o.employeeId);
  let productsQ = client.from("invoicing_product_links").select("*");
  if (o.projectId) productsQ = productsQ.eq("project_id", o.projectId);
  let invoicesQ = client.from("invoices").select("id,project_id,employee_id,period_month,status,source,cra_version,total_ht,number").gte("period_month", start).lt("period_month", until);
  if (o.projectId) invoicesQ = invoicesQ.eq("project_id", o.projectId);
  const [projects, assignments, employeeRows, productLinks, invoices, clients, clientLinks] = await Promise.all([
    many(projectsQ, "Could not read projects."),
    many(assignmentsQ, "Could not read staffing."),
    many(employeesQ, "Could not read employees."),
    many(productsQ, "Could not read product links."),
    many(invoicesQ, "Could not read invoices."),
    many(client.from("sales_clients").select("id,name"), "Could not read clients."),
    many(client.from("invoicing_client_links").select("client_id,provider_client_id"), "Could not read client links."),
  ]);
  // For a project view only the consultants staffed on it matter.
  const employeeIds = o.projectId ? [...new Set(assignments.map((a) => a.employee_id))] : null;
  const scoped = (q: any) => {
    let out = q.gte("month", start).lt("month", until);
    if (o.employeeId) out = out.eq("employee_id", o.employeeId);
    if (employeeIds) out = out.in("employee_id", employeeIds);
    return out;
  };
  const projectIds = projects.map((p) => p.id);
  const personIds = [...new Set(employeeRows.map((e) => e.person_id).filter(Boolean))];
  const skip = employeeIds !== null && employeeIds.length === 0;
  const [entries, craMonths, extensions, people] = await Promise.all([
    skip ? [] : many(scoped(client.from("cra_entries").select("employee_id,month,day,part,status,project_id")), "Could not read CRA entries."),
    skip ? [] : many(scoped(client.from("cra_months").select("employee_id,month,version")), "Could not read CRA months."),
    projectIds.length ? many(client.from("sales_project_extensions").select("project_id,status,start_date,end_date,tjm_profiles").in("project_id", projectIds), "Could not read extensions.") : [],
    personIds.length ? many(client.from("hr_people").select("id,full_name").in("id", personIds), "Could not read people.") : [],
  ]);
  const names = new Map(people.map((p) => [p.id, p.full_name ?? ""]));
  const employees = employeeRows
    .filter((e) => !employeeIds || employeeIds.includes(e.id))
    .map((e) => ({ id: e.id, person_id: e.person_id ?? null, full_name: String(names.get(e.person_id) ?? ""), start_date: e.start_date, end_date: e.end_date ?? null }));
  return { projects, employees, entries, craMonths, assignments, extensions, clients, clientLinks, productLinks, invoices };
}

function craFor(src: Sources, employeeId: string, month: string): { version: number; entries: CraEntry[] } | null {
  const entries = src.entries.filter((e) => e.employee_id === employeeId && ym(e.month) === month)
    .map((e) => ({ day: e.day, part: e.part, status: e.status, project_id: e.project_id ?? null }));
  const meta = src.craMonths.find((m) => m.employee_id === employeeId && ym(m.month) === month);
  if (!meta && !entries.length) return null;
  return { version: Number(meta?.version ?? 0), entries };
}
function productsByProject(src: Sources): Record<string, Record<string, ProductRef>> {
  const out: Record<string, Record<string, ProductRef>> = {};
  for (const l of src.productLinks) {
    (out[l.project_id] ??= {})[l.pricing_line] = { title: l.title, description: l.description ?? "", unit: l.unit ?? "jour", vat_rate: Number(l.vat_rate ?? 0.2) };
  }
  return out;
}
function rowsForMonth(ctx: LifecycleCtx, src: Sources, month: string): ToInvoiceRow[] {
  const craByEmployee: Record<string, { version: number; entries: CraEntry[] }> = {};
  for (const e of src.employees) {
    const cra = craFor(src, e.id, month);
    if (cra) craByEmployee[e.id] = cra;
  }
  const extensionsByProject: Record<string, Row[]> = {};
  for (const x of src.extensions) (extensionsByProject[x.project_id] ??= []).push(x);
  return toInvoiceRows({
    month, startMonth: ctx.settings.startMonth, employees: src.employees, craByEmployee,
    assignments: src.assignments as any, projects: src.projects as any, extensionsByProject: extensionsByProject as any,
    clients: src.clients as any, linkedClientIds: new Set(src.clientLinks.map((l) => l.client_id)),
    productsByProject: productsByProject(src), invoices: src.invoices as any,
  });
}

function buildFor(src: Sources, projectId: string, employeeId: string, month: string) {
  const project = src.projects.find((p) => p.id === projectId);
  if (!project) throw new HttpError("Project not found, or not billed in régie.", 404);
  const employee = src.employees.find((e) => e.id === employeeId);
  if (!employee) throw new HttpError("Consultant not found.", 404);
  const cra = craFor(src, employeeId, month) ?? { version: 0, entries: [] };
  const built = buildDraftLines({
    month, consultantName: employee.full_name, projectId, entries: cra.entries,
    assignments: src.assignments.filter((a) => a.employee_id === employeeId) as any, project: project as any,
    extensions: src.extensions.filter((x) => x.project_id === projectId) as any,
    products: productsByProject(src)[projectId] ?? {},
  });
  return { project, employee, cra, built };
}
function blocked(blocker: string, pricingLine?: string): Result {
  return { status: 422, body: { error: BLOCKER_MESSAGES[blocker] ?? "This draft cannot be created yet.", blocker, ...(pricingLine ? { pricingLine } : {}) } };
}
function craDraft(row: Row, lines: DraftLine[], patch: { dueDate?: string; purchaseOrder?: string } = {}): InvoiceDraft {
  const period = monthPeriod(ym(row.period_month));
  return {
    clientId: row.provider_client_id, issueDate: row.issue_date, dueDate: patch.dueDate ?? row.due_date, currency: row.currency ?? "EUR",
    periodStart: period.start, periodEnd: period.end, purchaseOrder: patch.purchaseOrder ?? row.purchase_order ?? "", lines,
  };
}

// ---------- reads ----------

async function decorate(ctx: LifecycleCtx, invoices: Row[]): Promise<Row[]> {
  const { client } = ctx;
  const [projects, clients, employees] = await Promise.all([
    many(client.from("sales_projects").select("id,title"), "Could not read projects."),
    many(client.from("sales_clients").select("id,name"), "Could not read clients."),
    many(client.from("employees").select("id,person_id"), "Could not read employees."),
  ]);
  const personIds = [...new Set(employees.map((e) => e.person_id).filter(Boolean))];
  const people = personIds.length ? await many(client.from("hr_people").select("id,full_name").in("id", personIds), "Could not read people.") : [];
  const title = new Map(projects.map((p) => [p.id, p.title]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const personName = new Map(people.map((p) => [p.id, p.full_name]));
  const consultant = new Map(employees.map((e) => [e.id, personName.get(e.person_id) ?? null]));
  const person = new Map(employees.map((e) => [e.id, e.person_id ?? null]));
  return invoices.map((i) => ({
    ...i,
    project_title: title.get(i.project_id) ?? null,
    client_name: clientName.get(i.billed_client_id) ?? null,
    consultant_name: consultant.get(i.employee_id) ?? null,
    consultant_person_id: person.get(i.employee_id) ?? null,
  }));
}

export async function monthRows(ctx: LifecycleCtx, month: string) {
  const src = await loadSources(ctx, { from: month, to: month });
  return { rows: rowsForMonth(ctx, src, month) };
}

export async function syncInvoices(ctx: LifecycleCtx): Promise<string> {
  const { client } = ctx;
  // Read our rows before the remote list so a draft created meanwhile is never treated as vanished.
  const [existing, clientLinks, projects, extensions] = await Promise.all([
    many(client.from("invoices").select("id,provider_invoice_id,status,project_id,source,ignored"), "Could not read invoices."),
    many(client.from("invoicing_client_links").select("client_id,provider_client_id"), "Could not read client links."),
    many(client.from("sales_projects").select("id,title,pricing_model,client_id,intermediary_client_id,start_date,end_date"), "Could not read projects."),
    many(client.from("sales_project_extensions").select("project_id,status,end_date"), "Could not read extensions."),
  ]);
  const remote = await ctx.provider().listInvoices(); // complete list: the adapter pages through everything
  const { inserts, updates, removedDraftIds } = reconcile(existing as any, remote, {
    clientLinks: clientLinks as any,
    projects: projects.map((p) => ({
      ...(p as any),
      extension_end_dates: extensions.filter((x) => x.project_id === p.id && x.status === "signed").map((x) => x.end_date ?? null),
    })),
  });
  const now = ctx.now().toISOString();
  if (inserts.length) {
    const { error } = await client.from("invoices")
      .upsert(inserts.map((r) => ({ ...r, provider: ctx.settings.provider })), { onConflict: "provider,provider_invoice_id", ignoreDuplicates: true });
    if (error) throw new Error("Could not import invoices.", { cause: error });
  }
  for (const u of updates) {
    const { error } = await client.from("invoices").update({ ...u.patch, updated_at: now }).eq("id", u.id);
    if (error) throw new Error("Could not update invoices.");
  }
  if (removedDraftIds.length) {
    const { error } = await client.from("invoices").delete().in("id", removedDraftIds).eq("status", "draft");
    if (error) throw new Error("Could not remove deleted drafts.");
  }
  await storeImportedLines(ctx, remote);
  const { error } = await client.from("invoicing_settings").update({ last_synced_at: now }).eq("id", "default");
  if (error) throw new Error("Could not save the sync time.");
  return now;
}

// Imported invoices keep Qonto's lines (title, description…), replaced on every sync. CRA lines are ours and untouched.
async function storeImportedLines(ctx: LifecycleCtx, remote: ProviderInvoice[]) {
  const ids = remote.map((r) => r.id);
  if (!ids.length) return;
  const rows = await many(
    ctx.client.from("invoices").select("id,provider_invoice_id").eq("source", "imported").in("provider_invoice_id", ids),
    "Could not read invoices.",
  );
  if (!rows.length) return;
  const byProviderId = new Map(remote.map((r) => [r.id, r]));
  const removed = await ctx.client.from("invoice_lines").delete().in("invoice_id", rows.map((r) => r.id));
  if (removed.error) throw new Error("Could not replace invoice lines.", { cause: removed.error });
  const lines = rows.flatMap((row) => (byProviderId.get(row.provider_invoice_id)?.lines ?? []).map((l, position) => ({
    invoice_id: row.id, position, title: l.title, description: l.description, quantity: Number(l.quantity) || 0,
    unit: l.unit, unit_price: Number(l.unitPrice) || 0, vat_rate: Number(l.vatRate) || 0,
  })));
  if (!lines.length) return;
  const added = await ctx.client.from("invoice_lines").insert(lines);
  if (added.error) throw new Error("Could not import invoice lines.", { cause: added.error });
}

export async function listInvoices(ctx: LifecycleCtx, refresh: boolean) {
  let lastSyncedAt = ctx.settings.lastSyncedAt;
  let syncError: string | null = null;
  const stale = !lastSyncedAt || ctx.now().getTime() - Date.parse(lastSyncedAt) > SYNC_TTL_MS;
  if (ctx.settings.hasSecret && (refresh || stale)) {
    try { lastSyncedAt = await syncInvoices(ctx); } catch (error) {
      console.error("[invoicing] sync failed", error);
      syncError = error instanceof ProviderError || error instanceof HttpError ? error.message : "Could not refresh invoices from Qonto.";
    }
  }
  const rows = await many(ctx.client.from("invoices").select("*").order("issue_date", { ascending: false }), "Could not read invoices.");
  return { invoices: await decorate(ctx, rows), lastSyncedAt, ...(syncError ? { syncError } : {}) };
}

export async function invoiceDetail(ctx: LifecycleCtx, id: string) {
  const invoice = await loadInvoice(ctx, id);
  const [lines, events] = await Promise.all([
    loadLines(ctx, id),
    many(ctx.client.from("invoice_events").select("*").eq("invoice_id", id).order("created_at"), "Could not read the invoice history."),
  ]);
  // Recipients for the Send confirmation; best effort.
  let recipients: string[] | null = null;
  if ((invoice.status === "finalized" || invoice.status === "paid") && invoice.provider_invoice_id && ctx.settings.hasSecret) {
    try { recipients = (await ctx.provider().getInvoice(invoice.provider_invoice_id)).clientEmails; } catch { recipients = null; }
  }
  const [decorated] = await decorate(ctx, [invoice]);
  const consultants = invoice.source === "imported" && invoice.project_id ? await projectConsultants(ctx, invoice.project_id) : [];
  return { invoice: decorated, lines, events, recipients, consultants };
}

// Everyone ever staffed on the project, by name: the consultants an imported invoice can be assigned to.
async function projectConsultants(ctx: LifecycleCtx, projectId: string): Promise<{ id: string; name: string }[]> {
  const staffing = await many(ctx.client.from("employee_project_assignments").select("employee_id").eq("project_id", projectId), "Could not read staffing.");
  const ids = [...new Set(staffing.map((a) => a.employee_id))];
  if (!ids.length) return [];
  const employees = await many(ctx.client.from("employees").select("id,person_id").in("id", ids), "Could not read employees.");
  const personIds = [...new Set(employees.map((e) => e.person_id).filter(Boolean))];
  const people = personIds.length ? await many(ctx.client.from("hr_people").select("id,full_name").in("id", personIds), "Could not read people.") : [];
  const name = new Map(people.map((p) => [p.id, String(p.full_name ?? "")]));
  return employees.map((e) => ({ id: e.id, name: name.get(e.person_id) || "Unnamed consultant" })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function projectSummary(ctx: LifecycleCtx, projectId: string) {
  const project = await maybeOne(ctx.client.from("sales_projects").select("id,start_date,tjm_profiles,currency").eq("id", projectId).maybeSingle(), "Could not read the project.");
  if (!project) throw new HttpError("Project not found.", 404);
  const [invoices, assignments] = await Promise.all([
    many(ctx.client.from("invoices").select("*").eq("project_id", projectId).order("issue_date", { ascending: false }), "Could not read invoices."),
    many(ctx.client.from("employee_project_assignments").select("employee_id,project_id,pricing_line,start_date,end_date,status").eq("project_id", projectId), "Could not read staffing."),
  ]);
  const invoiceLines = invoices.length
    ? await many(ctx.client.from("invoice_lines").select("invoice_id,pricing_line,position").in("invoice_id", invoices.map((i) => i.id)).order("position"), "Could not read the invoice lines.")
    : [];
  // The profile (TJM pricing line) an invoice bills: its own lines first,
  // else the consultant's staffing for that month (imported invoices).
  const lineProfile = new Map<string, string>();
  for (const l of invoiceLines) if (l.pricing_line && !lineProfile.has(l.invoice_id)) lineProfile.set(l.invoice_id, l.pricing_line);
  const staffedProfile = (employeeId: string | null, month: string): string | null => {
    if (!employeeId || !month) return null;
    const first = `${month}-01`, last = `${shiftMonth(month, 1)}-01`;
    const overlapping = assignments.filter((a) => a.employee_id === employeeId && a.start_date < last && (!a.end_date || a.end_date >= first));
    for (const a of overlapping) {
      const line = resolvePricingLine(a as any, project as any);
      if (line) return line;
    }
    return null;
  };
  let invoiced = 0, paid = 0, outstanding = 0;
  for (const i of invoices) {
    if (i.status !== "finalized" && i.status !== "paid") continue;
    invoiced += cents(i.total_ht);
    if (i.status === "paid") paid += cents(i.total_ttc);
    else outstanding += cents(i.total_ttc);
  }
  // Each row carries its month so the project view can create the draft.
  const rows: (ToInvoiceRow & { month: string; profile: string | null })[] = [];
  const { startMonth } = ctx.settings;
  if (startMonth) {
    const projectStart = ym(project.start_date);
    const from = projectStart && projectStart > startMonth ? projectStart : startMonth;
    const to = shiftMonth(parisToday(ctx.now()).slice(0, 7), -1);
    if (from <= to) {
      const src = await loadSources(ctx, { from, to, projectId });
      for (let m = from; m <= to; m = shiftMonth(m, 1)) {
        rows.push(...rowsForMonth(ctx, src, m).filter((r) => r.projectId === projectId && r.status === "not_invoiced").map((r) => ({ ...r, month: m, profile: staffedProfile(r.employeeId, m) })));
      }
    }
  }
  return {
    invoices: (await decorate(ctx, invoices)).map((i) => ({
      ...i,
      // Work is billed the month after it is done: no period → month before issue.
      profile: lineProfile.get(i.id) ?? staffedProfile(i.employee_id, ym(i.period_month) || (ym(i.issue_date) ? shiftMonth(ym(i.issue_date), -1) : "")),
    })),
    consultants: await projectConsultants(ctx, projectId),
    profiles: storedPricingLines(project.tjm_profiles).map((l) => l.name),
    totals: { invoicedHt: money(invoiced), paidTtc: money(paid), outstandingTtc: money(outstanding) },
    rows,
  };
}

// ---------- actions ----------

export async function createDraft(ctx: LifecycleCtx, input: { projectId: string; employeeId: string; month: string }): Promise<Result> {
  const { client, settings } = ctx;
  const { projectId, employeeId, month } = input;
  if (!settings.startMonth || month < settings.startMonth) return { status: 422, body: { error: "This month is before the invoicing start month." } };
  if (month > parisToday(ctx.now()).slice(0, 7)) return { status: 422, body: { error: "This month has not started yet." } };

  const existing = await findCraInvoice(ctx, projectId, employeeId, month);
  if (existing) return { status: 200, body: { invoice: existing, lines: await loadLines(ctx, existing.id), existing: true } };

  const src = await loadSources(ctx, { from: month, to: month, projectId, employeeId });
  const { project, cra, built } = buildFor(src, projectId, employeeId, month);
  if (!built.ok) return blocked(built.blocker, built.pricingLine);
  const billedClientId = project.intermediary_client_id ?? project.client_id;
  const link = src.clientLinks.find((l) => l.client_id === billedClientId);
  if (!link) return blocked("client_not_linked");

  const issueDate = parisToday(ctx.now());
  const dueDate = addDays(issueDate, settings.dueDays);
  const currency = project.currency || "EUR";
  const inserted = await client.from("invoices").insert({
    provider: settings.provider, status: "draft", source: "cra", project_id: projectId, employee_id: employeeId,
    period_month: `${month}-01`, cra_version: cra.version, billed_client_id: billedClientId, provider_client_id: link.provider_client_id,
    issue_date: issueDate, due_date: dueDate, currency, purchase_order: "",
    total_ht: built.totals.ht, total_vat: built.totals.vat, total_ttc: built.totals.ttc, created_by: ctx.actor,
  }).select().single();
  if (inserted.error) {
    // Another request created this consultant-month first: hand back its invoice.
    if ((inserted.error as { code?: string }).code === "23505") {
      const winner = await findCraInvoice(ctx, projectId, employeeId, month);
      if (winner) return { status: 200, body: { invoice: winner, lines: await loadLines(ctx, winner.id), existing: true } };
    }
    throw new Error("Could not create the invoice.");
  }
  const row = inserted.data as Row;
  const lines = built.lines.map(toDraftLine);

  let remote: ProviderInvoice;
  try {
    remote = await ctx.provider().createDraft(craDraft(row, lines));
  } catch (error) {
    await client.from("invoices").delete().eq("id", row.id);
    return { status: 502, body: { error: error instanceof ProviderError ? error.message : "Qonto did not create the draft. Please try again." } };
  }

  const saved = await updateInvoice(ctx, row.id, {
    provider_invoice_id: remote.id, number: remote.number, invoice_url: remote.invoiceUrl, ...totalsPatch(remote),
  });
  if (!saved) {
    // Without the provider id our row is useless: undo both sides so a retry starts clean.
    try { await ctx.provider().deleteDraft(remote.id); } catch { /* the next sync imports it */ }
    await client.from("invoices").delete().eq("id", row.id);
    return { status: 502, body: { error: "The draft could not be saved. Please try again." } };
  }
  const warnings: string[] = [];
  const lineInsert = await client.from("invoice_lines").insert(lineRows(row.id, built.lines));
  if (lineInsert.error) warnings.push("The draft lines could not be saved here; regenerate the draft.");
  const drift = totalsWarning(remote, lines);
  if (drift) warnings.push(drift);
  await record(ctx, row.id, "create_draft", { provider_invoice_id: remote.id, cra_version: cra.version, total_ttc: remote.totalTtc }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved, lines: await loadLines(ctx, row.id) }, warnings) };
}

function editableDraft(row: Row) {
  if (row.status !== "draft" || row.source !== "cra" || !row.provider_invoice_id) throw new HttpError("Only drafts created from the CRA can be edited here.", 409);
}

export async function updateDraft(
  ctx: LifecycleCtx,
  input: { invoiceId: string; dueDate: string; purchaseOrder: string; lines: { id: string; quantity: string; unitPrice: string; description: string }[] },
): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  editableDraft(row);
  if (row.issue_date && input.dueDate < row.issue_date) return { status: 400, body: { error: "The due date cannot be before the issue date." } };
  const stored = await loadLines(ctx, row.id);
  const edits = new Map(input.lines.map((l) => [l.id, l]));
  if ([...edits.keys()].some((id) => !stored.some((s) => s.id === id))) return { status: 400, body: { error: "Unknown invoice line." } };
  if (!stored.length) return { status: 409, body: { error: "This draft has no lines; regenerate it first." } };
  const merged = stored.map((s) => {
    const e = edits.get(s.id);
    const base = storedLine(s);
    return e ? { ...base, quantity: e.quantity, unitPrice: e.unitPrice, description: e.description } : base;
  });
  const remote = await ctx.provider().updateDraft(row.provider_invoice_id, craDraft(row, merged, input));

  const warnings: string[] = [];
  const saved = await updateInvoice(ctx, row.id, { due_date: input.dueDate, purchase_order: input.purchaseOrder, ...totalsPatch(remote) });
  let linesSaved = !!saved;
  for (const [i, s] of stored.entries()) {
    const { error } = await ctx.client.from("invoice_lines")
      .update({ description: merged[i].description, quantity: Number(merged[i].quantity), unit_price: Number(merged[i].unitPrice) }).eq("id", s.id);
    if (error) linesSaved = false;
  }
  if (!linesSaved) warnings.push("Qonto was updated but the local copy could not be saved. Reload before editing again.");
  const drift = totalsWarning(remote, merged);
  if (drift) warnings.push(drift);
  await record(ctx, row.id, "update_draft", { due_date: input.dueDate, purchase_order: input.purchaseOrder, total_ttc: remote.totalTtc }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved ?? row, lines: await loadLines(ctx, row.id) }, warnings) };
}

export async function regenerateDraft(ctx: LifecycleCtx, input: { invoiceId: string }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  editableDraft(row);
  const month = ym(row.period_month);
  const src = await loadSources(ctx, { from: month, to: month, projectId: row.project_id, employeeId: row.employee_id });
  const { cra, built } = buildFor(src, row.project_id, row.employee_id, month);
  if (!built.ok) return blocked(built.blocker, built.pricingLine);
  const lines = built.lines.map(toDraftLine);
  const remote = await ctx.provider().updateDraft(row.provider_invoice_id, craDraft(row, lines));

  const warnings: string[] = [];
  const saved = await updateInvoice(ctx, row.id, { cra_version: cra.version, ...totalsPatch(remote) });
  const removed = await ctx.client.from("invoice_lines").delete().eq("invoice_id", row.id);
  const added = removed.error ? removed : await ctx.client.from("invoice_lines").insert(lineRows(row.id, built.lines));
  if (!saved || added.error) warnings.push("Qonto was updated but the local copy could not be saved. Reload before editing again.");
  const drift = totalsWarning(remote, lines);
  if (drift) warnings.push(drift);
  await record(ctx, row.id, "regenerate_draft", { cra_version: cra.version, total_ttc: remote.totalTtc }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved ?? row, lines: await loadLines(ctx, row.id) }, warnings) };
}

export async function deleteDraft(ctx: LifecycleCtx, input: { invoiceId: string }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.status !== "draft") return { status: 409, body: { error: "Only drafts can be deleted. Cancel a validated invoice instead." } };
  if (row.provider_invoice_id) {
    try { await ctx.provider().deleteDraft(row.provider_invoice_id); } catch (error) {
      if (!(error instanceof ProviderError && error.status === 404)) throw error;
    }
  }
  // Lines and events go with the row (on delete cascade), so no event is kept for a deletion.
  const { error } = await ctx.client.from("invoices").delete().eq("id", row.id);
  if (error) throw new HttpError("The draft was deleted in Qonto but not here. Refresh the invoices list.", 502);
  return { status: 200, body: { deleted: true } };
}

export async function finalizeInvoice(ctx: LifecycleCtx, input: { invoiceId: string }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.status !== "draft" || !row.provider_invoice_id) return { status: 409, body: { error: "Only drafts can be validated." } };
  const p = ctx.provider();
  const id = row.provider_invoice_id;
  const remote = await confirmed(
    () => p.finalize(id), () => p.getInvoice(id),
    (r) => (r.status === "finalized" || r.status === "paid") && !!r.number,
    "Qonto did not confirm the validation. Refresh the invoices list before trying again.",
  );
  const patch = {
    status: remote.status, number: remote.number, finalized_at: remote.finalizedAt ?? ctx.now().toISOString(),
    invoice_url: remote.invoiceUrl, issue_date: remote.issueDate ?? row.issue_date, due_date: remote.dueDate ?? row.due_date,
    ...totalsPatch(remote),
  };
  const warnings: string[] = [];
  const saved = await updateInvoice(ctx, row.id, patch);
  if (!saved) warnings.push("The invoice was validated in Qonto but could not be saved here. Refresh the invoices list.");
  await record(ctx, row.id, "finalize", { number: remote.number, total_ttc: remote.totalTtc }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved ?? { ...row, ...patch } }, warnings) };
}

export async function sendInvoice(ctx: LifecycleCtx, input: { invoiceId: string; resend?: boolean }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if ((row.status !== "finalized" && row.status !== "paid") || !row.provider_invoice_id) return { status: 409, body: { error: "Validate the invoice before sending it." } };
  if (row.sent_at && !input.resend) return { status: 409, body: { error: "This invoice was already sent.", sentAt: row.sent_at } };
  const p = ctx.provider();
  const remote = await p.getInvoice(row.provider_invoice_id);
  const to = remote.clientEmails ?? [];
  if (!to.length) return { status: 422, body: { error: NO_EMAIL } };
  const number = remote.number ?? row.number;
  if (!number) return { status: 409, body: { error: "This invoice has no number yet. Refresh the invoices list." } };
  const month = ym(row.period_month) || ym(remote.periodStart) || ym(remote.issueDate ?? row.issue_date);
  const message = {
    to,
    subject: `Facture ${number} — Quicksort`,
    body: `Bonjour,\n\nVeuillez trouver ci-joint la facture ${number} pour la période ${monthLabelFr(month)}.\n\nCordialement,\nQuicksort`,
  };
  await p.send(row.provider_invoice_id, message);

  // The email is out: from here on, never fail the request (a retry would send it twice).
  const warnings: string[] = [];
  const sentAt = ctx.now().toISOString();
  const saved = await updateInvoice(ctx, row.id, { sent_at: sentAt });
  if (!saved) warnings.push("The invoice was sent, but its sent date could not be saved.");
  await record(ctx, row.id, "send", { to, number }, warnings);
  return { status: 200, body: withWarnings({ sent: true, invoice: saved ?? { ...row, sent_at: sentAt } }, warnings) };
}

export async function cancelInvoice(ctx: LifecycleCtx, input: { invoiceId: string }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.status !== "finalized" || !row.provider_invoice_id) return { status: 409, body: { error: "Only validated, unpaid invoices can be canceled." } };
  const p = ctx.provider();
  const id = row.provider_invoice_id;
  const remote = await confirmed(
    () => p.cancel(id), () => p.getInvoice(id), (r) => r.status === "canceled",
    "Qonto did not confirm the cancellation. Refresh the invoices list before trying again.",
  );
  const warnings: string[] = [];
  const saved = await updateInvoice(ctx, row.id, { status: "canceled", ...totalsPatch(remote) });
  if (!saved) warnings.push("The invoice was canceled in Qonto but could not be saved here. Refresh the invoices list.");
  await record(ctx, row.id, "cancel", { number: row.number }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved ?? { ...row, status: "canceled" } }, warnings) };
}

export async function assignInvoice(ctx: LifecycleCtx, input: { invoiceId: string; projectId: string | null; ignored?: boolean }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.source !== "imported") return { status: 409, body: { error: "Only invoices imported from Qonto can be reassigned." } };
  if (input.projectId) {
    const project = await maybeOne(ctx.client.from("sales_projects").select("id").eq("id", input.projectId).maybeSingle(), "Could not read the project.");
    if (!project) return { status: 404, body: { error: "Project not found." } };
  }
  const ignored = input.ignored ?? (input.projectId ? false : !!row.ignored);
  // A consultant only makes sense on the project they were staffed on.
  const employee = input.projectId === row.project_id ? {} : { employee_id: null };
  const saved = await updateInvoice(ctx, row.id, { project_id: input.projectId, ignored, ...employee });
  if (!saved) throw new Error("Could not assign the invoice.");
  const warnings: string[] = [];
  await record(ctx, row.id, "assign", { project_id: input.projectId, ignored }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved }, warnings) };
}

// The month an imported invoice is listed under, independent of its issue date (e.g. September work billed in October).
// CRA invoices keep their CRA month. null falls back to the issue date.
export async function setInvoicePeriod(ctx: LifecycleCtx, input: { invoiceId: string; month: string | null }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.source !== "imported") return { status: 409, body: { error: "The month of a CRA invoice is its CRA month." } };
  const saved = await updateInvoice(ctx, row.id, { period_month: input.month ? `${input.month}-01` : null });
  if (!saved) throw new Error("Could not save the invoice month.");
  const warnings: string[] = [];
  await record(ctx, row.id, "set_period", { month: input.month }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved }, warnings) };
}

// The consultant an imported invoice bills, picked among those staffed on its project. null unassigns it.
export async function assignConsultant(ctx: LifecycleCtx, input: { invoiceId: string; employeeId: string | null }): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.source !== "imported") return { status: 409, body: { error: "The consultant of a CRA invoice comes from its CRA." } };
  if (!row.project_id) return { status: 409, body: { error: "Attach the invoice to a project first." } };
  if (input.employeeId && !(await projectConsultants(ctx, row.project_id)).some((c) => c.id === input.employeeId)) {
    return { status: 400, body: { error: "This consultant is not staffed on the invoice's project." } };
  }
  const saved = await updateInvoice(ctx, row.id, { employee_id: input.employeeId });
  if (!saved) throw new Error("Could not assign the consultant.");
  const warnings: string[] = [];
  await record(ctx, row.id, "assign_consultant", { employee_id: input.employeeId }, warnings);
  const [decorated] = await decorate(ctx, [saved]);
  return { status: 200, body: withWarnings({ invoice: decorated }, warnings) };
}

// Link a Qonto import to a CRA consultant-month: it then covers that month instead of a CRA draft.
export async function linkInvoice(
  ctx: LifecycleCtx, input: { invoiceId: string; projectId: string; employeeId: string; month: string },
): Promise<Result> {
  const row = await loadInvoice(ctx, input.invoiceId);
  if (row.source !== "imported") return { status: 409, body: { error: "Only invoices imported from Qonto can be linked to a CRA." } };
  if (row.status === "canceled") return { status: 409, body: { error: "A canceled invoice cannot cover a CRA." } };
  if (!(await projectConsultants(ctx, input.projectId)).some((c) => c.id === input.employeeId)) {
    return { status: 400, body: { error: "This consultant is not staffed on that project." } };
  }
  const covering = await many(
    ctx.client.from("invoices").select("id").eq("project_id", input.projectId).eq("employee_id", input.employeeId)
      .eq("period_month", `${input.month}-01`).neq("status", "canceled").neq("id", row.id),
    "Could not read invoices.",
  );
  if (covering.length) return { status: 409, body: { error: "Another invoice already covers this consultant-month." } };
  const saved = await updateInvoice(ctx, row.id, {
    project_id: input.projectId, employee_id: input.employeeId, period_month: `${input.month}-01`, ignored: false,
  });
  if (!saved) throw new Error("Could not link the invoice.");
  const warnings: string[] = [];
  await record(ctx, row.id, "link_cra", { project_id: input.projectId, employee_id: input.employeeId, month: input.month }, warnings);
  return { status: 200, body: withWarnings({ invoice: saved }, warnings) };
}
