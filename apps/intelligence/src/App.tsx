import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowUpRight, BriefcaseBusiness, Building2, CalendarDays, ChevronDown, CircleDollarSign,
  ContactRound, FileText, Filter, LayoutGrid, Lightbulb, Menu, Network, Plus, Search,
  Pencil, Save, ShieldCheck, Sparkles, Target, UserRound, Users, X,
} from "lucide-react";

type View = "overview" | "capabilities" | "accounts" | "pipeline" | "doors";
type Capability = {
  id: string; name: string; short: string; color: string; people: number; projects: number;
  technologies: string[]; proof: string; experts: { initials: string; name: string; role: string }[];
};

const capabilities: Capability[] = [
  { id: "rag", name: "Enterprise RAG", short: "RAG", color: "blue", people: 6, projects: 4, technologies: ["Docling", "Qdrant", "Azure OpenAI"], proof: "4 production systems", experts: [{ initials: "AD", name: "Aïcha Dridi", role: "AI engineer" }, { initials: "MM", name: "Murad Mustafayev", role: "ML lead" }, { initials: "IH", name: "Issa Hammoud", role: "Data engineer" }] },
  { id: "voice", name: "Voice AI", short: "Voice", color: "violet", people: 8, projects: 3, technologies: ["LiveKit", "Deepgram", "ElevenLabs"], proof: "3 real-time deployments", experts: [{ initials: "NA", name: "Nader Sadek", role: "AI engineer" }, { initials: "AR", name: "Amadou Renaud", role: "Product engineer" }, { initials: "MK", name: "Mirette Karam", role: "Conversation designer" }] },
  { id: "agents", name: "Agentic AI", short: "Agents", color: "orange", people: 11, projects: 6, technologies: ["LangGraph", "CrewAI", "MCP"], proof: "6 client programmes", experts: [{ initials: "MA", name: "Mohamed Amari", role: "AI architect" }, { initials: "AK", name: "Alexandra Kim", role: "Product lead" }, { initials: "NK", name: "Nageeta Kumari", role: "ML engineer" }] },
  { id: "data", name: "Data for AI", short: "Data", color: "green", people: 9, projects: 7, technologies: ["dbt", "Airflow", "Snowflake"], proof: "7 data foundations", experts: [{ initials: "FA", name: "Frimpong Adotri", role: "Data lead" }, { initials: "AS", name: "Asmae Karmouchi", role: "Data engineer" }, { initials: "JB", name: "Jermiah Brown", role: "Platform engineer" }] },
];

const accounts = [
  {
    id: "bnp-paribas", name: "BNP Paribas", sector: "Financial services", contacts: 8, signal: "Strong", opportunity: "Knowledge copilot", value: "€240k", stage: "Discovery", owner: "MA", fit: ["RAG", "Agents"],
    caseStudies: [
      { title: "Regulated knowledge assistant", client: "European retail bank", summary: "A governed RAG assistant that helps operations teams find policy answers with source-level citations.", outcome: "42% faster policy resolution", evidence: "Production", tags: ["RAG", "Azure OpenAI"] },
      { title: "Analyst research copilot", client: "Global financial institution", summary: "An agentic research workflow spanning internal research, market data and compliance-approved summaries.", outcome: "6 hours saved per analyst weekly", evidence: "Reusable", tags: ["Agents", "Qdrant"] },
    ],
  },
  {
    id: "axa", name: "AXA", sector: "Insurance", contacts: 5, signal: "Warm", opportunity: "Claims voice agent", value: "€180k", stage: "Meeting", owner: "AD", fit: ["Voice", "Data"],
    caseStudies: [
      { title: "Claims intake voice agent", client: "European insurer", summary: "A real-time voice assistant that captures first-notice-of-loss details and routes complex claims to specialists.", outcome: "31% lower handling time", evidence: "Production", tags: ["Voice", "LiveKit"] },
      { title: "Claims document intelligence", client: "Specialty insurance group", summary: "A document pipeline that extracts, validates and prioritises claim evidence for human review.", outcome: "68% straight-through extraction", evidence: "Reusable", tags: ["Data", "Docling"] },
    ],
  },
  {
    id: "kering", name: "Kering", sector: "Luxury", contacts: 4, signal: "New", opportunity: "Retail intelligence", value: "€135k", stage: "Contacted", owner: "NK", fit: ["Agents", "Data"],
    caseStudies: [
      { title: "Store performance intelligence", client: "Global luxury retailer", summary: "A daily decision layer combining store, product and clienteling signals for regional retail teams.", outcome: "18% faster action on store signals", evidence: "Production", tags: ["Data", "Snowflake"] },
      { title: "Clienteling recommendation agent", client: "Premium fashion house", summary: "An assisted-selling agent that turns customer history and catalogue data into explainable recommendations.", outcome: "12% uplift in assisted conversion", evidence: "Reusable", tags: ["Agents", "RAG"] },
    ],
  },
  {
    id: "foundever", name: "Foundever", sector: "Customer experience", contacts: 6, signal: "Warm", opportunity: "Multilingual service automation", value: "€220k", stage: "Discovery", owner: "MA", fit: ["Voice", "Agents"],
    caseStudies: [
      { title: "Multilingual customer service agent", client: "Global service provider", summary: "A real-time voice agent supporting customer journeys across languages while preserving human escalation paths.", outcome: "29% lower average handling time", evidence: "Production", tags: ["Voice", "Agents"] },
      { title: "Agent knowledge copilot", client: "European contact centre", summary: "A grounded assistant that surfaces approved answers and next-best actions during live conversations.", outcome: "18% higher first-contact resolution", evidence: "Reusable", tags: ["RAG", "Data"] },
    ],
  },
  {
    id: "cdg-capital-morocco", name: "CDG Capital Morocco", sector: "Financial services", contacts: 5, signal: "New", opportunity: "Investment research copilot", value: "€165k", stage: "Contacted", owner: "AD", fit: ["RAG", "Data"],
    caseStudies: [
      { title: "Investment research assistant", client: "Regional investment bank", summary: "A bilingual research copilot that connects market intelligence, internal notes and approved investment documents.", outcome: "55% faster research preparation", evidence: "Production", tags: ["RAG", "Data"] },
      { title: "Portfolio reporting automation", client: "Asset management group", summary: "An agentic reporting workflow that validates source data and produces review-ready portfolio commentary.", outcome: "3 days saved each reporting cycle", evidence: "Reusable", tags: ["Agents", "Data"] },
    ],
  },
];

const pipeline = [
  { stage: "Identified", total: "€455k", cards: [{ company: "Kering", title: "Retail intelligence", value: "€135k", age: "2d" }, { company: "Orange", title: "Support automation", value: "€320k", age: "5d" }] },
  { stage: "Meeting", total: "€300k", cards: [{ company: "AXA", title: "Claims voice agent", value: "€180k", age: "Tomorrow" }, { company: "Veolia", title: "Operations copilot", value: "€120k", age: "Oct 12" }] },
  { stage: "Discovery", total: "€240k", cards: [{ company: "BNP Paribas", title: "Knowledge copilot", value: "€240k", age: "4d" }] },
  { stage: "Proposal", total: "€415k", cards: [{ company: "Foundever", title: "Multilingual service automation", value: "€220k", age: "Oct 9" }, { company: "Sanofi", title: "Research agent", value: "€195k", age: "Oct 15" }] },
];

const nav = [
  { id: "overview" as View, path: "/", label: "Overview", icon: LayoutGrid },
  { id: "capabilities" as View, path: "/capabilities", label: "Capabilities", icon: Sparkles },
  { id: "accounts" as View, path: "/accounts", label: "Accounts", icon: Building2 },
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

export default function App() {
  const initialRoute = useMemo(routeFromLocation, []);
  const storedWorkspace = useMemo(() => {
    try {
      const saved = window.localStorage.getItem("quicksort-intelligence-accounts-v1");
      return saved ? JSON.parse(saved) as { accounts: Account[]; intel: Record<string, AccountIntel> } : null;
    } catch { return null; }
  }, []);
  const [view, setView] = useState<View>(initialRoute.view);
  const [selected, setSelected] = useState("rag");
  const [query, setQuery] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(initialRoute.account);
  const [accountRecords, setAccountRecords] = useState<Account[]>(storedWorkspace?.accounts ?? accounts);
  const [intelRecords, setIntelRecords] = useState<Record<string, AccountIntel>>(storedWorkspace?.intel ?? accountIntel);
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
    window.localStorage.setItem("quicksort-intelligence-accounts-v1", JSON.stringify({ accounts: nextAccounts, intel: nextIntel }));
    notify("Account changes saved");
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
          <button><span className="profile-dot">JS</span><span>Jerry S.</span><ChevronDown size={15}/></button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20}/></button>
          <div className="breadcrumbs">Intelligence <span>/</span> {nav.find((item) => item.id === view)?.label}</div>
          <div className="top-actions"><button className="icon-button" aria-label="Search"><Search size={18}/></button><button className="primary" onClick={() => notify("New record ready to configure")}><Plus size={17}/> Add record</button></div>
        </header>
        {view === "overview" && <Overview active={active} selected={selected} setSelected={setSelected} go={go} notify={notify}/>} 
        {view === "capabilities" && <Capabilities active={active} selected={selected} setSelected={setSelected}/>} 
        {view === "accounts" && (selectedAccount
          ? <AccountDetail account={accountRecords.find((account) => account.id === selectedAccount)!} intel={intelRecords[selectedAccount]} onSave={saveAccount} onBack={() => navigate("accounts")} notify={notify}/>
          : <Accounts query={query} setQuery={setQuery} accounts={filteredAccounts} openAccount={(id) => navigate("accounts", id)} notify={notify}/>)} 
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

function Overview({ active, selected, setSelected, go, notify }: { active: Capability; selected: string; setSelected: (id: string) => void; go: (v: View) => void; notify: (m: string) => void }) {
  return <div className="page">
    <PageIntro title="Company intelligence, connected." text="Delivery evidence and commercial relationships in one live view." action={<button className="quiet-action" onClick={() => notify("Workspace data is up to date")}><Activity size={16}/> Live now</button>}/>
    <section className="metrics-grid" aria-label="Portfolio metrics">
      <Metric label="Active opportunities" value="18" change="+4 this month" icon={Target}/>
      <Metric label="Qualified pipeline" value="€1.50m" change="62% evidence matched" icon={CircleDollarSign}/>
      <Metric label="Proven capabilities" value="12" change="Across 28 deliveries" icon={Sparkles}/>
      <Metric label="Warm relationships" value="47" change="11 need follow-up" icon={Users}/>
    </section>
    <div className="overview-grid">
      <section className="surface capability-surface">
        <div className="section-head"><div><h2>Capability constellation</h2><p>Experience aggregated from delivered work</p></div><button onClick={() => go("capabilities")}>Explore portfolio <ArrowUpRight size={15}/></button></div>
        <CapabilityGraph selected={selected} setSelected={setSelected}/>
        <CapabilityDetail capability={active}/>
      </section>
      <section className="surface match-surface">
        <div className="match-kicker"><Lightbulb size={17}/> Best next match</div>
        <h2>BNP Paribas</h2><p className="match-title">Enterprise knowledge copilot</p>
        <div className="fit-score"><div><strong>92</strong><span>%</span></div><p>Delivery fit based on QuickSort’s proven work</p></div>
        <div className="evidence-list">
          <div><span>06</span><p><strong>Relevant engineers</strong>Enterprise RAG experience</p></div>
          <div><span>04</span><p><strong>Production projects</strong>Financial services ready</p></div>
          <div><span>02</span><p><strong>Reusable case studies</strong>Cleared for sales use</p></div>
        </div>
        <button className="primary wide" onClick={() => go("accounts")}>Open account intelligence</button>
      </section>
    </div>
    <section className="surface momentum">
      <div className="section-head"><div><h2>Commercial momentum</h2><p>What needs attention across the pipeline</p></div><button onClick={() => go("pipeline")}>Open pipeline <ArrowUpRight size={15}/></button></div>
      <div className="activity-row"><div className="activity-icon violet"><BriefcaseBusiness size={17}/></div><div><strong>Foundever proposal moved forward</strong><p>Multilingual service automation · €220k</p></div><span>12 min</span></div>
      <div className="activity-row"><div className="activity-icon blue"><UserRound size={17}/></div><div><strong>Warm introduction available at AXA</strong><p>Aïcha knows the Head of Claims Transformation</p></div><span>2 hr</span></div>
      <div className="activity-row"><div className="activity-icon green"><FileText size={17}/></div><div><strong>New delivery evidence added</strong><p>Voice orchestration · Retail assistant</p></div><span>Yesterday</span></div>
    </section>
  </div>;
}

function Metric({ label, value, change, icon: Icon }: { label: string; value: string; change: string; icon: React.ElementType }) {
  return <div className="metric"><div className="metric-label"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><p>{change}</p></div>;
}

function CapabilityGraph({ selected, setSelected }: { selected: string; setSelected: (id: string) => void }) {
  return <div className="graph" aria-label="Interactive capability graph">
    <svg viewBox="0 0 720 250" preserveAspectRatio="none" aria-hidden="true"><path d="M360 74 C300 88 182 89 118 152 M360 74 C340 112 295 112 273 154 M360 74 C388 110 427 112 447 154 M360 74 C430 86 552 89 608 152"/><path className="pulse-line" d="M360 74 C300 88 182 89 118 152"/></svg>
    <div className="hub"><span className="hub-logo">QS</span><div><strong>QuickSort</strong><small>28 delivered projects</small></div></div>
    {capabilities.map((cap, index) => <button key={cap.id} className={`graph-node n${index + 1} ${cap.color} ${selected === cap.id ? "selected" : ""}`} onClick={() => setSelected(cap.id)}><span>{cap.short}</span><small>{cap.people} people</small></button>)}
  </div>;
}

function CapabilityDetail({ capability }: { capability: Capability }) {
  return <div className="capability-detail"><div><span className={`dot ${capability.color}`}/><div><strong>{capability.name}</strong><p>{capability.proof}</p></div></div><div className="tech-list">{capability.technologies.map((tech) => <span key={tech}>{tech}</span>)}</div><div className="avatars">{capability.experts.map((expert) => <span key={expert.initials} title={expert.name}>{expert.initials}</span>)}<b>+{capability.people - 3}</b></div></div>;
}

function Capabilities({ active, selected, setSelected }: { active: Capability; selected: string; setSelected: (id: string) => void }) {
  return <div className="page"><PageIntro title="Delivery capability portfolio" text="Every claim is backed by people, deliverables and production experience." action={<button className="secondary"><Filter size={16}/> Filter evidence</button>}/>
    <div className="capabilities-layout"><section className="surface cap-map"><div className="section-head"><div><h2>QuickSort capability map</h2><p>Select a domain to inspect its evidence</p></div></div><CapabilityGraph selected={selected} setSelected={setSelected}/><div className="cap-grid">{capabilities.map((cap) => <button key={cap.id} className={selected === cap.id ? "cap-card active" : "cap-card"} onClick={() => setSelected(cap.id)}><span className={`dot ${cap.color}`}/><strong>{cap.name}</strong><small>{cap.projects} projects · {cap.people} people</small></button>)}</div></section>
      <aside className="surface evidence-panel"><span className={`domain-badge ${active.color}`}>{active.short}</span><h2>{active.name}</h2><p>{active.proof}, with reusable delivery patterns and specialist expertise.</p><div className="evidence-stat"><strong>{active.projects}</strong><span>client projects</span><strong>{active.people}</strong><span>experienced people</span></div><h3>Core stack</h3><div className="tech-list">{active.technologies.map((tech) => <span key={tech}>{tech}</span>)}</div><h3>People with evidence</h3>{active.experts.map((expert) => <div className="expert" key={expert.initials}><span>{expert.initials}</span><div><strong>{expert.name}</strong><small>{expert.role}</small></div><ArrowUpRight size={15}/></div>)}<button className="primary wide">Open capability dossier</button></aside>
    </div>
  </div>;
}

type CaseStudy = { title: string; client: string; summary: string; outcome: string; evidence: string; tags: string[] };
type Account = { id: string; name: string; sector: string; contacts: number; signal: string; opportunity: string; value: string; stage: string; owner: string; fit: string[]; caseStudies: CaseStudy[]; opportunitySummary?: string; fitScore?: string; evidence?: string[] };
type Lead = { name: string; role: string; company: string; status: string; nextStep: string; owner: string };
type AccountEvent = { date: string; month: string; title: string; type: string; detail: string };
type RelationshipContact = { name: string; role: string; strength: string; owner: string };
type AccountIntel = { leads: Lead[]; events: AccountEvent[]; contacts: RelationshipContact[] };

const accountIntel: Record<string, AccountIntel> = {
  "bnp-paribas": {
    contacts: [
      { name: "Camille Laurent", role: "Chief Information Officer", strength: "Strong", owner: "MA" },
      { name: "Sophie Martin", role: "Head of AI Transformation", strength: "Warm", owner: "AD" },
      { name: "Thomas Bernard", role: "GenAI Programme Lead", strength: "Active", owner: "NK" },
    ],
    leads: [
      { name: "Sophie Martin", role: "Head of AI Transformation", company: "BNP Paribas", status: "Qualified", nextStep: "Discovery workshop", owner: "AD" },
      { name: "Julien Moreau", role: "Knowledge Platforms Director", company: "BNP Paribas", status: "Engaged", nextStep: "Share case study", owner: "MA" },
      { name: "Élodie Robert", role: "Procurement Partner", company: "BNP Paribas", status: "New", nextStep: "Request introduction", owner: "NK" },
    ],
    events: [
      { date: "14", month: "OCT", title: "Enterprise AI discovery workshop", type: "Workshop", detail: "Paris · 5 attendees" },
      { date: "21", month: "OCT", title: "Knowledge copilot solution review", type: "Meeting", detail: "Remote · Architecture team" },
      { date: "05", month: "NOV", title: "BNP Paribas AI Forum", type: "Industry event", detail: "Paris · Relationship opportunity" },
    ],
  },
  "axa": {
    contacts: [
      { name: "Claire Dubois", role: "Claims Transformation Director", strength: "Strong", owner: "AD" },
      { name: "Hugo Lefèvre", role: "Customer Operations Lead", strength: "Warm", owner: "MA" },
      { name: "Inès Bernard", role: "AI Governance Manager", strength: "New", owner: "NK" },
    ],
    leads: [
      { name: "Claire Dubois", role: "Claims Transformation Director", company: "AXA", status: "Qualified", nextStep: "Voice demo", owner: "AD" },
      { name: "Hugo Lefèvre", role: "Customer Operations Lead", company: "AXA", status: "Engaged", nextStep: "Validate call flow", owner: "MA" },
      { name: "Inès Bernard", role: "AI Governance Manager", company: "AXA", status: "New", nextStep: "Send risk brief", owner: "NK" },
    ],
    events: [
      { date: "11", month: "OCT", title: "Claims voice agent demonstration", type: "Demo", detail: "Remote · Claims leadership" },
      { date: "18", month: "OCT", title: "Data and compliance review", type: "Workshop", detail: "Paris · Governance team" },
      { date: "07", month: "NOV", title: "Insurance innovation roundtable", type: "Industry event", detail: "Paris · 3 target contacts" },
    ],
  },
  "kering": {
    contacts: [
      { name: "Amélie Laurent", role: "Retail Innovation Director", strength: "Warm", owner: "NK" },
      { name: "Marc Petit", role: "Group Data Platform Lead", strength: "New", owner: "FA" },
      { name: "Lina Rossi", role: "Clienteling Product Owner", strength: "Strong", owner: "AD" },
    ],
    leads: [
      { name: "Amélie Laurent", role: "Retail Innovation Director", company: "Kering", status: "Engaged", nextStep: "Share retail demo", owner: "NK" },
      { name: "Marc Petit", role: "Group Data Platform Lead", company: "Kering", status: "New", nextStep: "Map data landscape", owner: "FA" },
      { name: "Lina Rossi", role: "Clienteling Product Owner", company: "Kering", status: "Qualified", nextStep: "Use-case workshop", owner: "AD" },
    ],
    events: [
      { date: "16", month: "OCT", title: "Retail intelligence introduction", type: "Meeting", detail: "Paris · Innovation team" },
      { date: "29", month: "OCT", title: "Clienteling use-case workshop", type: "Workshop", detail: "Remote · Product and data" },
      { date: "13", month: "NOV", title: "Luxury technology summit", type: "Industry event", detail: "Paris · Executive networking" },
    ],
  },
  "foundever": {
    contacts: [
      { name: "Sonia Alvarez", role: "Global Digital Transformation VP", strength: "Strong", owner: "MA" },
      { name: "David Martin", role: "Conversational AI Director", strength: "Warm", owner: "AD" },
      { name: "Nora Benali", role: "Service Innovation Lead", strength: "Active", owner: "NK" },
    ],
    leads: [
      { name: "Sonia Alvarez", role: "Global Digital Transformation VP", company: "Foundever", status: "Qualified", nextStep: "Discovery workshop", owner: "MA" },
      { name: "David Martin", role: "Conversational AI Director", company: "Foundever", status: "Engaged", nextStep: "Voice demo", owner: "AD" },
      { name: "Nora Benali", role: "Service Innovation Lead", company: "Foundever", status: "New", nextStep: "Share case study", owner: "NK" },
    ],
    events: [
      { date: "15", month: "OCT", title: "Service automation discovery", type: "Workshop", detail: "Remote · Transformation team" },
      { date: "28", month: "OCT", title: "Multilingual voice demonstration", type: "Demo", detail: "Paris · Operations leadership" },
      { date: "20", month: "NOV", title: "Customer experience summit", type: "Industry event", detail: "Madrid · Executive networking" },
    ],
  },
  "cdg-capital-morocco": {
    contacts: [
      { name: "Salma El Idrissi", role: "Chief Digital Officer", strength: "Warm", owner: "AD" },
      { name: "Youssef Alaoui", role: "Head of Investment Research", strength: "Active", owner: "MA" },
      { name: "Imane Bennis", role: "Data & Analytics Director", strength: "New", owner: "FA" },
    ],
    leads: [
      { name: "Salma El Idrissi", role: "Chief Digital Officer", company: "CDG Capital Morocco", status: "Qualified", nextStep: "Executive briefing", owner: "AD" },
      { name: "Youssef Alaoui", role: "Head of Investment Research", company: "CDG Capital Morocco", status: "Engaged", nextStep: "Research demo", owner: "MA" },
      { name: "Imane Bennis", role: "Data & Analytics Director", company: "CDG Capital Morocco", status: "New", nextStep: "Data workshop", owner: "FA" },
    ],
    events: [
      { date: "17", month: "OCT", title: "Investment research introduction", type: "Meeting", detail: "Casablanca · Research team" },
      { date: "31", month: "OCT", title: "Bilingual copilot demonstration", type: "Demo", detail: "Remote · Digital leadership" },
      { date: "26", month: "NOV", title: "Morocco Capital Markets Forum", type: "Industry event", detail: "Casablanca · Executive networking" },
    ],
  },
};

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
  const summary = draft.opportunitySummary ?? "Matched to proven QuickSort delivery evidence and the account’s current transformation priorities.";
  const evidence = draft.evidence ?? ["4 relevant production projects", "6 experienced engineers", `${draft.caseStudies.length} reusable case studies`];

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
          <div className="org-contacts">{draftIntel.contacts.map((contact, index) => <div className="org-contact" key={index}><span>{contact.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><strong><EditField editing={editing} value={contact.name} label={`Contact ${index + 1} name`} onChange={(name) => patchIntelItem("contacts", index, { name })}/></strong><small><EditField editing={editing} value={contact.role} label={`Contact ${index + 1} role`} onChange={(role) => patchIntelItem("contacts", index, { role })}/></small><em><i/> <EditField editing={editing} value={contact.strength} label={`Contact ${index + 1} strength`} onChange={(strength) => patchIntelItem("contacts", index, { strength })}/> · owner <EditField editing={editing} value={contact.owner} label={`Contact ${index + 1} owner`} onChange={(owner) => patchIntelItem("contacts", index, { owner })}/></em></div>)}</div>
        </div>
      </section>
      <aside className="surface opportunity-panel editable-block" onClick={beginEditing}>
        <span className="panel-label">Opportunity</span>
        <h2><EditField editing={editing} value={draft.opportunity} label="Opportunity name" onChange={(opportunity) => patchAccount({ opportunity })}/></h2>
        <p><EditField editing={editing} multiline value={summary} label="Opportunity summary" onChange={(opportunitySummary) => patchAccount({ opportunitySummary })}/></p>
        <div className="opportunity-score"><strong><EditField editing={editing} value={draft.fitScore ?? "92%"} label="Capability fit" onChange={(fitScore) => patchAccount({ fitScore })}/></strong><span>capability fit</span></div>
        <h3>Recommended capabilities</h3>
        {editing ? <input className="inline-edit" aria-label="Recommended capabilities" value={draft.fit.join(", ")} onChange={(event) => patchAccount({ fit: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}/> : <div className="fit-tags">{draft.fit.map((fit) => <span key={fit}>{fit}</span>)}</div>}
        <h3>Evidence ready</h3>
        {editing ? <textarea className="inline-edit textarea" aria-label="Evidence ready" value={evidence.join("\n")} onChange={(event) => patchAccount({ evidence: event.target.value.split("\n") })}/> : <ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
      </aside>
    </div>
    <section className="surface case-studies-section editable-block" onClick={beginEditing}>
      <div className="section-head"><div><h2>Relevant case studies</h2><p>Delivery evidence selected for {draft.name}</p></div><span className="case-count">{draft.caseStudies.length} ready to use</span></div>
      <div className="case-study-grid">{draft.caseStudies.map((study, index) => <article className="case-study-card" key={index}>
        <div className="case-study-top"><span><FileText size={16}/><EditField editing={editing} value={study.evidence} label={`Case study ${index + 1} evidence`} onChange={(evidence) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, evidence } : item) })}/></span>{!editing && <Pencil size={15}/>}</div>
        <div><small><EditField editing={editing} value={study.client} label={`Case study ${index + 1} client`} onChange={(client) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, client } : item) })}/></small><h3><EditField editing={editing} value={study.title} label={`Case study ${index + 1} title`} onChange={(title) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item) })}/></h3><p><EditField editing={editing} multiline value={study.summary} label={`Case study ${index + 1} summary`} onChange={(summary) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, summary } : item) })}/></p></div>
        <div className="case-study-outcome"><span>Proven outcome</span><strong><EditField editing={editing} value={study.outcome} label={`Case study ${index + 1} outcome`} onChange={(outcome) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, outcome } : item) })}/></strong></div>
        {editing ? <input className="inline-edit" aria-label={`Case study ${index + 1} tags`} value={study.tags.join(", ")} onChange={(event) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) } : item) })}/> : <div className="fit-tags">{study.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </article>)}</div>
    </section>
    <div className="account-intel-grid">
      <section className="surface leads-section editable-block" onClick={beginEditing}>
        <div className="section-head"><div><h2>Leads</h2><p>People moving this account forward</p></div><span className="case-count">{draftIntel.leads.length} active</span></div>
        <div className="lead-list">{draftIntel.leads.map((lead, index) => <div className="lead-row" key={index}>
          <span className="lead-avatar">{lead.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
          <span className="lead-person"><strong><EditField editing={editing} value={lead.name} label={`Lead ${index + 1} name`} onChange={(name) => patchIntelItem("leads", index, { name })}/></strong><small><EditField editing={editing} value={lead.role} label={`Lead ${index + 1} role`} onChange={(role) => patchIntelItem("leads", index, { role })}/></small></span>
          <span className={`lead-status ${lead.status.toLowerCase()}`}><EditField editing={editing} value={lead.status} label={`Lead ${index + 1} status`} onChange={(status) => patchIntelItem("leads", index, { status })}/></span>
          <span className="lead-next"><small>Next step</small><strong><EditField editing={editing} value={lead.nextStep} label={`Lead ${index + 1} next step`} onChange={(nextStep) => patchIntelItem("leads", index, { nextStep })}/></strong></span>
          <span className="lead-owner"><EditField editing={editing} value={lead.owner} label={`Lead ${index + 1} owner`} onChange={(owner) => patchIntelItem("leads", index, { owner })}/></span>
        </div>)}</div>
      </section>
      <section className="surface events-section editable-block" onClick={beginEditing}>
        <div className="section-head"><div><h2>Events</h2><p>Key moments around this account</p></div><CalendarDays size={18}/></div>
        <div className="event-list">{draftIntel.events.map((event, index) => <div className="event-row" key={index}>
          <span className="event-date"><strong><EditField editing={editing} value={event.date} label={`Event ${index + 1} day`} onChange={(date) => patchIntelItem("events", index, { date })}/></strong><small><EditField editing={editing} value={event.month} label={`Event ${index + 1} month`} onChange={(month) => patchIntelItem("events", index, { month })}/></small></span>
          <span className="event-info"><small><EditField editing={editing} value={event.type} label={`Event ${index + 1} type`} onChange={(type) => patchIntelItem("events", index, { type })}/></small><strong><EditField editing={editing} value={event.title} label={`Event ${index + 1} title`} onChange={(title) => patchIntelItem("events", index, { title })}/></strong><em><EditField editing={editing} value={event.detail} label={`Event ${index + 1} details`} onChange={(detail) => patchIntelItem("events", index, { detail })}/></em></span>
          {!editing && <Pencil size={14}/>} 
        </div>)}</div>
      </section>
    </div>
  </div>;
}

function Pipeline({ notify }: { notify: (m: string) => void }) {
  return <div className="page"><PageIntro title="Opportunity pipeline" text="Move from first signal to signed work, with delivery evidence attached." action={<button className="primary" onClick={() => notify("New opportunity ready to configure")}><Plus size={16}/> New opportunity</button>}/>
    <div className="pipeline-summary"><span><strong>€1.50m</strong> qualified pipeline</span><span><strong>18</strong> active opportunities</span><span><strong>38%</strong> weighted confidence</span></div>
    <div className="kanban">{pipeline.map((column) => <section className="kanban-column" key={column.stage}><header><div><i/><strong>{column.stage}</strong><span>{column.cards.length}</span></div><small>{column.total}</small></header>{column.cards.map((card) => <button className="deal-card" key={card.company} onClick={() => notify(`${card.company} opportunity opened`)}><div><span>{card.company}</span><small>{card.age}</small></div><h3>{card.title}</h3><p>{card.value}</p><div className="deal-bottom"><span>{card.company.slice(0, 2).toUpperCase()}</span><div className="mini-fit"><i/><i/><i/></div></div></button>)}<button className="add-deal"><Plus size={15}/> Add opportunity</button></section>)}</div>
  </div>;
}

function OpenDoors({ notify }: { notify: (m: string) => void }) {
  const people = [
    { initials: "AD", name: "Aïcha Dridi", role: "AI engineer", companies: ["AXA", "BNP Paribas", "Sanofi"], contacts: 9, introductions: 3 },
    { initials: "MA", name: "Mohamed Amari", role: "AI architect", companies: ["BNP Paribas", "Orange", "Veolia"], contacts: 12, introductions: 5 },
    { initials: "NK", name: "Nageeta Kumari", role: "ML engineer", companies: ["Kering", "LVMH"], contacts: 6, introductions: 2 },
    { initials: "FA", name: "Frimpong Adotri", role: "Data lead", companies: ["CDG Capital Morocco", "Foundever", "TotalEnergies"], contacts: 11, introductions: 4 },
  ];
  return <div className="page"><PageIntro title="Open doors" text="Find the shortest trusted path from QuickSort to the people who can move an opportunity." action={<button className="primary" onClick={() => notify("Relationship ready to add")}><Plus size={16}/> Add relationship</button>}/>
    <section className="surface door-map"><div className="section-head"><div><h2>Relationship network</h2><p>Team members with the strongest commercial reach</p></div><span className="legend"><i/> Strong relationship</span></div><div className="door-grid">{people.map((person) => <article className="person-card" key={person.name}><div className="person-main"><span>{person.initials}</span><div><h3>{person.name}</h3><p>{person.role}</p></div></div><div className="door-numbers"><div><strong>{person.contacts}</strong><span>contacts</span></div><div><strong>{person.introductions}</strong><span>open intros</span></div></div><div className="company-links">{person.companies.map((company, i) => <button key={company} onClick={() => notify(`${company} relationship path opened`)}><i className={i === 0 ? "strong" : ""}/>{company}<ArrowUpRight size={14}/></button>)}</div></article>)}</div></section>
  </div>;
}
