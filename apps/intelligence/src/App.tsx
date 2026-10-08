import { useEffect, useMemo, useState } from "react";
import { useClerk } from "@clerk/react";
import {
  Activity, ArrowUpRight, Building2, CalendarDays, ChevronDown, CircleDollarSign,
  ContactRound, FileText, Filter, LayoutGrid, Lightbulb, Menu, Network, Plus, Search,
  Pencil, Save, ShieldCheck, Sparkles, Target, Users, X,
} from "lucide-react";

type View = "overview" | "intelligence" | "capabilities" | "accounts" | "events" | "leads" | "pipeline" | "doors";
type Capability = {
  id: string; name: string; short: string; color: string; people: number; projects: number;
  technologies: string[]; proof: string; experts: { initials: string; name: string; role: string }[];
};

const capabilities: Capability[] = [
  { id: "rag", name: "Enterprise RAG", short: "RAG", color: "blue", people: 0, projects: 0, technologies: [], proof: "No delivery evidence added", experts: [] },
  { id: "voice", name: "Voice AI", short: "Voice", color: "violet", people: 0, projects: 0, technologies: [], proof: "No delivery evidence added", experts: [] },
  { id: "agents", name: "Agentic AI", short: "Agents", color: "orange", people: 0, projects: 0, technologies: [], proof: "No delivery evidence added", experts: [] },
  { id: "data", name: "Data for AI", short: "Data", color: "green", people: 0, projects: 0, technologies: [], proof: "No delivery evidence added", experts: [] },
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
type EventRecord = { id: string; title: string; date: string; location: string; lumaUrl: string; attendees: number; qualified: number; status: "Awaiting upload" | "Ready to analyze" | "Analyzed"; fileName?: string; attendeeData?: ImportedAttendee[] };

const initialLeads: LeadRecord[] = [];

const initialEvents: EventRecord[] = [
  { id: "quicksort-multimodal-ai", title: "Multimodal AI in Production (w/ The AI Collective)", date: "01 Oct 2026", location: "Paris", lumaUrl: "https://luma.com/quicksort-multimodal-ai", attendees: 0, qualified: 0, status: "Awaiting upload" },
  { id: "ccparis", title: "Cafe Compute Meetup: Paris", date: "02 Oct 2026", location: "Paris", lumaUrl: "https://luma.com/ccparis", attendees: 0, qualified: 0, status: "Awaiting upload" },
];

const intelligenceAreas = [
  { id: "lead", name: "Lead intelligence", icon: Target, summary: "Build ICP lists, find relevant buyers, enrich profiles, verify emails, score fit, and identify why-now signals.", output: "Qualified people and accounts ready for Leads", inputs: ["ICP and buyer criteria", "People and company enrichment", "Email verification", "Intent and timing signals"] },
  { id: "market", name: "Market intelligence", icon: Activity, summary: "Estimate market size, map segments, find growing companies, and monitor hiring, funding, adoption, and geographic expansion.", output: "Prioritised market segments and growth watchlists", inputs: ["Market sizing", "Segment mapping", "Funding and hiring", "Technology adoption"] },
  { id: "competitive", name: "Competitive intelligence", icon: Search, summary: "Track competitor ads, PPC keywords, rankings, backlinks, hiring, reviews, social posts, and campaign changes.", output: "Competitor movement alerts and response briefs", inputs: ["Search and ad history", "Rankings and backlinks", "Hiring signals", "Creative and messaging changes"] },
  { id: "customer", name: "Customer intelligence", icon: Users, summary: "Enrich inbound leads, classify accounts, analyze reviews and comments, find expansion opportunities, and route accounts.", output: "Enriched accounts with expansion and routing signals", inputs: ["Inbound enrichment", "Account classification", "Review analysis", "Expansion opportunities"] },
  { id: "marketing", name: "Marketing intelligence", icon: CircleDollarSign, summary: "Combine GA4, Search Console, advertising data, SEO demand, creator performance, and social trends.", output: "One performance view across acquisition channels", inputs: ["GA4 and Search Console", "Paid media performance", "SEO demand", "Creator and social trends"] },
  { id: "product", name: "Product intelligence", icon: Sparkles, summary: "Mine reviews, Reddit discussions, social comments, app listings, and YouTube content for recurring problems and feature requests.", output: "Evidence-backed problems and feature opportunities", inputs: ["Reviews and app stores", "Reddit and communities", "Social comments", "Video and creator content"] },
  { id: "partner", name: "Partner intelligence", icon: Network, summary: "Find agencies, creators, affiliates, integration partners, and complementary products; qualify and rank them.", output: "Ranked partner pipeline with fit evidence", inputs: ["Agency discovery", "Creator and affiliate fit", "Integration partners", "Complementary products"] },
  { id: "executive", name: "Executive intelligence", icon: FileText, summary: "Produce a weekly digest covering pipeline, competitors, market signals, campaign performance, and notable risks.", output: "Decision-ready weekly executive brief", inputs: ["Pipeline movement", "Competitive changes", "Market signals", "Performance and risk"] },
  { id: "providers", name: "Data-provider management", icon: Building2, summary: "Compare providers by cost, reliability, speed, and coverage before committing to multiple subscriptions.", output: "Evidence-based provider shortlist and spend plan", inputs: ["Cost comparison", "Coverage and freshness", "Reliability and limits", "Trial-before-buy decisions"] },
];

type ProviderCapability = { group: string; capability: string; provider: string; commercial: string; access?: string };
const providerCapabilities: ProviderCapability[] = [
  { group: "Keyword & rank tracking", capability: "Keyword volume & ideas", provider: "Semrush", commercial: "$139/mo" },
  { group: "Keyword & rank tracking", capability: "Competitor keywords", provider: "Serpstat", commercial: "$69/mo" },
  { group: "Keyword & rank tracking", capability: "Domain & ad history", provider: "SpyFu", commercial: "$39/mo" },
  { group: "Keyword & rank tracking", capability: "Keyword difficulty", provider: "DataForSEO Labs", commercial: "Usage based" },
  { group: "Keyword & rank tracking", capability: "Live SERP results", provider: "SerpApi", commercial: "$75/mo" },
  { group: "Keyword & rank tracking", capability: "Rank tracking", provider: "SE Ranking", commercial: "$65/mo" },
  { group: "Keyword & rank tracking", capability: "Search Console", provider: "SEOTesting", commercial: "$40/mo", access: "OAuth" },
  { group: "Backlinks & authority", capability: "Backlinks & anchors", provider: "Moz", commercial: "$99/mo" },
  { group: "Backlinks & authority", capability: "Trust & citation flow", provider: "Majestic", commercial: "$50/mo" },
  { group: "Backlinks & authority", capability: "Referring domains", provider: "DataForSEO Backlinks", commercial: "Usage based" },
  { group: "Backlinks & authority", capability: "Broken-link audit", provider: "Crawl endpoints", commercial: "Usage based" },
  { group: "AI visibility", capability: "AI Overview citations", provider: "SerpApi", commercial: "$75/mo" },
  { group: "AI visibility", capability: "Brand mentions in answers", provider: "Custom monitoring", commercial: "No official API" },
  { group: "AI visibility", capability: "Cited-source tracking", provider: "Custom monitoring", commercial: "No official API" },
  { group: "AI visibility", capability: "Where LLMs source it", provider: "Research workflow", commercial: "Rate-limited" },
  { group: "Trending & discovery", capability: "TikTok trends & sounds", provider: "TikTok API", commercial: "Invite-only" },
  { group: "Trending & discovery", capability: "X posts & profiles", provider: "X API", commercial: "$200/mo" },
  { group: "Trending & discovery", capability: "Instagram posts & reels", provider: "Instagram API", commercial: "App review" },
  { group: "Trending & discovery", capability: "YouTube videos & stats", provider: "YouTube API", commercial: "Quota-capped" },
  { group: "Trending & discovery", capability: "Creator analytics", provider: "Platform research", commercial: "Not publicly exposed" },
  { group: "Trending & discovery", capability: "Follower & profile graph", provider: "Platform APIs", commercial: "App review" },
  { group: "Trending & discovery", capability: "Subreddit posts", provider: "Reddit API", commercial: "Rate-limited" },
  { group: "Trending & discovery", capability: "LinkedIn posts & pages", provider: "LinkedIn API", commercial: "Partner-only" },
  { group: "Publish on socials", capability: "Post to X", provider: "Postiz", commercial: "$29/mo", access: "OAuth" },
  { group: "Publish on socials", capability: "Publish Instagram reels", provider: "Postiz", commercial: "$29/mo", access: "OAuth" },
  { group: "Publish on socials", capability: "Post to LinkedIn", provider: "Postiz", commercial: "$29/mo", access: "OAuth" },
  { group: "Publish on socials", capability: "Upload to YouTube", provider: "Postiz", commercial: "$29/mo", access: "OAuth" },
  { group: "Enrich people & company", capability: "Find & verify work email", provider: "Hunter", commercial: "$34/mo" },
  { group: "Enrich people & company", capability: "Person enrichment", provider: "Lusha", commercial: "$49/mo" },
  { group: "Enrich people & company", capability: "Profile & role history", provider: "PDL", commercial: "Credit packs" },
  { group: "Enrich people & company", capability: "Contact search", provider: "Apollo", commercial: "$59/seat" },
  { group: "Enrich people & company", capability: "Funding & investors", provider: "Crunchbase", commercial: "$99/mo", access: "TC" },
  { group: "Enrich people & company", capability: "Company firmographics", provider: "Commercial datasets", commercial: "Per-seat plans" },
  { group: "Enrich people & company", capability: "Knowledge-graph lookup", provider: "Diffbot", commercial: "$299/mo", access: "CS" },
  { group: "Enrich people & company", capability: "Company news & signals", provider: "Enterprise providers", commercial: "Enterprise-only" },
  { group: "Enrich people & company", capability: "Hiring & headcount", provider: "Enterprise providers", commercial: "Enterprise-only" },
  { group: "Enrich people & company", capability: "Mobile & social lookup", provider: "LeadMagic", commercial: "Credits" },
  { group: "Enrich people & company", capability: "Local business data", provider: "Maps providers", commercial: "Rate-limited" },
  { group: "Enrich people & company", capability: "Deliverability check", provider: "Hunter", commercial: "$34/mo" },
  { group: "Manage ad campaigns", capability: "Google Ads campaigns", provider: "Optmyzr", commercial: "$249/mo", access: "OAuth" },
  { group: "Manage ad campaigns", capability: "Meta Ads budgets", provider: "Revealbot", commercial: "$99/mo", access: "OAuth" },
  { group: "Manage ad campaigns", capability: "TikTok Ads", provider: "Madgicx", commercial: "$55/mo", access: "OAuth" },
  { group: "Manage ad campaigns", capability: "Microsoft Ads", provider: "Adalysis", commercial: "$99/mo", access: "OAuth" },
  { group: "Competitor creative", capability: "Meta Ad Library", provider: "Manual research", commercial: "Public library" },
  { group: "Competitor creative", capability: "Google Ads Transparency", provider: "SerpApi", commercial: "$75/mo" },
  { group: "Competitor creative", capability: "TikTok ad library", provider: "TikTok", commercial: "EU-only UI" },
  { group: "Competitor creative", capability: "LinkedIn ad library", provider: "Manual research", commercial: "Public library" },
  { group: "Measurement", capability: "GA4 sessions, goals & conversions", provider: "Supermetrics", commercial: "$69/mo", access: "OAuth" },
  { group: "Measurement", capability: "Business Profile", provider: "BrightLocal", commercial: "$39/mo", access: "OAuth" },
  { group: "Measurement", capability: "Pinterest Ads", provider: "Tailwind", commercial: "$25/mo", access: "OAuth" },
  { group: "Measurement", capability: "Snapchat Ads", provider: "Ads Manager", commercial: "Manual", access: "OAuth" },
  { group: "Measurement", capability: "Slack messages", provider: "Slack", commercial: "Workspace app" },
  { group: "Measurement", capability: "Actor runs at scale", provider: "Automation providers", commercial: "Per-seat plans" },
  { group: "Measurement", capability: "Channel analytics", provider: "Platform APIs", commercial: "Quota-capped" },
  { group: "Measurement", capability: "Google Trends", provider: "Research workflow", commercial: "No official API" },
];

const nav = [
  { id: "overview" as View, path: "/", label: "Overview", icon: LayoutGrid },
  { id: "intelligence" as View, path: "/intelligence", label: "Intelligence", icon: Lightbulb },
  { id: "capabilities" as View, path: "/capabilities", label: "Capabilities", icon: Sparkles },
  { id: "accounts" as View, path: "/accounts", label: "Accounts", icon: Building2 },
  { id: "events" as View, path: "/events", label: "Events", icon: CalendarDays },
  { id: "leads" as View, path: "/leads", label: "Leads", icon: Users },
  { id: "pipeline" as View, path: "/pipeline", label: "Pipeline", icon: Target },
  { id: "doors" as View, path: "/open-doors", label: "Open doors", icon: ContactRound },
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
  const [selected, setSelected] = useState("rag");
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
  const [toast, setToast] = useState("");
  const active = capabilities.find((c) => c.id === selected)!;
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
  const qualifyEvent = (event: EventRecord) => {
    if (!event.attendeeData?.length) { notify("Upload the attendee spreadsheet before analysis"); return; }
    const linkedinProfiles = event.attendeeData.filter((attendee) => attendee.linkedin).length;
    if (!linkedinProfiles) { notify("No LinkedIn column or profile URLs were found"); return; }
    notify(`${linkedinProfiles} LinkedIn profiles are ready · connect an enrichment provider to run AI analysis`);
  };
  return (
    <div className="app-shell">
      <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-header">
          <a className="brand" href="https://www.quicksort.fr" aria-label="Quicksort home">
            <span className="brand-word">Quicksort</span>
            <span className="brand-symbol" aria-hidden="true"><span className="brand-disc"/><span className="brand-cut"/><span className="brand-dot"/></span>
          </a>
        </div>
        <div className="portal-label">Intelligence workspace</div>
        <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20}/></button>
        <nav aria-label="Primary navigation">
          {nav.map(({ id, path, label, icon: Icon }) => <a key={id} href={path} className={view === id ? "active" : ""} onClick={(event) => { event.preventDefault(); go(id); }}><Icon size={18}/>{label}</a>)}
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
        {view === "overview" && <Overview active={active} selected={selected} setSelected={setSelected} go={go} notify={notify} accounts={accountRecords} leads={leadRecords} events={eventRecords}/>}
        {view === "intelligence" && <IntelligenceHub notify={notify}/>}
        {view === "capabilities" && <Capabilities active={active} selected={selected} setSelected={setSelected}/>} 
        {view === "accounts" && (selectedAccount
          ? <AccountDetail account={accountRecords.find((account) => account.id === selectedAccount)!} intel={intelRecords[selectedAccount]} onSave={saveAccount} onBack={() => navigate("accounts")} notify={notify}/>
          : <Accounts query={query} setQuery={setQuery} accounts={filteredAccounts} openAccount={(id) => navigate("accounts", id)} notify={notify}/>)} 
        {view === "events" && <Events events={eventRecords} onChange={saveEvents} onQualify={qualifyEvent} notify={notify}/>}
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

function Overview({ active, selected, setSelected, go, notify, accounts, leads, events }: { active: Capability; selected: string; setSelected: (id: string) => void; go: (v: View) => void; notify: (m: string) => void; accounts: Account[]; leads: LeadRecord[]; events: EventRecord[] }) {
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
        <CapabilityGraph selected={selected} setSelected={setSelected}/>
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

function IntelligenceHub({ notify }: { notify: (message: string) => void }) {
  const [selectedArea, setSelectedArea] = useState("lead");
  const [selectedGroup, setSelectedGroup] = useState("All");
  const [providerQuery, setProviderQuery] = useState("");
  const area = intelligenceAreas.find((item) => item.id === selectedArea)!;
  const AreaIcon = area.icon;
  const groups = ["All", ...Array.from(new Set(providerCapabilities.map((item) => item.group)))];
  const filteredProviders = providerCapabilities.filter((item) => (selectedGroup === "All" || item.group === selectedGroup) && `${item.capability} ${item.provider} ${item.group}`.toLowerCase().includes(providerQuery.toLowerCase()));
  return <div className="page intelligence-page">
    <PageIntro title="Intelligence command centre" text="Turn fragmented market, customer and channel data into prioritised commercial action." action={<button className="primary" onClick={() => notify("New intelligence brief ready to configure")}><Plus size={16}/> New brief</button>}/>
    <section className="intelligence-hero">
      <div><span>QuickSort intelligence system</span><h2>Nine lenses.<br/>One operating picture.</h2></div>
      <p>Choose an intelligence area to define the question, then assemble the smallest reliable provider stack to answer it.</p>
      <div className="intelligence-hero-stats"><div><strong>{intelligenceAreas.length}</strong><small>intelligence areas</small></div><div><strong>{providerCapabilities.length}</strong><small>data capabilities</small></div><div><strong>{groups.length - 1}</strong><small>provider groups</small></div></div>
    </section>
    <div className="intelligence-layout">
      <nav className="intelligence-area-nav" aria-label="Intelligence areas">{intelligenceAreas.map(({ id, name, icon: Icon }) => <button key={id} className={selectedArea === id ? "active" : ""} onClick={() => setSelectedArea(id)}><Icon size={16}/><span>{name}</span><ArrowUpRight size={13}/></button>)}</nav>
      <section className="surface intelligence-area-detail">
        <div className="intelligence-detail-head"><span><AreaIcon size={22}/></span><div><small>Intelligence area</small><h2>{area.name}</h2></div></div>
        <p>{area.summary}</p>
        <div className="intelligence-output"><small>Primary output</small><strong>{area.output}</strong></div>
        <div className="intelligence-inputs"><small>What it combines</small>{area.inputs.map((input) => <span key={input}><i/>{input}</span>)}</div>
        <div className="intelligence-actions"><button className="primary" onClick={() => notify(`${area.name} brief created`)}>Create brief</button><button className="secondary" onClick={() => { setSelectedGroup("All"); document.querySelector(".provider-catalogue")?.scrollIntoView({ behavior: "smooth" }); }}>View data options</button></div>
      </section>
    </div>
    <section className="surface provider-catalogue">
      <div className="provider-heading"><div><h2>Data capability catalogue</h2><p>Compare access, cost and coverage before adding another subscription.</p></div><span>{filteredProviders.length} options</span></div>
      <div className="provider-controls"><label><Search size={16}/><input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder="Search capabilities or providers"/></label><div className="provider-groups">{groups.map((group) => <button key={group} className={selectedGroup === group ? "active" : ""} onClick={() => setSelectedGroup(group)}>{group}</button>)}</div></div>
      <div className="provider-table-head"><span>Capability</span><span>Provider</span><span>Commercial model</span><span>Access</span><span/></div>
      <div className="provider-list">{filteredProviders.map((item) => <article className="provider-row" key={`${item.group}-${item.capability}`}><div><small>{item.group}</small><strong>{item.capability}</strong></div><span>{item.provider}</span><span>{item.commercial}</span><span>{item.access ?? "Direct"}</span><button onClick={() => notify(`${item.provider} added to comparison`)}>Compare <Plus size={13}/></button></article>)}</div>
      {filteredProviders.length === 0 && <div className="provider-empty">No provider capabilities match this search.</div>}
    </section>
  </div>;
}

function Metric({ label, value, change, icon: Icon }: { label: string; value: string; change: string; icon: React.ElementType }) {
  return <div className="metric"><div className="metric-label"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><p>{change}</p></div>;
}

function CapabilityGraph({ selected, setSelected }: { selected: string; setSelected: (id: string) => void }) {
  return <div className="graph" aria-label="Interactive capability graph">
    <svg viewBox="0 0 720 250" preserveAspectRatio="none" aria-hidden="true"><path d="M360 74 C300 88 182 89 118 152 M360 74 C340 112 295 112 273 154 M360 74 C388 110 427 112 447 154 M360 74 C430 86 552 89 608 152"/><path className="pulse-line" d="M360 74 C300 88 182 89 118 152"/></svg>
    <div className="hub"><span className="hub-logo">QS</span><div><strong>QuickSort</strong><small>No evidence added</small></div></div>
    {capabilities.map((cap, index) => <button key={cap.id} className={`graph-node n${index + 1} ${cap.color} ${selected === cap.id ? "selected" : ""}`} onClick={() => setSelected(cap.id)}><span>{cap.short}</span><small>{cap.people} people</small></button>)}
  </div>;
}

function CapabilityDetail({ capability }: { capability: Capability }) {
  return <div className="capability-detail"><div><span className={`dot ${capability.color}`}/><div><strong>{capability.name}</strong><p>{capability.proof}</p></div></div><div className="tech-list">{capability.technologies.length ? capability.technologies.map((tech) => <span key={tech}>{tech}</span>) : <small>No technology evidence added.</small>}</div><div className="avatars">{capability.experts.length ? capability.experts.map((expert) => <span key={expert.initials} title={expert.name}>{expert.initials}</span>) : <small>No people evidence added.</small>}</div></div>;
}

function Capabilities({ active, selected, setSelected }: { active: Capability; selected: string; setSelected: (id: string) => void }) {
  return <div className="page"><PageIntro title="Delivery capability portfolio" text="Every claim is backed by people, deliverables and production experience." action={<button className="secondary"><Filter size={16}/> Filter evidence</button>}/>
    <div className="capabilities-layout"><section className="surface cap-map"><div className="section-head"><div><h2>QuickSort capability map</h2><p>Select a domain to inspect its evidence</p></div></div><CapabilityGraph selected={selected} setSelected={setSelected}/><div className="cap-grid">{capabilities.map((cap) => <button key={cap.id} className={selected === cap.id ? "cap-card active" : "cap-card"} onClick={() => setSelected(cap.id)}><span className={`dot ${cap.color}`}/><strong>{cap.name}</strong><small>{cap.projects} projects · {cap.people} people</small></button>)}</div></section>
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

function Events({ events, onChange, onQualify, notify }: { events: EventRecord[]; onChange: (events: EventRecord[]) => void; onQualify: (event: EventRecord) => void; notify: (message: string) => void }) {
  const [lumaUrl, setLumaUrl] = useState("");
  const [error, setError] = useState("");
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const uploadedEvents = events.filter((event) => event.attendeeData?.length);
  const attendeeRows = events.reduce((total, event) => total + event.attendees, 0);
  const linkedinProfiles = events.reduce((total, event) => total + (event.attendeeData?.filter((attendee) => attendee.linkedin).length ?? 0), 0);
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
      const normalized = rows.map((row) => {
        const sourceRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "").trim()]));
        const lookup = Object.fromEntries(Object.entries(sourceRow).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ""), value]));
        const get = (...keys: string[]) => keys.map((key) => lookup[key]).find(Boolean) ?? "";
        const linkedin = Object.entries(lookup).find(([key]) => key.includes("linkedin") || key === "profileurl")?.[1] ?? "";
        const firstName = get("firstname", "givenname");
        const lastName = get("lastname", "surname", "familyname");
        return {
          name: get("fullname", "name", "attendeename") || [firstName, lastName].filter(Boolean).join(" "),
          role: get("jobtitle", "title", "role", "position"),
          company: get("company", "companyname", "organisation", "organization"),
          linkedin,
          email: get("email", "emailaddress"),
          sourceRow,
        } satisfies ImportedAttendee;
      }).filter((attendee) => Object.values(attendee.sourceRow).some(Boolean));
      if (!normalized.length) throw new Error("No attendee rows were found in the first worksheet.");
      const next = events.map((item) => item.id === eventId ? { ...item, fileName: file.name, attendeeData: normalized, attendees: normalized.length, qualified: 0, status: "Ready to analyze" as const } : item);
      onChange(next);
      setUploadErrors((current) => ({ ...current, [eventId]: "" }));
      notify(`${normalized.length} attendee rows loaded from ${file.name}`);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "This file could not be read.";
      setUploadErrors((current) => ({ ...current, [eventId]: message }));
    }
  };
  return <div className="page events-page">
    <PageIntro title="Events intelligence" text="Add an event, upload the real attendee sheet, then prepare LinkedIn profiles for authorized enrichment."/>
    <section className="event-importer">
      <div className="event-import-copy"><span className="import-icon"><CalendarDays size={22}/></span><div><h2>Bring in a Luma event</h2><p>The Luma link creates the event only. Attendee data appears after you upload a spreadsheet.</p></div></div>
      <form onSubmit={addEvent}><label htmlFor="luma-link">Luma event link</label><div><input id="luma-link" value={lumaUrl} onChange={(event) => { setLumaUrl(event.target.value); setError(""); }} placeholder="https://lu.ma/your-event"/><button className="primary" type="submit"><Plus size={16}/> Import event</button></div>{error && <p className="form-error" role="alert">{error}</p>}</form>
    </section>
    <div className="event-flow" aria-label="Event lead workflow"><span><b>1</b> Add Luma event</span><i/><span><b>2</b> Upload attendee sheet</span><i/><span><b>3</b> Enrich LinkedIn profiles</span></div>
    <section className="event-metrics"><div><span>Events added</span><strong>{events.length}</strong></div><div><span>Files uploaded</span><strong>{uploadedEvents.length}</strong></div><div><span>Attendee rows</span><strong>{attendeeRows}</strong></div><div><span>LinkedIn profiles</span><strong>{linkedinProfiles}</strong></div></section>
    <section className="surface event-workspace"><div className="section-head"><div><h2>Event queue</h2><p>Analyze new attendee lists or revisit completed results</p></div><span className="case-count">{events.length} events</span></div>
      <div className="event-table-head"><span>Event</span><span>Attendees</span><span>LinkedIn</span><span>Status</span><span>Source data</span></div>
      <div className="event-work-list">{events.map((event) => <article key={event.id} className="event-work-row">
        <div className="event-identity"><span><CalendarDays size={18}/></span><div><strong>{event.title}</strong><small>{event.date} · {event.location}</small><a href={event.lumaUrl} target="_blank" rel="noreferrer">Open Luma <ArrowUpRight size={12}/></a>{event.fileName && <em>{event.fileName}</em>}</div></div>
        <strong className="event-number">{event.attendeeData?.length ? event.attendees : "—"}</strong><strong className="event-number event-qualified">{event.attendeeData?.length ? event.attendeeData.filter((attendee) => attendee.linkedin).length : "—"}</strong>
        <span className={`analysis-status ${event.status === "Analyzed" ? "complete" : "ready"}`}><i/>{event.status}</span>
        <div className="event-actions"><label className="secondary file-action"><FileText size={15}/>{event.fileName ? "Replace file" : "Upload file"}<input type="file" accept=".xlsx,.xls,.csv" onChange={(input) => void uploadAttendees(event.id, input.target.files?.[0])}/></label><button className="primary" disabled={!event.attendeeData?.length} onClick={() => onQualify(event)}><Sparkles size={15}/> Analyze with AI</button>{uploadErrors[event.id] && <small className="event-upload-error" role="alert">{uploadErrors[event.id]}</small>}</div>
      </article>)}</div>
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
