import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "cn";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@quicksort-sas/ui";
import { db, errorMessage, isMissingRelationError } from "@quicksort/hr-db";
import { EmptyState, PageAlerts, PageHeading, linkButton } from "../../ui";
import { paged } from "../business-plan/actuals";
import { loadPayroll } from "../../payslips/client";
import { useInvoicingApi } from "../../sales/invoicing/api";
import { InvoiceDraftPanel } from "../../sales/invoicing/InvoiceDraftPanel";
import {
  CHECK_META,
  monthChecks,
  openChecks,
  shiftMonth,
  type CheckCra,
  type CheckCraMonth,
  type CheckGroup,
  type CheckInvoice,
  type CheckSources,
  type Issue,
} from "./rules";

/**
 * Operations → Checks: what doesn't add up across CRA, staffing, invoices and
 * payslips, month by month, plus the invoices that need attention whatever
 * their month (overdue, not linked). Rules live in ./rules.ts.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WINDOW = 12; // months checked, current one included
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const CHUNK = 100;
const GROUPS: { id: CheckGroup; title: string; empty: string }[] = [
  { id: "cra", title: "CRA & staffing", empty: "Every CRA is filed, complete and matches the staffing." },
  { id: "invoices", title: "Invoices", empty: "Every consultant-month is invoiced." },
  { id: "payslips", title: "Payslips", empty: "Every payslip is filed." },
];

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const untyped = () => db() as unknown as SupabaseClient;

async function loadSources(craFrom: string, invoicingStart: string | null): Promise<CheckSources> {
  const client = untyped();
  const rows = async <T,>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    const r = await q;
    if (r.error) throw r.error;
    return (r.data ?? []) as T[];
  };
  const [employees, assignments, projects, cra, craMonths, invoices, payroll] = await Promise.all([
    rows<CheckSources["employees"][number]>(client.from("employees").select("id,person_id,contract_type,start_date,end_date")),
    rows<CheckSources["assignments"][number]>(client.from("employee_project_assignments").select("employee_id,project_id,start_date,end_date,status")),
    rows<CheckSources["projects"][number]>(client.from("sales_projects").select("id,title,pricing_model")),
    paged<CheckCra>((from, to) =>
      client.from("cra_entries").select("employee_id,day,part,status,project_id").gte("day", `${craFrom}-01`).order("day").range(from, to)),
    rows<CheckCraMonth>(client.from("cra_months").select("employee_id,month,version").gte("month", `${craFrom}-01`)),
    paged<CheckInvoice>((from, to) =>
      client.from("invoices")
        .select("id,number,status,source,project_id,employee_id,period_month,cra_version,due_date,issue_date,total_ht,ignored,invoice_url")
        .order("id").range(from, to))
      .catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
    loadPayroll().catch(() => null),
  ]);
  const personIds = [...new Set(employees.map((e) => e.person_id))];
  const people: { id: string; full_name: string }[] = [];
  for (let i = 0; i < personIds.length; i += CHUNK) {
    people.push(...await rows<{ id: string; full_name: string }>(client.from("hr_people").select("id,full_name").in("id", personIds.slice(i, i + CHUNK))));
  }
  return { employees, people, assignments, projects, cra, craMonths, invoices, payroll, invoicingStart, craFrom };
}

/** Where to fix an issue. */
function fixLink(issue: Issue): { to: string; label: string } | null {
  const m = issue.month ? issue.month.replace("-", "/") : "";
  switch (issue.kind) {
    case "cra_missing":
    case "cra_incomplete":
    case "cra_unstaffed_days":
    case "cra_outside_employment":
    case "staffed_no_days":
      return issue.personId ? { to: `/hr/people/${issue.personId}/cra/${m}`, label: "Open CRA" } : null;
    case "invoice_missing":
    case "invoice_draft":
    case "invoice_cra_changed":
    case "invoice_without_days":
      return { to: `/sales/invoicing/${m}`, label: "Invoicing" };
    case "payslip_missing":
      return { to: `/hr/payslips?month=${issue.month}`, label: "Payslips" };
    case "invoice_unassigned":
      return { to: "/sales/invoicing/unassigned", label: "Link it" };
    case "invoice_overdue":
      return { to: "/sales/invoicing/invoices", label: "Invoices" };
  }
}

function IssueTable({ issues, label, onOpenInvoice }: { issues: Issue[]; label: string; onOpenInvoice: (id: string) => void }) {
  return (
    <Table aria-label={label}>
      <TableBody>
        {issues.map((issue) => {
          const meta = CHECK_META[issue.kind];
          const fix = fixLink(issue);
          return (
            <TableRow
              key={issue.key}
              className={cn(meta.severity === "error" && "bg-destructive/5", issue.invoiceId && "cursor-pointer")}
              {...(issue.invoiceId && {
                tabIndex: 0,
                "aria-label": `Open ${issue.invoiceNumber || "draft invoice"}`,
                // Links and buttons inside the row keep their own behaviour.
                onClick: (e: MouseEvent) => {
                  if (!(e.target as HTMLElement).closest("a,button")) onOpenInvoice(issue.invoiceId as string);
                },
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onOpenInvoice(issue.invoiceId as string);
                  }
                },
              })}
            >
              <TableCell className="w-44 align-top">
                <Badge variant={meta.severity === "error" ? "destructive" : "secondary"}>{meta.label}</Badge>
              </TableCell>
              <TableCell className="w-full whitespace-normal align-top">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  {issue.name && (issue.personId
                    ? <Link to={`/hr/people/${issue.personId}`} className="font-medium underline-offset-4 hover:underline">{issue.name}</Link>
                    : <span className="font-medium">{issue.name}</span>)}
                  {issue.projectTitle && (issue.projectId
                    ? <Link to={`/sales/projects/${issue.projectId}`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">{issue.projectTitle}</Link>
                    : <span className="text-sm text-muted-foreground">{issue.projectTitle}</span>)}
                  {issue.invoiceId && (
                    <button type="button" className="num text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => onOpenInvoice(issue.invoiceId as string)}>
                      {issue.invoiceNumber || "Draft"}
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{issue.detail}</p>
              </TableCell>
              <TableCell className="align-top">
                <div className="flex justify-end gap-1.5">
                  {issue.invoiceUrl && (
                    <a href={issue.invoiceUrl} target="_blank" rel="noreferrer" aria-label="Open the invoice PDF"
                      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                  {fix && (
                    <Link to={fix.to} className={linkButton({ size: "xs", variant: "outline" })}>{fix.label}</Link>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function countLine(issues: Issue[]) {
  const errors = issues.filter((i) => CHECK_META[i.kind].severity === "error").length;
  const warnings = issues.length - errors;
  if (!issues.length) return <span>Nothing to fix</span>;
  return (
    <>
      {errors > 0 && <span className="text-destructive">{errors} to fix</span>}
      {errors > 0 && warnings > 0 && " · "}
      {warnings > 0 && <span>{warnings} to review</span>}
    </>
  );
}

export function Checks() {
  const api = useInvoicingApi();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<CheckSources | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

  const today = isoToday();
  const current = today.slice(0, 7);
  const months = useMemo(() => Array.from({ length: WINDOW }, (_, i) => shiftMonth(current, i - WINDOW + 1)), [current]);
  const asked = params.get("month") ?? "";
  const month = PERIOD.test(asked) && months.includes(asked) ? asked : shiftMonth(current, -1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const settings = await api.get<{ startMonth?: string | null }>({ resource: "settings" }).catch(() => null);
      setData(await loadSources(months[0], settings?.startMonth ?? null));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api, months]);
  useEffect(() => { void load(); }, [load]);

  const byMonth = useMemo(
    () => new Map(months.map((m) => [m, data ? monthChecks(m, data, today) : []])),
    [data, months, today],
  );
  const open = useMemo(() => (data ? openChecks(data, today) : []), [data, today]);
  const overdue = useMemo(() => open.filter((i) => i.kind === "invoice_overdue"), [open]);
  const unlinked = useMemo(() => open.filter((i) => i.kind !== "invoice_overdue"), [open]);
  const issues = byMonth.get(month) ?? [];

  // Invoices in the order they appear on the page, for ← / → in the side panel.
  const invoiceIds = useMemo(() => {
    const shown = [
      ...GROUPS.flatMap((g) => (g.id === "payslips" && !data?.payroll ? [] : issues.filter((i) => CHECK_META[i.kind].group === g.id))),
      ...overdue,
      ...unlinked,
    ];
    return [...new Set(shown.flatMap((i) => (i.invoiceId ? [i.invoiceId] : [])))];
  }, [issues, overdue, unlinked, data?.payroll]);
  const pos = invoiceId ? invoiceIds.indexOf(invoiceId) : -1;
  // If the open invoice drops off the list after a fix, keep browsing from where it was.
  const lastPos = useRef(0);
  if (pos >= 0) lastPos.current = pos;
  const prevIdx = pos >= 0 ? pos - 1 : lastPos.current - 1;
  const nextIdx = pos >= 0 ? pos + 1 : lastPos.current;
  const nav = {
    index: pos,
    total: invoiceIds.length,
    onPrev: prevIdx >= 0 && prevIdx < invoiceIds.length ? () => setInvoiceId(invoiceIds[prevIdx]) : undefined,
    onNext: nextIdx >= 0 && nextIdx < invoiceIds.length ? () => setInvoiceId(invoiceIds[nextIdx]) : undefined,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Checks"
        action={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} aria-hidden="true" /> Refresh
          </Button>
        }
      >
        What doesn't add up: missing or incomplete CRAs, days off the staffing, consultant-months not invoiced, missing payslips
        and invoices to chase.
      </PageHeading>
      <PageAlerts error={error} />

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Month">
        {months.map((m) => {
          const list = byMonth.get(m) ?? [];
          const errors = list.filter((i) => CHECK_META[i.kind].severity === "error").length;
          return (
            <Button
              key={m}
              role="tab"
              aria-selected={m === month}
              variant={m === month ? "outline" : "ghost"}
              size="sm"
              className={cn("shrink-0 gap-1.5 rounded-full", m === month ? "bg-card text-foreground" : "text-muted-foreground")}
              onClick={() => setParams({ month: m }, { replace: true })}
            >
              {MONTHS[Number(m.slice(5, 7)) - 1]}
              {m.endsWith("-01") || m === months[0] ? <span className="opacity-60">{m.slice(2, 4)}</span> : null}
              {data && (
                <span className={cn("num text-xs", errors ? "text-destructive" : "opacity-60")}>
                  {list.length || "✓"}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {!data && loading && <p role="status" className="text-sm text-muted-foreground">Running checks…</p>}

      {data && (
        <>
          <p role="status" className="-mt-2 text-sm text-muted-foreground">
            {monthLabel(month)}{month === current && " (in progress)"} · {countLine(issues)}
          </p>
          {GROUPS.map((g) => {
            const list = issues.filter((i) => CHECK_META[i.kind].group === g.id);
            if (g.id === "payslips" && !data.payroll) return null;
            return (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle>{g.title}</CardTitle>
                  <CardDescription>{countLine(list)}</CardDescription>
                </CardHeader>
                <CardContent>
                  {list.length
                    ? <IssueTable issues={list} label={`${g.title} · ${monthLabel(month)}`} onOpenInvoice={setInvoiceId} />
                    : <EmptyState title={month === current && g.id !== "cra" ? "Checked once the month is over" : g.empty} />}
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardHeader>
              <CardTitle>Payment overdue</CardTitle>
              <CardDescription>Any month · {countLine(overdue)}</CardDescription>
            </CardHeader>
            <CardContent>
              {overdue.length
                ? <IssueTable issues={overdue} label="Payment overdue" onOpenInvoice={setInvoiceId} />
                : <EmptyState title="No validated invoice is past its due date." />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Invoices to link</CardTitle>
              <CardDescription>Any month · {countLine(unlinked)}</CardDescription>
            </CardHeader>
            <CardContent>
              {unlinked.length
                ? <IssueTable issues={unlinked} label="Invoices to link" onOpenInvoice={setInvoiceId} />
                : <EmptyState title="Every invoice is linked to a project, consultant and month." />}
            </CardContent>
          </Card>
        </>
      )}

      {invoiceId && (
        <InvoiceDraftPanel api={api} invoiceId={invoiceId} onClose={() => setInvoiceId(null)} onChanged={() => void load()} nav={nav} />
      )}
    </div>
  );
}
