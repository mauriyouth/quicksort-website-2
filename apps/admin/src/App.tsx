import { BlogManager } from "./BlogManager";
import { AccessManager } from "./AccessManager";
import { AdminSettings } from "./AdminSettings";
import { SpotlightSearch, type SpotlightSalesContact } from "./SpotlightSearch";
import { HrWorkspace } from "./hr/HrWorkspace";
import { loadWorkspace, executeCommand } from "./hr/data";
import type { Workspace } from "./hr/domain";
import { Opportunities } from "./sales/Opportunities";
import { Projects } from "./sales/Projects";
import { OpsBoard } from "./ops/OpsBoard";
import { PipelineBoard } from "./sales/PipelineBoard";
import { SalesDashboard } from "./sales/SalesDashboard";
import { SectionHeader, SALES_TABS, HR_TABS, OPS_TABS, type SectionTab } from "./SectionHeader";
import { SettingsPage, type SettingsSection } from "./SettingsPage";
import { Clients } from "./sales/Clients";
import { People } from "./sales/People";

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
  SlidersHorizontal,
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
      { id: "sales-people", href: "/sales/people", label: "Contacts" },
      { id: "opportunities", href: "/sales/opportunities", label: "Opportunities" },
      { id: "sales-projects", href: "/sales/projects", label: "Projects" },
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
      { id: "hr-overview", href: "/hr", label: "Overview" },
      { id: "recruiting", href: "/hr/recruiting", label: "Recruiting" },
      { id: "hr-people", href: "/hr/people", label: "People" },
      { id: "journeys", href: "/hr/journeys", label: "Journeys" },
      { id: "jobs", href: "/hr/jobs", label: "Job posts" },
      { id: "contracts", href: "/hr/contracts", label: "Contracts" },
    ],
  },
  { id: "blogs", href: "/blog-posts", label: "Blog posts", icon: FileText },
  { id: "administration", href: "/administration", label: "Administration", icon: SlidersHorizontal },
  { id: "people", href: "/accounts", label: "Accounts", icon: Users },
  { id: "requests", href: "/tool-requests", label: "Tool requests", icon: KeyRound },
  { id: "account", href: "/settings", label: "Settings", icon: Settings },
];
const ownerNav = [...nav, {id:"access",href:"/admin-access",label:"Admin access",icon:KeyRound}];
/* Settings sub-screens, shown as the top-menu tabs when /settings is
 * active (same label + divider + tabs pattern as Sales / HR / Ops). */
const SETTINGS_TABS: SectionTab[] = [
  { id: "account", href: "/settings", label: "Account" },
  { id: "ai", href: "/settings/ai", label: "AI configuration" },
  { id: "drive", href: "/settings/drive", label: "Google Drive contracts" },
];
export default function App() {
  const auth = useAuth();
  const staff = !auth.loading && !!auth.session && (auth.role === "admin" || auth.role === "hr");
  if (!auth.loading && auth.session && auth.role === "sales") {
    return <AuthGate auth={auth}><StaffingWorkspace email={auth.session.user.email || ""} /></AuthGate>;
  }
  return staff ? (
    <AuthGate auth={auth}>
      {auth.session && <Admin email={auth.session.user.email || ""} isOwner={auth.isOwner} role={auth.role === "hr" ? "hr" : "admin"} />}
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
function StaffingWorkspace({ email }: { email: string }) {
  const staffingNav = [{ id: "people", href: "/hr/people", label: "People", icon: Users }, { id: "account", href: "/settings", label: "Settings", icon: Settings }];
  const [tab, setTab] = usePortalRoute(staffingNav);
  function navigate(id: string) {
    const item = staffingNav.find(n => n.id === id);
    if (item) { window.history.pushState(null, "", item.href); setTab(id); }
  }
  return <Shell portal="Staffing" email={email} nav={staffingNav} current={tab} onNavigate={navigate} hideSubmenu hideTopbar>
    <SectionHeader label={tab === "account" ? "Settings" : "People"} current={tab} onNavigate={navigate} />
    {tab === "account" ? <AccountSecurity /> : <HrWorkspace view="people" actorEmail={email} role="sales" />}
  </Shell>;
}
function Admin({ email, isOwner, role }: { email: string; isOwner: boolean; role: "hr" | "admin" }) {
  const workspaceNav = role === "hr" ? nav.filter(item => item.id === "hr" || item.id === "account") : isOwner ? ownerNav : nav;
  const [tab, setTab] = usePortalRoute(
    workspaceNav.flatMap((item) =>
      item.children ? [item, ...item.children] : [item],
    ),
  );
  useEffect(() => {
    const path = window.location.pathname;
    // Staffing and CRA merged into People: keep old links and bookmarks working.
    if (path.startsWith("/hr/staffing") || path.startsWith("/hr/cra")) {
      window.history.replaceState(null, "", "/hr/people");
      setTab("hr-people");
      return;
    }
    if (tab === "hr") setTab("hr-overview");
    if (tab !== "not-found") return;
    const oldRecruiting = ["/hr/pipeline", "/hr/candidates", "/hr/interviews", "/hr/offers", "/hr/cv-analyzer", "/hr/analysis-history"];
    const destination = oldRecruiting.some(p => path.startsWith(p)) ? "recruiting"
      : path.startsWith("/hr/employees") ? "hr-people"
      : ["/hr/onboarding", "/hr/offboarding"].some(p => path.startsWith(p)) ? "journeys" : null;
    if (destination) {
      const route = HR_TABS.find(t => t.id === destination);
      if (route) window.history.replaceState(null, "", route.href + window.location.search);
      setTab(destination);
    }
  }, [tab, setTab]);
  const
    [jobs, setJobs] = useState<Job[]>([]),
    [people, setPeople] = useState<Row<"profiles">[]>([]),
    [salesPeople, setSalesPeople] = useState<SpotlightSalesContact[]>([]),
    [userRoles, setUserRoles] = useState<Row<"user_roles">[]>([]),
    [contracts, setContracts] = useState<Row<"contracts">[]>([]),
    [documents, setDocuments] = useState<Row<"candidate_documents">[]>([]),
    [requests, setRequests] = useState<Row<"tool_requests">[]>([]),
    [signatures, setSignatures] = useState<Row<"contract_signatures">[]>([]),
    [opportunities, setOpportunities] = useState<Row<"opportunities">[]>([]),
    [hr, setHr] = useState<Workspace | null>(null),
    [candidateRequests, setCandidateRequests] = useState<Row<"candidate_requests">[]>([]),
    [projects, setProjects] = useState<
      { id: string; title: string; status: string; clientName: string }[]
    >([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Job | null | undefined>(undefined),
    [search, setSearch] = useState(""),
    [person, setPerson] = useState(""),
    [accountQuery, setAccountQuery] = useState(""),
    [rightsFilter, setRightsFilter] = useState(""),
    [spotlightOpen, setSpotlightOpen] = useState(false);
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
        loadWorkspace(),
        db().from("candidate_requests").select("*").order("created_at", { ascending: false }),
        db().from("user_roles").select("*"),
      ]);
      for (const r of results) if ("error" in r && r.error) throw r.error;
      setJobs(results[0].data || []);
      setPeople(results[1].data || []);
      setContracts(results[2].data || []);
      setDocuments(results[3].data || []);
      setRequests(results[4].data || []);
      setSignatures(results[5].data || []);
      setOpportunities(results[6].data || []);
      setHr(results[7]);
      setCandidateRequests(results[8].data || []);
      setUserRoles(results[9].data || []);
      // Delivery projects back the Spotlight "Projects" group. The table
      // arrives with its own migration, so a missing table must never block
      // the whole workspace — degrade to an empty list instead.
      try {
        const r = await db()
          .from("sales_projects")
          .select("id, title, status, client_id")
          .order("updated_at", { ascending: false });
        if (r.error) throw r.error;
        const clients = await db().from("sales_clients").select("id, name");
        const names = new Map((clients.data || []).map((c) => [c.id, c.name]));
        setProjects(
          (r.data || []).map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            clientName: names.get(p.client_id) || "",
          })),
        );
      } catch {
        setProjects([]);
      }
      // Client contacts back the Spotlight "Contacts" group (sales_contacts is
      // a different table than accounts/profiles). Degrade to empty if the
      // table is unavailable, same as projects above.
      try {
        const r = await db().from("sales_contacts").select("*").order("name");
        if (r.error) throw r.error;
        const clients = await db().from("sales_clients").select("id, name");
        const names = new Map(
          (clients.data || []).map((c) => [c.id, c.name]),
        );
        setSalesPeople(
          (r.data || []).map((p) => ({
            id: p.id,
            name: p.name,
            email: p.email,
            clientName: names.get(p.client_id || "") || "",
          })),
        );
      } catch {
        setSalesPeople([]);
      }
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
  // Accounts page helpers: rights come from user_roles (managed in the
  // Access manager) and only render here — assignment stays fine-grained.
  const roleOf = (id: string) =>
    userRoles.find((r) => r.user_id === id)?.role || "candidate";
  const visibleAccounts = people.filter((p) => {
    const q = accountQuery.trim().toLowerCase();
    return (
      (!person || p.id === person) &&
      (!q ||
        (p.full_name || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q)) &&
      (!rightsFilter || roleOf(p.id) === rightsFilter)
    );
  });
  const accountsScoped =
    !!person || !!accountQuery.trim() || !!rightsFilter;
  const visibleAccountIds = new Set(visibleAccounts.map((p) => p.id));
  const docVisible = (candidateId: string) =>
    !accountsScoped || visibleAccountIds.has(candidateId);
  const pipeline = hr?.applications.filter(a => a.status === "active") || [];
  const hrPeople = hr?.people || [];
  const pipelineBreaches = pipeline.filter(a => (Date.now() - Date.parse(a.stage_entered_at)) / 86400000 > 14);
  const offersToMove = hr?.offers.filter(o => ["draft", "pending_approval", "pending_direction", "shared"].includes(o.status)) || [];
  const exits = hr?.exits.filter(e => e.status === "open") || [];
  useEffect(() => {
    setEditing(undefined);
    setError("");
    setMessage("");
    setSearch("");
    setAccountQuery("");
    setRightsFilter("");
    // The accounts page can be deep-linked: /accounts?account=<id>.
    setPerson(new URLSearchParams(window.location.search).get("account") || "");
  }, [tab]);
  useEffect(() => {
    const sync = () => {
      if (window.location.pathname.startsWith("/accounts")) {
        setPerson(
          new URLSearchParams(window.location.search).get("account") || "",
        );
        setAccountQuery("");
        setRightsFilter("");
      }
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(id: string) {
    setTab(id);
    setEditing(undefined);
    setError("");
    setMessage("");
    setSearch("");
  }
  // Settings sub-screens live under /settings/*; the sidebar "Settings"
  // entry owns the /settings prefix (usePortalRoute resolves it), so the
  // sub-tab is tracked separately and synced from the path.
  const resolveSettingsTab = (): SettingsSection =>
    window.location.pathname.startsWith("/settings/ai")
      ? "ai"
      : window.location.pathname.startsWith("/settings/drive")
        ? "drive"
        : "account";
  const [settingsTab, setSettingsTab] = useState<SettingsSection>(resolveSettingsTab);
  useEffect(() => {
    const sync = () => setSettingsTab(resolveSettingsTab());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  // Sidebar navigation pushes /settings before the tab flips — re-resolve.
  useEffect(() => {
    if (tab === "account") setSettingsTab(resolveSettingsTab());
  }, [tab]);
  function settingsNavigate(id: string) {
    const route = SETTINGS_TABS.find(t => t.id === id);
    if (!route) return navigate(id);
    if (window.location.pathname !== route.href)
      window.history.pushState(null, "", route.href);
    setSettingsTab(id as SettingsSection);
  }
  // Spotlight deep-links: open a page pointed at an exact record
  // (?candidate=, ?account=, or a person record under /hr/people/<id>/<tab>).
  // Pages read those params on mount and re-sync on popstate, so pushing the
  // URL suffices when switching pages; when already on the page, a synthetic
  // popstate makes it re-sync.
  function spotlightNavigate(id: string, params?: Record<string, string>) {
    if (!params) return navigate(id);
    const route = workspaceNav
      .flatMap((item) => (item.children ? item.children : [item]))
      .find((item) => item.id === id);
    if (!route) return navigate(id);
    const url = new URL(route.href, window.location.origin);
    const { person, application, employment, ...rest } = params;
    if (person) {
      // Person records route as paths, not query params: /hr/people/<id>[/tab].
      const tab = application ? 'applications' : employment ? 'employments' : '';
      url.pathname = `${route.href}/${person}${tab ? `/${tab}` : ''}`;
      if (application) url.searchParams.set('application', application);
      if (employment) url.searchParams.set('employment', employment);
    }
    for (const [key, value] of Object.entries(rest))
      url.searchParams.set(key, value);
    const target = url.pathname + url.search + url.hash;
    if (tab === id) {
      window.history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else {
      // Pass the full deep link so the section-href push doesn't clobber it.
      setTab(id, target);
    }
    setEditing(undefined);
    setError("");
    setMessage("");
    setSearch("");
    window.scrollTo(0, 0);
  }
  // HR person records link to the Sales project behind an assignment.
  function openProject(projectId: string) {
    const url = new URL("/sales/projects", window.location.origin);
    url.searchParams.set("project", projectId);
    window.history.pushState(null, "", url.pathname + url.search);
    if (tab === "sales-projects") window.dispatchEvent(new PopStateEvent("popstate"));
    else setTab("sales-projects");
    setEditing(undefined);
    setError("");
    setMessage("");
    window.scrollTo(0, 0);
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
      const application = hr?.applications.find(a => a.id === String(f.get("application")));
      if (!application) throw new Error("Choose the application this contract belongs to.");
      if (!hr?.accounts.some(a => a.profile_id === candidate && a.person_id === application.person_id)) {
        throw new Error("Link this portal account to the selected person in HR before sharing their contract.");
      }
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
          person_id: application.person_id,
          application_id: application.id,
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
    "sales-projects",
  ];
  const isSales = salesTabIds.includes(tab);
  const hrTabIds = [
    "hr",
    "hr-overview", "recruiting", "hr-people", "journeys",
    "jobs",
    "contracts",
  ];
  const isHr = hrTabIds.includes(tab);
  const isOps = tab === "operations";
  // One shared top menu on every page: the section name plus its screens
  // as tabs. Section landing routes resolve to their first screen
  // ("/sales" → Dashboard, "/hr" → Pipeline); single-screen pages show the
  // page name without tabs.
  const headerCurrent =
    tab === "sales" ? "sales-dashboard" : tab === "hr" ? "hr-overview" : tab;
  const headerLabel = isSales
    ? "Sales"
    : isHr
      ? "HR"
      : isOps
        ? "Operations"
        : (workspaceNav.find((item) => item.id === tab)?.label ??
          "Page");
  const headerTabs = isSales
    ? SALES_TABS
    : isHr
      ? HR_TABS
      : isOps
        ? OPS_TABS
        : tab === "account"
          ? SETTINGS_TABS
          : [];
  return (
    <Shell
      portal="Admin"
      email={email}
      nav={workspaceNav}
      current={tab}
      onNavigate={navigate}
      hideSubmenu
      hideTopbar
      sidebarAction={
        <button
          type="button"
          className="spotlight-trigger"
          onClick={() => setSpotlightOpen(true)}
          title="Search the workspace (⌘P)"
        >
          <Search size={16} />
          <span>Search</span>
          <kbd>⌘P</kbd>
        </button>
      }
    >
      <SpotlightSearch
        open={spotlightOpen}
        onOpenChange={setSpotlightOpen}
        onNavigate={spotlightNavigate}
        nav={workspaceNav}
        salesPeople={salesPeople}
        candidates={pipeline.map(a => ({ id: a.id, person_id: a.person_id, full_name: hrPeople.find(p => p.id === a.person_id)?.full_name || "Person", email: hrPeople.find(p => p.id === a.person_id)?.email || "", stage: a.stage }))}
        employees={(hr?.employees || []).map(e => ({ id: e.id, person_id: e.person_id, full_name: hrPeople.find(p => p.id === e.person_id)?.full_name || "Person", email: hrPeople.find(p => p.id === e.person_id)?.email || "", stage: e.status, status: e.status }))}
        opportunities={opportunities}
        jobs={jobs}
        contracts={contracts}
        requests={requests}
        projects={projects}
      />
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <SectionHeader
        label={headerLabel}
        tabs={headerTabs}
        current={tab === "account" ? settingsTab : headerCurrent}
        onNavigate={tab === "account" ? settingsNavigate : navigate}
      />
      {tab === "access" && isOwner && <AccessManager />}
      {["hr", "hr-overview", "recruiting", "hr-people", "journeys"].includes(tab) && (
        <HrWorkspace view={tab === "recruiting" ? "recruiting" : tab === "hr-people" ? "people" : tab === "journeys" ? "journeys" : "overview"} actorEmail={email} role={role} openProject={openProject} />
      )}
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
      {tab === "sales-projects" && <Projects actorEmail={email} />}
      {tab === "administration" && <AdminSettings />}
      {tab === "operations" && <OpsBoard actorEmail={email} />}
      {tab === "blogs" && <BlogManager />}
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
                  ? `${pipelineBreaches.length} waiting over 14 days`
                  : "No applications waiting over 14 days"
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
            <button className="btn lime" onClick={() => navigate("recruiting")}>
              Open recruiting
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
                      <h3>{stage.replaceAll("_", " ")}</h3>
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
              <div className="toolbar-right">
                <button className="btn" onClick={() => setEditing(null)}>
                  <Plus size={16} />
                  Create a job
                </button>
              </div>
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
            <div className="panel-head">
              <label className="form">
                Search accounts
                <input
                  type="search"
                  value={accountQuery}
                  onChange={(e) => {
                    setAccountQuery(e.target.value);
                    setPerson("");
                  }}
                  placeholder="Name or email…"
                />
              </label>
              <label className="form">
                Rights
                <select
                  value={rightsFilter}
                  onChange={(e) => setRightsFilter(e.target.value)}
                >
                  <option value="">All rights</option>
                  <option value="employee">Employee</option>
                  <option value="hr">HR</option>
                  <option value="sales">Sales</option>
                  <option value="admin">Admin</option>
                  <option value="candidate">Candidate</option>
                </select>
              </label>
            </div>
            <p className="muted small-text">
              Rights are assigned in the Access manager — this list is
              read-only.
            </p>
            {visibleAccounts.map((p) => (
              <div className="list-row" key={p.id}>
                <div>
                  <h3>{p.full_name || "New account"}</h3>
                  <p className="muted">{p.email}</p>
                </div>
                <div className="actions">
                  <Pill status={roleOf(p.id)} />
                  <span className="muted small-text">
                    Joined {formatDate(p.created_at)}
                  </span>
                </div>
              </div>
            ))}
            {visibleAccounts.length === 0 && (
              <Empty title="No accounts match">
                Try a different name, email, or rights type.
              </Empty>
            )}
          </section>
          <section className="panel">
            <h2>Onboarding documents</h2>
            {documents.filter((d) => docVisible(d.candidate_id)).length ? (
              documents
                .filter((d) => docVisible(d.candidate_id))
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
                  Portal account
                  <select name="candidate" required defaultValue={hr?.accounts.find(a => a.person_id === new URLSearchParams(window.location.search).get("person"))?.profile_id || ""} key={hr?.accounts.length}>
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
                  Recruitment application
                  <select name="application" required defaultValue={new URLSearchParams(window.location.search).get("application") || ""}>
                    <option value="" disabled>Select an application</option>
                    {(hr?.applications || []).filter(a => a.status === "active").map(a => (
                      <option key={a.id} value={a.id}>{hrPeople.find(p => p.id === a.person_id)?.full_name} · {hr?.opportunities.find(r => r.id === a.opportunity_id)?.title}</option>
                    ))}
                  </select>
                  <span className="muted">The portal account must be explicitly linked to this person.</span>
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
              const countersigned = hr?.countersignatures.find(s => s.contract_id === c.id);
              return (
                <div className="list-row" key={c.id}>
                  <div>
                    <h3>{c.title}</h3>
                    <p className="muted">
                      {name(c.candidate_id)} · {formatDate(c.created_at)}
                    </p>
                    <Pill status={signed && countersigned ? "signed" : "pending"} />
                    <p className="small-text muted">Employee: {signed ? "signed" : "awaiting signature"} · Employer: {countersigned ? "signed" : "awaiting signature"}</p>
                    {signed && (
                      <p className="small-text muted">
                        Signed by {signed.signer_name} on{" "}
                        {formatDate(signed.signed_at)}
                      </p>
                    )}
                  </div>
                  {!countersigned && c.application_id && (
                    <button className="btn small" disabled={busy} onClick={() => {
                      const signer = window.prompt("Employer signatory name. Confirming records your signature on this exact document.");
                      if (!signer) return;
                      void action(async () => { await executeCommand({ kind: "countersign_contract", contract_id: c.id, signer_name: signer }); }, "Employer signature recorded.");
                    }}>Countersign</button>
                  )}
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
        <SettingsPage section={settingsTab} isOwner={isOwner} email={email} />
      )}
      {loading && (
        <p className="muted" role="status">
          Refreshing workspace…
        </p>
      )}
    </Shell>
  );
}
