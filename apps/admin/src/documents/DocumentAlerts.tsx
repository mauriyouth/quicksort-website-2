import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { db, errorMessage, isMissingRelationError, type DocumentAlert } from "@quicksort/hr-db";
import { expiryLabel, formatDay, loadAlerts } from "./client";
import "../sales/sales.css";
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
    <div className="docs-page">
      <header className="docs-head">
        <h1>Documents</h1>
        <p className="projects-lede">Identity papers, contracts and certificates that expired, expire soon or are still missing.</p>
      </header>
      <Notice error>{error}</Notice>
      {notReady && <Notice>The documents registry is not set up yet — apply the documents migrations (supabase db push).</Notice>}

      <section className="docs-kpis" aria-label="Summary">
        {kpis.map(k => (
          <div key={k.label} className={`docs-kpi${k.strong ? " strong" : ""}`}>
            <span className="docs-kpi-label">{k.label}</span>
            <span className="docs-kpi-value">{rows ? k.value : "—"}</span>
            <span className="docs-kpi-sub">{k.sub}</span>
          </div>
        ))}
      </section>

      <section className="projects-card" aria-label="Document alerts">
        <div className="projects-toolbar">
          <div className="projects-tabs" role="tablist" aria-label="Alert filters">
            {tabs.map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id}
                className={`projects-tab${filter === id ? " on" : ""}`} onClick={() => setFilter(id)}>
                {label}<span className="docs-count">{count}</span>
              </button>
            ))}
          </div>
          <div className="projects-toolbar-right">
            <label className="projects-search">
              <Search size={16} aria-hidden="true" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person, project or document" aria-label="Search alerts" />
            </label>
          </div>
        </div>

        {rows === null && <p className="docs-empty">Loading…</p>}
        {rows !== null && !visible.length && (
          <p className="docs-empty">{rows.length ? "No alert matches this filter." : "Nothing to renew — every required document is filed and valid."}</p>
        )}
        {!!visible.length && (
          <ul className="docs-alerts">
            {visible.map(r => (
              <li key={`${r.severity}-${r.document_id || r.type_code}-${r.person_id || r.project_id || r.client_id}-${r.extension_id || ""}`} className="docs-alert">
                <span className={`doc-pill doc-pill--${r.severity}`}>{SEVERITY_LABEL[r.severity]}</span>
                <div className="docs-alert-doc">
                  <span className="docs-alert-title">{r.title}</span>
                  {r.type_label !== r.title && <span className="docs-alert-meta">{r.type_label}</span>}
                </div>
                <div className="docs-alert-owner">
                  <span className="docs-alert-title">{r.ownerName}</span>
                  <span className="docs-alert-meta">{r.ownerDetail}</span>
                </div>
                <div className="docs-alert-when">
                  {r.severity === "missing" ? (
                    <span className="docs-alert-meta">Not filed</span>
                  ) : (
                    <>
                      <span className="docs-alert-title">{expiryLabel({ tone: r.severity, daysLeft: r.days_left })}</span>
                      <span className="docs-alert-meta">{formatDay(r.expires_on)}</span>
                    </>
                  )}
                </div>
                <Link className="docs-alert-action" to={r.href}>
                  {r.severity === "missing" ? "Upload" : "Renew"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
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
