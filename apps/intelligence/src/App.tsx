import { useEffect, useMemo, useState } from "react";
import { useClerk, useSession } from "@clerk/react";
import { db } from "./workspaceAuth";
import type { EventAiIntelligence } from "./event-intelligence-schema";
import type { CompetitorRecord, CompetitorResult } from "./competitor-schema";
import {
  Activity, ArrowLeft, ArrowUpRight, BookOpen, Building2, CalendarDays, ChevronDown, CircleDollarSign,
  ContactRound, FileText, Filter, LayoutGrid, Lightbulb, Menu, Network, Plus, Search,
  PanelLeftClose, PanelLeftOpen, Pencil, Save, ShieldCheck, Sparkles, Target, Users, X,
} from "lucide-react";

type View = "overview" | "market" | "competitors" | "marketing" | "partners" | "executive" | "capabilities" | "accounts" | "events" | "leads" | "pipeline" | "doors" | "guide";
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
  {
    id: "najm", name: "Najm", sector: "Not set", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "Not set", owner: "—", fit: [], caseStudies: [],
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
  headers?: string[]; columnMapping?: ColumnMapping; analysisFields?: string[]; analysis?: EventAnalysis; aiIntelligence?: EventAiIntelligence;
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
  competitors: { title: "Competitor analysis", description: "Compare the companies you compete with and see how their search, advertising, authority, and messaging change.", outcome: "A focused competitor brief with the changes that matter.", focus: ["Competitor keywords", "Keyword volume and ideas", "Domain and ad history", "Live search results", "Search visibility", "Backlinks and authority", "Competitor creative", "Messaging changes"], sources: ["Search data", "Ad libraries", "Domain history", "Backlink data"], icon: Search },
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
  { id: "guide" as View, path: "/guide", label: "GTM workspace guide", sidebarLabel: "How to use", icon: BookOpen },
];

const accountSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function routeFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path.startsWith("/events/")) return { view: "events" as View, account: null, event: decodeURIComponent(path.slice("/events/".length)) };
  if (path.startsWith("/accounts/")) {
    const slug = decodeURIComponent(path.slice("/accounts/".length));
    return { view: "accounts" as View, account: slug, event: null };
  }
  const item = nav.find((entry) => entry.path === path);
  return { view: item?.id ?? "overview", account: null, event: null };
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
  const [selectedEvent, setSelectedEvent] = useState<string | null>(initialRoute.event);
  const [accountRecords, setAccountRecords] = useState<Account[]>(() => {
    if (!storedWorkspace?.accounts) return accounts;
    const savedIds = new Set(storedWorkspace.accounts.map((account) => account.id));
    return [...storedWorkspace.accounts, ...accounts.filter((account) => !savedIds.has(account.id))];
  });
  const [intelRecords, setIntelRecords] = useState<Record<string, AccountIntel>>({ ...emptyAccountIntel, ...storedWorkspace?.intel });
  const [leadRecords, setLeadRecords] = useState<LeadRecord[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("quicksort-intelligence-leads-v4") || "null") ?? initialLeads; } catch { return initialLeads; }
  });
  const [eventRecords, setEventRecords] = useState<EventRecord[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("quicksort-intelligence-events-v4") || "null") ?? initialEvents; } catch { return initialEvents; }
  });
  const [competitorRecords, setCompetitorRecords] = useState<CompetitorRecord[]>(() => {
    try { return JSON.parse(window.localStorage.getItem("quicksort-intelligence-competitors-v1") || "[]"); } catch { return []; }
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
      setSelectedEvent(route.event);
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
    const label = accountRecords.find((account) => account.id === selectedAccount)?.name ?? eventRecords.find((event) => event.id === selectedEvent)?.title ?? nav.find((item) => item.id === view)?.label ?? "Overview";
    document.title = `${label} · QuickSort Intelligence`;
  }, [view, selectedAccount, selectedEvent, accountRecords, eventRecords]);
  const navigate = (next: View, account: string | null = null) => {
    const path = account ? `/accounts/${account}` : nav.find((item) => item.id === next)?.path ?? "/";
    window.history.pushState({}, "", path);
    setView(next);
    setSelectedAccount(account);
    setSelectedEvent(null);
    setMobileOpen(false);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const go = (next: View) => navigate(next);
  const openEvent = (eventId: string) => {
    window.history.pushState({}, "", `/events/${encodeURIComponent(eventId)}`);
    setView("events"); setSelectedAccount(null); setSelectedEvent(eventId); setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
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
  const saveCompetitors = (next: CompetitorRecord[]) => { setCompetitorRecords(next); window.localStorage.setItem("quicksort-intelligence-competitors-v1", JSON.stringify(next)); };
  const addEventLead = (event: EventRecord, person: EventAiIntelligence["priorityPeople"][number]) => {
    if (leadRecords.some((lead) => lead.name.toLowerCase() === person.name.toLowerCase() && lead.company.toLowerCase() === person.company.toLowerCase())) { notify("This person is already in Leads"); return; }
    saveLeads([{ id: `event-${Date.now()}`, name: person.name, role: person.role, company: person.company, source: "Event", origin: event.title, score: person.fitScore, reason: person.why, stage: "New", owner: "—" }, ...leadRecords]);
    notify(`${person.name} added to Leads for human review`);
  };
  const addEventAccount = (event: EventRecord, organisation: EventAiIntelligence["organisations"][number]) => {
    const existing = accountRecords.find((account) => account.name.toLowerCase() === organisation.name.toLowerCase());
    if (existing) { navigate("accounts", existing.id); return; }
    const id = accountSlug(organisation.name) || `account-${Date.now()}`;
    const nextAccount: Account = { id, name: organisation.name, sector: "Not set", contacts: organisation.attendeeCount, signal: "Event", opportunity: organisation.nextStep, value: "—", stage: "New", owner: "—", fit: [], caseStudies: [], evidence: [organisation.relevance, `Discovered from ${event.title}`] };
    const nextAccounts = [...accountRecords, nextAccount];
    const nextIntel = { ...intelRecords, [id]: { leads: [], events: [{ date: event.date.split(" ")[0] || "—", month: event.date.split(" ")[1] || "—", title: event.title, type: "Event", detail: `${organisation.attendeeCount} attendee${organisation.attendeeCount === 1 ? "" : "s"} connected` }], contacts: [] } };
    setAccountRecords(nextAccounts); setIntelRecords(nextIntel);
    window.localStorage.setItem("quicksort-intelligence-accounts-v3", JSON.stringify({ accounts: nextAccounts, intel: nextIntel }));
    navigate("accounts", id);
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
          <div className="breadcrumbs">Intelligence <span>/</span> {eventRecords.find((event) => event.id === selectedEvent)?.title ?? nav.find((item) => item.id === view)?.label}</div>
          <div className="top-actions"><button className="icon-button" aria-label="Search"><Search size={18}/></button><button className="primary" onClick={() => notify("New record ready to configure")}><Plus size={17}/> Add record</button></div>
        </header>
        {view === "overview" && <Overview active={active} capabilities={capabilities} selected={selected} setSelected={setSelected} go={go} notify={notify} accounts={accountRecords} leads={leadRecords} events={eventRecords}/>}
        {(view === "market" || view === "marketing" || view === "partners" || view === "executive") && <IntelligencePage workspace={intelligenceWorkspaces[view]} notify={notify}/>}
        {view === "competitors" && <CompetitorAnalysis competitors={competitorRecords} onChange={saveCompetitors} notify={notify}/>}
        {view === "capabilities" && <Capabilities active={active} capabilities={capabilities} selected={selected} setSelected={setSelected}/>}
        {view === "accounts" && (selectedAccount && accountRecords.some((account) => account.id === selectedAccount)
          ? <AccountDetail account={accountRecords.find((account) => account.id === selectedAccount)!} intel={intelRecords[selectedAccount] ?? { leads: [], events: [], contacts: [] }} onSave={saveAccount} onBack={() => navigate("accounts")} notify={notify}/>
          : <Accounts query={query} setQuery={setQuery} accounts={filteredAccounts} openAccount={(id) => navigate("accounts", id)} notify={notify}/>)} 
        {view === "events" && <Events events={eventRecords} selectedEventId={selectedEvent} onOpenEvent={openEvent} onBack={() => navigate("events")} onChange={saveEvents} onAddLead={addEventLead} onAddAccount={addEventAccount} notify={notify}/>}
        {view === "leads" && <Leads leads={leadRecords} onChange={saveLeads} notify={notify}/>}
        {view === "pipeline" && <Pipeline notify={notify}/>} 
        {view === "doors" && <OpenDoors notify={notify}/>}
        {view === "guide" && <WorkspaceGuide go={go}/>}
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

function CompetitorAnalysis({ competitors, onChange, notify }: { competitors: CompetitorRecord[]; onChange: (records: CompetitorRecord[]) => void; notify: (message: string) => void }) {
  const { session } = useSession();
  const [website, setWebsite] = useState("");
  const [market, setMarket] = useState("AI consulting and AI engineering services in Paris, France");
  const [busy, setBusy] = useState<"website" | "discover" | null>(null);
  const [error, setError] = useState("");
  const [marketSummary, setMarketSummary] = useState("");
  async function research(mode: "website" | "discover") {
    setBusy(mode); setError("");
    try {
      const token = await session?.getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      let url = website.trim();
      if (mode === "website" && url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (mode === "website") { try { new URL(url); } catch { throw new Error("Enter a valid competitor website."); } }
      const response = await fetch("/api/competitor-intelligence", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(mode === "website" ? { mode, url } : { mode, market }) });
      const payload = await response.json() as CompetitorResult & { error?: string; analyzedAt?: string };
      if (!response.ok) throw new Error(payload.error || "Competitor research failed.");
      const analyzedAt = payload.analyzedAt ?? new Date().toISOString();
      const source = mode === "website" ? "Manual" as const : "Discovered" as const;
      const incoming = payload.competitors.map((competitor) => ({ ...competitor, id: accountSlug(competitor.url) || crypto.randomUUID(), source, analyzedAt }));
      const merged = [...competitors];
      for (const competitor of incoming) {
        const index = merged.findIndex((current) => current.url.replace(/\/$/, "").toLowerCase() === competitor.url.replace(/\/$/, "").toLowerCase());
        if (index >= 0) merged[index] = competitor; else merged.unshift(competitor);
      }
      onChange(merged); setMarketSummary(payload.marketSummary); setWebsite("");
      notify(mode === "website" ? "Competitor website analyzed" : `${incoming.length} competitors discovered for review`);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Competitor research failed."); }
    finally { setBusy(null); }
  }
  return <div className="page competitor-page"><PageIntro title="Competitor analysis" text="Add known competitor websites manually or automatically discover close competitors for QuickSort. Nothing enters Accounts automatically."/>
    <div className="competitor-entry-grid"><section className="surface"><div className="competitor-entry-head"><span><Plus size={18}/></span><div><h2>Add a known competitor</h2><p>Paste the company website. Secure backend research reads the public site and AI structures the commercial comparison.</p></div></div><label>Competitor website<input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://competitor.com"/></label><button className="primary" disabled={Boolean(busy) || !website.trim()} onClick={() => void research("website")}>{busy === "website" ? "Analyzing website…" : "Analyze website"}</button></section>
      <section className="surface"><div className="competitor-entry-head"><span><Sparkles size={18}/></span><div><h2>Discover close competitors</h2><p>Search the market around QuickSort, then review the proposed companies before adding them.</p></div></div><label>Market and location<input value={market} onChange={(event) => setMarket(event.target.value)} /></label><button className="secondary" disabled={Boolean(busy) || !market.trim()} onClick={() => void research("discover")}>{busy === "discover" ? "Searching the market…" : "Discover competitors"}</button></section></div>
    {error && <div className="analysis-error" role="alert">{error}</div>}{marketSummary && <section className="competitor-market-summary"><span>Market view</span><p>{marketSummary}</p></section>}
    <section className="surface competitor-library"><div className="section-head"><div><h2>Competitors</h2><p>Manually added and automatically discovered companies</p></div><span className="case-count">{competitors.length} companies</span></div>{competitors.length ? <div className="competitor-cards">{competitors.map((competitor) => <article key={competitor.id}><header><div><span>{competitor.source}</span><h3>{competitor.name}</h3><a href={competitor.url} target="_blank" rel="noreferrer">{new URL(competitor.url).hostname}<ArrowUpRight size={12}/></a></div><button aria-label={`Remove ${competitor.name}`} onClick={() => { onChange(competitors.filter((item) => item.id !== competitor.id)); notify(`${competitor.name} removed`); }}><X size={15}/></button></header><p>{competitor.summary}</p><dl><div><dt>Positioning</dt><dd>{competitor.positioning}</dd></div><div><dt>Audience</dt><dd>{competitor.audience}</dd></div></dl><div className="competitor-tags">{competitor.services.map((service) => <span key={service}>{service}</span>)}</div><section><h4>Differentiators</h4>{competitor.differentiators.map((item) => <p key={item}>{item}</p>)}</section><div className="competitor-signals"><section><h4>Competitive threats</h4>{competitor.threats.map((item) => <p key={item}>{item}</p>)}</section><section><h4>QuickSort opportunities</h4>{competitor.opportunities.map((item) => <p key={item}>{item}</p>)}</section></div>{competitor.evidence.length > 0 && <footer>{competitor.evidence.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</footer>}</article>)}</div> : <div className="data-empty">No competitors added yet. Add a website or run discovery above.</div>}</section>
  </div>;
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
    <div className="account-list">{accounts.map((account) => <a className="account-card" key={account.id} href={`/accounts/${encodeURIComponent(account.id)}`} onClick={(event) => { event.preventDefault(); openAccount(account.id); }} aria-label={`Open ${account.name} account`}><div className="account-monogram">{account.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div><div className="account-title"><h2>{account.name}</h2><p>{account.sector} · {account.contacts} mapped contacts</p></div><div className={`signal ${account.signal.toLowerCase()}`}><i/>{account.signal} relationship</div><div className="account-opportunity"><span>{account.opportunity}</span><strong>{account.value}</strong></div><div className="fit-tags">{account.fit.map((f) => <span key={f}>{f}</span>)}</div><div className="account-owner"><span>{account.owner}</span><div><small>Owner</small><strong>{account.stage}</strong></div></div><span className="open-card" aria-hidden="true"><ArrowUpRight size={18}/></span></a>)}</div>
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
      <button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Back to accounts</button>
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

function Events({ events, selectedEventId, onOpenEvent, onBack, onChange, onAddLead, onAddAccount, notify }: {
  events: EventRecord[]; selectedEventId: string | null; onOpenEvent: (id: string) => void; onBack: () => void;
  onChange: (events: EventRecord[]) => void;
  onAddLead: (event: EventRecord, person: EventAiIntelligence["priorityPeople"][number]) => void;
  onAddAccount: (event: EventRecord, organisation: EventAiIntelligence["organisations"][number]) => void;
  notify: (message: string) => void;
}) {
  const { session } = useSession();
  const [lumaUrl, setLumaUrl] = useState("");
  const [error, setError] = useState("");
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [analyzingEvent, setAnalyzingEvent] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const selectedEvent = selectedEventId ? events.find((event) => event.id === selectedEventId) ?? null : null;
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
    setLumaUrl(""); setError(""); onOpenEvent(nextEvent.id); notify("Event added · upload its attendee spreadsheet next");
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
  const analyzeEvent = async (event: EventRecord) => {
    const rows = eventRows(event);
    if (!rows.length) { notify("Upload an attendee spreadsheet first"); return; }
    const mapping = eventMapping(event);
    if (!mapping.name && !(mapping.firstName || mapping.lastName)) { notify("Map a name column before analysis"); return; }
    setAnalysisError(""); setAnalyzingEvent(event.id);
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
    const qualified = attendees.filter((attendee) => attendee.name && (attendee.company || attendee.role || attendee.linkedin)).length;
    onChange(events.map((item) => item.id === event.id ? { ...item, attendeeData: attendees, analysis, qualified, status: "Analyzed" } : item));
    try {
      const token = await session?.getToken();
      if (!token) throw new Error("Your session expired. Sign in again.");
      const selectedCustom = selected.filter((header) => !mappedHeaders.has(header));
      const response = await fetch("/api/event-intelligence", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event: { id: event.id, title: event.title }, attendees: attendees.slice(0, 300).map((attendee) => ({
          name: attendee.name, role: attendee.role, company: attendee.company, linkedin: attendee.linkedin, email: attendee.email,
          custom: Object.fromEntries(selectedCustom.map((header) => [header, attendee.sourceRow[header] ?? ""])),
        })) }),
      });
      const payload = await response.json() as EventAiIntelligence & { error?: string };
      if (!response.ok) throw new Error(payload.error || "AI analysis failed.");
      onChange(events.map((item) => item.id === event.id ? { ...item, attendeeData: attendees, analysis, aiIntelligence: payload, qualified: payload.priorityPeople.length, status: "Analyzed" } : item));
      notify(`AI intelligence ready · ${payload.priorityPeople.length} people recommended for review`);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "AI analysis could not be completed.";
      setAnalysisError(message);
      notify("Local analysis saved · AI enrichment needs attention");
    } finally { setAnalyzingEvent(null); }
  };
  if (selectedEvent) {
    const rows = eventRows(selectedEvent);
    const headers = eventHeaders(selectedEvent);
    const mapping = eventMapping(selectedEvent);
    const selectedFields = selectedEvent.analysisFields ?? Array.from(new Set(Object.values(mapping).filter(Boolean) as string[]));
    return <div className="page event-detail-page">
      <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> All events</button>
      <PageIntro title={selectedEvent.title} text={`${selectedEvent.date} · ${selectedEvent.location}`} action={<a className="secondary" href={selectedEvent.lumaUrl} target="_blank" rel="noreferrer">Open Luma <ArrowUpRight size={14}/></a>}/>
      <div className="event-flow" aria-label="Event intelligence workflow"><span className={rows.length ? "done" : ""}><b>1</b> Upload</span><i/><span className={rows.length ? "done" : ""}><b>2</b> Map columns</span><i/><span className={selectedEvent.aiIntelligence ? "done" : ""}><b>3</b> AI intelligence</span><i/><span><b>4</b> Human approval</span></div>
      <section className="event-detail-source"><div><FileText size={20}/><span><strong>{selectedEvent.fileName ?? "No attendee file uploaded"}</strong><small>{rows.length ? `${rows.length} attendee rows · ${headers.length} columns` : "Upload CSV, TSV, XLS or XLSX"}</small></span></div><label className="secondary file-action">{selectedEvent.fileName ? "Replace file" : "Upload attendee file"}<input type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={(input) => void uploadAttendees(selectedEvent.id, input.target.files?.[0])}/></label>{uploadErrors[selectedEvent.id] && <small className="event-upload-error">{uploadErrors[selectedEvent.id]}</small>}</section>
      {rows.length > 0 && <section className="surface event-detail-mapper"><div className="mapping-head"><div><span>Data preparation</span><h3>{headers.length} headers detected</h3><p>Confirm the core fields and choose any event questions the AI should use.</p></div><button className="primary" disabled={analyzingEvent === selectedEvent.id} onClick={() => void analyzeEvent(selectedEvent)}><Sparkles size={15}/>{analyzingEvent === selectedEvent.id ? "Researching…" : "Run AI analysis"}</button></div>
        {analysisError && <div className="analysis-error" role="alert">{analysisError}</div>}
        <div className="mapping-layout"><section className="mapping-fields"><h4>Map core fields</h4>{mappedFieldOptions.map((field) => <label key={field.id}><span><strong>{field.label}</strong><small>{field.hint}</small></span><select value={mapping[field.id] ?? ""} onChange={(input) => updateMapping(selectedEvent, field.id, input.target.value)}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</section><section className="detected-columns"><div className="columns-head"><div><h4>Fields to analyze</h4><p>Include interests and custom event questions.</p></div><span>{selectedFields.length} selected</span></div><div className="column-list">{headers.map((header) => { const values = rows.map((row) => row[header]?.trim()).filter(Boolean); const mappedAs = mappedFieldOptions.find((field) => mapping[field.id] === header)?.label; return <label key={header} className={selectedFields.includes(header) ? "selected" : ""}><input type="checkbox" checked={selectedFields.includes(header)} onChange={() => toggleAnalysisField(selectedEvent, header)}/><span><strong>{header}</strong><small>{mappedAs ? `Mapped as ${mappedAs} · ${values.length} populated` : `${values.length} populated`}</small><em>{Array.from(new Set(values)).slice(0, 2).join(" · ") || "No sample value"}</em></span></label>; })}</div></section></div>
      </section>}
      {selectedEvent.analysis && <LocalEventAnalysis analysis={selectedEvent.analysis}/>}
      {selectedEvent.aiIntelligence && <EventIntelligenceResult event={selectedEvent} intelligence={selectedEvent.aiIntelligence} onAddLead={onAddLead} onAddAccount={onAddAccount}/>}
    </div>;
  }
  return <div className="page events-page"><PageIntro title="Events intelligence" text="Add a Luma event, then open its dedicated workspace for mapping, research, and human-approved GTM actions."/>
    <section className="event-importer"><div className="event-import-copy"><span className="import-icon"><CalendarDays size={22}/></span><div><h2>Bring in a Luma event</h2><p>Add the event first. Upload and intelligence happen inside its dedicated page.</p></div></div><form onSubmit={addEvent}><label htmlFor="luma-link">Luma event link</label><div><input id="luma-link" value={lumaUrl} onChange={(event) => { setLumaUrl(event.target.value); setError(""); }} placeholder="https://lu.ma/your-event"/><button className="primary" type="submit"><Plus size={16}/> Add event</button></div>{error && <p className="form-error" role="alert">{error}</p>}</form></section>
    <section className="event-metrics"><div><span>Events added</span><strong>{events.length}</strong></div><div><span>Files uploaded</span><strong>{uploadedEvents.length}</strong></div><div><span>Attendee rows</span><strong>{attendeeRows}</strong></div><div><span>LinkedIn profiles</span><strong>{linkedinProfiles}</strong></div></section>
    <section className="surface event-workspace"><div className="section-head"><div><h2>Event queue</h2><p>Open an event to upload, map, analyze, and approve prospects</p></div><span className="case-count">{events.length} events</span></div><div className="event-table-head"><span>Event</span><span>Attendees</span><span>Qualified</span><span>Status</span><span>Workspace</span></div><div className="event-work-list">{events.map((event) => <article className="event-work-row" key={event.id}><button className="event-identity event-open" onClick={() => onOpenEvent(event.id)}><span><CalendarDays size={18}/></span><div><strong>{event.title}</strong><small>{event.date} · {event.location}</small><em>{event.lumaUrl}</em></div></button><strong className="event-number">{eventRows(event).length || "—"}</strong><strong className="event-number event-qualified">{event.aiIntelligence?.priorityPeople.length ?? "—"}</strong><span className={`analysis-status ${event.aiIntelligence ? "complete" : "ready"}`}><i/>{event.aiIntelligence ? "AI ready" : event.status}</span><button className="primary" onClick={() => onOpenEvent(event.id)}>Open intelligence <ArrowUpRight size={14}/></button></article>)}</div></section>
  </div>;
}

function LocalEventAnalysis({ analysis }: { analysis: EventAnalysis }) {
  return <section className="event-analysis local-analysis"><div className="analysis-head"><div><span>Uploaded data</span><h3>{analysis.rows} attendees mapped</h3></div><small>Email type is informational only. Personal emails do not reduce lead fit.</small></div><div className="analysis-metrics"><div><strong>{analysis.linkedin}</strong><span>LinkedIn supplied</span></div><div><strong>{analysis.workEmails}</strong><span>Work emails</span></div><div><strong>{analysis.personalEmails}</strong><span>Personal emails</span></div><div><strong>{analysis.phones}</strong><span>Phone numbers</span></div><div><strong>{analysis.seniorRoles}</strong><span>Senior roles supplied</span></div></div></section>;
}

function EventIntelligenceResult({ event, intelligence, onAddLead, onAddAccount }: { event: EventRecord; intelligence: EventAiIntelligence; onAddLead: (event: EventRecord, person: EventAiIntelligence["priorityPeople"][number]) => void; onAddAccount: (event: EventRecord, organisation: EventAiIntelligence["organisations"][number]) => void }) {
  return <section className="ai-intelligence"><div className="ai-intelligence-head"><div><span>Human approval required</span><h2>Event intelligence</h2><p>{intelligence.summary}</p></div></div><OrganisationGraph intelligence={intelligence}/><div className="intelligence-brief"><section><h3>Audience segments</h3>{intelligence.segments.map((segment) => <div key={segment.name}><strong>{segment.count}</strong><span><b>{segment.name}</b><small>{segment.reason}</small></span></div>)}</section><section><h3>Recommended actions</h3>{intelligence.recommendations.map((recommendation, index) => <p key={recommendation}><b>{index + 1}</b>{recommendation}</p>)}</section></div><div className="intelligence-results-grid"><section><div className="section-head"><div><h2>People for human review</h2><p>Approve individuals before they enter Leads.</p></div></div><div className="priority-people">{intelligence.priorityPeople.map((person) => <article key={`${person.name}-${person.company}`}><div className="person-rank"><strong>{person.fitScore}</strong><span>{person.category}</span><em>{person.confidence} confidence</em></div><div><h3>{person.name}</h3><p>{person.role}{person.company ? ` · ${person.company}` : ""}</p><small>{person.publicEvidence}</small><b>{person.why}</b><em>{person.reachOut}</em>{person.seniorContact && <small className="senior-contact">Decision-maker path: {person.seniorContact}</small>}{person.linkedin && <a href={person.linkedin} target="_blank" rel="noreferrer">Review public profile <ArrowUpRight size={12}/></a>}</div><button className="secondary" onClick={() => onAddLead(event, person)}>Approve as lead</button></article>)}</div></section><section><div className="section-head"><div><h2>Organisation opportunities</h2><p>Approve a company to create or open its account.</p></div></div><div className="organisation-list">{intelligence.organisations.map((organisation) => <article key={organisation.name}><div><h3>{organisation.name}</h3><small>{organisation.attendeeCount} connected attendee{organisation.attendeeCount === 1 ? "" : "s"}</small></div><p>{organisation.relevance}</p><div>{organisation.decisionMakerRoles.map((role) => <span key={role}>{role}</span>)}</div><b>{organisation.nextStep}</b><button className="secondary" onClick={() => onAddAccount(event, organisation)}>Approve as account</button></article>)}</div></section></div>{intelligence.researchSources.length > 0 && <section className="research-sources"><h3>Public evidence reviewed</h3><div>{intelligence.researchSources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12}/></a>)}</div></section>}</section>;
}

function OrganisationGraph({ intelligence }: { intelligence: EventAiIntelligence }) {
  const organisations = intelligence.organisations.slice(0, 5);
  const people = intelligence.priorityPeople.slice(0, 10);
  return <section className="organisation-graph"><div className="section-head"><div><h2>People and organisation map</h2><p>Nodes show reviewed prospects, represented companies, and decision-maker paths.</p></div><span className="case-count">{people.length + organisations.length} nodes</span></div>{organisations.length ? <><div className="graph-canvas"><svg viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">{people.map((person, index) => { const matchedIndex = organisations.findIndex((org) => person.company && org.name.toLowerCase() === person.company.toLowerCase()); if (matchedIndex < 0) return null; const px = 90 + (index % 5) * 190; const py = index < 5 ? 70 : 350; const ox = 120 + matchedIndex * 190; return <line key={`${person.name}-${index}`} x1={px} y1={py} x2={ox} y2={210}/>; })}</svg>{organisations.map((org, index) => <div className="graph-org" style={{ left: `${12 + index * 19}%`, top: "50%" }} key={org.name}><strong>{org.name}</strong><small>{org.attendeeCount} attendees</small></div>)}{people.map((person, index) => <div className={`graph-person ${person.category.toLowerCase()}`} style={{ left: `${9 + (index % 5) * 19}%`, top: index < 5 ? "12%" : "82%" }} key={`${person.name}-${index}`}><strong>{person.name}</strong><small>{person.category}</small></div>)}</div><div className="graph-legend"><span><i className="professional"/>Professional</span><span><i className="founder"/>Founder</span><span><i className="student"/>Student</span><span><i className="unknown"/>Needs verification</span></div></> : <div className="data-empty">No verified organisation relationships were found.</div>}</section>;
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

function WorkspaceGuide({ go }: { go: (view: View) => void }) {
  type GuideStep = { title: string; detail: string };
  const areas: { view: View; title: string; purpose: string; when: string; steps: GuideStep[]; result: string; icon: React.ElementType }[] = [
    { view: "overview", title: "Overview", purpose: "See the current commercial picture across the workspace.", when: "Start here before deciding where the GTM team should focus.", steps: [
      { title: "Read the totals", detail: "Check the real accounts, leads, events, attendees, and opportunities already recorded." },
      { title: "Review recent activity", detail: "Look for new evidence, approved records, and changes that need action." },
      { title: "Choose the next workspace", detail: "Open the relevant section to do the work at its source." },
    ], result: "A clear priority for the next GTM action.", icon: LayoutGrid },
    { view: "capabilities", title: "Capabilities", purpose: "Understand what QuickSort can credibly deliver from approved candidate evidence.", when: "Use this when qualifying an opportunity or preparing proof for an account.", steps: [
      { title: "Choose a vertical", detail: "Review AI for Business, Infrastructure for AI, Data for AI, or Voice AI." },
      { title: "Inspect the evidence", detail: "Check approved people, projects, technologies, and delivery proof linked from Admin." },
      { title: "Match the account need", detail: "Use only capabilities supported by real evidence." },
      { title: "Correct data in Admin", detail: "Capability records are governed in Admin and are read-only here." },
    ], result: "Verified capability evidence ready to support an account or opportunity.", icon: Sparkles },
    { view: "accounts", title: "Accounts", purpose: "Keep each company’s context, people, evidence, and opportunity in one record.", when: "Use this after a company has been approved as a real target or customer.", steps: [
      { title: "Open the company card", detail: "Click anywhere on a company row to open its full account page." },
      { title: "Complete the record", detail: "Add the sector, owner, relationship, opportunity, value, and current stage." },
      { title: "Map the organisation", detail: "Record relevant contacts, decision makers, colleagues, and introduction paths." },
      { title: "Attach proof", detail: "Select relevant case studies and capability evidence." },
    ], result: "One reliable company record connected to Leads and Pipeline.", icon: Building2 },
    { view: "events", title: "Events", purpose: "Turn an event attendee export into reviewed people and company opportunities.", when: "Use this only after you have the real event link and attendee CSV or Excel file.", steps: [
      { title: "Add the event", detail: "Paste the event link so it has its own workspace." },
      { title: "Upload the attendee file", detail: "Use the original export. No attendee data appears before upload." },
      { title: "Map the columns", detail: "Confirm name, LinkedIn, email, phone, company, role, and useful custom answers." },
      { title: "Run AI analysis", detail: "Review professional context, company mapping, priority people, and decision-maker paths." },
      { title: "Approve the output", detail: "A person becomes a Lead or a company becomes an Account only after human approval." },
    ], result: "Approved event leads and accounts with their source evidence preserved.", icon: CalendarDays },
    { view: "leads", title: "Leads", purpose: "Qualify individual people before outreach and keep their source visible.", when: "Use this for people coming from Events, research, or Network relationships.", steps: [
      { title: "Filter by source", detail: "Separate event, researched, and network leads." },
      { title: "Verify the person", detail: "Check role, company, public evidence, fit score, and why the person matters." },
      { title: "Assign ownership", detail: "Choose who is responsible and move the lead through the correct stage." },
      { title: "Plan outreach", detail: "Create a relevant message and record the next action." },
      { title: "Connect the company", detail: "Link a qualified lead to the correct Account and opportunity." },
    ], result: "A reviewed person with an owner, source, stage, and next action.", icon: Users },
    { view: "market", title: "Market", purpose: "Decide which segments and companies deserve GTM attention.", when: "Use this before building a target-account list or entering a new segment.", steps: [
      { title: "Define the question", detail: "Specify geography, industry, company type, and the commercial hypothesis." },
      { title: "Collect current signals", detail: "Use credible evidence such as growth, hiring, adoption, or expansion." },
      { title: "Compare segments", detail: "Rank relevance, timing, evidence quality, and QuickSort capability fit." },
      { title: "Approve target companies", detail: "Create Accounts only for companies the team agrees to pursue." },
    ], result: "A prioritised market view and evidence-based target-account list.", icon: Activity },
    { view: "competitors", title: "Competitors", purpose: "Understand companies competing for the same buyers and work.", when: "Use this when positioning QuickSort, preparing a pitch, or reviewing market changes.", steps: [
      { title: "Add or discover", detail: "Paste a known competitor website or request close companies for review." },
      { title: "Review the evidence", detail: "Check positioning, audience, services, differentiators, and source links." },
      { title: "Compare with QuickSort", detail: "Identify credible threats and areas where QuickSort is stronger." },
      { title: "Choose an action", detail: "Update messaging, sales proof, market focus, or account strategy." },
    ], result: "A competitor brief tied to a specific GTM decision.", icon: Search },
    { view: "marketing", title: "Marketing", purpose: "Turn approved channel data into decisions about demand and campaigns.", when: "Use this when real search, analytics, advertising, content, or social data is available.", steps: [
      { title: "Choose the question", detail: "Start with a decision such as where demand is rising or which campaign is working." },
      { title: "Select the evidence", detail: "Use the relevant channel and time period without mixing unrelated metrics." },
      { title: "Read the change", detail: "Compare performance with the prior period and identify the likely reason." },
      { title: "Assign the action", detail: "Record what changes, who owns it, and when results will be reviewed." },
    ], result: "A marketing decision with evidence, an owner, and a review date.", icon: CircleDollarSign },
    { view: "partners", title: "Strategic partners", purpose: "Build relationships that improve delivery, distribution, or trusted access.", when: "Use this for agencies, creators, integration partners, and complementary providers.", steps: [
      { title: "Define the partner profile", detail: "State the goal, ideal type, geography, and value exchange." },
      { title: "Check mutual fit", detail: "Review audience overlap, capabilities, reputation, and commercial relevance." },
      { title: "Find the warm path", detail: "Check Open doors for a trusted introduction before cold outreach." },
      { title: "Approve and assign", detail: "Choose an owner, outreach message, and concrete next step." },
    ], result: "A qualified partner opportunity with a clear reason to collaborate.", icon: Network },
    { view: "executive", title: "Executive", purpose: "Give leadership a concise view of movement, risk, and decisions.", when: "Use this for the weekly GTM review, not as a second place to edit source records.", steps: [
      { title: "Review the live picture", detail: "Read changes across Accounts, Leads, Pipeline, Events, Market, and Competitors." },
      { title: "Confirm material signals", detail: "Remove noise and keep only evidence that could change a decision." },
      { title: "Make the decision", detail: "State what should start, stop, continue, or receive more attention." },
      { title: "Assign accountability", detail: "Give every decision an owner and follow-up date in its source workspace." },
    ], result: "A short weekly decision brief linked to the underlying records.", icon: FileText },
    { view: "pipeline", title: "Pipeline", purpose: "Manage commercial opportunities from qualified signal to signed work.", when: "Use this only when a real account, opportunity, stage, value, and owner exist.", steps: [
      { title: "Create the opportunity", detail: "Link it to the correct Account and record the problem being solved." },
      { title: "Set the commercial facts", detail: "Add owner, stage, value, next action, and expected timing." },
      { title: "Attach evidence", detail: "Use capability proof, case studies, contacts, and event context." },
      { title: "Move stages carefully", detail: "Advance only when the required evidence or customer action exists." },
    ], result: "An accurate pipeline where every opportunity has evidence and a next action.", icon: Target },
    { view: "doors", title: "Open doors", purpose: "Find the shortest trusted introduction path into a company.", when: "Use this when a verified relationship can help reach a target person or account.", steps: [
      { title: "Record the relationship", detail: "Add who knows whom, the company, relationship strength, and internal owner." },
      { title: "Verify the connection", detail: "Confirm the relationship is real and current before relying on it." },
      { title: "Create a network lead", detail: "Send the relevant person to Leads with Network as the source." },
      { title: "Request the introduction", detail: "Agree on context, message, owner, and follow-up before outreach." },
    ], result: "A trusted, approved introduction path connected to Leads and Accounts.", icon: ContactRound },
  ];
  return <div className="page guide-page"><section className="guide-hero"><span><BookOpen size={24}/></span><div><small>GTM team field guide</small><h1>From signal to a human-approved opportunity.</h1><p>Collect real evidence, understand what matters, approve each person or company, and move only verified work into the commercial pipeline. Nothing becomes a Lead or Account automatically.</p></div></section><section className="guide-workflow"><div><b>1</b><span><strong>Collect</strong><small>Events, sources, relationships</small></span></div><i/><div><b>2</b><span><strong>Understand</strong><small>Map, enrich, score</small></span></div><i/><div><b>3</b><span><strong>Approve</strong><small>Human review is required</small></span></div><i/><div><b>4</b><span><strong>Act</strong><small>Lead, account, pipeline</small></span></div></section><div className="guide-grid">{areas.map(({ view, title, purpose, when, steps, result, icon: Icon }) => <article key={view}><header><span><Icon size={18}/></span><div><h2>{title}</h2><p>{purpose}</p></div></header><div className="guide-when"><strong>When to use it</strong><p>{when}</p></div><ol>{steps.map((step) => <li key={step.title}><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol><div className="guide-result"><strong>What you get</strong><p>{result}</p></div><button className="secondary" onClick={() => go(view)}>Open {title} <ArrowUpRight size={13}/></button></article>)}</div></div>;
}
