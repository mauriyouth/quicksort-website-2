import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Stat,
  StatGroup,
  StatLabel,
  StatSource,
  StatValue,
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
import { EmptyState, PageAlerts, PageHeading, linkButton } from "../ui";
import { db, errorMessage, isMissingRelationError, type DocumentAlert } from "@quicksort/hr-db";
import { expiryLabel, formatDay, loadAlerts } from "./client";
import "./documents.css";

/**
 * HR → Documents: every warning from document_alerts in one list — expired
 * first, then missing, then what expires next. RLS scopes it: HR sees person
 * documents, admins also see projects and clients. Each row opens the owner's
 * documents, where the file is renewed or uploaded.
 */
type Filter = "all" | "expired" | "expiring" | "missing";
type Row = DocumentAlert & { ownerName: string; ownerDetail: string; href: string };

const RANK = { expired: 0, missing: 1, expiring: 2 } as const;
const SEVERITY_LABEL = { expired: "Expired", expiring: "Expiring", missing: "Missing" } as const;
const SEVERITY_BADGE = { expired: "destructive", expiring: "warning", missing: "secondary" } as const;

async function ownerNames(alerts: DocumentAlert[]) {
  const ids = (key: "person_id" | "project_id" | "client_id") => [...new Set(alerts.map(a => a[key]).filter((id): id is string => !!id))];
  const [people, projects, clients] = await Promise.all([
    ids("person_id").length ? db().from("hr_people").select("id,full_name").in("id", ids("person_id")) : null,
    ids("project_id").length ? db().from("sales_projects").select("id,title,client_id").in("id", ids("project_id")) : null,
    ids("client_id").length ? db().from("sales_clients").select("id,name").in("id", ids("client_id")) : null,
  ]);
  const projectClients = [...new Set((projects?.data || []).map(p => p.client_id).filter(Boolean))];
  const projectClientRows = projectClients.length ? (await db().from("sales_clients").select("id,name").in("id", projectClients)).data || [] : [];
  return {
    people: new Map((people?.data || []).map(p => [p.id, p.full_name])),
    projects: new Map((projects?.data || []).map(p => [p.id, { title: p.title, client: projectClientRows.find(c => c.id === p.client_id)?.name || "" }])),
    clients: new Map((clients?.data || []).map(c => [c.id, c.name])),
  };
}

export function DocumentAlerts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notReady, setNotReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const alerts = await loadAlerts();
      const names = await ownerNames(alerts);
      const next = alerts.map((alert): Row => {
        if (alert.person_id)
          return { ...alert, ownerName: names.people.get(alert.person_id) || "Person", ownerDetail: "Employee", href: `/hr/people/${alert.person_id}/employments` };
        if (alert.owner_kind === "company")
          return { ...alert, ownerName: "Quicksort", ownerDetail: "Company", href: "/operations/admin" };
        if (alert.project_id) {
          const project = names.projects.get(alert.project_id);
          return { ...alert, ownerName: project?.title || "Project", ownerDetail: project?.client ? `Project · ${project.client}` : "Project", href: `/sales/projects/${alert.project_id}` };
        }
        return { ...alert, ownerName: names.clients.get(alert.client_id || "") || "Client", ownerDetail: "Client", href: `/sales/clients/${alert.client_id}` };
      });
      next.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.days_left ?? 0) - (b.days_left ?? 0) || a.ownerName.localeCompare(b.ownerName));
      if (!cancelled) setRows(next);
    })().catch(e => {
      if (cancelled) return;
      if (isMissingRelationError(e)) setNotReady(true);
      else setError(errorMessage(e));
      setRows([]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const all = rows || [];
    return {
      all: all.length,
      expired: all.filter(r => r.severity === "expired").length,
      expiring: all.filter(r => r.severity === "expiring").length,
      missing: all.filter(r => r.severity === "missing").length,
      soon: all.filter(r => r.severity === "expiring" && (r.days_left ?? 99) <= 30).length,
    };
  }, [rows]);

  const needle = search.trim().toLowerCase();
  const visible = (rows || []).filter(r =>
    (filter === "all" || r.severity === filter) &&
    (!needle || `${r.title} ${r.type_label} ${r.ownerName} ${r.ownerDetail}`.toLowerCase().includes(needle)));

  const kpis = [
    { label: "Expired", value: counts.expired, sub: "Renew now", strong: counts.expired > 0 },
    { label: "Expiring in 30 days", value: counts.soon, sub: `${counts.expiring} inside their warning window`, strong: false },
    { label: "Missing", value: counts.missing, sub: "Required but not filed", strong: false },
  ];
  const tabs: [Filter, string, number][] = [
    ["all", "All", counts.all],
    ["expired", "Expired", counts.expired],
    ["expiring", "Expiring", counts.expiring],
    ["missing", "Missing", counts.missing],
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Documents">
        Identity papers, contracts and certificates that expired, expire soon or are still missing.
      </PageHeading>
      <PageAlerts error={error} />
      {notReady && <PageAlerts message="The documents registry is not set up yet. Apply the documents migrations (supabase db push)." />}

      <Card aria-label="Summary">
        <CardContent>
          <StatGroup>
            {kpis.map(k => (
              <Stat key={k.label} pivot={k.strong}>
                <StatValue>{rows ? k.value : "—"}</StatValue>
                <StatLabel>{k.label}</StatLabel>
                <StatSource>{k.sub}</StatSource>
              </Stat>
            ))}
          </StatGroup>
        </CardContent>
      </Card>

      <Card aria-label="Document alerts">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <TabsList variant="line" aria-label="Alert filters">
              {tabs.map(([id, label, count]) => (
                <TabsTrigger key={id} value={id} className="gap-1.5">
                  {label}
                  <span className="num text-xs text-muted-foreground">{count}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <InputGroup className="w-full sm:w-72">
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person, project or document" aria-label="Search alerts" />
          </InputGroup>
        </CardHeader>
        <CardContent>
          {rows === null && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
          {rows !== null && !visible.length && (
            <EmptyState title={rows.length ? "No alert matches this filter" : "Nothing to renew"}>
              {rows.length ? "Try another filter or search." : "Every required document is filed and valid."}
            </EmptyState>
          )}
          {!!visible.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="w-24"><span className="sr-only">Action</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(r => (
                  <TableRow key={`${r.severity}-${r.document_id || r.type_code}-${r.person_id || r.project_id || r.client_id}-${r.extension_id || ""}`}>
                    <TableCell><Badge variant={SEVERITY_BADGE[r.severity]}>{SEVERITY_LABEL[r.severity]}</Badge></TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium">{r.title}</div>
                      {r.type_label !== r.title && <div className="text-xs text-muted-foreground">{r.type_label}</div>}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <div>{r.ownerName}</div>
                      <div className="text-xs text-muted-foreground">{r.ownerDetail}</div>
                    </TableCell>
                    <TableCell>
                      {r.severity === "missing" ? (
                        <span className="text-xs text-muted-foreground">Not filed</span>
                      ) : (
                        <>
                          <div>{expiryLabel({ tone: r.severity, daysLeft: r.days_left })}</div>
                          <div className="num text-xs text-muted-foreground">{formatDay(r.expires_on)}</div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link className={linkButton({ variant: "outline", size: "sm" })} to={r.href}>
                        {r.severity === "missing" ? "Upload" : "Renew"}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Compact queue for the HR overview: the next few person alerts. */
export function DocumentAlertsQueue({ onOpenPerson }: { onOpenPerson: (personId: string) => void }) {
  const [alerts, setAlerts] = useState<DocumentAlert[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    loadAlerts({ kind: "person" })
      .then(async list => {
        const sorted = [...list].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.days_left ?? 0) - (b.days_left ?? 0));
        const { people } = await ownerNames(sorted.slice(0, 6));
        if (!cancelled) {
          setAlerts(sorted);
          setNames(people);
        }
      })
      .catch(() => !cancelled && setAlerts([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!alerts) return null;
  if (!alerts.length) return <p className="docs-empty">Every required employee document is filed and valid.</p>;
  return (
    <div className="hr-queue">
      {alerts.slice(0, 6).map(alert => (
        <div key={`${alert.severity}-${alert.document_id || alert.type_code}-${alert.person_id}`} className="hr-queue-row">
          <div>
            <strong>{alert.title}</strong>
            <p>
              {names.get(alert.person_id || "") || "Employee"} ·{" "}
              {alert.severity === "missing" ? "not filed" : expiryLabel({ tone: alert.severity, daysLeft: alert.days_left }).toLowerCase()}
            </p>
          </div>
          {alert.person_id && (
            <button className="btn secondary" onClick={() => onOpenPerson(alert.person_id!)}>
              {alert.severity === "missing" ? "Upload" : "Renew"}
            </button>
          )}
        </div>
      ))}
      {alerts.length > 6 && <Link className="docs-more" to="/hr/documents">See all {alerts.length} alerts</Link>}
    </div>
  );
}
