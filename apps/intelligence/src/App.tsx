import { useEffect, useMemo, useState } from "react";
import { useClerk } from "@clerk/react";
import { db } from "./workspaceAuth";
import {
  Activity, ArrowUpRight, Building2, CalendarDays, ChevronDown, CircleDollarSign,
  ContactRound, FileText, Filter, LayoutGrid, Lightbulb, Menu, Network, Plus, Search,
  PanelLeftClose, PanelLeftOpen, Pencil, Save, ShieldCheck, Sparkles, Target, Users, X,
} from "lucide-react";

type View = "overview" | "market" | "competitors" | "marketing" | "partners" | "executive" | "capabilities" | "accounts" | "events" | "leads" | "pipeline" | "doors";
type Capability = {
  id: string; name: string; short: string; color: string; people: number; projects: number;
  technologies: string[]; proof: string; experts: { initials: string; name: string; role: string }[];
};

const emptyCapabilities: Capability[] = [
  { id: "ai_for_business", name: "AI for Business", short: "AI", color: "blue", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "infrastructure_for_ai", name: "Infrastructure for AI", short: "Infra", color: "green", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "data_for_ai", name: "Data for AI", short: "Data", color: "orange", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "voice_ai", name: "Voice AI", short: "Voice", color: "violet", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
];

const accounts = [
  {
    id: "bnp-paribas", name: "BNP Paribas", sector: "Financial services", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "axa", name: "AXA", sector: "Insurance", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "kering", name: "Kering", sector: "Luxury", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "foundever", name: "Foundever", sector: "Customer experience", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "cdg-capital-morocco", name: "CDG Capital Morocco", sector: "Financial services", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
  },
];

type LeadSource = "Event" | "Tool" | "Network";
type LeadStage = "New" | "Qualified" | "Contacted" | "Converted";
type LeadRecord = { id: string; name: string; role: string; company: string; source: LeadSource; origin: string; score: number; reason: string; stage: LeadStage; owner: string };
type ImportedAttendee = { name: string; role: string; company: string; linkedin: string; email: string; sourceRow: Record<string, string> };
type MappedField = "name" | "firstName" | "lastName" | "linkedin" | "email" | "phone" | "company" | "role";
type ColumnMapping = Partial<Record<MappedField, string>>;
type EventAnalysis = {
  analyzedAt: string;
  rows: number;
  linkedin: number;
  workEmails: number;
  personalEmails: number;
  phones: number;
  namedPeople: number;
  companies: { label: string; count: number }[];
  seniorRoles: number;
  customFields: { label: string; populated: number; examples: string[] }[];
};
type EventRecord = {
  id: string; title: string; date: string; location: string; lumaUrl: string; attendees: number; qualified: number;
  status: "Awaiting upload" | "Ready to analyze" | "Analyzed"; fileName?: string; attendeeData?: ImportedAttendee[];
  headers?: string[]; columnMapping?: ColumnMapping; analysisFields?: string[]; analysis?: EventAnalysis;
};

const initialLeads: LeadRecord[] = [];

const initialEvents: EventRecord[] = [
  { id: "quicksort-multimodal-ai", title: "Multimodal AI in Production (w/ The AI Collective)", date: "01 Oct 2026", location: "Paris", lumaUrl: "https://luma.com/quicksort-multimodal-ai", attendees: 0, qualified: 0, status: "Awaiting upload" },
  { id: "ccparis", title: "Cafe Compute Meetup: Paris", date: "02 Oct 2026", location: "Paris", lumaUrl: "https://luma.com/ccparis", attendees: 0, qualified: 0, status: "Awaiting upload" },
];

const mappedFieldOptions: { id: MappedField; label: string; hint: string }[] = [
  { id: "name", label: "Full name", hint: "A single full-name column" },
  { id: "firstName", label: "First name", hint: "Used with last name when full name is absent" },
  { id: "lastName", label: "Last name", hint: "Used with first name when full name is absent" },
  { id: "linkedin", label: "LinkedIn", hint: "Profile URL or LinkedIn identifier" },
  { id: "email", label: "Primary email", hint: "Classified as work or personal" },
  { id: "phone", label: "Phone", hint: "Optional phone or mobile number" },
  { id: "company", label: "Company", hint: "Current employer or organisation" },
  { id: "role", label: "Job title", hint: "Current role or position" },
];

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const headerMatches = (header: string, exact: string[], includes: string[]) => {
  const normalized = normalizeHeader(header);
  return exact.includes(normalized) || includes.some((needle) => normalized.includes(needle));
};
const guessColumnMapping = (headers: string[]): ColumnMapping => {
  const find = (exact: string[], includes: string[] = []) => headers.find((header) => headerMatches(header, exact, includes));
  return {
    name: find(["name", "fullname", "attendeename", "guestname"]),
    firstName: find(["firstname", "givenname"]),
    lastName: find(["lastname", "surname", "familyname"]),
    linkedin: find(["linkedin", "linkedinurl", "linkedinprofile", "profileurl"], ["linkedin"]),
    email: find(["email", "emailaddress", "primaryemail"]),
    phone: find(["phone", "phonenumber", "mobile", "mobilenumber"], ["phonenumber", "mobilephone"]),
    company: find(["company", "companyname", "organisation", "organization", "employer"], ["companydoyouwork", "currentcompany", "employer"]),
    role: find(["jobtitle", "role", "position", "currentrole"], ["jobtitle", "currentrole", "position"]),
  };
};
const eventRows = (event: EventRecord) => event.attendeeData?.map((attendee) => attendee.sourceRow) ?? [];
const eventHeaders = (event: EventRecord) => event.headers?.length ? event.headers : Object.keys(eventRows(event)[0] ?? {});
const eventMapping = (event: EventRecord) => ({ ...guessColumnMapping(eventHeaders(event)), ...event.columnMapping });
const mapAttendee = (sourceRow: Record<string, string>, mapping: ColumnMapping): ImportedAttendee => {
  const read = (field: MappedField) => mapping[field] ? String(sourceRow[mapping[field]!] ?? "").trim() : "";
  const fullName = read("name") || [read("firstName"), read("lastName")].filter(Boolean).join(" ");
  return { name: fullName, role: read("role"), company: read("company"), linkedin: read("linkedin"), email: read("email"), sourceRow };
};
const personalEmailDomains = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr", "outlook.com", "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "gmx.fr", "orange.fr", "free.fr", "laposte.net"]);
const emailKind = (value: string) => {
  const domain = value.trim().toLowerCase().split("@")[1];
  if (!domain) return "missing";
  return personalEmailDomains.has(domain) ? "personal" : "work";
};

type IntelligenceWorkspace = { title: string; description: string; outcome: string; focus: string[]; sources: string[]; icon: React.ElementType };
const intelligenceWorkspaces: Record<"market" | "competitors" | "marketing" | "partners" | "executive", IntelligenceWorkspace> = {
  market: { title: "Market intelligence", description: "Understand market size, priority segments, and the companies showing real growth signals.", outcome: "A ranked market map built from verified signals.", focus: ["Market size", "Segment mapping", "Growing companies", "Hiring and funding", "Technology adoption", "Geographic expansion"], sources: ["Company data", "Funding signals", "Hiring activity", "Market research"], icon: Activity },
  competitors: { title: "Competitor analysis", description: "Track the companies you compete with and see how their search, advertising, authority, and messaging change.", outcome: "A focused competitor brief with the changes that matter.", focus: ["Competitor keywords", "Keyword volume and ideas", "Domain and ad history", "Live search results", "Rank tracking", "Backlinks and authority", "Competitor creative", "Messaging changes"], sources: ["Search data", "Ad libraries", "Domain history", "Backlink data"], icon: Search },
  marketing: { title: "Marketing intelligence", description: "Bring acquisition and audience signals together without mixing them into unrelated workflows.", outcome: "A clear performance view across marketing channels.", focus: ["Search demand", "Search Console", "GA4 performance", "Advertising results", "Creator performance", "Social trends"], sources: ["GA4", "Search Console", "Advertising platforms", "Social channels"], icon: CircleDollarSign },
  partners: { title: "Strategic partners", description: "Find and qualify partners that can expand distribution, delivery, and market access.", outcome: "A ranked strategic partner pipeline with fit evidence.", focus: ["Agency partners", "Creators and affiliates", "Integration partners", "Complementary products", "Partner fit", "Introduction paths"], sources: ["Company profiles", "Partner networks", "Audience overlap", "Relationship data"], icon: Network },
  executive: { title: "Executive intelligence", description: "Summarise the signals leadership needs to make weekly commercial decisions.", outcome: "A decision-ready executive brief based on live workspace data.", focus: ["Pipeline movement", "Competitor changes", "Market signals", "Campaign performance", "Customer risks", "Strategic opportunities"], sources: ["Pipeline", "Accounts", "Market signals", "Marketing performance"], icon: FileText },
};

const nav = [
  { id: "overview" as View, path: "/", label: "Overview", sidebarLabel: "Overview", icon: LayoutGrid },
  { id: "capabilities" as View, path: "/capabilities", label: "Capabilities", sidebarLabel: "Capabilities", icon: Sparkles },
  { id: "accounts" as View, path: "/accounts", label: "Accounts", sidebarLabel: "Accounts", icon: Building2 },
  { id: "events" as View, path: "/events", label: "Events", sidebarLabel: "Events", icon: CalendarDays },
  { id: "leads" as View, path: "/leads", label: "Leads", sidebarLabel: "Leads", icon: Users },
  { id: "market" as View, path: "/market-intelligence", label: "Market intelligence", sidebarLabel: "Market", icon: Activity },
  { id: "competitors" as View, path: "/competitor-analysis", label: "Competitor analysis", sidebarLabel: "Competitors", icon: Search },
  { id: "marketing" as View, path: "/marketing-intelligence", label: "Marketing intelligence", sidebarLabel: "Marketing", icon: CircleDollarSign },
  { id: "partners" as View, path: "/strategic-partners", label: "Strategic partners", sidebarLabel: "Strategic partners", icon: Network },
  { id: "executive" as View, path: "/executive-intelligence", label: "Executive intelligence", sidebarLabel: "Executive", icon: FileText },
  { id: "pipeline" as View, path: "/pipeline", label: "Pipeline", sidebarLabel: "Pipeline", icon: Target },
  { id: "doors" as View, path: "/open-doors", label: "Open doors", sidebarLabel: "Open doors", icon: ContactRound },
];

const accountSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function routeFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/accounts/")) {
    const slug = decodeURIComponent(path.slice("/accounts/".length));
    return { view: "accounts" as View, account: accounts.find((item) => item.id === slug || accountSlug(item.name) === slug)?.id ?? null };
  }
  const item = nav.find((entry) => entry.path === path);
  return { view: item?.id ?? "overview", account: null };
}

export default function App({ email = "" }: { email?: string }) {
  const clerk = useClerk();
  const initialRoute = useMemo(routeFromLocation, []);
  const storedWorkspace = useMemo(() => {
    try {
      const saved = window.localStorage.getItem("quicksort-intelligence-accounts-v3");
      return saved ? JSON.parse(saved) as { accounts: Account[]; intel: Record<string, AccountIntel> } : null;
    } catch { return null; }
  }, []);
  const [view, setView] = useState<View>(initialRoute.view);
  const [selected, setSelected] = useState("ai_for_business");
  const [capabilities, setCapabilities] = useState<Capability[]>(emptyCapabilities);
  const [query, setQuery] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(initialRoute.account);
  const [accountRecords, setAccountRecords] = useState<Account[]>(storedWorkspace?.accounts ?? accounts);
  const [intelRecords, setIntelRecords] = useState<Record<string, AccountIntel>>(storedWorkspace?.intel ?? emptyAccountIntel);
  const [leadRecords, setLeadRecords] = useState<LeadRecord[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("quicksort-intelligence-leads-v4") || "null") ?? initialLeads; } catch { return initialLeads; }
  });
  const [eventRecords, setEventRecords] = useState<EventRecord[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("quicksort-intelligence-events-v4") || "null") ?? initialEvents; } catch { return initialEvents; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("quicksort-intelligence-sidebar") === "collapsed"; }
    catch { return false; }
  });
  const [toast, setToast] = useState("");
  const active = capabilities.find((c) => c.id === selected) ?? capabilities[0] ?? emptyCapabilities[0];
  const filteredAccounts = useMemo(() => accountRecords.filter((a) => `${a.name} ${a.sector} ${a.opportunity}`.toLowerCase().includes(query.toLowerCase())), [accountRecords, query]);
  useEffect(() => {
    const syncRoute = () => {
      const route = routeFromLocation();
      setView(route.view);
      setSelectedAccount(route.account);
      setQuery("");
      setMobileOpen(false);
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);
  useEffect(() => {
    let activeRequest = true;
    void db().rpc("get_business_capabilities").then(({ data, error }) => {
      if (!activeRequest || error || !Array.isArray(data)) return;
      const mapped = data.map((item: Record<string, unknown>) => ({
        id: String(item.id), name: String(item.name), short: String(item.short), color: String(item.color),
        people: Number(item.people) || 0, projects: Number(item.projects) || 0,
        technologies: Array.isArray(item.technologies) ? item.technologies.map(String) : [],
        proof: Number(item.projects) > 0 || Number(item.people) > 0 ? String(item.description) : "No approved candidate evidence yet",
        experts: Array.isArray(item.experts) ? item.experts.map((expert) => {
          const record = expert as Record<string, unknown>;
          const name = String(record.name || "Candidate");
          return { initials: name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(), name, role: String(record.role || "QuickSort candidate") };
        }) : [],
      }));
      setCapabilities(mapped);
    });
    return () => { activeRequest = false; };
  }, []);
  useEffect(() => {
    const label = accountRecords.find((account) => account.id === selectedAccount)?.name ?? nav.find((item) => item.id === view)?.label ?? "Overview";
    document.title = `${label} · QuickSort Intelligence`;
  }, [view, selectedAccount, accountRecords]);
  const navigate = (next: View, account: string | null = null) => {
    const path = account ? `/accounts/${account}` : nav.find((item) => item.id === next)?.path ?? "/";
    window.history.pushState({}, "", path);
    setView(next);
    setSelectedAccount(account);
    setMobileOpen(false);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const go = (next: View) => navigate(next);
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem("quicksort-intelligence-sidebar", next ? "collapsed" : "open"); } catch { /* The control still works without persistence. */ }
  };
  const saveAccount = (updatedAccount: Account, updatedIntel: AccountIntel) => {
    const nextAccounts = accountRecords.map((account) => account.id === updatedAccount.id ? updatedAccount : account);
    const nextIntel = { ...intelRecords, [updatedAccount.id]: updatedIntel };
    setAccountRecords(nextAccounts);
    setIntelRecords(nextIntel);
    window.localStorage.setItem("quicksort-intelligence-accounts-v3", JSON.stringify({ accounts: nextAccounts, intel: nextIntel }));
    notify("Account changes saved");
  };
  const saveLeads = (next: LeadRecord[]) => { setLeadRecords(next); window.localStorage.setItem("quicksort-intelligence-leads-v4", JSON.stringify(next)); };
  const saveEvents = (next: EventRecord[]) => {
    setEventRecords(next);
    try { window.localStorage.setItem("quicksort-intelligence-events-v4", JSON.stringify(next)); }
    catch { notify("File loaded for this session, but it is too large for browser storage"); }
  };
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-header">
          <a className="brand" href="https://www.quicksort.fr" aria-label="Quicksort home">
            <span className="brand-word">Quicksort</span>
            <span className="brand-symbol" aria-hidden="true"><span className="brand-disc"/><span className="brand-cut"/><span className="brand-dot"/></span>
          </a>
          <button className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? <PanelLeftOpen size={15}/> : <PanelLeftClose size={15}/>}</button>
        </div>
        <div className="portal-label">Business workspace</div>
        <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20}/></button>
        <nav aria-label="Primary navigation">
          {nav.map(({ id, path, sidebarLabel, icon: Icon }) => <a key={id} href={path} title={sidebarCollapsed ? sidebarLabel : undefined} className={view === id ? "active" : ""} onClick={(event) => { event.preventDefault(); go(id); }}><Icon size={18}/><span className="nav-label">{sidebarLabel}</span></a>)}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={22}/>
          <p>Your Quicksort workspace.<br/>Connected, from day one.</p>
          <button onClick={() => clerk.signOut()} title="Sign out"><span className="profile-dot">{email ? email.slice(0, 2).toUpperCase() : "QS"}</span><span>{email || "QuickSort admin"}</span><ChevronDown size={15}/></button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button>
          <div className="breadcrumbs">Intelligence <span>/</span> {nav.find((item) => item.id === view)?.label}</div>
          <div className="top-actions"><button className="icon-button" aria-label="Search"><Search size={18}/></button><button className="primary" onClick={() => notify("New record ready to configure")}><Plus size={17}/> Add record</button></div>
        </header>
        {view === "overview" && <Overview active={active} capabilities={capabilities} selected={selected} setSelected={setSelected} go={go} notify={notify} accounts={accountRecords} leads={leadRecords} events={eventRecords}/>}
        {(["market", "competitors", "marketing", "partners", "executive"] as const).includes(view as keyof typeof intelligenceWorkspaces) && <IntelligencePage workspace={intelligenceWorkspaces[view as keyof typeof intelligenceWorkspaces]} notify={notify}/>}
        {view === "capabilities" && <Capabilities active={active} capabilities={capabilities} selected={selected} setSelected={setSelected}/>}
        {view === "accounts" && (selectedAccount
          ? <AccountDetail account={accountRecords.find((account) => account.id === selectedAccount)!} intel={intelRecords[selectedAccount]} onSave={saveAccount} onBack={() => navigate("accounts")} notify={notify}/>
          : <Accounts query={query} setQuery={setQuery} accounts={filteredAccounts} openAccount={(id) => navigate("accounts", id)} notify={notify}/>)} 
        {view === "events" && <Events events={eventRecords} onChange={saveEvents} notify={notify}/>}
        {view === "leads" && <Leads leads={leadRecords} onChange={saveLeads} notify={notify}/>}
        {view === "pipeline" && <Pipeline notify={notify}/>} 
        {view === "doors" && <OpenDoors notify={notify}/>}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation"/>}
    </div>
  );
}

function PageIntro({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}

function Overview({ active, capabilities, selected, setSelected, go, notify, accounts, leads, events }: { active: Capability; capabilities: Capability[]; selected: string; setSelected: (id: string) => void; go: (v: View) => void; notify: (m: string) => void; accounts: Account[]; leads: LeadRecord[]; events: EventRecord[] }) {
  const attendees = events.reduce((total, event) => total + event.attendees, 0);
  const opportunities = accounts.filter((account) => account.opportunity !== "Not set").length;
  return <div className="page">
    <PageIntro title="Company intelligence, connected." text="Only verified records and uploaded source data appear in this workspace." action={<button className="quiet-action" onClick={() => notify("Workspace data is current")}><Activity size={16}/> Current</button>}/>
    <section className="metrics-grid" aria-label="Portfolio metrics">
      <Metric label="Accounts" value={String(accounts.length)} change="Added to this workspace" icon={Building2}/>
      <Metric label="Active opportunities" value={String(opportunities)} change="Based on account records" icon={Target}/>
      <Metric label="Leads" value={String(leads.length)} change="Across all lead sources" icon={Users}/>
      <Metric label="Uploaded attendees" value={String(attendees)} change="From event spreadsheets" icon={CalendarDays}/>
    </section>
    <div className="overview-grid">
      <section className="surface capability-surface">
        <div className="section-head"><div><h2>Capability constellation</h2><p>Experience aggregated from delivered work</p></div><button onClick={() => go("capabilities")}>Explore portfolio <ArrowUpRight size={15}/></button></div>
        <CapabilityGraph capabilities={capabilities} selected={selected} setSelected={setSelected}/>
        <CapabilityDetail capability={active}/>
      </section>
      <section className="surface match-surface empty-workspace">
        <div className="match-kicker"><Lightbulb size={17}/> Next best match</div>
        <h2>No recommendation yet</h2>
        <p className="match-title">Add real contacts, evidence and opportunities to generate account recommendations.</p>
        <div className="data-empty">Recommendations stay empty until verified workspace data is available.</div>
        <button className="primary wide" onClick={() => go("accounts")}>Open account intelligence</button>
      </section>
    </div>
    <section className="surface momentum">
      <div className="section-head"><div><h2>Commercial momentum</h2><p>What needs attention across the pipeline</p></div><button onClick={() => go("pipeline")}>Open pipeline <ArrowUpRight size={15}/></button></div>
      <div className="data-empty">No commercial activity has been recorded yet.</div>
    </section>
  </div>;
}

function IntelligencePage({ workspace, notify }: { workspace: IntelligenceWorkspace; notify: (message: string) => void }) {
  const WorkspaceIcon = workspace.icon;
  return <div className="page intelligence-workspace-page">
    <PageIntro title={workspace.title} text={workspace.description} action={<button className="primary" onClick={() => notify(`${workspace.title} brief ready to configure`)}><Plus size={16}/> New brief</button>}/>
    <section className="intelligence-workspace-hero">
      <span><WorkspaceIcon size={24}/></span>
      <div><small>Primary output</small><h2>{workspace.outcome}</h2></div>
    </section>
    <div className="intelligence-workspace-grid">
      <section className="surface intelligence-focus-panel">
        <div className="section-head"><div><h2>What to analyse</h2><p>Keep each brief focused on the signals you need.</p></div></div>
        <div className="intelligence-focus-grid">{workspace.focus.map((item) => <button key={item} onClick={() => notify(`${item} selected for the brief`)}><span>{item}</span><Plus size={14}/></button>)}</div>
      </section>
      <aside className="surface intelligence-source-panel">
        <h2>Data sources</h2><p>Add sources only when the brief needs them.</p>
        <div>{workspace.sources.map((source) => <span key={source}>{source}</span>)}</div>
        <button className="secondary wide" onClick={() => notify("Data source connection ready to configure")}>Connect a source</button>
      </aside>
    </div>
    <section className="surface intelligence-empty-state"><WorkspaceIcon size={22}/><div><h2>No briefs yet</h2><p>Create the first {workspace.title.toLowerCase()} brief when you have a real question and source data.</p></div></section>
  </div>;
}

function Metric({ label, value, change, icon: Icon }: { label: string; value: string; change: string; icon: React.ElementType }) {
  return <div className="metric"><div className="metric-label"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><p>{change}</p></div>;
}

function CapabilityGraph({ capabilities, selected, setSelected }: { capabilities: Capability[]; selected: string; setSelected: (id: string) => void }) {
  return <div className="graph" aria-label="Interactive capability graph">
    <svg viewBox="0 0 720 250" preserveAspectRatio="none" aria-hidden="true"><path d="M360 74 C300 88 182 89 118 152 M360 74 C340 112 295 112 273 154 M360 74 C388 110 427 112 447 154 M360 74 C430 86 552 89 608 152"/><path className="pulse-line" d="M360 74 C300 88 182 89 118 152"/></svg>
    <div className="hub"><span className="hub-logo">QS</span><div><strong>QuickSort</strong><small>No evidence added</small></div></div>
    {capabilities.map((cap, index) => <button key={cap.id} className={`graph-node n${index + 1} ${cap.color} ${selected === cap.id ? "selected" : ""}`} onClick={() => setSelected(cap.id)}><span>{cap.short}</span><small>{cap.people} people</small></button>)}
  </div>;
}

function CapabilityDetail({ capability }: { capability: Capability }) {
  return <div className="capability-detail"><div><span className={`dot ${capability.color}`}/><div><strong>{capability.name}</strong><p>{capability.proof}</p></div></div><div className="tech-list">{capability.technologies.length ? capability.technologies.map((tech) => <span key={tech}>{tech}</span>) : <small>No technology evidence added.</small>}</div><div className="avatars">{capability.experts.length ? capability.experts.map((expert) => <span key={expert.initials} title={expert.name}>{expert.initials}</span>) : <small>No people evidence added.</small>}</div></div>;
}

function Capabilities({ active, capabilities, selected, setSelected }: { active: Capability; capabilities: Capability[]; selected: string; setSelected: (id: string) => void }) {
  return <div className="page"><PageIntro title="Delivery capability portfolio" text="Every claim is backed by people, deliverables and production experience." action={<button className="secondary"><Filter size={16}/> Filter evidence</button>}/>
    <div className="capabilities-layout"><section className="surface cap-map"><div className="section-head"><div><h2>QuickSort capability map</h2><p>Approved candidate skills and delivered project evidence</p></div></div><CapabilityGraph capabilities={capabilities} selected={selected} setSelected={setSelected}/><div className="cap-grid">{capabilities.map((cap) => <button key={cap.id} className={selected === cap.id ? "cap-card active" : "cap-card"} onClick={() => setSelected(cap.id)}><span className={`dot ${cap.color}`}/><strong>{cap.name}</strong><small>{cap.projects} projects · {cap.people} people</small></button>)}</div></section>
      <aside className="surface evidence-panel"><span className={`domain-badge ${active.color}`}>{active.short}</span><h2>{active.name}</h2><p>{active.proof}</p><div className="evidence-stat"><strong>{active.projects}</strong><span>client projects</span><strong>{active.people}</strong><span>experienced people</span></div><h3>Core stack</h3><div className="tech-list">{active.technologies.length ? active.technologies.map((tech) => <span key={tech}>{tech}</span>) : <small>No technology evidence added.</small>}</div><h3>People with evidence</h3>{active.experts.length ? active.experts.map((expert) => <div className="expert" key={expert.initials}><span>{expert.initials}</span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><ArrowUpRight size={15}/></div>) : <div className="data-empty">No people evidence added.</div>}<button className="primary wide">Open capability dossier</button></aside>
    </div>
  </div>;
}

type CaseStudy = { title: string; client: string; summary: string; outcome: string; evidence: string; tags: string[] };
type Account = { id: string; name: string; sector: string; contacts: number; signal: string; opportunity: string; value: string; stage: string; owner: string; fit: string[]; caseStudies: CaseStudy[]; opportunitySummary?: string; fitScore?: string; evidence?: string[] };
type Lead = { name: string; role: string; company: string; status: string; nextStep: string; owner: string };
type AccountEvent = { date: string; month: string; title: string; type: string; detail: string };
type RelationshipContact = { name: string; role: string; strength: string; owner: string };
type AccountIntel = { leads: Lead[]; events: AccountEvent[]; contacts: RelationshipContact[] };

const emptyAccountIntel = Object.fromEntries(accounts.map((account) => [account.id, { contacts: [], leads: [], events: [] }])) as Record<string, AccountIntel>;

function Accounts({ query, setQuery, accounts, openAccount, notify }: { query: string; setQuery: (s: string) => void; accounts: Account[]; openAccount: (id: string) => void; notify: (m: string) => void }) {
  return <div className="page"><PageIntro title="Account intelligence" text="See who matters, who knows them and where the opportunity sits." action={<button className="primary" onClick={() => notify("New account ready to configure")}><Plus size={16}/> Add account</button>}/>
    <div className="toolbar"><label><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies or opportunities"/></label><button className="secondary"><Filter size={16}/> Filters</button><span>{accounts.length} accounts</span></div>
    <div className="account-list">{accounts.map((account) => <article className="account-card" key={account.id}><div className="account-monogram">{account.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div><div className="account-title"><h2>{account.name}</h2><p>{account.sector} · {account.contacts} mapped contacts</p></div><div className={`signal ${account.signal.toLowerCase()}`}><i/>{account.signal} relationship</div><div className="account-opportunity"><span>{account.opportunity}</span><strong>{account.value}</strong></div><div className="fit-tags">{account.fit.map((f) => <span key={f}>{f}</span>)}</div><div className="account-owner"><span>{account.owner}</span><div><small>Owner</small><strong>{account.stage}</strong></div></div><button className="open-card" onClick={() => openAccount(account.id)} aria-label={`Open ${account.name}`}><ArrowUpRight size={18}/></button></article>)}</div>
  </div>;
}

function EditField({ editing, value, onChange, label, multiline = false }: { editing: boolean; value: string | number; onChange: (value: string) => void; label: string; multiline?: boolean }) {
  if (!editing) return <span className="editable-value">{value}</span>;
  return multiline
    ? <textarea className="inline-edit textarea" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}/>
    : <input className="inline-edit" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}/>;
}

function AccountDetail({ account, intel, onSave, onBack, notify }: { account: Account; intel: AccountIntel; onSave: (account: Account, intel: AccountIntel) => void; onBack: () => void; notify: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account);
  const [draftIntel, setDraftIntel] = useState(intel);
  useEffect(() => { setDraft(account); setDraftIntel(intel); setEditing(false); }, [account, intel]);
  const patchAccount = (patch: Partial<Account>) => setDraft((current) => ({ ...current, ...patch }));
  const patchIntelItem = <K extends "contacts" | "leads" | "events">(group: K, index: number, patch: Partial<AccountIntel[K][number]>) => {
    setDraftIntel((current) => ({ ...current, [group]: current[group].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  };
  const beginEditing = () => { if (!editing) setEditing(true); };
  const cancelEditing = () => { setDraft(account); setDraftIntel(intel); setEditing(false); };
  const saveEditing = () => { onSave(draft, draftIntel); setEditing(false); };
  const summary = draft.opportunitySummary ?? "";
  const evidence = draft.evidence ?? [];

  return <div className={`page account-detail-page ${editing ? "edit-mode" : ""}`}>
    <div className="account-page-actions">
      <button className="back-link" onClick={onBack}>‹ All accounts</button>
      <div>{editing ? <><button className="secondary" onClick={cancelEditing}><X size={15}/> Cancel</button><button className="primary" onClick={saveEditing}><Save size={15}/> Save changes</button></> : <button className="secondary" onClick={() => setEditing(true)}><Pencil size={15}/> Edit account</button>}</div>
    </div>
    <div className="page-intro editable-block" onClick={beginEditing}>
      <div><h1><EditField editing={editing} value={draft.name} label="Account name" onChange={(name) => patchAccount({ name })}/></h1>
        <div className="account-subtitle"><EditField editing={editing} value={draft.sector} label="Sector" onChange={(sector) => patchAccount({ sector })}/><span>·</span><EditField editing={editing} value={draft.contacts} label="Mapped contacts" onChange={(contacts) => patchAccount({ contacts: Number(contacts) || 0 })}/><span>mapped contacts ·</span><EditField editing={editing} value={draft.signal} label="Relationship strength" onChange={(signal) => patchAccount({ signal })}/><span>relationship</span></div>
      </div>
      {!editing && <span className="edit-hint"><Pencil size={13}/> Click content to edit</span>}
    </div>
    <section className="account-brief editable-block" onClick={beginEditing}>
      <div><span>Active opportunity</span><strong><EditField editing={editing} value={draft.opportunity} label="Active opportunity" onChange={(opportunity) => patchAccount({ opportunity })}/></strong></div>
      <div><span>Estimated value</span><strong><EditField editing={editing} value={draft.value} label="Estimated value" onChange={(value) => patchAccount({ value })}/></strong></div>
      <div><span>Current stage</span><strong><EditField editing={editing} value={draft.stage} label="Current stage" onChange={(stage) => patchAccount({ stage })}/></strong></div>
      <div><span>QuickSort owner</span><strong><EditField editing={editing} value={draft.owner} label="QuickSort owner" onChange={(owner) => patchAccount({ owner })}/></strong></div>
    </section>
    <div className="account-detail-grid">
      <section className="surface org-surface editable-block" onClick={beginEditing}>
        <div className="section-head"><div><h2>Relationship map</h2><p>Decision makers and the shortest trusted path</p></div><span className="legend"><i/> Active relationship</span></div>
        <div className="org-chart">
          <div className="org-root"><span>{draft.name.split(" ").map((part) => part[0]).join("").slice(0,2)}</span><strong>{draft.name}</strong></div>
          <div className="org-line"/>
          <div className="org-contacts">{draftIntel.contacts.length ? draftIntel.contacts.map((contact, index) => <div className="org-contact" key={index}><span>{contact.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><strong><EditField editing={editing} value={contact.name} label={`Contact ${index + 1} name`} onChange={(name) => patchIntelItem("contacts", index, { name })}/></strong><small><EditField editing={editing} value={contact.role} label={`Contact ${index + 1} role`} onChange={(role) => patchIntelItem("contacts", index, { role })}/></small><em><i/> <EditField editing={editing} value={contact.strength} label={`Contact ${index + 1} strength`} onChange={(strength) => patchIntelItem("contacts", index, { strength })}/> · owner <EditField editing={editing} value={contact.owner} label={`Contact ${index + 1} owner`} onChange={(owner) => patchIntelItem("contacts", index, { owner })}/></em></div>) : <div className="data-empty">No contacts added.</div>}</div>
        </div>
      </section>
      <aside className="surface opportunity-panel editable-block" onClick={beginEditing}>
        <span className="panel-label">Opportunity</span>
        <h2><EditField editing={editing} value={draft.opportunity} label="Opportunity name" onChange={(opportunity) => patchAccount({ opportunity })}/></h2>
        <p>{editing || summary ? <EditField editing={editing} multiline value={summary} label="Opportunity summary" onChange={(opportunitySummary) => patchAccount({ opportunitySummary })}/> : "No opportunity details added."}</p>
        <div className="opportunity-score"><strong><EditField editing={editing} value={draft.fitScore ?? "—"} label="Capability fit" onChange={(fitScore) => patchAccount({ fitScore })}/></strong><span>capability fit</span></div>
        <h3>Recommended capabilities</h3>
        {editing ? <input className="inline-edit" aria-label="Recommended capabilities" value={draft.fit.join(", ")} onChange={(event) => patchAccount({ fit: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}/> : draft.fit.length ? <div className="fit-tags">{draft.fit.map((fit) => <span key={fit}>{fit}</span>)}</div> : <div className="data-empty">No capability matches added.</div>}
        <h3>Evidence ready</h3>
        {editing ? <textarea className="inline-edit textarea" aria-label="Evidence ready" value={evidence.join("\n")} onChange={(event) => patchAccount({ evidence: event.target.value.split("\n").filter(Boolean) })}/> : evidence.length ? <ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="data-empty">No evidence added.</div>}
      </aside>
    </div>
    <section className="surface case-studies-section editable-block" onClick={beginEditing}>
      <div className="section-head"><div><h2>Relevant case studies</h2><p>Delivery evidence selected for {draft.name}</p></div><span className="case-count">{draft.caseStudies.length} ready to use</span></div>
      {draft.caseStudies.length ? <div className="case-study-grid">{draft.caseStudies.map((study, index) => <article className="case-study-card" key={index}>
        <div className="case-study-top"><span><FileText size={16}/><EditField editing={editing} value={study.evidence} label={`Case study ${index + 1} evidence`} onChange={(evidence) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, evidence } : item) })}/></span>{!editing && <Pencil size={15}/>}</div>
        <div><small><EditField editing={editing} value={study.client} label={`Case study ${index + 1} client`} onChange={(client) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, client } : item) })}/></small><h3><EditField editing={editing} value={study.title} label={`Case study ${index + 1} title`} onChange={(title) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item) })}/></h3><p><EditField editing={editing} multiline value={study.summary} label={`Case study ${index + 1} summary`} onChange={(summary) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, summary } : item) })}/></p></div>
        <div className="case-study-outcome"><span>Proven outcome</span><strong><EditField editing={editing} value={study.outcome} label={`Case study ${index + 1} outcome`} onChange={(outcome) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, outcome } : item) })}/></strong></div>
        {editing ? <input className="inline-edit" aria-label={`Case study ${index + 1} tags`} value={study.tags.join(", ")} onChange={(event) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) } : item) })}/> : <div className="fit-tags">{study.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </article>)}</div> : <div className="data-empty">No case studies added.</div>}
    </section>
    <div className="account-intel-grid">
      <section className="surface leads-section editable-block" onClick={beginEditing}>
        <div className="section-head"><div><h2>Leads</h2><p>People moving this account forward</p></div><span className="case-count">{draftIntel.leads.length} active</span></div>
        {draftIntel.leads.length ? <div className="lead-list">{draftIntel.leads.map((lead, index) => <div className="lead-row" key={index}>
          <span className="lead-avatar">{lead.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
          <span className="lead-person"><strong><EditField editing={editing} value={lead.name} label={`Lead ${index + 1} name`} onChange={(name) => patchIntelItem("leads", index, { name })}/></strong><small><EditField editing={editing} value={lead.role} label={`Lead ${index + 1} role`} onChange={(role) => patchIntelItem("leads", index, { role })}/></small></span>
          <span className={`lead-status ${lead.status.toLowerCase()}`}><EditField editing={editing} value={lead.status} label={`Lead ${index + 1} status`} onChange={(status) => patchIntelItem("leads", index, { status })}/></span>
          <span className="lead-next"><small>Next step</small><strong><EditField editing={editing} value={lead.nextStep} label={`Lead ${index + 1} next step`} onChange={(nextStep) => patchIntelItem("leads", index, { nextStep })}/></strong></span>
          <span className="lead-owner"><EditField editing={editing} value={lead.owner} label={`Lead ${index + 1} owner`} onChange={(owner) => patchIntelItem("leads", index, { owner })}/></span>
        </div>)}</div> : <div className="data-empty">No leads added.</div>}
      </section>
      <section className="surface events-section editable-block" onClick={beginEditing}>
        <div className="section-head"><div><h2>Events</h2><p>Key moments around this account</p></div><CalendarDays size={18}/></div>
        {draftIntel.events.length ? <div className="event-list">{draftIntel.events.map((event, index) => <div className="event-row" key={index}>
          <span className="event-date"><strong><EditField editing={editing} value={event.date} label={`Event ${index + 1} day`} onChange={(date) => patchIntelItem("events", index, { date })}/></strong><small><EditField editing={editing} value={event.month} label={`Event ${index + 1} month`} onChange={(month) => patchIntelItem("events", index, { month })}/></small></span>
          <span className="event-info"><small><EditField editing={editing} value={event.type} label={`Event ${index + 1} type`} onChange={(type) => patchIntelItem("events", index, { type })}/></small><strong><EditField editing={editing} value={event.title} label={`Event ${index + 1} title`} onChange={(title) => patchIntelItem("events", index, { title })}/></strong><em><EditField editing={editing} value={event.detail} label={`Event ${index + 1} details`} onChange={(detail) => patchIntelItem("events", index, { detail })}/></em></span>
          {!editing && <Pencil size={14}/>} 
        </div>)}</div> : <div className="data-empty">No account events added.</div>}
      </section>
    </div>
  </div>;
}

function Events({ events, onChange, notify }: { events: EventRecord[]; onChange: (events: EventRecord[]) => void; notify: (message: string) => void }) {
  const [lumaUrl, setLumaUrl] = useState("");
  const [error, setError] = useState("");
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const uploadedEvents = events.filter((event) => event.attendeeData?.length);
  const attendeeRows = events.reduce((total, event) => total + event.attendees, 0);
  const linkedinProfiles = events.reduce((total, event) => {
    const mapping = eventMapping(event);
    return total + eventRows(event).filter((row) => mapping.linkedin && row[mapping.linkedin]).length;
  }, 0);
  const addEvent = (event: React.FormEvent) => {
    event.preventDefault();
    const value = lumaUrl.trim();
    if (!/^https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com)\//i.test(value)) { setError("Paste a valid lu.ma or luma.com event link."); return; }
    const rawSlug = value.split("/").filter(Boolean).pop()?.split("?")[0] || "new-event";
    const title = decodeURIComponent(rawSlug).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const nextEvent: EventRecord = { id: `${rawSlug}-${Date.now()}`, title, date: "Date to confirm", location: "From Luma", lumaUrl: value, attendees: 0, qualified: 0, status: "Awaiting upload" };
    onChange([nextEvent, ...events]);
    setLumaUrl(""); setError(""); notify("Event added · upload its attendee spreadsheet next");
  };
  const uploadAttendees = async (eventId: string, file?: File) => {
    if (!file) return;
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("The spreadsheet has no worksheets.");
      const rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "", raw: false });
      const sourceRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? "").trim()])))
        .filter((row) => Object.values(row).some(Boolean));
      const headers = Array.from(new Set(sourceRows.flatMap((row) => Object.keys(row))));
      const mapping = guessColumnMapping(headers);
      const normalized = sourceRows.map((row) => mapAttendee(row, mapping));
      if (!normalized.length) throw new Error("No attendee rows were found in the first worksheet.");
      const defaultFields = Array.from(new Set(Object.values(mapping).filter(Boolean) as string[]));
      const next = events.map((item) => item.id === eventId ? { ...item, fileName: file.name, attendeeData: normalized, headers, columnMapping: mapping, analysisFields: defaultFields, analysis: undefined, attendees: normalized.length, qualified: 0, status: "Ready to analyze" as const } : item);
      onChange(next);
      setOpenEvent(eventId);
      setUploadErrors((current) => ({ ...current, [eventId]: "" }));
      notify(`${normalized.length} rows and ${headers.length} columns loaded · review the mapping`);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "This file could not be read.";
      setUploadErrors((current) => ({ ...current, [eventId]: message }));
    }
  };
  const updateMapping = (event: EventRecord, field: MappedField, header: string) => {
    const mapping = { ...eventMapping(event), [field]: header };
    const attendees = eventRows(event).map((row) => mapAttendee(row, mapping));
    onChange(events.map((item) => item.id === event.id ? { ...item, columnMapping: mapping, attendeeData: attendees, analysis: undefined, qualified: 0, status: "Ready to analyze" } : item));
  };
  const toggleAnalysisField = (event: EventRecord, header: string) => {
    const selected = event.analysisFields ?? Array.from(new Set(Object.values(eventMapping(event)).filter(Boolean) as string[]));
    const next = selected.includes(header) ? selected.filter((item) => item !== header) : [...selected, header];
    onChange(events.map((item) => item.id === event.id ? { ...item, analysisFields: next, analysis: undefined, status: "Ready to analyze" } : item));
  };
  const analyzeEvent = (event: EventRecord) => {
    const rows = eventRows(event);
    if (!rows.length) { notify("Upload an attendee spreadsheet first"); return; }
    const mapping = eventMapping(event);
    if (!mapping.name && !(mapping.firstName || mapping.lastName)) { notify("Map a name column before analysis"); return; }
    const attendees = rows.map((row) => mapAttendee(row, mapping));
    const selected = event.analysisFields ?? [];
    const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
    const companyCounts = attendees.reduce<Record<string, number>>((result, attendee) => {
      const company = attendee.company.trim();
      if (company) result[company] = (result[company] ?? 0) + 1;
      return result;
    }, {});
    const customFields = selected.filter((header) => !mappedHeaders.has(header)).map((header) => {
      const values = rows.map((row) => row[header]?.trim()).filter(Boolean);
      return { label: header, populated: values.length, examples: Array.from(new Set(values)).slice(0, 3) };
    });
    const workEmails = attendees.filter((attendee) => emailKind(attendee.email) === "work").length;
    const analysis: EventAnalysis = {
      analyzedAt: new Date().toISOString(), rows: rows.length,
      linkedin: attendees.filter((attendee) => attendee.linkedin).length,
      workEmails, personalEmails: attendees.filter((attendee) => emailKind(attendee.email) === "personal").length,
      phones: mapping.phone ? rows.filter((row) => row[mapping.phone!]?.trim()).length : 0,
      namedPeople: attendees.filter((attendee) => attendee.name).length,
      companies: Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })),
      seniorRoles: attendees.filter((attendee) => /\b(founder|owner|chief|ceo|cto|cio|cdo|vp|vice president|director|head|partner)\b/i.test(attendee.role)).length,
      customFields,
    };
    const qualified = attendees.filter((attendee) => attendee.name && (attendee.linkedin || emailKind(attendee.email) === "work")).length;
    onChange(events.map((item) => item.id === event.id ? { ...item, attendeeData: attendees, analysis, qualified, status: "Analyzed" } : item));
    notify(`Analysis complete · ${qualified} people have a LinkedIn profile or work email`);
  };
  return <div className="page events-page">
    <PageIntro title="Events intelligence" text="Upload each event list, map its columns, and choose exactly which attendee fields to analyze."/>
    <section className="event-importer">
      <div className="event-import-copy"><span className="import-icon"><CalendarDays size={22}/></span><div><h2>Bring in a Luma event</h2><p>The Luma link creates the event only. Attendee data appears after you upload a spreadsheet.</p></div></div>
      <form onSubmit={addEvent}><label htmlFor="luma-link">Luma event link</label><div><input id="luma-link" value={lumaUrl} onChange={(event) => { setLumaUrl(event.target.value); setError(""); }} placeholder="https://lu.ma/your-event"/><button className="primary" type="submit"><Plus size={16}/> Import event</button></div>{error && <p className="form-error" role="alert">{error}</p>}</form>
    </section>
    <div className="event-flow" aria-label="Event lead workflow"><span><b>1</b> Upload attendee sheet</span><i/><span><b>2</b> Map its columns</span><i/><span><b>3</b> Analyze selected fields</span></div>
    <section className="event-metrics"><div><span>Events added</span><strong>{events.length}</strong></div><div><span>Files uploaded</span><strong>{uploadedEvents.length}</strong></div><div><span>Attendee rows</span><strong>{attendeeRows}</strong></div><div><span>LinkedIn profiles</span><strong>{linkedinProfiles}</strong></div></section>
    <section className="surface event-workspace"><div className="section-head"><div><h2>Event queue</h2><p>Analyze new attendee lists or revisit completed results</p></div><span className="case-count">{events.length} events</span></div>
      <div className="event-table-head"><span>Event</span><span>Attendees</span><span>LinkedIn</span><span>Status</span><span>Source data</span></div>
      <div className="event-work-list">{events.map((event) => {
        const rows = eventRows(event);
        const headers = eventHeaders(event);
        const mapping = eventMapping(event);
        const selectedFields = event.analysisFields ?? Array.from(new Set(Object.values(mapping).filter(Boolean) as string[]));
        const linkedInCount = rows.filter((row) => mapping.linkedin && row[mapping.linkedin]?.trim()).length;
        const isOpen = openEvent === event.id;
        return <article key={event.id} className={`event-work-item ${isOpen ? "open" : ""}`}>
          <div className="event-work-row">
            <div className="event-identity"><span><CalendarDays size={18}/></span><div><strong>{event.title}</strong><small>{event.date} · {event.location}</small><a href={event.lumaUrl} target="_blank" rel="noreferrer">Open Luma <ArrowUpRight size={12}/></a>{event.fileName && <em>{event.fileName}</em>}</div></div>
            <strong className="event-number">{rows.length || "—"}</strong><strong className="event-number event-qualified">{rows.length ? linkedInCount : "—"}</strong>
            <span className={`analysis-status ${event.status === "Analyzed" ? "complete" : "ready"}`}><i/>{event.status}</span>
            <div className="event-actions"><label className="secondary file-action"><FileText size={15}/>{event.fileName ? "Replace file" : "Upload file"}<input type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={(input) => void uploadAttendees(event.id, input.target.files?.[0])}/></label><button className="primary" disabled={!rows.length} onClick={() => setOpenEvent(isOpen ? null : event.id)}>{isOpen ? <ChevronDown size={15}/> : <Pencil size={15}/>} {isOpen ? "Close mapping" : "Map columns"}</button>{uploadErrors[event.id] && <small className="event-upload-error" role="alert">{uploadErrors[event.id]}</small>}</div>
          </div>
          {isOpen && rows.length > 0 && <div className="event-mapper">
            <div className="mapping-head"><div><span>Column mapper</span><h3>{headers.length} headers detected</h3><p>Review the automatic matches. Every original column remains available.</p></div><button className="primary" onClick={() => analyzeEvent(event)}><Sparkles size={15}/> Run analysis</button></div>
            <div className="mapping-layout">
              <section className="mapping-fields"><h4>Map core fields</h4>{mappedFieldOptions.map((field) => <label key={field.id}><span><strong>{field.label}</strong><small>{field.hint}</small></span><select value={mapping[field.id] ?? ""} onChange={(input) => updateMapping(event, field.id, input.target.value)}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</section>
              <section className="detected-columns"><div className="columns-head"><div><h4>Fields to analyze</h4><p>Select custom answers, interests, or any other useful column.</p></div><span>{selectedFields.length} selected</span></div><div className="column-list">{headers.map((header) => {
                const values = rows.map((row) => row[header]?.trim()).filter(Boolean);
                const mappedAs = mappedFieldOptions.find((field) => mapping[field.id] === header)?.label;
                return <label key={header} className={selectedFields.includes(header) ? "selected" : ""}><input type="checkbox" checked={selectedFields.includes(header)} onChange={() => toggleAnalysisField(event, header)}/><span><strong>{header}</strong><small>{mappedAs ? `Mapped as ${mappedAs} · ${values.length} populated` : `${values.length} populated`}</small><em>{Array.from(new Set(values)).slice(0, 2).join(" · ") || "No sample value"}</em></span></label>;
              })}</div></section>
            </div>
            {event.analysis && <section className="event-analysis"><div className="analysis-head"><div><span>Latest result</span><h3>{event.analysis.rows} attendees analyzed</h3></div><small>Local structured analysis · no attendee data sent to an external AI provider</small></div><div className="analysis-metrics"><div><strong>{event.analysis.linkedin}</strong><span>LinkedIn</span></div><div><strong>{event.analysis.workEmails}</strong><span>Work emails</span></div><div><strong>{event.analysis.personalEmails}</strong><span>Personal emails</span></div><div><strong>{event.analysis.phones}</strong><span>Phone numbers</span></div><div><strong>{event.analysis.seniorRoles}</strong><span>Senior roles</span></div></div><div className="analysis-detail"><div><h4>Top companies</h4>{event.analysis.companies.length ? <div className="company-bars">{event.analysis.companies.map((company) => <span key={company.label}><b>{company.label}</b><em>{company.count}</em></span>)}</div> : <p>No company column is mapped or populated.</p>}</div><div><h4>Custom fields</h4>{event.analysis.customFields.length ? event.analysis.customFields.map((field) => <div className="custom-summary" key={field.label}><strong>{field.label}</strong><small>{field.populated} answers</small><p>{field.examples.join(" · ")}</p></div>) : <p>Select custom columns above to include interests and event answers.</p>}</div></div></section>}
          </div>}
        </article>;
      })}</div>
    </section>
  </div>;
}

function Leads({ leads, onChange, notify }: { leads: LeadRecord[]; onChange: (leads: LeadRecord[]) => void; notify: (message: string) => void }) {
  const [source, setSource] = useState<"All" | LeadSource>("All");
  const [search, setSearch] = useState("");
  const stages: LeadStage[] = ["New", "Qualified", "Contacted", "Converted"];
  const visible = leads.filter((lead) => (source === "All" || lead.source === source) && `${lead.name} ${lead.company} ${lead.role}`.toLowerCase().includes(search.toLowerCase()));
  const advance = (lead: LeadRecord) => {
    const next = stages[Math.min(stages.indexOf(lead.stage) + 1, stages.length - 1)];
    onChange(leads.map((item) => item.id === lead.id ? { ...item, stage: next } : item));
    notify(next === lead.stage ? `${lead.name} is already converted` : `${lead.name} moved to ${next}`);
  };
  return <div className="page leads-page">
    <PageIntro title="Lead pipeline" text="Every prospect in one place, with the source and reason behind the signal." action={<button className="primary" onClick={() => notify("Manual lead ready to configure")}><Plus size={16}/> Add lead</button>}/>
    <section className="lead-intelligence-panel">
      <div><span><Lightbulb size={18}/></span><div><h2>Lead intelligence</h2><p>Build an ICP, identify buyers, enrich profiles, verify emails, and score real leads.</p></div></div>
      <div className="lead-intelligence-actions">{["ICP lists", "Buyer discovery", "Profile enrichment", "Email verification", "Fit scoring", "Why-now signals"].map((item) => <button key={item} onClick={() => notify(`${item} ready to configure`)}>{item}<Plus size={12}/></button>)}</div>
    </section>
    <section className="lead-source-strip">
      {(["All", "Event", "Tool", "Network"] as const).map((item) => <button key={item} className={source === item ? "active" : ""} onClick={() => setSource(item)}><span className={`source-mark ${item.toLowerCase()}`}/><div><strong>{item === "All" ? "All leads" : `${item} leads`}</strong><small>{item === "Network" ? "From Open doors" : item === "Event" ? "From Luma events" : item === "Tool" ? "From prospecting tools" : "Across every source"}</small></div><b>{item === "All" ? leads.length : leads.filter((lead) => lead.source === item).length}</b></button>)}
    </section>
    <div className="toolbar lead-toolbar"><label><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, roles or companies"/></label><button className="secondary"><Filter size={16}/> Filters</button><span>{visible.length} leads</span></div>
    <div className="lead-pipeline">{stages.map((stage) => {
      const stageLeads = visible.filter((lead) => lead.stage === stage);
      return <section className="lead-column" key={stage}><header><div><i/><strong>{stage}</strong><span>{stageLeads.length}</span></div></header><div>{stageLeads.map((lead) => <article className="lead-card" key={lead.id}>
        <div className="lead-card-top"><span className="lead-avatar">{lead.name.split(" ").map((part) => part[0]).join("").slice(0,2)}</span><span className={`lead-source ${lead.source.toLowerCase()}`}>{lead.source}</span><strong className="lead-score">{lead.score}</strong></div>
        <h3>{lead.name}</h3><p>{lead.role}</p><b>{lead.company}</b>
        <div className="lead-reason"><Sparkles size={14}/><span>{lead.reason}</span></div>
        <div className="lead-origin"><small>Source</small><strong>{lead.origin}</strong></div>
        <footer><span>{lead.owner}</span><button onClick={() => advance(lead)}>{stage === "Converted" ? "Complete" : "Advance"} <ArrowUpRight size={13}/></button></footer>
      </article>)}</div>{stageLeads.length === 0 && <p className="empty-stage">No {source === "All" ? "" : source.toLowerCase() + " "}leads here.</p>}</section>;
    })}</div>
  </div>;
}

function Pipeline({ notify }: { notify: (m: string) => void }) {
  return <div className="page"><PageIntro title="Opportunity pipeline" text="Move from first signal to signed work, with delivery evidence attached." action={<button className="primary" onClick={() => notify("New opportunity ready to configure")}><Plus size={16}/> New opportunity</button>}/>
    <div className="pipeline-summary"><span><strong>0</strong> active opportunities</span><span><strong>0</strong> qualified opportunities</span><span><strong>—</strong> weighted confidence</span></div>
    <section className="surface empty-workspace"><Target size={24}/><h2>No opportunity data added</h2><p>Create an opportunity when you have a real account, value and stage to record.</p><button className="primary" onClick={() => notify("New opportunity ready to configure")}><Plus size={15}/> Add opportunity</button></section>
  </div>;
}

function OpenDoors({ notify }: { notify: (message: string) => void }) {
  return <div className="page"><PageIntro title="Open doors" text="Record verified relationships to find the shortest trusted path into an account." action={<button className="primary" onClick={() => notify("New relationship ready to configure")}><Plus size={16}/> Add relationship</button>}/>
    <section className="surface door-map empty-workspace"><ContactRound size={26}/><h2>No relationships added</h2><p>Network leads will appear only after a real relationship is recorded here.</p><button className="secondary" onClick={() => notify("New relationship ready to configure")}><Plus size={15}/> Add first relationship</button></section>
  </div>;
}
