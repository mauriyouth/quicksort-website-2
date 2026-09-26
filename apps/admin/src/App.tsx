import { BlogManager } from "./BlogManager";
import { AiSettings } from "./AiSettings";
import { AccessManager } from "./AccessManager";
import { Pipeline } from "./hr/Pipeline";
import "./hr/hr.css";
import { Opportunities } from "./sales/Opportunities";
import { OpsBoard } from "./ops/OpsBoard";
import { PipelineBoard } from "./sales/PipelineBoard";
import { SalesDashboard } from "./sales/SalesDashboard";
import { SectionHeader, SALES_TABS, HR_TABS, OPS_TABS } from "./SectionHeader";
import { Clients } from "./sales/Clients";
import { People } from "./sales/People";
import { Analyzer } from "./hr/Analyzer";
import { Employees } from "./hr/Employees";
import { dwellDays, slaState, stageLabel } from "./hr/stages";
import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Users,
  FileText,
  KeyRound,
  LayoutDashboard,
  Plus,
  Search,
  ArrowUpRight,
  Settings,
  RefreshCw,
  UsersRound,
  Target,
  BadgeEuro,
  DoorOpen,
  Briefcase,
  KanbanSquare,
} from "lucide-react";

// Loaded on demand so each audience only downloads its own shell.
const HrPortal = lazy(() =>
  import("./portal/HrPortal").then((m) => ({ default: m.HrPortal })),
);
import {
  db,
  downloadFile,
  sha256,
  errorMessage,
  type Job,
  type Row,
} from "@quicksort/hr-db";
import { isLinkedInUrl, slugify, validateFile } from "@quicksort/hr-db/validation";
import { useAuth } from "@quicksort/hr-db/auth";
import {
  usePortalRoute,
  AuthGate,
  Shell,
  Stat,
  Notice,
  Empty,
  Pill,
  AccountSecurity,
  formatDate,
} from "@quicksort/hr-ui";
const nav = [
  { id: "overview", href: "/overview", label: "Overview", icon: LayoutDashboard },
  {
    id: "sales",
    href: "/sales",
    label: "Sales",
    icon: Briefcase,
    children: [
      { id: "sales-dashboard", href: "/sales", label: "Dashboard" },
      { id: "sales-pipeline", href: "/sales/pipeline", label: "Pipeline" },
      { id: "sales-clients", href: "/sales/clients", label: "Clients" },
      { id: "sales-people", href: "/sales/people", label: "People" },
      { id: "opportunities", href: "/sales/opportunities", label: "Opportunities" },
    ],
  },
  {
    id: "operations",
    href: "/operations",
    label: "Operations",
    icon: KanbanSquare,
  },
  {
    id: "hr",
    href: "/hr",
    label: "HR",
    icon: UsersRound,
    children: [
      // Offers, Onboarding and Offboarding are no longer standalone tabs —
      // they live as views inside the Pipeline, which owns the full lifecycle.
      { id: "pipeline", href: "/hr/pipeline", label: "Pipeline" },
      { id: "jobs", href: "/hr/jobs", label: "Job posts" },
      { id: "employees", href: "/hr/employees", label: "Employees" },
      { id: "analyzer", href: "/hr/cv-analyzer", label: "CV analyzer" },
      { id: "contracts", href: "/hr/contracts", label: "Contracts" },
    ],
  },
  { id: "blogs", href: "/blog-posts", label: "Blog posts", icon: FileText },
  { id: "people", href: "/accounts", label: "Accounts", icon: Users },
  { id: "requests", href: "/tool-requests", label: "Tool requests", icon: KeyRound },
  { id: "account", href: "/settings", label: "Settings", icon: Settings },
];
const ownerNav = [...nav, {id:"access",href:"/admin-access",label:"Admin access",icon:KeyRound}];
export default function App() {
  const auth = useAuth();
  // One deployment, two workspaces: staff (role "admin") get the back-office
  // (HR, Sales, Ops); every other signed-in user gets the candidate portal.
  // Access to data is still enforced by Supabase RLS — this fork only picks
  // the shell. While auth loads, `staff` is false and AuthGate shows its
  // loading state.
  const staff = !auth.loading && !!auth.session && auth.role === "admin";
  return staff ? (
    <AuthGate auth={auth} admin>
      {auth.session && <Admin email={auth.session.user.email || ""} isOwner={auth.isOwner} />}
    </AuthGate>
  ) : (
    <AuthGate auth={auth}>
      {auth.session && (
        <Suspense
          fallback={<p className="muted" role="status">Opening your workspace…</p>}
        >
          <HrPortal
            userId={auth.session.user.id}
            email={auth.session.user.email || ""}
          />
        </Suspense>
      )}
    </AuthGate>
  );
}
function Admin({ email, isOwner }: { email: string; isOwner: boolean }) {
  const [tab, setTab] = usePortalRoute(
    (isOwner ? ownerNav : nav).flatMap((item) =>
      item.children ? [item, ...item.children] : [item],
    ),
  );
  // The section landing route ("/hr") replaces itself with the first page.
  useEffect(() => {
    if (tab === "hr") {
      window.history.replaceState(
        null,
        "",
        "/hr/pipeline" + window.location.search + window.location.hash,
      );
      setTab("pipeline");
    }
  }, [tab, setTab]);
  // Tabs that merged into the Pipeline or the CV analyzer keep their old
  // bookmarks working.
  useEffect(() => {
    if (tab !== "not-found") return;
    const path = window.location.pathname;
    if (
      [
        "/hr/candidates",
        "/hr/interviews",
        "/hr/onboarding",
        "/hr/offboarding",
        "/hr/offers",
      ].some((p) => path.startsWith(p))
    ) {
      window.history.replaceState(
        null,
        "",
        "/hr/pipeline" + window.location.search + window.location.hash,
      );
      setTab("pipeline");
    } else if (path.startsWith("/hr/analysis-history")) {
      window.history.replaceState(
        null,
        "",
        "/hr/cv-analyzer" + window.location.search + window.location.hash,
      );
      setTab("analyzer");
    }
  }, [tab, setTab]);
  const
    [jobs, setJobs] = useState<Job[]>([]),
    [people, setPeople] = useState<Row<"profiles">[]>([]),
    [contracts, setContracts] = useState<Row<"contracts">[]>([]),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]),
    [signatures, setSignatures] = useState<Row<"contract_signatures">[]>([]),
    [opportunities, setOpportunities] = useState<Row<"opportunities">[]>([]),
    [pipeline, setPipeline] = useState<Row<"pipeline_candidates">[]>([]),
    [pipelineOffers, setPipelineOffers] = useState<Row<"offers">[]>([]),
    [exits, setExits] = useState<Row<"offboarding_records">[]>([]),
    [candidateRequests, setCandidateRequests] = useState<Row<"candidate_requests">[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Job | null | undefined>(undefined),
    [search, setSearch] = useState(""),
    [person, setPerson] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db().from("jobs").select("*").order("created_at", { ascending: false }),
        db()
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("contracts")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("candidate_documents")
          .select("*")
          .order("created_at", { ascending: false }),
        db()
          .from("tool_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        db().from("contract_signatures").select("*"),
        db().from("opportunities").select("*").order("created_at", { ascending: false }),
        db().from("pipeline_candidates").select("*").is("disposition", null),
        db().from("offers").select("*"),
        db().from("offboarding_records").select("*").eq("status", "open"),
        db().from("candidate_requests").select("*").order("created_at", { ascending: false }),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setJobs(results[0].data || []);
      setPeople(results[1].data || []);
      setContracts(results[2].data || []);
      setDocuments(results[3].data || []);
      setRequests(results[4].data || []);
      setSignatures(results[5].data || []);
      setOpportunities(results[6].data || []);
      setPipeline(results[7].data || []);
      setPipelineOffers(results[8].data || []);
      setExits(results[9].data || []);
      setCandidateRequests(results[10].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    document.title = "Quicksort Admin";
    void load();
  }, [load]);
  async function action(work: () => Promise<void>, success = "Saved.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const name = (id: string) =>
    people.find((p) => p.id === id)?.full_name ||
    people.find((p) => p.id === id)?.email ||
    "Candidate";
  const pipelineBreaches = pipeline.filter(
    (c) => slaState(c.stage, dwellDays(c.updated_at, [])) === "breach",
  );
  const offersToMove = pipelineOffers.filter((o) =>
    ["pending_approval", "pending_direction", "sent"].includes(o.status),
  );
  useEffect(() => { setEditing(undefined); setError(""); setMessage(""); setSearch(""); }, [tab]);
  function navigate(id: string) {
    setTab(id);
    setEditing(undefined);
    setError("");
    setMessage("");
    setSearch("");
  }
  async function saveJob(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const linkedin_url = String(f.get("linkedin_url")).trim();
    if (!isLinkedInUrl(linkedin_url)) {
      setError("Enter an HTTPS linkedin.com application link.");
      return;
    }
    const values = {
      title: String(f.get("title")).trim(),
      slug: slugify(String(f.get("slug"))),
      department: String(f.get("department")).trim(),
      location: String(f.get("location")).trim(),
      employment_type: String(f.get("employment_type")),
      description: String(f.get("description")).trim(),
      linkedin_url,
      published: f.get("published") === "on",
      updated_at: new Date().toISOString(),
    };
    await action(async () => {
      const result = editing
        ? await db()
            .from("jobs")
            .update(values)
            .eq("id", editing.id)
            .select("id")
            .single()
        : await db().from("jobs").insert(values).select("id").single();
      if (result.error) throw result.error;
      setEditing(undefined);
    }, "Job saved. Published jobs are available on the website.");
  }
  async function uploadContract(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await action(async () => {
      const file = f.get("file") as File;
      validateFile(file, true);
      const candidate = String(f.get("candidate"));
      const path = `${candidate}/${crypto.randomUUID()}.pdf`;
      const hash = await sha256(file);
      const upload = await db()
        .storage.from("contracts")
        .upload(path, file, { upsert: false, contentType: "application/pdf" });
      if (upload.error) throw upload.error;
      const result = await db()
        .from("contracts")
        .insert({
          candidate_id: candidate,
          title: String(f.get("title")).trim(),
          storage_path: path,
          document_sha256: hash,
        });
      if (result.error) {
        await db().storage.from("contracts").remove([path]);
        throw result.error;
      }
      form.reset();
    }, "Contract shared with the candidate.");
  }
  const salesTabIds = [
    "sales",
    "sales-dashboard",
    "sales-pipeline",
    "sales-clients",
    "sales-people",
    "opportunities",
  ];
  const isSales = salesTabIds.includes(tab);
  const hrTabIds = [
    "hr",
    "pipeline",
    "jobs",
    "employees",
    "analyzer",
    "contracts",
  ];
  const isHr = hrTabIds.includes(tab);
  const isOps = tab === "operations";
  // One shared top menu on every page: the section name plus its screens
  // as tabs. Section landing routes resolve to their first screen
  // ("/sales" → Dashboard, "/hr" → Pipeline); single-screen pages show the
  // page name without tabs.
  const headerCurrent =
    tab === "sales" ? "sales-dashboard" : tab === "hr" ? "pipeline" : tab;
  const headerLabel = isSales
    ? "Sales"
    : isHr
      ? "HR"
      : isOps
        ? "Operations"
        : ((isOwner ? ownerNav : nav).find((item) => item.id === tab)?.label ??
          "Page");
  const headerTabs = isSales
    ? SALES_TABS
    : isHr
      ? HR_TABS
      : isOps
        ? OPS_TABS
        : [];
  return (
    <Shell
      portal="Admin"
      email={email}
      nav={isOwner ? ownerNav : nav}
      current={tab}
      onNavigate={navigate}
      hideSubmenu
      hideTopbar
    >
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <SectionHeader
        label={headerLabel}
        tabs={headerTabs}
        current={headerCurrent}
        onNavigate={navigate}
      />
      {tab === "access" && isOwner && <AccessManager />}
      {tab === "pipeline" && <Pipeline actorEmail={email} />}
      {(tab === "sales" || tab === "sales-dashboard") && (
        <SalesDashboard
          actorEmail={email}
          onOpenClient={(id) => {
            window.history.pushState(null, "", `/sales/clients/${id}`);
            setTab("sales-clients");
          }}
        />
      )}
      {tab === "sales-pipeline" && <PipelineBoard />}
      {tab === "sales-clients" && <Clients actorEmail={email} />}
      {tab === "sales-people" && <People actorEmail={email} />}
      {tab === "opportunities" && <Opportunities actorEmail={email} />}
      {tab === "operations" && <OpsBoard actorEmail={email} />}
      {tab === "employees" && <Employees />}
      {tab === "blogs" && <BlogManager />}
      {tab === "analyzer" && (
        <Analyzer jobs={jobs} documents={documents} people={people} />
      )}
      {tab === "overview" && (
        <>
          <div className="heading">
            <div />
            <button
              className="btn"
              onClick={() => {
                setTab("jobs");
                setEditing(null);
              }}
            >
              <Plus size={16} />
              Create a job
            </button>
          </div>
          <div className="stats">
            <Stat
              label="In the funnel"
              value={pipeline.length}
              detail={
                pipelineBreaches.length
                  ? `${pipelineBreaches.length} over stage SLA — act now`
                  : "Everyone inside stage SLAs"
              }
              icon={Users}
            />
            <Stat
              label="Offers to move"
              value={offersToMove.length}
              detail="Approvals and signatures in flight"
              icon={BadgeEuro}
            />
            <Stat
              label="Open opportunities"
              value={opportunities.filter((r) => ["pending_approval", "approved", "published"].includes(r.status)).length}
              detail="Hiring demand being worked"
              icon={Target}
            />
            <Stat
              label="Exits in progress"
              value={exits.length}
              detail="Offboarding workflows open"
              icon={DoorOpen}
            />
          </div>
          <div className="hero">
            <div className="eyebrow">The full talent cycle</div>
            <h2>From first hello to a fond farewell.</h2>
            <p>
              Opportunities, AI-assisted screening, interviews, offers, onboarding,
              probation and offboarding — one record per person, every decision
              logged.
            </p>
            <button className="btn lime" onClick={() => navigate("pipeline")}>
              Open the pipeline
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="grid-two">
            <section className="panel">
              <div className="panel-head">
                <h2>Latest opportunities</h2>
                <button className="link-button" onClick={() => navigate("opportunities")}>
                  View all
                </button>
              </div>
              {opportunities.length ? (
                opportunities.slice(0, 4).map((r) => (
                  <div className="list-row" key={r.id}>
                    <div>
                      <h3>{r.title}</h3>
                      <p className="muted small-text">
                        {r.hiring_mode === "sur_mission" ? "Sur mission" : "Sur profil"}
                      </p>
                    </div>
                    <Pill status={r.status} />
                  </div>
                ))
              ) : (
                <Empty title="No opportunities yet">
                  Open an opportunity to start the funnel.
                </Empty>
              )}
            </section>
            <section className="panel">
              <h2>Pipeline health</h2>
              {["application", "screening", "hr_interview", "technical_interview", "offer"].map((stage) => {
                const count = pipeline.filter((c) => c.stage === stage).length;
                const total = Math.max(1, pipeline.length);
                return (
                  <div className="step" key={stage}>
                    <span className="step-num">{count}</span>
                    <div style={{ flex: 1 }}>
                      <h3>{stageLabel(stage)}</h3>
                      <div className="meter" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (count / total) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          </div>
        </>
      )}
      {tab === "jobs" && (
        <>
          <div className="hr-actions">
            <button className="btn" onClick={() => setEditing(null)}>
              <Plus size={16} />
              Create a job
            </button>
          </div>
          {editing !== undefined && (
            <section className="panel">
              <h2>{editing ? "Edit job post" : "Create a job post"}</h2>
              <form
                className="form"
                key={editing?.id || "new"}
                onSubmit={saveJob}
              >
                <div className="form-columns">
                  <label>
                    Job title
                    <input
                      name="title"
                      defaultValue={editing?.title}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    URL slug
                    <input
                      name="slug"
                      defaultValue={editing?.slug}
                      required
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      placeholder="senior-ai-engineer"
                    />
                  </label>
                  <label>
                    Department
                    <input
                      name="department"
                      defaultValue={editing?.department || "Engineering"}
                      required
                    />
                  </label>
                  <label>
                    Location
                    <input
                      name="location"
                      defaultValue={editing?.location || "Paris, France"}
                      required
                    />
                  </label>
                </div>
                <label>
                  Contract type
                  <select
                    name="employment_type"
                    defaultValue={editing?.employment_type || "Permanent (CDI)"}
                  >
                    {[
                      "Permanent (CDI)",
                      "Fixed-term (CDD)",
                      "Contract",
                      "Internship",
                      "Apprenticeship",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Job description
                  <textarea
                    name="description"
                    defaultValue={editing?.description}
                    rows={8}
                    maxLength={20000}
                    required
                    placeholder="The role, responsibilities and what you’re looking for…"
                  />
                </label>
                <label>
                  LinkedIn application URL
                  <input
                    type="url"
                    name="linkedin_url"
                    defaultValue={editing?.linkedin_url}
                    placeholder="https://www.linkedin.com/jobs/view/…"
                    required
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={editing?.published}
                  />
                  Publish on the website
                </label>
                <div className="actions">
                  <button className="btn" disabled={busy}>
                    Save job
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setEditing(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="panel">
            <div className="toolbar">
              <Search size={18} />
              <input
                aria-label="Search jobs"
                placeholder="Search job posts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="btn secondary small"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            {!jobs.length && !loading && (
              <Empty title="No job posts yet">
                Your published opportunities will appear on the careers page.
              </Empty>
            )}
            {jobs
              .filter((j) =>
                j.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((j) => (
                <div className="list-row" key={j.id}>
                  <div>
                    <h3>{j.title}</h3>
                    <p className="muted">
                      {j.department} · {j.location}
                    </p>
                    <Pill status={j.published ? "published" : "draft"} />
                  </div>
                  <div className="actions">
                    <a
                      className="btn secondary small"
                      href={j.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      LinkedIn
                      <ArrowUpRight size={14} />
                    </a>
                    <button
                      className="btn secondary small"
                      onClick={() => setEditing(j)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          async () => {
                            const r = await db()
                              .from("jobs")
                              .update({
                                published: !j.published,
                                updated_at: new Date().toISOString(),
                              })
                              .eq("id", j.id)
                              .select("id")
                              .single();
                            if (r.error) throw r.error;
                          },
                          j.published ? "Job unpublished." : "Job published.",
                        )
                      }
                    >
                      {j.published ? "Unpublish" : "Publish"}
                    </button>
                    <button
                      className="btn danger small"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            `Delete “${j.title}”? This removes it from the website.`,
                          )
                        )
                          void action(async () => {
                            const r = await db()
                              .from("jobs")
                              .delete()
                              .eq("id", j.id)
                              .select("id")
                              .single();
                            if (r.error) throw r.error;
                          }, "Job deleted.");
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </section>
        </>
      )}
      {tab === "people" && (
        <>
          <section className="panel">
            <label className="form">
              Select a candidate
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">All accounts</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
            {people
              .filter((p) => !person || p.id === person)
              .map((p) => (
                <div className="list-row" key={p.id}>
                  <div>
                    <h3>{p.full_name || "New account"}</h3>
                    <p className="muted">{p.email}</p>
                  </div>
                  <span className="muted small-text">
                    Joined {formatDate(p.created_at)}
                  </span>
                </div>
              ))}
          </section>
          <section className="panel">
            <h2>Onboarding documents</h2>
            {documents.filter((d) => !person || d.candidate_id === person)
              .length ? (
              documents
                .filter((d) => !person || d.candidate_id === person)
                .map((d) => (
                  <div className="list-row" key={d.id}>
                    <div>
                      <h3 className="document-name">{d.name}</h3>
                      <p className="muted">
                        {name(d.candidate_id)} · {d.category} ·{" "}
                        {formatDate(d.created_at)}
                      </p>
                    </div>
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            downloadFile(
                              "candidate-documents",
                              d.storage_path,
                              d.name,
                            ),
                          "Document downloaded.",
                        )
                      }
                    >
                      Download
                    </button>
                  </div>
                ))
            ) : (
              <Empty title="No documents yet">
                Candidate uploads will appear here, ready for review.
              </Empty>
            )}
          </section>
          <section className="panel">
            <h2>Candidate rights requests</h2>
            {candidateRequests.length ? (
              candidateRequests.map((r) => (
                <div className="list-row" key={r.id}>
                  <div>
                    <h3>{r.kind.replace("_", " ")}</h3>
                    <p className="muted">
                      {r.email} · {formatDate(r.created_at)}
                    </p>
                    {r.message && <p className="wrap">{r.message}</p>}
                    <Pill status={r.status} />
                    {r.admin_note && <p className="small-text">Response: {r.admin_note}</p>}
                  </div>
                  {r.status === "open" && (
                    <form
                      className="form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void action(async () => {
                          const result = await db()
                            .from("candidate_requests")
                            .update({
                              status: "resolved",
                              admin_note: String(f.get("note")).trim(),
                            })
                            .eq("id", r.id)
                            .select("id")
                            .single();
                          if (result.error) throw result.error;
                        }, "Request resolved.");
                      }}
                    >
                      <label>
                        Response
                        <input name="note" maxLength={2000} placeholder="What HR did about it" />
                      </label>
                      <button className="btn secondary small" disabled={busy}>
                        Resolve
                      </button>
                    </form>
                  )}
                </div>
              ))
            ) : (
              <Empty title="No requests yet">
                Human re-review and GDPR requests from the HR portal land here.
              </Empty>
            )}
          </section>
        </>
      )}
      {tab === "contracts" && (
        <>
          <section className="panel">
            <h2>Share a contract</h2>
            <form className="form" onSubmit={uploadContract}>
              <div className="form-columns">
                <label>
                  Candidate
                  <select name="candidate" required defaultValue="">
                    <option value="" disabled>
                      Select an account
                    </option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contract title
                  <input
                    name="title"
                    required
                    maxLength={200}
                    placeholder="Employment agreement"
                  />
                </label>
              </div>
              <label>
                PDF document
                <input
                  name="file"
                  type="file"
                  accept="application/pdf"
                  required
                />
                <span className="muted">
                  Up to 10 MB. Shared contracts are retained as an exact
                  version.
                </span>
              </label>
              <div>
                <button className="btn" disabled={busy || !people.length}>
                  Share contract
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>Shared contracts</h2>
            {!contracts.length && (
              <Empty title="No contracts shared">
                Select a candidate above to send their first contract.
              </Empty>
            )}
            {contracts.map((c) => {
              const signed = signatures.find((s) => s.contract_id === c.id);
              return (
                <div className="list-row" key={c.id}>
                  <div>
                    <h3>{c.title}</h3>
                    <p className="muted">
                      {name(c.candidate_id)} · {formatDate(c.created_at)}
                    </p>
                    <Pill status={signed ? "signed" : "pending"} />
                    {signed && (
                      <p className="small-text muted">
                        Signed by {signed.signer_name} on{" "}
                        {formatDate(signed.signed_at)}
                      </p>
                    )}
                  </div>
                  <button
                    className="btn secondary small"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          downloadFile(
                            "contracts",
                            c.storage_path,
                            c.title + ".pdf",
                          ),
                        "Contract downloaded.",
                      )
                    }
                  >
                    Download PDF
                  </button>
                </div>
              );
            })}
          </section>
        </>
      )}
      {tab === "requests" && (
        <>
          <section className="panel">
            {!requests.length && (
              <Empty title="All clear">
                New access requests will appear here for review.
              </Empty>
            )}
            {requests.map((r) => (
              <div className="list-row" key={r.id}>
                <div>
                  <h3>{r.tool_name}</h3>
                  <p className="muted">
                    {name(r.candidate_id)} · {formatDate(r.created_at)}
                  </p>
                  <p className="wrap">{r.reason}</p>
                  <Pill status={r.status} />
                  {r.admin_note && (
                    <p className="small-text">Your response: {r.admin_note}</p>
                  )}
                </div>
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void action(async () => {
                      const result = await db()
                        .from("tool_requests")
                        .update({
                          status: String(f.get("status")),
                          admin_note: String(f.get("note")),
                        })
                        .eq("id", r.id)
                        .select("id")
                        .single();
                      if (result.error) throw result.error;
                    }, "Request updated.");
                  }}
                >
                  <label>
                    Decision
                    <select name="status" defaultValue={r.status}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="declined">Declined</option>
                    </select>
                  </label>
                  <label>
                    Response to candidate
                    <input
                      name="note"
                      defaultValue={r.admin_note}
                      maxLength={1000}
                      placeholder="Next steps or a short explanation"
                    />
                  </label>
                  <button className="btn secondary small" disabled={busy}>
                    Save response
                  </button>
                </form>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === "account" && (
        <>
          <section className="panel" style={{ maxWidth: 550 }}>
            <p className="muted">Signed in as {email}</p>
            <AccountSecurity />
          </section>
          <AiSettings isOwner={isOwner} />
        </>
      )}
      {loading && (
        <p className="muted" role="status">
          Refreshing workspace…
        </p>
      )}
    </Shell>
  );
}
