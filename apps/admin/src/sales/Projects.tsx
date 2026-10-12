import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { db, errorMessage, type Row } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import {
  money,
  useSales,
  type SalesClient,
  type SalesOpportunity,
} from "./data";
import {
  useAdminReferentials,
  statusesFor,
  statusMeta,
  typeLabel,
  type AdminStatus,
} from "../referentials";
import { ClientPicker } from "./ClientPicker";
import { ProjectContractSection, type ContractFolder } from "./ProjectContract";
import {
  ProjectExtensionsSection,
  isActiveExtension,
  type ProjectExtension,
} from "./ProjectExtensions";
import {
  lineDays,
  linesAmount,
  linesDays,
  openDaysBetween,
  storedPricingLines,
  type PricingLine,
} from "./pricing-lines";
import { DateField } from "../DateField";
import "./sales.css";
import "./project-form.css";
import { loadWorkspace } from "../hr/data";

/**
 * Projects (sales.md §14 Phase 2) — the delivery continuation of won deals.
 * Each project keeps the pricing model of its origin opportunity (régie
 * TJM × days / forfait fixed price) and its lifecycle statuses come from the
 * configurable referentials edited under Administration → Global settings,
 * BoondManager-style. Régie contracts carry named pricing lines
 * ("Lead dev", "Data engineer"…), each with its own rate and end date —
 * the line window runs from the contract start to that date and the project
 * amount is the sum of rate × open days across the lines.
 */
type Project = Row<"sales_projects">;

/** One named daily rate on a régie contract (sales_projects.tjm_profiles). */
export type TjmProfile = PricingLine;

/** Defensive parse of the JSONB column — see pricing-lines.ts. */
export const storedTjmProfiles = storedPricingLines;

type TjmProfileDraft = {
  name: string;
  tjm: string;
  end_date: string;
};

/** Semantic list tabs (source design "Projects — redesign.html"). */
type ProjectsTab = "all" | "attention" | "ending" | "archived";

/** One row of the projects list — every display value precomputed from the
    raw project, its signed extensions, team assignments and CRA days. */
type ProjectRow = {
  project: Project;
  meta: AdminStatus;
  client?: SalesClient;
  team: string[];
  who: string;
  initials: string;
  isRegie: boolean;
  rate: string;
  metaLine: string;
  effEnd: string | null;
  extended: boolean;
  total: number;
  budgetDays: number;
  consumedDays: number;
  usedPct: number;
  billed: number;
  timePct: number | null;
  daysLeft: number | null;
  /** Non-empty when the row needs attention (drives the inverted pill,
      the flag strip, the tab filter and the inverted stat card). */
  flag: string | null;
};

/** Page state from the address bar: ?project=<id> → edit that project,
    ?new=1 → create form, otherwise the projects list. Unknown ids fall
    back to the list. */
function sheetFromUrl(list: Project[]): Project | null | undefined {
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") return null;
  const id = params.get("project");
  if (!id) return undefined;
  return list.find((p) => p.id === id) ?? undefined;
}

/** Open working days between ISO dates lives in pricing-lines.ts. */

/** Compact date for the timeline column — day + short month. */
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

/** Day count for display: whole days plain, half days with one decimal. */
const fmtDays = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** Longer date for the header meta and stat subtitles — day + month + year. */
const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Elapsed percentage + days left between the project start and end. */
function timelineProgress(p: Project) {
  if (!p.start_date || !p.end_date) return null;
  const start = new Date(`${p.start_date}T00:00:00`).getTime();
  const end = new Date(`${p.end_date}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const now = Date.now();
  return {
    pct: Math.round(
      Math.max(0, Math.min(1, (now - start) / (end - start))) * 100,
    ),
    left: Math.ceil((end - now) / 86400000),
  };
}

export function Projects({ actorEmail }: { actorEmail: string }) {
  const { data, loading, busy, error, message, load, action } =
    useSales(actorEmail);
  const ref = useAdminReferentials();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<
    { project_id: string; employee_id: string }[]
  >([]);
  const [employees, setEmployees] = useState<
    { id: string; full_name: string }[]
  >([]);
  const [extensions, setExtensions] = useState<ProjectExtension[]>([]);
  /** Days consumed per project, summed from employee CRA entries (status
      'client_project'). The map is best-effort: a missing cra_entries
      migration or a permission error leaves it empty rather than breaking
      the projects screen. */
  const [craDaysByProject, setCraDaysByProject] = useState<Map<string, number>>(
    new Map(),
  );
  const [loadError, setLoadError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ProjectsTab>("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The create/edit form is a page, addressed by the URL: ?project=<id>
  // edits, ?new=1 creates. `undefined` = the projects list itself.
  const [editing, setEditing] = useState<Project | null | undefined>(undefined);
  const projectsRef = useRef<Project[]>([]);

  useEffect(() => {
    document.title =
      editing === null
        ? "New project · Quicksort Admin"
        : editing
          ? `${editing.title} · Quicksort Admin`
          : "Projects · Quicksort Admin";
  }, [editing]);

  // Sync the open page from the address bar on back/forward navigation.
  useEffect(() => {
    const onPop = () => setEditing(sheetFromUrl(projectsRef.current));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await db()
          .from("sales_projects")
          .select("*")
          .order("updated_at", { ascending: false });
        if (r.error) throw r.error;
        const ext = await db().from("sales_project_extensions").select("*");
        if (ext.error) throw ext.error;
        // CRA consumption: a full 'client_project' entry = one day billed
        // to that project, a half-day entry (am/pm) = half a day. HR
        // operators read every employee's CRA through the cra_access
        // policy, so a single grouped count feeds the progress bars on
        // every project row.
        const craWithParts = await db()
          .from("cra_entries")
          .select("project_id, part")
          .eq("status", "client_project");
        // Databases without the half-day migration reject the part column —
        // fall back to counting every entry as a full day instead of losing
        // consumption entirely.
        const cra = craWithParts.error
          ? await db()
              .from("cra_entries")
              .select("project_id")
              .eq("status", "client_project")
          : craWithParts;
        const craDays = new Map<string, number>();
        if (!cra.error) {
          for (const row of cra.data || []) {
            if (row.project_id)
              craDays.set(
                row.project_id,
                (craDays.get(row.project_id) || 0) +
                  ("part" in row && (row.part === "am" || row.part === "pm")
                    ? 0.5
                    : 1),
              );
          }
        }
        const staffing = await loadWorkspace();
        const today = new Date().toISOString().slice(0, 10);
        if (!cancelled) {
          const list = r.data || [];
          setProjects(list);
          projectsRef.current = list;
          setExtensions(ext.data || []);
          setAssignments(
            staffing.assignments.filter(
              (a) =>
                ["reserved", "confirmed", "active"].includes(a.status) &&
                a.start_date <= today &&
                (!a.end_date || a.end_date >= today),
            ),
          );
          setEmployees(
            staffing.employees.map((e) => ({
              id: e.id,
              full_name:
                staffing.people.find((p) => p.id === e.person_id)?.full_name ||
                "Person",
            })),
          );
          setCraDaysByProject(craDays);
          setLoadError("");
          // The URL is the source of truth: (re)open the create/edit page
          // after every reload so deep links and redirects land on it.
          setEditing(sheetFromUrl(list));
        }
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadTick lets child sections (extensions) ask for a project refresh.
  }, [data, reloadTick]); // re-fetch after every sales action() reload

  const projectStatuses = statusesFor(ref.statuses, "project", {
    includeHidden: false,
  });
  const terminalStatus =
    projectStatuses.find((s) => s.is_terminal) ||
    projectStatuses[projectStatuses.length - 1];
  const defaultStatus =
    projectStatuses.find((s) => s.is_default) || projectStatuses[0];

  const clientsById = useMemo(
    () => new Map<string, SalesClient>(data.clients.map((c) => [c.id, c])),
    [data.clients],
  );
  const teamByProject = useMemo(() => {
    const employeesById = new Map(employees.map((e) => [e.id, e.full_name]));
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const name = employeesById.get(a.employee_id);
      if (!name) continue;
      map.set(a.project_id, [...(map.get(a.project_id) || []), name]);
    }
    for (const [id, names] of map)
      map.set(
        id,
        [...new Set(names)].sort((a, b) => a.localeCompare(b)),
      );
    return map;
  }, [assignments, employees]);
  const opportunitiesById = useMemo(
    () =>
      new Map<string, SalesOpportunity>(
        data.opportunities.map((o) => [o.id, o]),
      ),
    [data.opportunities],
  );
  /** Signed extensions per project — they extend the timeline and value. */
  const signedExtensionsByProject = useMemo(() => {
    const map = new Map<string, ProjectExtension[]>();
    for (const e of extensions.filter(isActiveExtension)) {
      map.set(e.project_id, [...(map.get(e.project_id) || []), e]);
    }
    return map;
  }, [extensions]);
  /** Won deals that don't have a project yet — convertible. */
  const convertible = data.opportunities.filter(
    (o) =>
      o.stage === "won" && !projects.some((p) => p.opportunity_id === o.id),
  );

  /** Precomputed list rows — one pass over projects feeds the table, the
      stat cards and every tab count. */
  const rows = useMemo<ProjectRow[]>(() => {
    return projects.map((p) => {
      const meta = statusMeta(ref.statuses, "project", p.status);
      const client = clientsById.get(p.client_id);
      const team = teamByProject.get(p.id) || [];
      const isRegie = p.pricing_model === "regie";
      // Signed extensions push the end date out and add value.
      const signedExts = signedExtensionsByProject.get(p.id) || [];
      let effEnd = p.end_date;
      for (const ext of signedExts) {
        if (ext.end_date && (!effEnd || ext.end_date > effEnd))
          effEnd = ext.end_date;
      }
      const extTotal = signedExts.reduce(
        (sum, ext) => sum + Number(ext.amount),
        0,
      );
      const total = Number(p.amount) + extTotal;
      // Consumption comes from the CRA: signed régie extensions grow the
      // day budget alongside the value.
      const consumedDays = craDaysByProject.get(p.id) || 0;
      const budgetDays = isRegie
        ? Number(p.estimated_days ?? 0) +
          signedExts.reduce(
            (sum, ext) =>
              ext.pricing_model === "regie" && ext.estimated_days != null
                ? sum + Number(ext.estimated_days)
                : sum,
            0,
          )
        : 0;
      const usedPct =
        budgetDays > 0 ? Math.round((consumedDays / budgetDays) * 100) : 0;
      // Blended rate (amount ÷ budget) turns consumed days into an
      // approximate consumed value — all we can do across TJM profiles.
      const billed =
        budgetDays > 0 ? Math.round((consumedDays / budgetDays) * total) : 0;
      const progress = timelineProgress({ ...p, end_date: effEnd });
      // Needs attention: budget exceeded.
      let flag: string | null = null;
      if (budgetDays > 0 && consumedDays > budgetDays)
        flag = `Budget exceeded by ${fmtDays(consumedDays - budgetDays)} days (${usedPct}% of ${fmtDays(budgetDays)} days)`;
      const rate = isRegie
        ? `${money(Number(p.tjm ?? 0), p.currency)}/j`
        : "Forfait";
      return {
        project: p,
        meta,
        client,
        team,
        who: team.length
          ? team.length > 1
            ? `${team[0]} +${team.length - 1}`
            : team[0]
          : "Unassigned",
        initials: team.length
          ? team[0]
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0]?.toUpperCase() ?? "")
              .join("")
          : "—",
        isRegie,
        rate,
        metaLine: [
          client?.name,
          p.type ? typeLabel(ref.types, p.type) : "",
          rate,
        ]
          .filter(Boolean)
          .join(" · "),
        effEnd,
        extended: !!effEnd && effEnd !== p.end_date,
        total,
        budgetDays,
        consumedDays,
        usedPct,
        billed,
        timePct: progress?.pct ?? null,
        daysLeft: progress?.left ?? null,
        flag,
      };
    });
  }, [
    projects,
    ref.statuses,
    ref.types,
    clientsById,
    teamByProject,
    signedExtensionsByProject,
    craDaysByProject,
  ]);

  const activeRows = rows.filter((r) => !r.meta.is_terminal);
  const activeCount = activeRows.length;
  const activeTotal = activeRows.reduce(
    (sum, r) => sum + Number(r.project.amount),
    0,
  );
  const staffedCount = activeRows.filter((r) => r.team.length > 0).length;
  const trackedRows = activeRows.filter((r) => r.budgetDays > 0);
  const consumedTotal = activeRows.reduce((sum, r) => sum + r.billed, 0);
  const attentionRows = rows.filter((r) => r.flag);
  const endingSoon = activeRows.filter((r) => {
    if (!r.effEnd) return false;
    const days = Math.ceil(
      (new Date(r.effEnd).getTime() - Date.now()) / 86400000,
    );
    return days >= 0 && days <= 30;
  }).length;
  const archivedCount = rows.length - activeCount;
  // Breakdown for the inverted "Needs attention" card subtitle.
  const attentionParts = [
    rows.filter((r) => r.budgetDays > 0 && r.consumedDays > r.budgetDays)
      .length,
  ];
  const attentionSub = attentionParts[0]
    ? `${attentionParts[0]} over budget`
    : "";

  const query = search.toLowerCase();
  const visible = rows.filter((r) => {
    if (tab === "attention" && !r.flag) return false;
    if (tab === "ending") {
      if (!r.effEnd) return false;
      const days = Math.ceil(
        (new Date(r.effEnd).getTime() - Date.now()) / 86400000,
      );
      if (days < 0 || days > 30) return false;
    }
    if (tab === "archived" && !r.meta.is_terminal) return false;
    if (!query) return true;
    const p = r.project;
    return (
      p.title.toLowerCase().includes(query) ||
      (r.client?.name.toLowerCase().includes(query) ?? false) ||
      typeLabel(ref.types, p.type).toLowerCase().includes(query) ||
      p.owner_email.toLowerCase().includes(query) ||
      r.team.join(" ").toLowerCase().includes(query)
    );
  });

  // The overflow menu closes on any outside click, like the design
  // mockup's document-level listener.
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  // Escape leaves the create/edit page, like every other sheet.
  useEffect(() => {
    if (editing === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProjectDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // Opening a project page pushes a history entry so the browser back
  // button returns to the list; ?new=1 addresses the create form.
  function openProjectPage(project: Project | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("new");
    if (project) url.searchParams.set("project", project.id);
    else url.searchParams.set("new", "1");
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
    setEditing(project);
  }

  // Closing the page drops the ?project=/?new= deep link so refreshes
  // land back on the list.
  function closeProjectDialog() {
    setEditing(undefined);
    const url = new URL(window.location.href);
    if (url.searchParams.has("project") || url.searchParams.has("new")) {
      url.searchParams.delete("project");
      url.searchParams.delete("new");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pricing_model = String(f.get("pricing_model"));
    const opportunityId = String(f.get("opportunity_id") || "");
    // Named régie lines are serialized into a hidden field by the form;
    // the flat tjm/estimated_days columns stay in sync below as the blended
    // rate / total days so the table, extensions and dashboards keep working.
    const windowStart = String(f.get("start_date") || "");
    const windowEnd = String(f.get("end_date") || "");
    const profiles =
      pricing_model === "regie"
        ? storedTjmProfiles(JSON.parse(String(f.get("tjm_profiles") || "[]")))
        : [];
    const daysSum = linesDays(profiles, windowStart, windowEnd);
    const regieAmount = linesAmount(profiles, windowStart, windowEnd);
    const fixedPrice =
      pricing_model === "forfait" ? Number(f.get("fixed_price") ?? 0) : null;
    const values = {
      title: String(f.get("title")).trim(),
      client_id: String(f.get("client_id")),
      // The convert picker only exists on create — never unlink on edit.
      opportunity_id: editing ? editing.opportunity_id : opportunityId || null,
      pricing_model,
      currency: String(f.get("currency") || "EUR"),
      tjm_profiles: profiles,
      tjm:
        pricing_model === "regie"
          ? daysSum > 0
            ? Math.round((regieAmount / daysSum) * 100) / 100
            : 0
          : null,
      estimated_days: pricing_model === "regie" ? daysSum : null,
      fixed_price: fixedPrice,
      amount: pricing_model === "regie" ? regieAmount : Number(fixedPrice ?? 0),
      status: String(f.get("status") || defaultStatus?.key || ""),
      start_date: String(f.get("start_date") || "") || null,
      end_date: String(f.get("end_date") || "") || null,
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      notes: String(f.get("notes")).trim(),
      updated_at: new Date().toISOString(),
    };
    void action(async () => {
      const result = editing
        ? await db()
            .from("sales_projects")
            .update(values)
            .eq("id", editing.id)
            .select("id")
            .single()
        : await db()
            .from("sales_projects")
            .insert(values)
            .select("id")
            .single();
      if (result.error) throw result.error;
    }, "Project saved.");
    closeProjectDialog();
  }

  function setStatus(p: Project, status: string, success: string) {
    void action(async () => {
      const result = await db()
        .from("sales_projects")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, success);
  }

  return (
    <>
      <Notice error>{error || loadError}</Notice>
      <Notice>{message}</Notice>
      {ref.missing && (
        <Notice error>
          The admin_settings migration is missing — apply
          supabase/migrations/20261007090000_sales_projects_admin_settings.sql,
          until then built-in defaults are used.
        </Notice>
      )}
      {editing !== undefined && (
        <div className="pj-page">
          <div className="pj-head">
            <button className="pj-back" onClick={closeProjectDialog}>
              <ArrowLeft size={16} />
              Projects
            </button>
            <div className="pj-head-row">
              <div className="pj-head-main">
                <div className="pj-title-row">
                  <h1 className="pj-title" id="pj-title">
                    {editing ? "Edit project" : "Create a project"}
                  </h1>
                  {editing && (
                    <span className="pj-title-chip">{editing.title}</span>
                  )}
                </div>
                {editing && (
                  <div className="pj-meta">
                    {(() => {
                      const meta = statusMeta(
                        ref.statuses,
                        "project",
                        editing.status,
                      );
                      const client = clientsById.get(editing.client_id);
                      const signed =
                        signedExtensionsByProject.get(editing.id) || [];
                      let effEnd = editing.end_date;
                      for (const ext of signed) {
                        if (ext.end_date && (!effEnd || ext.end_date > effEnd))
                          effEnd = ext.end_date;
                      }
                      const items: ReactElement[] = [
                        <span className="pj-meta-item" key="status">
                          <span
                            className="pj-meta-dot"
                            style={{ background: meta.color }}
                            aria-hidden="true"
                          />
                          {meta.label}
                        </span>,
                      ];
                      if (client)
                        items.push(
                          <span className="pj-meta-item" key="client">
                            {client.name}
                          </span>,
                        );
                      items.push(
                        <span className="pj-meta-item" key="pricing">
                          {editing.pricing_model === "regie"
                            ? "Régie"
                            : "Forfait"}
                          {` · ${editing.currency}`}
                        </span>,
                      );
                      if (editing.start_date && effEnd)
                        items.push(
                          <span className="pj-meta-item" key="range">
                            {`${shortDate(editing.start_date)} → ${longDate(effEnd)}`}
                          </span>,
                        );
                      return items;
                    })()}
                  </div>
                )}
              </div>
              <div className="pj-actions">
                <button
                  type="button"
                  className="pj-btn pj-btn-ghost"
                  onClick={closeProjectDialog}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="pj-form"
                  className="pj-btn pj-btn-primary"
                  disabled={busy}
                >
                  {editing ? "Save changes" : "Create project"}
                </button>
              </div>
            </div>
          </div>
          {editing && (
            <ProjectStatsStrip
              project={editing}
              signedExts={signedExtensionsByProject.get(editing.id) || []}
              craDays={craDaysByProject.get(editing.id) || 0}
            />
          )}
          <ProjectForm
            key={editing?.id || "new"}
            editing={editing}
            clients={data.clients}
            convertible={convertible}
            opportunitiesById={opportunitiesById}
            statuses={projectStatuses}
            defaultStatusKey={defaultStatus?.key}
            busy={busy}
            actorEmail={actorEmail}
            craDaysByProject={craDaysByProject}
            signedExtensions={
              editing ? signedExtensionsByProject.get(editing.id) || [] : []
            }
            onCancel={closeProjectDialog}
            onSubmit={save}
            onFolderLinked={(projectId, folder) => {
              const patch = {
                drive_folder_id: folder.id,
                drive_folder_name: folder.name,
                drive_folder_link: folder.webViewLink || null,
              };
              setProjects((list) =>
                list.map((x) => (x.id === projectId ? { ...x, ...patch } : x)),
              );
              setEditing((e) =>
                e && e.id === projectId ? { ...e, ...patch } : e,
              );
            }}
            onExtensionsChanged={() => setReloadTick((t) => t + 1)}
            onProjectPatched={(projectId, patch) => {
              setProjects((list) =>
                list.map((x) => (x.id === projectId ? { ...x, ...patch } : x)),
              );
              setEditing((e) =>
                e && e.id === projectId ? { ...e, ...patch } : e,
              );
            }}
          />
        </div>
      )}
      {editing === undefined && (
        <>
          <header className="projects-head">
            <div className="projects-head-text">
              <h1>Projects</h1>
              <p className="projects-lede">
                Delivery, consumption and billing across your engagements
              </p>
            </div>
            <button
              type="button"
              className="projects-cta"
              onClick={() => openProjectPage(null)}
            >
              <Plus size={18} />
              New project
            </button>
          </header>
          <section className="projects-stats" aria-label="Summary">
            <div className="projects-stat">
              <span className="projects-stat-label">Active projects</span>
              <span className="projects-stat-value">{activeCount}</span>
              <span className="projects-stat-sub">
                {staffedCount} staffed · {activeCount - staffedCount} unassigned
              </span>
            </div>
            <div className="projects-stat">
              <span className="projects-stat-label">Contract value</span>
              <span className="projects-stat-value">{money(activeTotal)}</span>
              <span className="projects-stat-sub">
                Régie + forfait, active contracts
              </span>
            </div>
            <div className="projects-stat">
              <span className="projects-stat-label">Consumed to date</span>
              <span className="projects-stat-value">
                ≈ {money(consumedTotal)}
              </span>
              <span className="projects-stat-sub">
                {trackedRows.length
                  ? `Tracked on ${trackedRows.filter((r) => r.consumedDays > 0).length} of ${trackedRows.length} régie projects`
                  : "No régie contracts active"}
              </span>
            </div>
            <div className="projects-stat projects-stat-inv">
              <span className="projects-stat-label">Needs attention</span>
              <span className="projects-stat-value">
                {attentionRows.length}
              </span>
              <span className="projects-stat-sub">
                {attentionSub || "Nothing flagged"}
              </span>
            </div>
          </section>
          <section className="projects-card" aria-label="Project list">
            <div className="projects-toolbar">
              <div
                className="projects-tabs"
                role="tablist"
                aria-label="Filter projects"
              >
                {(
                  [
                    ["all", "All", rows.length],
                    ["attention", "Needs attention", attentionRows.length],
                    ["ending", "Ending in 30 days", endingSoon],
                    ["archived", "Archived", archivedCount],
                  ] as [ProjectsTab, string, number][]
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    className={`projects-tab${tab === id ? " on" : ""}`}
                    onClick={() => setTab(id)}
                  >
                    {label} <span className="count">{count}</span>
                  </button>
                ))}
              </div>
              <div className="projects-toolbar-right">
                <label className="projects-search">
                  <Search size={18} aria-hidden="true" />
                  <span className="projects-search-label">Search projects</span>
                  <input
                    type="search"
                    aria-label="Search projects"
                    placeholder="Search code, consultant, client"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  className="projects-refresh"
                  aria-label="Refresh"
                  title="Refresh"
                  disabled={loading}
                  onClick={() => void load()}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>
            <div className="projects-table-scroll">
              <div className="projects-table">
                <div className="projects-head-row" aria-hidden="true">
                  <div>Project</div>
                  <div>Timeline</div>
                  <div>
                    Consumption{" "}
                    <span className="projects-head-hint">
                      · bar = days used, tick = time elapsed
                    </span>
                  </div>
                  <div>Status</div>
                  <div />
                </div>
                {visible.map((r, i) => {
                  const p = r.project;
                  const ended = r.daysLeft !== null && r.daysLeft < 0;
                  const tracked = r.consumedDays > 0 && r.budgetDays > 0;
                  return (
                    <div className="projects-row" key={p.id}>
                      <div className="projects-cell">
                        <span
                          className={`projects-avatar${
                            r.team.length ? "" : " unassigned"
                          }`}
                          aria-hidden="true"
                        >
                          {r.initials}
                        </span>
                        <div className="projects-cell-text">
                          <span className="projects-who">{r.who}</span>
                          <button
                            type="button"
                            className="projects-title"
                            title={p.title}
                            onClick={() => openProjectPage(p)}
                          >
                            {p.title}
                          </button>
                          <span className="projects-sub">
                            {r.metaLine || "—"}
                          </span>
                        </div>
                      </div>
                      <div className="projects-timeline">
                        {p.start_date && r.effEnd ? (
                          <>
                            <div className="projects-range">
                              <span>{`${shortDate(p.start_date)} → ${shortDate(r.effEnd)}`}</span>
                              {r.extended && (
                                <span className="projects-ext-tag">
                                  extended
                                </span>
                              )}
                              {r.daysLeft !== null && (
                                <span
                                  className={`left${ended ? " ended" : ""}`}
                                >
                                  {ended
                                    ? `Ended ${Math.abs(r.daysLeft)}d ago`
                                    : `${r.daysLeft}d left`}
                                </span>
                              )}
                            </div>
                            {r.timePct !== null && (
                              <div
                                className="projects-bar"
                                role="progressbar"
                                aria-valuenow={r.timePct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
                                <div
                                  className="projects-bar-fill"
                                  style={{ width: `${r.timePct}%` }}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="projects-range">
                            <span>
                              {p.start_date
                                ? `Starts ${shortDate(p.start_date)}`
                                : "No dates"}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="projects-consume">
                        {tracked ? (
                          <>
                            <div className="projects-consume-label">
                              <span>
                                {fmtDays(r.consumedDays)} / {fmtDays(r.budgetDays)} j ·{" "}
                                <span className="projects-consume-dim">
                                  {r.usedPct}%
                                </span>
                              </span>
                              <span>
                                <strong>{money(r.billed, p.currency)}</strong>{" "}
                                <span className="projects-consume-dim">
                                  / {money(r.total, p.currency)}
                                </span>
                              </span>
                            </div>
                            <div
                              className="projects-bar tall"
                              role="progressbar"
                              aria-label="Contract days consumed"
                              aria-valuenow={Math.min(r.usedPct, 100)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className="projects-bar-fill"
                                style={{
                                  width: `${Math.min(r.usedPct, 100)}%`,
                                }}
                              />
                              {r.timePct !== null && (
                                <div
                                  className="projects-bar-tick"
                                  style={{ left: `${r.timePct}%` }}
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="projects-consume-label">
                              <span className="projects-consume-dim">
                                {r.isRegie
                                  ? r.consumedDays > 0
                                    ? `${fmtDays(r.consumedDays)} logged · set a day budget`
                                    : "No days logged yet"
                                  : "Forfait — no day budget"}
                              </span>
                              <span>
                                <span className="projects-consume-dim">
                                  — /
                                </span>{" "}
                                <strong>{money(r.total, p.currency)}</strong>
                              </span>
                            </div>
                            <div
                              className="projects-bar tall dashed"
                              aria-hidden="true"
                            />
                          </>
                        )}
                      </div>
                      <div>
                        <span
                          className={`projects-status${r.flag ? " alert" : ""}`}
                        >
                          <span
                            className="projects-status-dot"
                            style={{
                              background: r.flag ? undefined : r.meta.color,
                            }}
                            aria-hidden="true"
                          />
                          {r.meta.label}
                        </span>
                      </div>
                      <div className="projects-col-actions">
                        <button
                          className="projects-row-btn icon"
                          aria-label={`More actions for ${p.title}`}
                          aria-expanded={menuFor === p.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setMenuFor(menuFor === p.id ? null : p.id);
                          }}
                        >
                          <MoreVertical size={16} />
                        </button>
                        {menuFor === p.id && (
                          <div
                            className={`projects-menu${
                              i >= visible.length - 2 ? " up" : ""
                            }`}
                            role="menu"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              disabled={busy}
                              onClick={() => {
                                setMenuFor(null);
                                openProjectPage(p);
                              }}
                            >
                              Edit
                            </button>
                            {r.meta.is_terminal
                              ? defaultStatus &&
                                p.status !== defaultStatus.key && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={busy}
                                    onClick={() => {
                                      setMenuFor(null);
                                      setStatus(
                                        p,
                                        defaultStatus.key,
                                        "Project restored.",
                                      );
                                    }}
                                  >
                                    <ArchiveRestore size={16} />
                                    Restore
                                  </button>
                                )
                              : terminalStatus &&
                                p.status !== terminalStatus.key && (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={busy}
                                    onClick={() => {
                                      setMenuFor(null);
                                      setStatus(
                                        p,
                                        terminalStatus.key,
                                        "Project archived.",
                                      );
                                    }}
                                  >
                                    <Archive size={16} />
                                    Archive
                                  </button>
                                )}
                            <button
                              type="button"
                              role="menuitem"
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                setMenuFor(null);
                                if (confirm(`Delete project “${p.title}”?`))
                                  void action(async () => {
                                    const r = await db()
                                      .from("sales_projects")
                                      .delete()
                                      .eq("id", p.id)
                                      .select("id")
                                      .single();
                                    if (r.error) throw r.error;
                                  }, "Project deleted.");
                              }}
                            >
                              <Trash2 size={16} />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                      {r.flag && (
                        <div className="projects-flag">
                          <TriangleAlert size={16} aria-hidden="true" />
                          <span>{r.flag}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!visible.length && (
                  <div className="projects-empty">
                    {projects.length
                      ? "No projects match this view."
                      : "No projects yet — convert a won deal from the pipeline, or create a project manually."}
                  </div>
                )}
              </div>
            </div>
            <div className="projects-foot">
              <span>
                Showing {visible.length} of {rows.length} projects
              </span>
              <span>Account owner · {actorEmail}</span>
            </div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Stat strip under the edit page header (source design "Edit Project.html"):
 * contract value, CRA consumption, remaining budget and time left — all
 * derived from the saved project row plus its signed extensions and the
 * CRA days already recorded against it.
 */
function ProjectStatsStrip({
  project,
  signedExts,
  craDays,
}: {
  project: Project;
  signedExts: ProjectExtension[];
  craDays: number;
}) {
  const isRegie = project.pricing_model === "regie";
  const days = Number(project.estimated_days ?? 0);
  // Signed extensions grow both the day budget and the contract value.
  const extDays = signedExts.reduce(
    (sum, ext) =>
      ext.pricing_model === "regie" && ext.estimated_days != null
        ? sum + Number(ext.estimated_days)
        : sum,
    0,
  );
  const budget = isRegie ? days + extDays : 0;
  const extAmount = signedExts.reduce(
    (sum, ext) => sum + Number(ext.amount),
    0,
  );
  const total = Number(project.amount) + extAmount;
  // Blended consumption value — the same approximation as the projects list.
  const pct = budget > 0 ? Math.round((craDays / budget) * 100) : 0;
  const consumedValue = budget > 0 ? Math.round((craDays / budget) * total) : 0;
  let effEnd = project.end_date;
  for (const ext of signedExts) {
    if (ext.end_date && (!effEnd || ext.end_date > effEnd))
      effEnd = ext.end_date;
  }
  const progress = timelineProgress({ ...project, end_date: effEnd });
  return (
    <div className="pj-stats">
      <div className="pj-stat">
        <span className="pj-stat-label">Contract value</span>
        <span className="pj-stat-value">{money(total, project.currency)}</span>
        <span className="pj-stat-sub">
          {isRegie
            ? `${money(Number(project.tjm ?? 0), project.currency)} × ${fmtDays(budget)} days`
            : "Forfait"}
          {extAmount > 0 ? " · incl. extensions" : ""}
        </span>
      </div>
      <div className="pj-stat">
        <span className="pj-stat-label">Consumed (CRA)</span>
        <span className="pj-stat-value">
          {budget > 0
            ? money(consumedValue, project.currency)
            : `${fmtDays(craDays)} days`}
        </span>
        <span className="pj-stat-sub">
          {budget > 0
            ? `${fmtDays(craDays)} of ${fmtDays(budget)} days · ${pct}%`
            : "from CRA timesheets"}
        </span>
      </div>
      <div className="pj-stat">
        <span className="pj-stat-label">Remaining</span>
        <span className="pj-stat-value">
          {budget > 0 ? money(total - consumedValue, project.currency) : "—"}
        </span>
        <span className="pj-stat-sub">
          {budget > 0
            ? `${fmtDays(budget - craDays)} days left to deliver`
            : "Fixed price"}
        </span>
      </div>
      <div className="pj-stat">
        <span className="pj-stat-label">Time left</span>
        <span className="pj-stat-value">
          {progress
            ? progress.left < 0
              ? "Ended"
              : `${progress.left} days`
            : "—"}
        </span>
        <span className="pj-stat-sub">
          {effEnd ? `Ends ${longDate(effEnd)}` : "No end date"}
        </span>
      </div>
    </div>
  );
}

function ProjectForm({
  editing,
  clients,
  convertible,
  opportunitiesById,
  statuses,
  defaultStatusKey,
  busy,
  actorEmail,
  craDaysByProject,
  signedExtensions,
  onCancel,
  onSubmit,
  onFolderLinked,
  onExtensionsChanged,
  onProjectPatched,
}: {
  editing: Project | null;
  clients: SalesClient[];
  convertible: SalesOpportunity[];
  opportunitiesById: Map<string, SalesOpportunity>;
  statuses: ReturnType<typeof statusesFor>;
  defaultStatusKey: string | undefined;
  busy: boolean;
  actorEmail: string;
  craDaysByProject: Map<string, number>;
  signedExtensions: ProjectExtension[];
  onCancel: () => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onFolderLinked: (projectId: string, folder: ContractFolder) => void;
  onExtensionsChanged: () => void;
  onProjectPatched: (
    projectId: string,
    patch: { end_date: string | null; updated_at: string },
  ) => void;
}) {
  const source = editing?.opportunity_id
    ? opportunitiesById.get(editing.opportunity_id)
    : undefined;
  const [pricingModel, setPricingModel] = useState(
    editing?.pricing_model || source?.pricing_model || "regie",
  );
  const [clientId, setClientId] = useState(editing?.client_id || "");
  const [startDate, setStartDate] = useState(editing?.start_date || "");
  const [endDate, setEndDate] = useState(editing?.end_date || "");
  const [profiles, setProfiles] = useState<TjmProfileDraft[]>(() => {
    const stored = storedTjmProfiles(editing?.tjm_profiles);
    if (editing && stored.length)
      return stored.map((p) => ({
        name: p.name,
        tjm: String(p.tjm),
        end_date: p.end_date || "",
      }));
    if (editing?.pricing_model === "regie" && editing.tjm != null)
      return [{ name: "", tjm: String(editing.tjm), end_date: "" }];
    if (!editing && source?.pricing_model === "regie" && source.tjm != null)
      return [{ name: "", tjm: String(source.tjm), end_date: "" }];
    return [{ name: "", tjm: "", end_date: "" }];
  });
  const [currency, setCurrency] = useState(editing?.currency || "EUR");
  const [fixedPrice, setFixedPrice] = useState(
    editing?.fixed_price != null
      ? String(editing.fixed_price)
      : source?.fixed_price != null
        ? String(source.fixed_price)
        : "",
  );
  const [owner, setOwner] = useState(editing?.owner_email || actorEmail);

  // Line volumes derive from each line's end date inside the contract
  // window (open days).
  const openDays = openDaysBetween(startDate, endDate);
  const cleanedProfiles: PricingLine[] = profiles.map((p) => ({
    name: p.name.trim(),
    tjm: Number(p.tjm) || 0,
    end_date: p.end_date || null,
  }));
  const totalDays = linesDays(cleanedProfiles, startDate, endDate);
  const regieTotal = linesAmount(cleanedProfiles, startDate, endDate);
  const daysDiffer = openDays > 0 && totalDays !== openDays;
  const currencySymbol =
    { EUR: "€", USD: "$", SAR: "SAR" }[currency as "EUR" | "USD" | "SAR"] ||
    currency;
  const fixedNumber = Number(fixedPrice) || 0;

  // Timeline track between the picked dates — a muted fill up to today with
  // a lime marker, like the source design's schedule track.
  const timeline = useMemo(() => {
    if (!startDate || !endDate) return null;
    const start = new Date(`${startDate}T00:00:00`).getTime();
    const end = new Date(`${endDate}T00:00:00`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
    return {
      pct: Math.round(
        Math.max(0, Math.min(1, (Date.now() - start) / (end - start))) * 100,
      ),
    };
  }, [startDate, endDate]);

  // CRA consumption for an existing project: the day budget mirrors the
  // régie profiles (plus signed régie extensions), the amount the matching
  // contract value — the same figures as the projects list and stat strip.
  const consumedDays = editing ? craDaysByProject.get(editing.id) || 0 : 0;
  const extBudgetDays = signedExtensions.reduce(
    (sum, ext) =>
      ext.pricing_model === "regie" && ext.estimated_days != null
        ? sum + Number(ext.estimated_days)
        : sum,
    0,
  );
  const extAmount = signedExtensions.reduce(
    (sum, ext) => sum + Number(ext.amount),
    0,
  );
  const consumptionBudget =
    pricingModel === "regie" ? totalDays + extBudgetDays : 0;
  const consumptionAmount =
    pricingModel === "regie" ? regieTotal + extAmount : fixedNumber + extAmount;
  const consumePct =
    consumptionBudget > 0
      ? Math.round((consumedDays / consumptionBudget) * 100)
      : 0;
  const consumedValue =
    consumptionBudget > 0
      ? Math.round((consumedDays / consumptionBudget) * consumptionAmount)
      : 0;

  const setProfile = (i: number, patch: Partial<TjmProfileDraft>) =>
    setProfiles((list) =>
      list.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    );
  const addProfile = () =>
    setProfiles((list) => [...list, { name: "", tjm: "", end_date: "" }]);
  const removeProfile = (i: number) =>
    setProfiles((list) =>
      list.length <= 1 ? list : list.filter((_, j) => j !== i),
    );

  return (
    <form id="pj-form" className="pj-form" onSubmit={onSubmit}>
      <div className="pj-body">
        {!editing && !!convertible.length && (
          <section className="pj-card">
            <label className="pj-field">
              <span className="pj-label">Convert a won deal (optional)</span>
              <select
                name="opportunity_id"
                defaultValue=""
                onChange={(e) => {
                  const o = opportunitiesById.get(e.target.value);
                  if (o) {
                    setPricingModel(o.pricing_model);
                    setClientId(o.client_id);
                    setProfiles(
                      o.pricing_model === "regie" && o.tjm != null
                        ? [{ name: "", tjm: String(o.tjm), end_date: "" }]
                        : [{ name: "", tjm: "", end_date: "" }],
                    );
                  }
                }}
              >
                <option value="">Create manually</option>
                {convertible.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title} —{" "}
                    {clients.find((c) => c.id === o.client_id)?.name ||
                      "Client"}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        <div className={editing ? "pj-layout" : "pj-layout pj-layout-wide"}>
          <div className="pj-main">
            <section className="pj-card">
              <div className="pj-card-head">
                <div>
                  <h2 className="pj-card-title">General</h2>
                  <p className="pj-card-desc">
                    Who the project is for and who owns it.
                  </p>
                </div>
              </div>
              <div className="pj-grid pj-grid-3">
                <label className="pj-field">
                  <span className="pj-label">Project title</span>
                  <input
                    name="title"
                    defaultValue={editing?.title}
                    required
                    maxLength={200}
                  />
                  <span className="pj-field-help">
                    Same as the code — give it a readable name, e.g. "Credit
                    Chain · AI squad"
                  </span>
                </label>
                <div className="pj-field">
                  <span className="pj-label">Client</span>
                  <ClientPicker
                    clients={clients}
                    value={clientId}
                    onChange={setClientId}
                    required
                  />
                </div>
                <label className="pj-field">
                  <span className="pj-label">Status</span>
                  <select
                    name="status"
                    defaultValue={
                      editing?.status || defaultStatusKey || statuses[0]?.key
                    }
                  >
                    {statuses.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                        {s.is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="pj-field pj-field-owner">
                <span className="pj-label">Owner</span>
                <span className="pj-affix pj-owner">
                  <span className="pj-owner-avatar" aria-hidden="true">
                    {owner.trim().charAt(0) || "?"}
                  </span>
                  <input
                    name="owner_email"
                    type="email"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    maxLength={200}
                  />
                </span>
              </label>
            </section>

            <section className="pj-card">
              <div className="pj-card-head">
                <div>
                  <h2 className="pj-card-title">Contract</h2>
                  <p className="pj-card-desc">
                    The initial contract window and its pricing — renewals
                    continue as extensions below.
                  </p>
                </div>
                {openDays > 0 && (
                  <span className="pj-chip">{openDays} working days</span>
                )}
              </div>

              {/* The initial contract is modeled like an extension: an
                  index badge, a window, and its own pricing lines in one
                  sunken row. */}
              <div className="pj-contract">
                <div className="pj-contract-head">
                  <span className="pj-contract-index" aria-hidden="true">
                    1
                  </span>
                  <span className="pj-contract-name">Initial contract</span>
                  {startDate && (
                    <span className="pj-contract-from">
                      From {shortDate(startDate)}
                    </span>
                  )}
                </div>

                <div className="pj-grid pj-grid-2">
                  <label className="pj-field">
                    <span className="pj-label">Start date</span>
                    <DateField
                      name="start_date"
                      defaultValue={editing?.start_date || ""}
                      onChange={(value) => setStartDate(value)}
                    />
                  </label>
                  <label className="pj-field">
                    <span className="pj-label">End date</span>
                    <DateField
                      name="end_date"
                      value={endDate}
                      onChange={(value) => setEndDate(value)}
                    />
                  </label>
                </div>
                {pricingModel === "regie" && openDays > 0 && daysDiffer && (
                  <p className="pj-hint">
                    The profile windows don't match the contract end date.
                    <button
                      type="button"
                      className="pj-link"
                      onClick={() => setProfile(0, { end_date: endDate })}
                    >
                      Run the first profile to {longDate(endDate)}
                    </button>
                  </p>
                )}
                {timeline && (
                  <div className="pj-track">
                    <div
                      className="pj-track-bar"
                      role="progressbar"
                      aria-label="Contract window elapsed"
                      aria-valuenow={timeline.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="pj-track-fill"
                        style={{ width: `${timeline.pct}%` }}
                      />
                      <div
                        className="pj-track-today"
                        style={{ left: `${timeline.pct}%` }}
                      />
                    </div>
                    <div className="pj-track-labels">
                      <span>{shortDate(startDate)}</span>
                      <span>Today · {timeline.pct}% of the window elapsed</span>
                      <span>{shortDate(endDate)}</span>
                    </div>
                  </div>
                )}

                <div className="pj-grid pj-grid-2 pj-pricing-row">
                  <div className="pj-field">
                    <span className="pj-label">Pricing model</span>
                    <div
                      className="pj-seg"
                      role="radiogroup"
                      aria-label="Pricing model"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={pricingModel === "regie"}
                        className={pricingModel === "regie" ? "on" : ""}
                        onClick={() => setPricingModel("regie")}
                      >
                        Régie
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={pricingModel === "forfait"}
                        className={pricingModel === "forfait" ? "on" : ""}
                        onClick={() => setPricingModel("forfait")}
                      >
                        Forfait
                      </button>
                    </div>
                    <input
                      type="hidden"
                      name="pricing_model"
                      value={pricingModel}
                    />
                  </div>
                  <label className="pj-field">
                    <span className="pj-label">Currency</span>
                    <select
                      name="currency"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      <option value="EUR">EUR — Euro</option>
                      <option value="SAR">SAR — Saudi riyal</option>
                      <option value="USD">USD — US dollar</option>
                    </select>
                  </label>
                </div>
                {pricingModel === "forfait" && (
                  <label className="pj-field pj-field-fixed">
                    <span className="pj-label">Forfait</span>
                    <input
                      name="fixed_price"
                      type="number"
                      min="0"
                      step="100"
                      value={fixedPrice}
                      onChange={(e) => setFixedPrice(e.target.value)}
                      required
                    />
                  </label>
                )}
                {pricingModel === "regie" && (
                  <div className="pj-table">
                    <div className="pj-table-head" aria-hidden="true">
                      <span>Profile</span>
                      <span>Rate</span>
                      <span>End date</span>
                      <span className="pj-right">Subtotal</span>
                      <span />
                    </div>
                    {profiles.map((profile, i) => {
                      const cleaned = cleanedProfiles[i];
                      const days = lineDays(cleaned, startDate, endDate);
                      return (
                        <div className="pj-table-row" key={i}>
                          <input
                            aria-label={`Profile ${i + 1} name`}
                            placeholder="Name this profile, e.g. Data Engineer"
                            value={profile.name}
                            maxLength={100}
                            onChange={(e) =>
                              setProfile(i, { name: e.target.value })
                            }
                          />
                          <span className="pj-affix">
                            <input
                              aria-label={`Profile ${i + 1} daily rate`}
                              type="number"
                              min="0"
                              step="10"
                              required
                              value={profile.tjm}
                              onChange={(e) =>
                                setProfile(i, { tjm: e.target.value })
                              }
                            />
                            <span className="pj-affix-suffix">
                              {currencySymbol} / day
                            </span>
                          </span>
                          <DateField
                            aria-label={`Profile ${i + 1} end date`}
                            value={profile.end_date}
                            min={startDate || undefined}
                            max={endDate || undefined}
                            onChange={(value) =>
                              setProfile(i, { end_date: value })
                            }
                          />
                          <span
                            className="pj-subtotal"
                            title={`${days} working days`}
                          >
                            {money(cleaned.tjm * days, currency)}
                          </span>
                          <button
                            type="button"
                            className="pj-profile-remove"
                            aria-label={`Remove profile ${i + 1}`}
                            title={
                              profiles.length <= 1
                                ? "A régie project needs at least one profile"
                                : "Remove profile"
                            }
                            disabled={profiles.length <= 1}
                            onClick={() => removeProfile(i)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                    <input
                      type="hidden"
                      name="tjm_profiles"
                      value={JSON.stringify(cleanedProfiles)}
                    />
                    <div className="pj-table-foot">
                      <button
                        type="button"
                        className="pj-add-profile"
                        onClick={addProfile}
                      >
                        + Add profile
                      </button>
                      <span className="pj-value">
                        <span className="pj-value-label">Estimated value</span>
                        <span className="pj-value-amount">
                          {money(regieTotal, currency)}
                        </span>
                      </span>
                    </div>
                  </div>
                )}
                {pricingModel === "forfait" && fixedNumber > 0 && (
                  <div className="pj-table-foot pj-foot-plain">
                    <span />
                    <span className="pj-value">
                      <span className="pj-value-label">Estimated value</span>
                      <span className="pj-value-amount">
                        {money(fixedNumber, currency)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </section>

            {editing && (
              <section className="pj-card">
                <ProjectExtensionsSection
                  projectId={editing.id}
                  numberOffset={1}
                  pricingModel={pricingModel}
                  currency={currency}
                  profiles={storedTjmProfiles(editing.tjm_profiles)}
                  tjm={editing.tjm != null ? Number(editing.tjm) : null}
                  estimatedDays={
                    editing.estimated_days != null
                      ? Number(editing.estimated_days)
                      : null
                  }
                  fixedPrice={
                    editing.fixed_price != null
                      ? Number(editing.fixed_price)
                      : null
                  }
                  projectEndDate={editing.end_date}
                  busy={busy}
                  onChanged={onExtensionsChanged}
                  onProjectPatched={(patch) => {
                    // Keep the form field in sync: a signed extension moves
                    // the contract end date, and saving the form must not
                    // revert it to the stale draft value.
                    setEndDate(patch.end_date || "");
                    onProjectPatched(editing.id, patch);
                  }}
                />
              </section>
            )}

            <section className="pj-card">
              <div className="pj-card-head">
                <div>
                  <h2 className="pj-card-title">Notes</h2>
                  <p className="pj-card-desc">
                    Scope, team, renewal terms — anything the next person needs.
                  </p>
                </div>
              </div>
              <textarea
                className="pj-notes-area"
                name="notes"
                defaultValue={editing?.notes}
                rows={5}
                maxLength={5000}
                placeholder="Scope, team, renewal terms…"
                aria-label="Notes"
              />
            </section>
          </div>

          {editing && (
            <aside className="pj-side">
              <section className="pj-card pj-consume-card">
                <div className="pj-card-head">
                  <h2 className="pj-card-title">Consumption (CRA)</h2>
                  <a className="pj-side-link" href="/hr/people">
                    Timesheets →
                  </a>
                </div>
                <p className="pj-side-label">Value billed / Estimated value</p>
                <p className="pj-side-figures">
                  <strong>
                    {consumptionBudget > 0
                      ? money(consumedValue, currency)
                      : `${fmtDays(consumedDays)} days`}
                  </strong>
                  {consumptionBudget > 0 && (
                    <span>/ {money(consumptionAmount, currency)}</span>
                  )}
                </p>
                {consumptionBudget > 0 && (
                  <>
                    <div
                      className="pj-side-bar"
                      role="progressbar"
                      aria-label="Contract days consumed"
                      aria-valuenow={Math.min(consumePct, 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className={consumePct > 100 ? "over" : ""}
                        style={{ width: `${Math.min(consumePct, 100)}%` }}
                      />
                    </div>
                    <div className="pj-side-meta">
                      <span>
                        {consumePct}% billed · {fmtDays(consumedDays)} of{" "}
                        {fmtDays(consumptionBudget)} days
                      </span>
                      <span>
                        {money(
                          Math.max(consumptionAmount - consumedValue, 0),
                          currency,
                        )}{" "}
                        to go
                      </span>
                    </div>
                  </>
                )}
                {consumedDays === 0 && (
                  <p className="pj-hint">
                    No client-project days recorded on this project yet — the
                    bar fills as employees save their CRA.
                  </p>
                )}
              </section>
              <section className="pj-card">
                <ProjectContractSection
                  projectId={editing.id}
                  folder={
                    editing.drive_folder_id
                      ? {
                          id: editing.drive_folder_id,
                          name: editing.drive_folder_name || "",
                          webViewLink: editing.drive_folder_link || undefined,
                        }
                      : null
                  }
                  title="Contract files"
                  onLinked={(folder) => onFolderLinked(editing.id, folder)}
                />
              </section>
            </aside>
          )}
        </div>
      </div>
    </form>
  );
}
