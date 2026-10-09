import { useEffect, useMemo, useRef, useState } from "react";
import { useClerk, useSession } from "@clerk/react";
import { db } from "./workspaceAuth";
import type { EventAiIntelligence } from "./event-intelligence-schema";
import type { CompetitorRecord, CompetitorResult } from "./competitor-schema";
import { autoPanVelocity, draggedPosition, zoomPanAtPoint } from "./relationshipCanvasMath";
import { filterWorkspaceSearch, type WorkspaceSearchEntry } from "./workspaceSearch";
import {
  Activity, ArrowLeft, ArrowUpRight, BookOpen, Building2, CalendarDays, ChevronDown, CircleDollarSign,
  ClipboardPaste, ContactRound, Copy, FileText, Filter, Handshake, LayoutGrid, Lightbulb, Menu, Network, Plus, Search,
  Maximize2, Minus, PanelLeftClose, PanelLeftOpen, Pencil, Redo2, Save, Scissors, ShieldCheck, Sparkles, SquareDashed, Target, Trash2, Undo2, UserPlus, Users, X,
} from "lucide-react";

type View = "overview" | "market" | "competitors" | "marketing" | "partners" | "businessPartners" | "caseStudies" | "executive" | "capabilities" | "accounts" | "events" | "leads" | "pipeline" | "kanban" | "doors" | "guide";
type GlobalSearchEntry = WorkspaceSearchEntry & {
  target: "view" | "account" | "event";
  view: View;
  recordId?: string;
  icon: React.ElementType;
};
type Capability = {
  id: string; name: string; short: string; color: string; people: number; projects: number;
  technologies: string[]; proof: string; experts: { initials: string; name: string; role: string }[];
};

const accountStages = ["New", "Ongoing", "Discovery", "Ended"] as const;
type AccountStage = typeof accountStages[number];
const normalizeAccountStage = (stage: unknown): AccountStage => {
  if (stage === "Discovery" || stage === "New" || stage === "Ongoing" || stage === "Ended") return stage;
  if (stage === "Won" || stage === "Lost") return "Ended";
  if (stage === "Qualified" || stage === "Proposal" || stage === "Contacted" || stage === "Converted") return "Ongoing";
  return "New";
};

const emptyCapabilities: Capability[] = [
  { id: "ai_for_business", name: "AI for Business", short: "AI", color: "blue", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "infrastructure_for_ai", name: "Infrastructure for AI", short: "Infra", color: "green", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "data_for_ai", name: "Data for AI", short: "Data", color: "orange", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
  { id: "voice_ai", name: "Voice AI", short: "Voice", color: "violet", people: 0, projects: 0, technologies: [], proof: "No approved candidate evidence yet", experts: [] },
];

const accounts: Account[] = [
  {
    id: "bnp-paribas", name: "BNP Paribas", sector: "Financial services", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "axa", name: "AXA", sector: "Insurance", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "kering", name: "Kering", sector: "Luxury", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "foundever", name: "Foundever", sector: "Customer experience", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "cdg-capital-morocco", name: "CDG Capital Morocco", sector: "Financial services", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
  {
    id: "najm", name: "Najm", sector: "Not set", contacts: 0, signal: "Not set", opportunity: "Not set", value: "—", stage: "New", owner: "—", fit: [], caseStudies: [],
  },
];

type LeadSource = "Event" | "Tool" | "Network";
type LeadStage = "New" | "Qualified" | "Contacted" | "Converted";
type LeadRecord = { id: string; name: string; role: string; company: string; source: LeadSource; origin: string; score: number; reason: string; stage: LeadStage; owner: string };
type PartnerAccountLink = { accountId: string; contactKeys: string[] };
type BusinessPartnerRecord = {
  id: string;
  name: string;
  company: string;
  role: string;
  origin: string;
  linkedin: string;
  email: string;
  phone: string;
  relationship: string;
  owner: string;
  notes: string;
  accountLinks: PartnerAccountLink[];
};
type BusinessCaseStudyRecord = {
  id: string;
  title: string;
  client: string;
  accountId: string;
  summary: string;
  challenge: string;
  solution: string;
  outcome: string;
  evidenceUrl: string;
  tags: string[];
  studyType: "Success story" | "Business case" | "Opportunity assessment" | "Strategic study";
  status: "Draft" | "Validated" | "Published";
};
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
  { id: "caseStudies" as View, path: "/business-case-studies", label: "Case studies", sidebarLabel: "Case studies", icon: FileText },
  { id: "accounts" as View, path: "/accounts", label: "Accounts", sidebarLabel: "Accounts", icon: Building2 },
  { id: "events" as View, path: "/events", label: "Events", sidebarLabel: "Events", icon: CalendarDays },
  { id: "leads" as View, path: "/leads", label: "Leads", sidebarLabel: "Leads", icon: Users },
  { id: "market" as View, path: "/market-intelligence", label: "Market intelligence", sidebarLabel: "Market", icon: Activity },
  { id: "competitors" as View, path: "/competitor-analysis", label: "Competitor analysis", sidebarLabel: "Competitors", icon: Search },
  { id: "marketing" as View, path: "/marketing-intelligence", label: "Marketing intelligence", sidebarLabel: "Marketing", icon: CircleDollarSign },
  { id: "partners" as View, path: "/strategic-partners", label: "Strategic partners", sidebarLabel: "Strategic partners", icon: Network },
  { id: "businessPartners" as View, path: "/business-partners", label: "Business partners", sidebarLabel: "Business partners", icon: Handshake },
  { id: "executive" as View, path: "/executive-intelligence", label: "Executive intelligence", sidebarLabel: "Executive", icon: FileText },
  { id: "pipeline" as View, path: "/pipeline", label: "Pipeline", sidebarLabel: "Pipeline", icon: Target },
  { id: "kanban" as View, path: "/kanban", label: "Kanban", sidebarLabel: "Kanban", icon: LayoutGrid },
  { id: "doors" as View, path: "/open-doors", label: "Open doors", sidebarLabel: "Open doors", icon: ContactRound },
  { id: "guide" as View, path: "/guide", label: "GTM workspace guide", sidebarLabel: "How to use", icon: BookOpen },
];

const accountSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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
  const [ownerOptions, setOwnerOptions] = useState<OwnerOption[]>([]);
  const [kanbanProjects, setKanbanProjects] = useState<KanbanProject[]>([]);
  const [kanbanBoards, setKanbanBoards] = useState<KanbanBoard[]>([]);
  const [kanbanColumns, setKanbanColumns] = useState<KanbanColumn[]>([]);
  const [kanbanCards, setKanbanCards] = useState<KanbanCard[]>([]);
  const [kanbanBoardAccounts, setKanbanBoardAccounts] = useState<KanbanBoardAccount[]>([]);
  const [query, setQuery] = useState("");
  const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string | null>(initialRoute.account);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(initialRoute.event);
  const [accountRecords, setAccountRecords] = useState<Account[]>(() => {
    if (!storedWorkspace?.accounts) return accounts;
    const savedIds = new Set(storedWorkspace.accounts.map((account) => account.id));
    return [...storedWorkspace.accounts.map((account) => ({ ...account, stage: normalizeAccountStage(account.stage) })), ...accounts.filter((account) => !savedIds.has(account.id))];
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
  const [businessPartnerRecords, setBusinessPartnerRecords] = useState<BusinessPartnerRecord[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("quicksort-intelligence-business-partners-v1") || "[]") as Partial<BusinessPartnerRecord>[];
      return saved.map((partner) => ({ ...emptyBusinessPartner(), ...partner, accountLinks: Array.isArray(partner.accountLinks) ? partner.accountLinks : [] }));
    } catch { return []; }
  });
  const [businessCaseStudies, setBusinessCaseStudies] = useState<BusinessCaseStudyRecord[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem("quicksort-intelligence-sidebar") === "collapsed"; }
    catch { return false; }
  });
  const [toast, setToast] = useState("");
  const [createIntent] = useState(0);
  const workspaceSearchEntries = useMemo<GlobalSearchEntry[]>(() => [
    ...nav.map(({ id, label, icon }) => ({ id: `view-${id}`, label, detail: "Workspace page", keywords: `${id} ${label}`, target: "view" as const, view: id, icon })),
    ...accountRecords.map((account) => ({ id: `account-${account.id}`, label: account.name, detail: `${account.sector} · Account`, keywords: `${account.opportunity} ${account.owner} ${account.signal} ${account.stage}`, target: "account" as const, view: "accounts" as const, recordId: account.id, icon: Building2 })),
    ...eventRecords.map((event) => ({ id: `event-${event.id}`, label: event.title, detail: `${event.date} · ${event.location || "Event"}`, keywords: `${event.status} event ${event.lumaUrl}`, target: "event" as const, view: "events" as const, recordId: event.id, icon: CalendarDays })),
    ...leadRecords.map((lead) => ({ id: `lead-${lead.id}`, label: lead.name, detail: `${lead.role || "Lead"}${lead.company ? ` · ${lead.company}` : ""}`, keywords: `${lead.source} ${lead.origin} ${lead.reason} ${lead.owner}`, target: "view" as const, view: "leads" as const, icon: Users })),
    ...businessPartnerRecords.map((partner) => ({ id: `partner-${partner.id}`, label: partner.name, detail: `${partner.role || "Business partner"}${partner.company ? ` · ${partner.company}` : ""}`, keywords: `${partner.origin} ${partner.relationship} ${partner.owner}`, target: "view" as const, view: "businessPartners" as const, icon: Handshake })),
    ...businessCaseStudies.map((study) => ({ id: `study-${study.id}`, label: study.title, detail: `${study.studyType}${study.client ? ` · ${study.client}` : ""}`, keywords: `${study.summary} ${study.challenge} ${study.outcome} ${study.tags.join(" ")}`, target: "view" as const, view: "caseStudies" as const, icon: FileText })),
  ], [accountRecords, businessCaseStudies, businessPartnerRecords, eventRecords, leadRecords]);
  const workspaceSearchResults = useMemo(() => filterWorkspaceSearch(workspaceSearchEntries, workspaceSearchQuery), [workspaceSearchEntries, workspaceSearchQuery]);
  const active = capabilities.find((c) => c.id === selected) ?? capabilities[0] ?? emptyCapabilities[0];
  const filteredAccounts = useMemo(() => accountRecords.filter((a) => `${a.name} ${a.sector} ${a.opportunity}`.toLowerCase().includes(query.toLowerCase())), [accountRecords, query]);
  const openWorkspaceSearch = () => { setWorkspaceSearchQuery(""); setWorkspaceSearchOpen(true); };
  const closeWorkspaceSearch = () => { setWorkspaceSearchOpen(false); setWorkspaceSearchQuery(""); };
  useEffect(() => {
    const handleWorkspaceSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openWorkspaceSearch();
      } else if (event.key === "Escape") {
        setWorkspaceSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleWorkspaceSearchShortcut);
    return () => window.removeEventListener("keydown", handleWorkspaceSearchShortcut);
  }, []);
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
    let activeRequest = true;
    void db().from("candidate_profiles").select("candidate_id, headline, profiles!candidate_profiles_candidate_id_fkey(full_name, email)").eq("review_status", "approved").then(({ data, error }) => {
      if (!activeRequest || error || !data) return;
      setOwnerOptions(data.map((row: Record<string, any>) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return { id: String(row.candidate_id), name: String(profile?.full_name || profile?.email || "Candidate"), email: String(profile?.email || ""), headline: String(row.headline || "") };
      }));
    });
    return () => { activeRequest = false; };
  }, []);
  useEffect(() => {
    let activeRequest = true;
    void Promise.all([
      db().from("business_accounts").select("*").order("updated_at", { ascending: false }),
      db().from("business_leads").select("*").order("updated_at", { ascending: false }),
      db().from("business_partners").select("*").order("updated_at", { ascending: false }),
      db().from("business_case_studies").select("*").order("updated_at", { ascending: false }),
    ]).then(([accountResult, leadResult, partnerResult, caseStudyResult]) => {
      if (!activeRequest) return;
      if (!accountResult.error && accountResult.data) {
        setAccountRecords(accountResult.data.map((row: Record<string, any>) => ({
          databaseId: String(row.id), id: String(row.slug), name: String(row.name), sector: String(row.sector || "Not set"), contacts: Number(row.contacts) || 0,
          signal: String(row.signal || "Not set"), opportunity: String(row.opportunity || "Not set"), value: String(row.estimated_value || "—"), stage: normalizeAccountStage(row.stage), owner: String(row.owner || "—"),
          fit: Array.isArray(row.fit) ? row.fit.map(String) : [], caseStudies: Array.isArray(row.case_studies) ? row.case_studies : [], opportunitySummary: String(row.opportunity_summary || ""), fitScore: String(row.fit_score || "—"), evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
        })));
        setIntelRecords(Object.fromEntries(accountResult.data.map((row: Record<string, any>) => {
          const intelligence = row.intelligence && typeof row.intelligence === "object" ? row.intelligence : {};
          return [String(row.slug), {
            leads: Array.isArray(intelligence.leads) ? intelligence.leads : [],
            events: Array.isArray(intelligence.events) ? intelligence.events : [],
            contacts: Array.isArray(intelligence.contacts) ? intelligence.contacts : [],
            teams: Array.isArray(intelligence.teams) ? intelligence.teams : [],
            connections: Array.isArray(intelligence.connections) ? intelligence.connections : [],
            nodes: Array.isArray(intelligence.nodes) ? intelligence.nodes : [],
            accountPosition: intelligence.accountPosition && Number.isFinite(intelligence.accountPosition.x) && Number.isFinite(intelligence.accountPosition.y) ? intelligence.accountPosition : undefined,
          }];
        })));
      }
      if (!leadResult.error && leadResult.data) setLeadRecords(leadResult.data.map((row: Record<string, any>) => ({ id: String(row.id), name: String(row.name), role: String(row.role || ""), company: String(row.company || ""), source: row.source as LeadSource, origin: String(row.origin || ""), score: Number(row.score) || 0, reason: String(row.reason || ""), stage: row.stage as LeadStage, owner: String(row.owner || "—") })));
      if (!partnerResult.error && partnerResult.data) setBusinessPartnerRecords(partnerResult.data.map((row: Record<string, any>) => ({ id: String(row.id), name: String(row.name), company: String(row.company || ""), role: String(row.role || ""), origin: String(row.origin || ""), linkedin: String(row.linkedin_url || ""), email: String(row.email || ""), phone: String(row.phone || ""), relationship: String(row.relationship || ""), owner: String(row.owner || ""), notes: String(row.notes || ""), accountLinks: Array.isArray(row.account_links) ? row.account_links : [] })));
      if (!caseStudyResult.error && caseStudyResult.data) setBusinessCaseStudies(caseStudyResult.data.map((row: Record<string, any>) => ({
        id: String(row.id), title: String(row.title), client: String(row.client || ""), accountId: String(row.account_id || ""), summary: String(row.summary || ""), challenge: String(row.challenge || ""), solution: String(row.solution || ""), outcome: String(row.outcome || ""), evidenceUrl: String(row.evidence_url || ""), tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        studyType: (["Success story", "Business case", "Opportunity assessment", "Strategic study"].includes(row.study_type) ? row.study_type : "Success story") as BusinessCaseStudyRecord["studyType"],
        status: (["Draft", "Validated", "Published"].includes(row.status) ? row.status : row.status === "Ready for website" ? "Validated" : "Draft") as BusinessCaseStudyRecord["status"],
      })));
    });
    return () => { activeRequest = false; };
  }, []);
  const loadKanban = async () => {
    const [projects, boards, columns, cards, links] = await Promise.all([
      db().from("kanban_projects").select("id, name, project_number").order("project_number"),
      db().from("kanban_boards").select("id, project_id, name").order("created_at"),
      db().from("kanban_columns").select("id, board_id, name, position").order("position"),
      db().from("kanban_cards").select("id, board_id, column_id, title, description, card_number, due_at").order("card_number"),
      db().from("kanban_board_accounts").select("board_id, account_id"),
    ]);
    if (!projects.error) setKanbanProjects((projects.data || []) as KanbanProject[]);
    if (!boards.error) setKanbanBoards((boards.data || []) as KanbanBoard[]);
    if (!columns.error) setKanbanColumns((columns.data || []) as KanbanColumn[]);
    if (!cards.error) setKanbanCards((cards.data || []) as KanbanCard[]);
    if (!links.error) setKanbanBoardAccounts((links.data || []) as KanbanBoardAccount[]);
  };
  useEffect(() => { void loadKanban(); }, []);
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
  const openWorkspaceSearchResult = (result: GlobalSearchEntry) => {
    closeWorkspaceSearch();
    if (result.target === "account" && result.recordId) navigate("accounts", result.recordId);
    else if (result.target === "event" && result.recordId) openEvent(result.recordId);
    else navigate(result.view);
  };
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem("quicksort-intelligence-sidebar", next ? "collapsed" : "open"); } catch { /* The control still works without persistence. */ }
  };
  const saveAccount = (updatedAccount: Account, updatedIntel: AccountIntel) => {
    const databaseId = updatedAccount.databaseId || crypto.randomUUID();
    const savedAccount = { ...updatedAccount, databaseId };
    const nextAccounts = accountRecords.some((account) => account.id === updatedAccount.id)
      ? accountRecords.map((account) => account.id === updatedAccount.id ? savedAccount : account)
      : [savedAccount, ...accountRecords];
    const nextIntel = { ...intelRecords, [updatedAccount.id]: updatedIntel };
    setAccountRecords(nextAccounts);
    setIntelRecords(nextIntel);
    void (async () => {
      const accountResult = await db().from("business_accounts").upsert({
      id: databaseId, slug: updatedAccount.id, name: updatedAccount.name, sector: updatedAccount.sector, contacts: updatedAccount.contacts,
      signal: updatedAccount.signal, opportunity: updatedAccount.opportunity, estimated_value: updatedAccount.value, stage: updatedAccount.stage, owner: updatedAccount.owner,
      fit: updatedAccount.fit, case_studies: updatedAccount.caseStudies, opportunity_summary: updatedAccount.opportunitySummary || "", fit_score: updatedAccount.fitScore || "—", evidence: updatedAccount.evidence || [], intelligence: updatedIntel,
    }, { onConflict: "slug" });
      if (accountResult.error) { notify("Could not save account changes"); return; }
      const links = updatedIntel.contacts.flatMap(contact => (contact.kanbanCardIds || []).map(cardId => ({ card_id: cardId, account_id: databaseId, contact_key: contact.id! }))).filter(link => link.contact_key);
      const deleted = await db().from("kanban_card_contacts").delete().eq("account_id", databaseId);
      if (!deleted.error && links.length) await db().from("kanban_card_contacts").insert(links);
    })();
    notify("Account changes saved");
  };
  const saveLeads = (next: LeadRecord[]) => {
    setLeadRecords(next);
    void db().from("business_leads").upsert(next.map((lead) => ({ ...lead, id: isUuid(lead.id) ? lead.id : crypto.randomUUID() })));
  };
  const saveEvents = (next: EventRecord[]) => {
    setEventRecords(next);
    try { window.localStorage.setItem("quicksort-intelligence-events-v4", JSON.stringify(next)); }
    catch { notify("File loaded for this session, but it is too large for browser storage"); }
  };
  const saveCompetitors = (next: CompetitorRecord[]) => { setCompetitorRecords(next); window.localStorage.setItem("quicksort-intelligence-competitors-v1", JSON.stringify(next)); };
  const saveBusinessPartners = (next: BusinessPartnerRecord[]) => {
    setBusinessPartnerRecords(next);
    void db().from("business_partners").upsert(next.map((partner) => ({ id: partner.id, name: partner.name, company: partner.company, role: partner.role, origin: partner.origin, linkedin_url: partner.linkedin, email: partner.email, phone: partner.phone, relationship: partner.relationship, owner: partner.owner, notes: partner.notes, account_links: partner.accountLinks })));
  };
  const saveCaseStudies = (next: BusinessCaseStudyRecord[]) => {
    setBusinessCaseStudies(next);
    void db().from("business_case_studies").upsert(next.map((study) => ({ id: study.id, title: study.title, client: study.client, account_id: study.accountId, summary: study.summary, challenge: study.challenge, solution: study.solution, outcome: study.outcome, evidence_url: study.evidenceUrl, tags: study.tags, study_type: study.studyType, status: study.status })));
  };
  const addManualAccount = (account: Account) => {
    const nextAccounts = [account, ...accountRecords];
    const nextIntel = { ...intelRecords, [account.id]: { leads: [], events: [], contacts: [] } };
    setAccountRecords(nextAccounts);
    setIntelRecords(nextIntel);
    void db().from("business_accounts").insert({ id: account.databaseId, slug: account.id, name: account.name, sector: account.sector, contacts: account.contacts, signal: account.signal, opportunity: account.opportunity, estimated_value: account.value, stage: account.stage, owner: account.owner, fit: account.fit, case_studies: account.caseStudies, opportunity_summary: account.opportunitySummary || "", fit_score: account.fitScore || "—", evidence: account.evidence || [], intelligence: nextIntel[account.id] });
    notify(`${account.name} added to Accounts`);
    navigate("accounts", account.id);
  };
  const addEventLead = (event: EventRecord, person: EventAiIntelligence["priorityPeople"][number]) => {
    if (leadRecords.some((lead) => lead.name.toLowerCase() === person.name.toLowerCase() && lead.company.toLowerCase() === person.company.toLowerCase())) { notify("This person is already in Leads"); return; }
    saveLeads([{ id: crypto.randomUUID(), name: person.name, role: person.role, company: person.company, source: "Event", origin: event.title, score: person.fitScore, reason: person.why, stage: "New", owner: "—" }, ...leadRecords]);
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
  const addOpenDoorRelationship = (input: OpenDoorInput) => {
    const existingAccount = accountRecords.find((account) => account.name.trim().toLowerCase() === input.company.trim().toLowerCase());
    let slug = existingAccount?.id || accountSlug(input.company) || `account-${Date.now()}`;
    if (!existingAccount && accountRecords.some((account) => account.id === slug)) slug = `${slug}-${Date.now()}`;
    const currentIntel = existingAccount ? (intelRecords[existingAccount.id] || { leads: [], events: [], contacts: [] }) : { leads: [], events: [], contacts: [] };
    const linkedinKey = input.linkedin.trim().replace(/\/$/, "").toLowerCase();
    const contactIndex = currentIntel.contacts.findIndex((contact) => {
      const sameProfile = linkedinKey && (contact.linkedin || "").trim().replace(/\/$/, "").toLowerCase() === linkedinKey;
      return Boolean(sameProfile) || contact.name.trim().toLowerCase() === input.contactName.trim().toLowerCase();
    });
    const connection: KnownByConnection = {
      ownerId: input.connector.id,
      name: input.connector.name,
      email: input.connector.email,
      relationship: input.relationship,
      strength: input.strength,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    const existingContact = contactIndex >= 0 ? currentIntel.contacts[contactIndex] : null;
    const knownBy = [...(existingContact?.knownBy || []).filter((item) => item.ownerId !== connection.ownerId && item.email !== connection.email && item.name.toLowerCase() !== connection.name.toLowerCase()), connection];
    const contact: RelationshipContact = existingContact ? {
      ...existingContact,
      role: input.role || existingContact.role,
      linkedin: input.linkedin || existingContact.linkedin,
      owner: existingContact.owner || input.connector.name,
      strength: existingContact.strength || input.strength,
      knownBy,
    } : {
      id: crypto.randomUUID(), name: input.contactName, role: input.role, strength: input.strength, owner: input.connector.name,
      linkedin: input.linkedin, knownBy, x: 120 + (currentIntel.contacts.length % 4) * 245, y: 270 + Math.floor(currentIntel.contacts.length / 4) * 185,
    };
    const contacts = contactIndex >= 0
      ? currentIntel.contacts.map((item, index) => index === contactIndex ? contact : item)
      : [...currentIntel.contacts, contact];
    const nextIntel = { ...currentIntel, contacts };
    const nextAccount: Account = existingAccount ? {
      ...existingAccount,
      contacts: contacts.length,
      signal: hasValue(existingAccount.signal) ? existingAccount.signal : input.strength === "Trusted" ? "Strong" : "Warm",
      owner: hasValue(existingAccount.owner) ? existingAccount.owner : input.connector.name,
    } : {
      databaseId: crypto.randomUUID(), id: slug, name: input.company.trim(), sector: input.sector.trim() || "Not set", contacts: 1,
      signal: input.strength === "Trusted" ? "Strong" : "Warm", opportunity: "Not set", value: "—", stage: "New", owner: input.connector.name,
      fit: [], caseStudies: [], evidence: [],
    };
    saveAccount(nextAccount, nextIntel);
    notify(existingAccount ? `${input.connector.name}'s relationship was linked to ${existingAccount.name}` : `${input.company} was created in Accounts with this relationship`);
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
          <div className="top-actions"><button className="icon-button" aria-label="Search workspace" aria-haspopup="dialog" aria-expanded={workspaceSearchOpen} onClick={openWorkspaceSearch}><Search size={18}/></button></div>
        </header>
        {view === "overview" && <Overview active={active} capabilities={capabilities} selected={selected} setSelected={setSelected} go={go} notify={notify} accounts={accountRecords} leads={leadRecords} events={eventRecords}/>}
        {(view === "market" || view === "marketing" || view === "partners" || view === "executive") && <IntelligencePage workspace={intelligenceWorkspaces[view]} notify={notify}/>}
        {view === "businessPartners" && <BusinessPartners partners={businessPartnerRecords} accounts={accountRecords} intel={intelRecords} onChange={saveBusinessPartners} openAccount={(id) => navigate("accounts", id)} notify={notify}/>}
        {view === "caseStudies" && <BusinessCaseStudies studies={businessCaseStudies} accounts={accountRecords} onChange={saveCaseStudies} notify={notify}/>}
        {view === "competitors" && <CompetitorAnalysis competitors={competitorRecords} onChange={saveCompetitors} notify={notify}/>}
        {view === "capabilities" && <Capabilities active={active} capabilities={capabilities} selected={selected} setSelected={setSelected}/>}
        {view === "accounts" && (selectedAccount && accountRecords.some((account) => account.id === selectedAccount)
          ? <AccountDetail account={accountRecords.find((account) => account.id === selectedAccount)!} intel={intelRecords[selectedAccount] ?? { leads: [], events: [], contacts: [] }} linkedStudies={businessCaseStudies.filter((study) => study.accountId === selectedAccount)} ownerOptions={ownerOptions} actorEmail={email} kanbanCards={kanbanCards.filter(card => kanbanBoardAccounts.some(link => link.board_id === card.board_id && link.account_id === accountRecords.find(account => account.id === selectedAccount)?.databaseId)).map(card => ({ ...card, boardName: kanbanBoards.find(board => board.id === card.board_id)?.name || "Board", columnName: kanbanColumns.find(column => column.id === card.column_id)?.name || "Status" }))} onSave={saveAccount} onBack={() => navigate("accounts")} notify={notify}/>
          : <Accounts query={query} setQuery={setQuery} accounts={filteredAccounts} allAccounts={accountRecords} openAccount={(id) => navigate("accounts", id)} onAdd={addManualAccount} createIntent={createIntent}/>)}
        {view === "events" && <Events events={eventRecords} selectedEventId={selectedEvent} onOpenEvent={openEvent} onBack={() => navigate("events")} onChange={saveEvents} onAddLead={addEventLead} onAddAccount={addEventAccount} notify={notify}/>}
        {view === "leads" && <Leads leads={leadRecords} onChange={saveLeads} notify={notify} createIntent={createIntent}/>}
        {view === "pipeline" && <Pipeline notify={notify}/>} 
        {view === "kanban" && <BusinessKanban projects={kanbanProjects} boards={kanbanBoards} columns={kanbanColumns} cards={kanbanCards} boardAccounts={kanbanBoardAccounts} accounts={accountRecords} onRefresh={loadKanban} notify={notify}/>}
        {view === "doors" && <OpenDoors accounts={accountRecords} intel={intelRecords} ownerOptions={ownerOptions} actorEmail={email} onAdd={addOpenDoorRelationship} openAccount={(id) => navigate("accounts", id)} notify={notify}/>}
        {view === "guide" && <WorkspaceGuide go={go}/>}
      </main>
      {workspaceSearchOpen && <div className="workspace-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWorkspaceSearch(); }}>
        <section className="workspace-search-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-search-title">
          <div className="workspace-search-field">
            <Search size={20}/>
            <label id="workspace-search-title" className="sr-only" htmlFor="workspace-search-input">Search workspace</label>
            <input id="workspace-search-input" autoFocus value={workspaceSearchQuery} onChange={(event) => setWorkspaceSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && workspaceSearchResults[0]) openWorkspaceSearchResult(workspaceSearchResults[0]); }} placeholder="Search pages, accounts, people, events…"/>
            <kbd>Esc</kbd>
            <button type="button" onClick={closeWorkspaceSearch} aria-label="Close workspace search"><X size={17}/></button>
          </div>
          <div className="workspace-search-results" aria-live="polite">
            <div className="workspace-search-caption">{workspaceSearchQuery.trim() ? `${workspaceSearchResults.length} result${workspaceSearchResults.length === 1 ? "" : "s"}` : "Quick access"}</div>
            {workspaceSearchResults.map((result) => {
              const Icon = result.icon;
              return <button type="button" key={result.id} onClick={() => openWorkspaceSearchResult(result)}><span><Icon size={17}/></span><span><strong>{result.label}</strong><small>{result.detail}</small></span><ArrowUpRight size={15}/></button>;
            })}
            {workspaceSearchResults.length === 0 && <div className="workspace-search-empty"><Search size={22}/><strong>No results found</strong><span>Try an account, person, event, or workspace page.</span></div>}
          </div>
          <footer><span><kbd>↵</kbd> Open first result</span><span><kbd>⌘</kbd><kbd>K</kbd> Open search</span></footer>
        </section>
      </div>}
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

function BusinessKanban({ projects, boards, columns, cards, boardAccounts, accounts, onRefresh, notify }: { projects: KanbanProject[]; boards: KanbanBoard[]; columns: KanbanColumn[]; cards: KanbanCard[]; boardAccounts: KanbanBoardAccount[]; accounts: Account[]; onRefresh: () => Promise<void>; notify: (message: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const project = projects.find(item => item.id === projectId) || projects[0];
  const projectBoards = boards.filter(item => item.project_id === project?.id);
  const [boardId, setBoardId] = useState(projectBoards[0]?.id || "");
  const board = projectBoards.find(item => item.id === boardId) || projectBoards[0];
  const boardColumns = columns.filter(item => item.board_id === board?.id);
  const boardCards = cards.filter(item => item.board_id === board?.id);
  const linkedAccounts = accounts.filter(account => account.databaseId && boardAccounts.some(link => link.board_id === board?.id && link.account_id === account.databaseId));
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id); }, [projects, projectId]);
  useEffect(() => { if (!projectBoards.some(item => item.id === boardId)) setBoardId(projectBoards[0]?.id || ""); }, [project?.id, boards]);
  const move = async (card: KanbanCard, columnId: string) => {
    const result = await db().from("kanban_cards").update({ column_id: columnId }).eq("id", card.id);
    if (result.error) { notify("Could not update this card"); return; }
    await onRefresh(); notify(`CARD-${String(card.card_number).padStart(6, "0")} updated`);
  };
  return <div className="page business-kanban"><PageIntro title="Kanban workspace" text="The same projects, cards, owners and status updates used in Admin and Candidate." action={<button className="secondary" onClick={() => void onRefresh()}>Refresh</button>}/>{!projects.length ? <section className="surface data-empty">No Kanban projects have been created in Admin yet.</section> : <><nav className="business-kanban-projects">{projects.map(item => <button className={item.id === project?.id ? "active" : ""} key={item.id} onClick={() => { setProjectId(item.id); setBoardId(""); }}><small>PRJ-{String(item.project_number).padStart(4, "0")}</small><strong>{item.name}</strong></button>)}</nav><div className="business-kanban-toolbar"><label>Board<select value={board?.id || ""} onChange={event => setBoardId(event.target.value)}>{projectBoards.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div><span>Linked accounts</span>{linkedAccounts.length ? linkedAccounts.map(account => <a href={`/accounts/${account.id}`} key={account.id}>{account.name}</a>) : <small>No account mapped in Admin</small>}</div></div>{board ? <div className="business-kanban-columns">{boardColumns.map(column => <section key={column.id}><header><strong>{column.name}</strong><span>{boardCards.filter(card => card.column_id === column.id).length}</span></header>{boardCards.filter(card => card.column_id === column.id).map(card => <article key={card.id}><small>CARD-{String(card.card_number).padStart(6, "0")}</small><h3>{card.title}</h3>{card.description && <p>{card.description}</p>}<label>Move to<select value={card.column_id} onChange={event => void move(card, event.target.value)}>{boardColumns.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></article>)}</section>)}</div> : <section className="surface data-empty">This project has no board yet.</section>}</>}</div>;
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
    <section className="surface competitor-library"><div className="section-head"><div><h2>Competitors</h2></div></div>{competitors.length ? <div className="competitor-cards">{competitors.map((competitor) => <article key={competitor.id}><header><div><span>{competitor.source}</span><h3>{competitor.name}</h3><a href={competitor.url} target="_blank" rel="noreferrer">{new URL(competitor.url).hostname}<ArrowUpRight size={12}/></a></div><button aria-label={`Remove ${competitor.name}`} onClick={() => { onChange(competitors.filter((item) => item.id !== competitor.id)); notify(`${competitor.name} removed`); }}><X size={15}/></button></header><p>{competitor.summary}</p><dl><div><dt>Positioning</dt><dd>{competitor.positioning}</dd></div><div><dt>Audience</dt><dd>{competitor.audience}</dd></div></dl><div className="competitor-tags">{competitor.services.map((service) => <span key={service}>{service}</span>)}</div><section><h4>Differentiators</h4>{competitor.differentiators.map((item) => <p key={item}>{item}</p>)}</section><div className="competitor-signals"><section><h4>Competitive threats</h4>{competitor.threats.map((item) => <p key={item}>{item}</p>)}</section><section><h4>QuickSort opportunities</h4>{competitor.opportunities.map((item) => <p key={item}>{item}</p>)}</section></div>{competitor.evidence.length > 0 && <footer>{competitor.evidence.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>)}</footer>}</article>)}</div> : <div className="data-empty">No competitors added yet. Add a website or run discovery above.</div>}</section>
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
type Account = { databaseId?: string; id: string; name: string; sector: string; contacts: number; signal: string; opportunity: string; value: string; stage: AccountStage; owner: string; fit: string[]; caseStudies: CaseStudy[]; opportunitySummary?: string; fitScore?: string; evidence?: string[] };
type Lead = { name: string; role: string; company: string; status: string; nextStep: string; owner: string };
type AccountEvent = { date: string; month: string; title: string; type: string; detail: string };
type RelationshipComment = { id: string; text: string; author: string; createdAt: string };
type KnownByConnection = { ownerId?: string; name: string; email?: string; relationship: string; strength: string; notes?: string; createdAt: string };
type RelationshipContact = { id?: string; name: string; role: string; team?: string; department?: string; strength: string; owner: string; linkedin?: string; knownBy?: KnownByConnection[]; comments?: RelationshipComment[]; kanbanCardIds?: string[]; x?: number; y?: number };
type RelationshipTeam = { id: string; name: string; description?: string; memberIds?: string[]; departmentId?: string; x: number; y: number; width: number; height: number };
type RelationshipCanvasNode = { id: string; type: "department" | "note"; title: string; body: string; x: number; y: number; width: number; height: number };
type RelationshipEdge = { id: string; source: string; target: string; label: string; strength?: string; owner?: string; notes?: string; kind?: "manual" | "membership" };
type CanvasPoint = { x: number; y: number };
type AccountIntel = { leads: Lead[]; events: AccountEvent[]; contacts: RelationshipContact[]; teams?: RelationshipTeam[]; nodes?: RelationshipCanvasNode[]; connections?: RelationshipEdge[]; accountPosition?: CanvasPoint };
type OwnerOption = { id: string; name: string; email: string; headline: string };
type AuditLog = { id: string; section: string; action: string; changes: Record<string, unknown>; actor_email: string; created_at: string };
type AuditChange = { field: string; before?: unknown; after?: unknown };
type KanbanProject = { id: string; name: string; project_number: number };
type KanbanBoard = { id: string; project_id: string; name: string };
type KanbanColumn = { id: string; board_id: string; name: string; position: number };
type KanbanCard = { id: string; board_id: string; column_id: string; title: string; description: string; card_number: number; due_at: string | null };
type KanbanBoardAccount = { board_id: string; account_id: string };
type OpenDoorInput = { company: string; sector: string; contactName: string; role: string; linkedin: string; connector: OwnerOption; relationship: string; strength: string; notes: string };

const emptyAccountIntel = Object.fromEntries(accounts.map((account) => [account.id, { contacts: [], leads: [], events: [] }])) as Record<string, AccountIntel>;

function Accounts({ query, setQuery, accounts, allAccounts, openAccount, onAdd, createIntent }: { query: string; setQuery: (s: string) => void; accounts: Account[]; allAccounts: Account[]; openAccount: (id: string) => void; onAdd: (account: Account) => void; createIntent: number }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (createIntent) setAdding(true); }, [createIntent]);
  const addAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = String(values.get("name") || "").trim();
    let id = accountSlug(name) || `account-${Date.now()}`;
    if (allAccounts.some((account) => account.id === id)) id = `${id}-${Date.now()}`;
    onAdd({ databaseId: crypto.randomUUID(), id, name, sector: String(values.get("sector") || "Not set").trim() || "Not set", contacts: 0, signal: String(values.get("signal") || "Not set"), opportunity: String(values.get("opportunity") || "Not set").trim() || "Not set", value: String(values.get("value") || "—").trim() || "—", stage: normalizeAccountStage(values.get("stage")), owner: String(values.get("owner") || "—").trim() || "—", fit: [], caseStudies: [], evidence: [] });
    setAdding(false);
  };
  return <div className="page"><PageIntro title="Account intelligence" text="See who matters, who knows them and where the opportunity sits." action={<button className="primary" onClick={() => setAdding(true)}><Plus size={16}/> Add account</button>}/>
    {adding && <form className="surface quick-create-form" onSubmit={addAccount}><div className="section-head"><div><h2>Add account</h2><p>Create the company record now. You can complete its intelligence page next.</p></div><button type="button" className="icon-button" onClick={() => setAdding(false)} aria-label="Close account form"><X size={17}/></button></div><div className="quick-create-grid"><label>Company name<input name="name" required autoFocus placeholder="Company name"/></label><label>Sector<input name="sector" placeholder="Industry or sector"/></label><label>Relationship<select name="signal"><option>Not set</option><option>Warm</option><option>Strong</option><option>Cold</option></select></label><label>Opportunity<input name="opportunity" placeholder="Opportunity or need"/></label><label>Estimated value<input name="value" placeholder="€—"/></label><label>Opportunity stage<select name="stage">{accountStages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>QuickSort owner<input name="owner" placeholder="Owner"/></label></div><div className="actions"><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button><button className="primary"><Save size={15}/> Create account</button></div></form>}
    <div className="toolbar"><label><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies or opportunities"/></label><button className="secondary"><Filter size={16}/> Filters</button><span>{accounts.length} accounts</span></div>
    <div className="account-list">{accounts.map((account) => <a className="account-card" key={account.id} href={`/accounts/${encodeURIComponent(account.id)}`} onClick={(event) => { event.preventDefault(); openAccount(account.id); }} aria-label={`Open ${account.name} account`}><div className="account-monogram">{account.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}</div><div className="account-title"><h2>{account.name}</h2><p>{account.sector} · {account.contacts} mapped contacts</p></div><div className={`signal ${account.signal.toLowerCase()}`}><i/>{account.signal} relationship</div><div className="account-opportunity"><small>Account opportunity</small><span>{account.opportunity}</span><strong>{account.value}</strong></div><div className="fit-tags">{account.fit.map((f) => <span key={f}>{f}</span>)}</div><div className="account-owner"><span>{account.owner === "—" ? "—" : account.owner.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><small>QuickSort owner</small><b>{hasValue(account.owner) ? account.owner : "Not assigned"}</b><strong>{account.stage} · opportunity stage</strong></div></div><span className="open-card" aria-hidden="true"><ArrowUpRight size={18}/></span></a>)}</div>
  </div>;
}

function EditField({ editing, value, onChange, label, multiline = false }: { editing: boolean; value: string | number; onChange: (value: string) => void; label: string; multiline?: boolean }) {
  if (!editing) return <span className="editable-value">{value}</span>;
  return multiline
    ? <textarea className="inline-edit textarea" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}/>
    : <input className="inline-edit" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}/>;
}

const hasValue = (value?: string) => Boolean(value && value.trim() && value.trim().toLowerCase() !== "not set" && value.trim() !== "—");
const auditFieldLabel = (field: string) => ({
  intelligence: "Relationship map",
  estimated_value: "Estimated value",
  case_studies: "Case studies",
  opportunity_summary: "Opportunity summary",
  fit_score: "Capability fit",
}[field] ?? field.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()));

const auditValueSummary = (field: string, value: unknown) => {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? `${value.length} item${value.length === 1 ? "" : "s"}` : "None";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (field === "intelligence") {
      const groups = ["contacts", "teams", "nodes", "connections", "leads", "events"]
        .map((key) => [key, Array.isArray(record[key]) ? record[key].length : 0] as const)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${key}`);
      return groups.length ? groups.join(" · ") : "Empty relationship map";
    }
    return `${Object.keys(record).length} field${Object.keys(record).length === 1 ? "" : "s"}`;
  }
  return String(value);
};

const auditValueDetail = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "Empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const auditChangeDetails = (log: AuditLog): AuditChange[] => {
  const changes = log.changes || {};
  const wrapped = log.action === "created" ? changes.created : log.action === "deleted" ? changes.deleted : undefined;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return Object.entries(wrapped as Record<string, unknown>).map(([field, value]) => ({
      field,
      ...(log.action === "created" ? { after: value } : { before: value }),
    }));
  }
  return Object.entries(changes).map(([field, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && ("before" in value || "after" in value)) {
      const comparison = value as { before?: unknown; after?: unknown };
      return { field, before: comparison.before, after: comparison.after };
    }
    return { field, after: value };
  });
};

function RelationshipCanvas({ account, contacts, teams = [], nodes = [], connections = [], accountPosition = { x: 445, y: 42 }, ownerOptions, kanbanCards, actorEmail, onRequestEdit, onChange }: {
  account: Account;
  contacts: RelationshipContact[];
  teams?: RelationshipTeam[];
  nodes?: RelationshipCanvasNode[];
  connections?: RelationshipEdge[];
  accountPosition?: CanvasPoint;
  ownerOptions: OwnerOption[];
  kanbanCards: (KanbanCard & { boardName: string; columnName: string })[];
  actorEmail: string;
  onRequestEdit: () => void;
  onChange: (contacts: RelationshipContact[], teams: RelationshipTeam[], nodes: RelationshipCanvasNode[], connections: RelationshipEdge[], accountPosition: CanvasPoint) => void;
}) {
  const normalizedContacts = useMemo(() => contacts.map((contact, index) => ({
    ...contact,
    id: contact.id || `contact-${index}`,
    x: contact.x ?? 110 + (index % 4) * 245,
    y: contact.y ?? 270 + Math.floor(index / 4) * 185,
  })), [contacts]);
  const normalizedTeams = useMemo(() => teams.map((team) => ({ ...team, width: 210, height: 96 })), [teams]);
  const [layoutContacts, setLayoutContacts] = useState<RelationshipContact[]>(normalizedContacts);
  const [layoutTeams, setLayoutTeams] = useState<RelationshipTeam[]>(normalizedTeams);
  const [layoutNodes, setLayoutNodes] = useState<RelationshipCanvasNode[]>(nodes);
  const [layoutAccount, setLayoutAccount] = useState<CanvasPoint>(accountPosition);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [drawingEdge, setDrawingEdge] = useState<{ source: string; x: number; y: number } | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [comment, setComment] = useState("");
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const historyRef = useRef<{ contacts: RelationshipContact[]; teams: RelationshipTeam[]; nodes: RelationshipCanvasNode[]; connections: RelationshipEdge[]; accountPosition: CanvasPoint }[]>([]);
  const redoRef = useRef<{ contacts: RelationshipContact[]; teams: RelationshipTeam[]; nodes: RelationshipCanvasNode[]; connections: RelationshipEdge[]; accountPosition: CanvasPoint }[]>([]);
  const clipboardRef = useRef<{ contacts: RelationshipContact[]; teams: RelationshipTeam[]; nodes: RelationshipCanvasNode[] } | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const [, refreshCommands] = useState(0);
  const drag = useRef<{ kind: "account" | "contact" | "team" | "node" | "pan"; id: string; startX: number; startY: number; originX: number; originY: number; originPanX: number; originPanY: number; moved: boolean } | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const latestPointerRef = useRef<CanvasPoint | null>(null);
  const autoPanFrameRef = useRef<number | null>(null);
  useEffect(() => setLayoutContacts(normalizedContacts), [normalizedContacts]);
  useEffect(() => setLayoutTeams(normalizedTeams), [normalizedTeams]);
  useEffect(() => setLayoutNodes(nodes), [nodes]);
  useEffect(() => setLayoutAccount(accountPosition), [accountPosition.x, accountPosition.y]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handlePinch = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const currentZoom = zoomRef.current;
      const nextZoom = Math.min(1.7, Math.max(.55, currentZoom * Math.exp(-event.deltaY * .012)));
      const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const nextPan = zoomPanAtPoint(panRef.current, currentZoom, nextZoom, pointer);
      panRef.current = nextPan;
      zoomRef.current = nextZoom;
      setPan(nextPan);
      setZoom(nextZoom);
    };
    canvas.addEventListener("wheel", handlePinch, { passive: false });
    return () => canvas.removeEventListener("wheel", handlePinch);
  }, []);
  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);
  useEffect(() => () => {
    if (autoPanFrameRef.current !== null) cancelAnimationFrame(autoPanFrameRef.current);
  }, []);
  useEffect(() => {
    if (!selectionMenu) return;
    const closeMenu = () => setSelectionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [selectionMenu]);
  useEffect(() => {
    if (!selectedNode && !selectedEdge) return;
    const dismissInspector = (event: PointerEvent) => {
      if (inspectorRef.current?.contains(event.target as Node)) return;
      setSelectedNode(null);
      setSelectedEdge(null);
    };
    window.addEventListener("pointerdown", dismissInspector, true);
    return () => window.removeEventListener("pointerdown", dismissInspector, true);
  }, [selectedNode, selectedEdge]);

  const currentSnapshot = () => ({ contacts: layoutContacts, teams: layoutTeams, nodes: layoutNodes, connections, accountPosition: layoutAccount });
  const persist = (nextContacts = layoutContacts, nextTeams = layoutTeams, nextNodes = layoutNodes, nextConnections = connections, nextAccountPosition = layoutAccount, remember = true) => {
    if (remember) {
      historyRef.current = [...historyRef.current.slice(-29), currentSnapshot()];
      redoRef.current = [];
      refreshCommands((value) => value + 1);
    }
    onRequestEdit();
    onChange(nextContacts, nextTeams, nextNodes, nextConnections, nextAccountPosition);
  };
  const applySnapshot = (snapshot: ReturnType<typeof currentSnapshot>) => {
    setLayoutContacts(snapshot.contacts);
    setLayoutTeams(snapshot.teams);
    setLayoutNodes(snapshot.nodes);
    setLayoutAccount(snapshot.accountPosition);
    setSelectedNode(null);
    setSelectedEdge(null);
    onChange(snapshot.contacts, snapshot.teams, snapshot.nodes, snapshot.connections, snapshot.accountPosition);
  };
  const undo = () => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;
    redoRef.current.push(currentSnapshot());
    applySnapshot(snapshot);
    refreshCommands((value) => value + 1);
  };
  const redo = () => {
    const snapshot = redoRef.current.pop();
    if (!snapshot) return;
    historyRef.current.push(currentSnapshot());
    applySnapshot(snapshot);
    refreshCommands((value) => value + 1);
  };

  const nodePoint = (id: string) => {
    if (id === "account") return { x: layoutAccount.x + 105, y: layoutAccount.y + 48 };
    const contact = layoutContacts.find((item) => item.id === id);
    if (contact) return { x: (contact.x ?? 0) + 105, y: (contact.y ?? 0) + 73 };
    const team = layoutTeams.find((item) => `team:${item.id}` === id);
    if (team) return { x: team.x + team.width / 2, y: team.y + 31 };
    const node = layoutNodes.find((item) => `node:${item.id}` === id);
    return node ? { x: node.x + node.width / 2, y: node.y + node.height / 2 } : null;
  };
  const beginConnection = (event: React.PointerEvent, source: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = nodePoint(source);
    if (!point) return;
    setConnectFrom(source);
    setDrawingEdge({ source, x: point.x, y: point.y });
    setSelectedNode(null);
    setSelectedEdge(null);
  };
  useEffect(() => {
    if (!drawingEdge) return;
    const move = (event: PointerEvent) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setDrawingEdge((current) => current ? {
        ...current,
        x: (event.clientX - bounds.left - pan.x) / zoom,
        y: (event.clientY - bounds.top - pan.y) / zoom,
      } : null);
    };
    const finish = (event: PointerEvent) => {
      const targetElement = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-connection-node]");
      const target = targetElement?.dataset.connectionNode;
      if (target && target !== drawingEdge.source) {
        const existing = connections.find((edge) => (edge.source === drawingEdge.source && edge.target === target) || (edge.source === target && edge.target === drawingEdge.source));
        if (existing) {
          setSelectedEdge(existing.id);
        } else {
          const edge: RelationshipEdge = { id: crypto.randomUUID(), source: drawingEdge.source, target, label: "", strength: "Not assessed", owner: "", notes: "", kind: "manual" };
          persist(layoutContacts, layoutTeams, layoutNodes, [...connections, edge]);
          setSelectedEdge(edge.id);
        }
      }
      setSelectedNode(null);
      setConnectFrom(null);
      setDrawingEdge(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
  }, [drawingEdge, connections, layoutContacts, layoutTeams, layoutNodes, pan.x, pan.y, zoom]);
  const startDrag = (event: React.PointerEvent, kind: "account" | "contact" | "team" | "node" | "pan", id: string, originX: number, originY: number) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("input, select, textarea, a")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    drag.current = { kind, id, startX: event.clientX, startY: event.clientY, originX, originY, originPanX: panRef.current.x, originPanY: panRef.current.y, moved: false };
    if (kind !== "pan" && autoPanFrameRef.current === null) autoPanFrameRef.current = requestAnimationFrame(autoPanDrag);
  };
  const updateDraggedCard = (active: NonNullable<typeof drag.current>, clientX: number, clientY: number, currentPan = panRef.current) => {
    const nextPosition = draggedPosition(
      { x: active.originX, y: active.originY },
      { x: active.startX, y: active.startY },
      { x: clientX, y: clientY },
      { x: active.originPanX, y: active.originPanY },
      currentPan,
      zoom,
    );
    const dx = nextPosition.x - active.originX;
    const dy = nextPosition.y - active.originY;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    if (active.kind === "account") setLayoutAccount(nextPosition);
    if (active.kind === "contact") setLayoutContacts((current) => current.map((item) => item.id === active.id ? { ...item, ...nextPosition } : item));
    if (active.kind === "team") setLayoutTeams((current) => current.map((item) => item.id === active.id ? { ...item, ...nextPosition } : item));
    if (active.kind === "node") setLayoutNodes((current) => current.map((item) => item.id === active.id ? { ...item, ...nextPosition } : item));
  };
  function autoPanDrag() {
    const active = drag.current;
    const pointer = latestPointerRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!active || active.kind === "pan" || !pointer || !bounds) { autoPanFrameRef.current = null; return; }
    const velocity = autoPanVelocity(pointer, bounds);
    if (velocity.x || velocity.y) {
      const nextPan = { x: panRef.current.x + velocity.x, y: panRef.current.y + velocity.y };
      panRef.current = nextPan;
      setPan(nextPan);
      updateDraggedCard(active, pointer.x, pointer.y, nextPan);
    }
    autoPanFrameRef.current = requestAnimationFrame(autoPanDrag);
  }
  const moveDrag = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active) return;
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
    if (active.kind === "pan") {
      const nextPan = { x: active.originX + dx, y: active.originY + dy };
      panRef.current = nextPan;
      setPan(nextPan);
    } else updateDraggedCard(active, event.clientX, event.clientY);
  };
  const endDrag = () => {
    const active = drag.current;
    if (active?.moved && active.kind !== "pan") {
      const pointer = latestPointerRef.current ?? { x: active.startX, y: active.startY };
      const finalPosition = draggedPosition(
        { x: active.originX, y: active.originY },
        { x: active.startX, y: active.startY },
        pointer,
        { x: active.originPanX, y: active.originPanY },
        panRef.current,
        zoom,
      );
      const nextContacts = active.kind === "contact" ? layoutContacts.map((item) => item.id === active.id ? { ...item, ...finalPosition } : item) : layoutContacts;
      const nextTeams = active.kind === "team" ? layoutTeams.map((item) => item.id === active.id ? { ...item, ...finalPosition } : item) : layoutTeams;
      const nextNodes = active.kind === "node" ? layoutNodes.map((item) => item.id === active.id ? { ...item, ...finalPosition } : item) : layoutNodes;
      const nextAccount = active.kind === "account" ? finalPosition : layoutAccount;
      const previousContacts = active.kind === "contact" ? nextContacts.map((item) => item.id === active.id ? { ...item, x: active.originX, y: active.originY } : item) : nextContacts;
      const previousTeams = active.kind === "team" ? nextTeams.map((item) => item.id === active.id ? { ...item, x: active.originX, y: active.originY } : item) : nextTeams;
      const previousNodes = active.kind === "node" ? nextNodes.map((item) => item.id === active.id ? { ...item, x: active.originX, y: active.originY } : item) : nextNodes;
      const previousAccount = active.kind === "account" ? { x: active.originX, y: active.originY } : layoutAccount;
      historyRef.current = [...historyRef.current.slice(-29), { contacts: previousContacts, teams: previousTeams, nodes: previousNodes, connections, accountPosition: previousAccount }];
      setLayoutContacts(nextContacts);
      setLayoutTeams(nextTeams);
      setLayoutNodes(nextNodes);
      setLayoutAccount(nextAccount);
      redoRef.current = [];
      suppressClickRef.current = `${active.kind}:${active.id}`;
      window.setTimeout(() => { suppressClickRef.current = null; }, 0);
      refreshCommands((value) => value + 1);
      onRequestEdit();
      onChange(nextContacts, nextTeams, nextNodes, connections, nextAccount);
    }
    if (autoPanFrameRef.current !== null) cancelAnimationFrame(autoPanFrameRef.current);
    autoPanFrameRef.current = null;
    latestPointerRef.current = null;
    drag.current = null;
  };
  const addPerson = () => {
    const nextContact: RelationshipContact = { id: crypto.randomUUID(), name: "New contact", role: "", team: "", strength: "", owner: "", linkedin: "", knownBy: [], x: 420, y: 300 };
    const nextContacts = [...layoutContacts, nextContact];
    setLayoutContacts(nextContacts);
    setSelectedNode(nextContact.id!); setSelectedEdge(null);
    persist(nextContacts);
  };
  const addTeam = () => {
    const members = layoutContacts.filter((contact) => contact.id && selectedContacts.includes(contact.id));
    const bounds = canvasRef.current?.getBoundingClientRect();
    const averageX = members.length ? members.reduce((total, contact) => total + (contact.x ?? 80) + 105, 0) / members.length : 0;
    const minY = members.length ? Math.min(...members.map((contact) => contact.y ?? 220)) : 0;
    const x = members.length ? averageX - 105 : bounds ? (bounds.width / 2 - pan.x) / zoom - 105 : 420;
    const y = members.length ? minY - 130 : bounds ? (bounds.height / 2 - pan.y) / zoom - 48 : 220;
    const teamId = crypto.randomUUID();
    const memberIds = members.map((contact) => contact.id!);
    const nextTeam: RelationshipTeam = { id: teamId, name: "New team", memberIds, x, y, width: 210, height: 96 };
    const nextContacts = layoutContacts.map((contact) => memberIds.includes(contact.id || "") ? {
      ...contact,
      team: nextTeam.name,
    } : contact);
    const nextTeams = [...layoutTeams, nextTeam];
    const membershipEdges: RelationshipEdge[] = memberIds.map((contactId) => ({ id: crypto.randomUUID(), source: `team:${teamId}`, target: contactId, label: "Team member", strength: "Not assessed", notes: "", kind: "membership" }));
    setLayoutContacts(nextContacts);
    setLayoutTeams(nextTeams);
    setSelectedContacts([]);
    setSelectedNode(`team:${teamId}`);
    setSelectedEdge(null);
    setSelectionMenu(null);
    persist(nextContacts, nextTeams, layoutNodes, [...connections, ...membershipEdges]);
  };
  const addNode = (type: "department" | "note") => {
    const nextNode: RelationshipCanvasNode = { id: crypto.randomUUID(), type, title: type === "department" ? "New department" : "New note", body: "", x: type === "department" ? 110 : 720, y: type === "department" ? 180 : 210, width: type === "department" ? 250 : 220, height: type === "department" ? 120 : 150 };
    const nextNodes = [...layoutNodes, nextNode]; setLayoutNodes(nextNodes); setSelectedNode(`node:${nextNode.id}`); setSelectedEdge(null); persist(layoutContacts, layoutTeams, nextNodes);
  };
  const patchContact = (id: string, patch: Partial<RelationshipContact>) => { const next = layoutContacts.map(item => item.id === id ? { ...item, ...patch } : item); setLayoutContacts(next); persist(next); };
  const patchTeam = (id: string, patch: Partial<RelationshipTeam>) => {
    const currentTeam = layoutTeams.find((item) => item.id === id);
    const next = layoutTeams.map((item) => item.id === id ? { ...item, ...patch } : item);
    const nextContacts = patch.name && currentTeam
      ? layoutContacts.map((contact) => (currentTeam.memberIds || []).includes(contact.id || "") || contact.team === currentTeam.name ? { ...contact, team: patch.name } : contact)
      : layoutContacts;
    setLayoutTeams(next);
    if (nextContacts !== layoutContacts) setLayoutContacts(nextContacts);
    persist(nextContacts, next);
  };
  const patchNode = (id: string, patch: Partial<RelationshipCanvasNode>) => { const next = layoutNodes.map(item => item.id === id ? { ...item, ...patch } : item); setLayoutNodes(next); persist(layoutContacts, layoutTeams, next); };
  const patchEdge = (id: string, patch: Partial<RelationshipEdge>) => persist(layoutContacts, layoutTeams, layoutNodes, connections.map(item => item.id === id ? { ...item, ...patch } : item));
  const setTeamMembers = (team: RelationshipTeam, memberIds: string[]) => {
    const nextContacts = layoutContacts.map((contact) => {
      const isMember = memberIds.includes(contact.id || "");
      if (isMember) return { ...contact, team: team.name };
      return contact.team === team.name ? { ...contact, team: "" } : contact;
    });
    const nextTeams = layoutTeams.map((item) => item.id === team.id ? { ...item, memberIds, width: 210, height: 96 } : item);
    const retainedEdges = connections.filter((edge) => !(edge.source === `team:${team.id}` && edge.kind === "membership"));
    const membershipEdges: RelationshipEdge[] = memberIds.map((contactId) => ({ id: crypto.randomUUID(), source: `team:${team.id}`, target: contactId, label: "Team member", strength: "Not assessed", notes: "", kind: "membership" }));
    setLayoutContacts(nextContacts);
    setLayoutTeams(nextTeams);
    persist(nextContacts, nextTeams, layoutNodes, [...retainedEdges, ...membershipEdges]);
  };
  const setDepartmentTeam = (department: RelationshipCanvasNode, team: RelationshipTeam, checked: boolean) => {
    const source = `node:${department.id}`;
    const target = `team:${team.id}`;
    const nextTeams = layoutTeams.map((item) => item.id === team.id ? { ...item, departmentId: checked ? department.id : undefined } : item);
    const existing = connections.find((edge) => edge.source === source && edge.target === target && edge.kind === "membership");
    const nextConnections = checked
      ? existing ? connections : [...connections, { id: crypto.randomUUID(), source, target, label: "Contains team", strength: "Not assessed", notes: "", kind: "membership" as const }]
      : connections.filter((edge) => !(edge.source === source && edge.target === target && edge.kind === "membership"));
    setLayoutTeams(nextTeams);
    persist(layoutContacts, nextTeams, layoutNodes, nextConnections);
  };
  const assignSelectedToDepartment = (department: RelationshipCanvasNode) => {
    if (!selectedContacts.length) return;
    const selectedIds = new Set(selectedContacts);
    const departmentNodeIds = new Set(layoutNodes.filter((node) => node.type === "department").map((node) => `node:${node.id}`));
    const nextContacts = layoutContacts.map((contact) => selectedIds.has(contact.id || "") ? { ...contact, department: department.title } : contact);
    const retainedEdges = connections.filter((edge) => !(edge.kind === "membership" && departmentNodeIds.has(edge.source) && selectedIds.has(edge.target)));
    const departmentEdges: RelationshipEdge[] = selectedContacts.map((contactId) => ({
      id: crypto.randomUUID(),
      source: `node:${department.id}`,
      target: contactId,
      label: "Department member",
      strength: "Not assessed",
      notes: "",
      kind: "membership",
    }));
    setLayoutContacts(nextContacts);
    setSelectedContacts([]);
    setSelectedNode(`node:${department.id}`);
    setSelectedEdge(null);
    setSelectionMenu(null);
    persist(nextContacts, layoutTeams, layoutNodes, [...retainedEdges, ...departmentEdges]);
  };
  const openSelectionMenu = (event: React.MouseEvent, contactId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedContacts((current) => current.includes(contactId) ? current : [...current, contactId]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectionMenu({ x: Math.min(event.clientX, window.innerWidth - 250), y: Math.min(event.clientY, window.innerHeight - 300) });
  };
  const deleteSelection = () => {
    if (selectedEdge) {
      persist(layoutContacts, layoutTeams, layoutNodes, connections.filter((edge) => edge.id !== selectedEdge));
      setSelectedEdge(null);
      return;
    }
    if (!selectedNode && !selectedContacts.length) return;
    const ids = new Set(selectedContacts);
    if (selectedNode && !selectedNode.startsWith("team:") && !selectedNode.startsWith("node:")) ids.add(selectedNode);
    const teamId = selectedNode?.startsWith("team:") ? selectedNode.slice(5) : null;
    const nodeId = selectedNode?.startsWith("node:") ? selectedNode.slice(5) : null;
    const removedKeys = new Set<string>([...ids]);
    if (teamId) removedKeys.add(`team:${teamId}`);
    if (nodeId) removedKeys.add(`node:${nodeId}`);
    const nextContacts = layoutContacts.filter((contact) => !ids.has(contact.id || ""));
    const nextTeams = layoutTeams.filter((team) => team.id !== teamId).map((team) => ({ ...team, memberIds: (team.memberIds || []).filter((id) => !ids.has(id)), departmentId: team.departmentId === nodeId ? undefined : team.departmentId }));
    const nextNodes = layoutNodes.filter((node) => node.id !== nodeId);
    const nextConnections = connections.filter((edge) => !removedKeys.has(edge.source) && !removedKeys.has(edge.target));
    setLayoutContacts(nextContacts);
    setLayoutTeams(nextTeams);
    setLayoutNodes(nextNodes);
    setSelectedContacts([]);
    setSelectedNode(null);
    persist(nextContacts, nextTeams, nextNodes, nextConnections);
  };
  const deleteEdge = (edgeId: string) => {
    persist(layoutContacts, layoutTeams, layoutNodes, connections.filter((edge) => edge.id !== edgeId));
    setSelectedEdge(null);
  };
  const copySelection = () => {
    const selectedContactSet = new Set(selectedContacts.length ? selectedContacts : selectedNode && !selectedNode.includes(":") ? [selectedNode] : []);
    clipboardRef.current = {
      contacts: layoutContacts.filter((contact) => selectedContactSet.has(contact.id || "")),
      teams: selectedNode?.startsWith("team:") ? layoutTeams.filter((team) => team.id === selectedNode.slice(5)) : [],
      nodes: selectedNode?.startsWith("node:") ? layoutNodes.filter((node) => node.id === selectedNode.slice(5)) : [],
    };
    refreshCommands((value) => value + 1);
  };
  const pasteSelection = () => {
    const copied = clipboardRef.current;
    if (!copied || (!copied.contacts.length && !copied.teams.length && !copied.nodes.length)) return;
    const pastedContacts = copied.contacts.map((contact) => ({ ...contact, id: crypto.randomUUID(), name: `${contact.name} copy`, x: (contact.x ?? 80) + 30, y: (contact.y ?? 220) + 30 }));
    const pastedTeams = copied.teams.map((team) => ({ ...team, id: crypto.randomUUID(), name: `${team.name} copy`, memberIds: [], x: team.x + 30, y: team.y + 30, width: 210, height: 96 }));
    const pastedNodes = copied.nodes.map((node) => ({ ...node, id: crypto.randomUUID(), title: `${node.title} copy`, x: node.x + 30, y: node.y + 30 }));
    const nextContacts = [...layoutContacts, ...pastedContacts];
    const nextTeams = [...layoutTeams, ...pastedTeams];
    const nextNodes = [...layoutNodes, ...pastedNodes];
    setLayoutContacts(nextContacts);
    setLayoutTeams(nextTeams);
    setLayoutNodes(nextNodes);
    setSelectedContacts(pastedContacts.map((contact) => contact.id!));
    persist(nextContacts, nextTeams, nextNodes, connections);
  };
  const cutSelection = () => { copySelection(); deleteSelection(); };
  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, textarea, select")) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if (command && event.key.toLowerCase() === "c") { event.preventDefault(); copySelection(); }
      else if (command && event.key.toLowerCase() === "x") { event.preventDefault(); cutSelection(); }
      else if (command && event.key.toLowerCase() === "v") { event.preventDefault(); pasteSelection(); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  });
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workspaceRef.current?.requestFullscreen();
  };

  return <div ref={workspaceRef} className="relationship-workspace">
    <div className="relationship-toolbar">
      <div>
        <button className="secondary small" onClick={addPerson}><UserPlus size={14}/> Add person</button>
        <button className="secondary small" onClick={addTeam}><SquareDashed size={14}/> Add team</button>
        <button className="secondary small" onClick={() => addNode("department")}><Building2 size={14}/> Add department</button>
        <button className="secondary small" onClick={() => addNode("note")}><FileText size={14}/> Add note</button>
      </div>
      <div className="relationship-toolbar-actions">
        <div className="relationship-edit-controls" aria-label="Editing controls">
          <button onClick={undo} disabled={!historyRef.current.length} aria-label="Undo"><Undo2 size={14}/></button>
          <button onClick={redo} disabled={!redoRef.current.length} aria-label="Redo"><Redo2 size={14}/></button>
          <button onClick={copySelection} disabled={!selectedNode && !selectedContacts.length} aria-label="Copy selection"><Copy size={14}/></button>
          <button onClick={cutSelection} disabled={!selectedNode && !selectedContacts.length} aria-label="Cut selection"><Scissors size={14}/></button>
          <button onClick={pasteSelection} disabled={!clipboardRef.current} aria-label="Paste selection"><ClipboardPaste size={14}/></button>
          <button className="delete-control" onClick={deleteSelection} disabled={!selectedNode && !selectedEdge && !selectedContacts.length} aria-label="Delete selection"><Trash2 size={14}/></button>
        </div>
        <div className="canvas-controls" aria-label="Canvas controls">
          <button onClick={() => setZoom((value) => Math.max(.55, value - .1))} aria-label="Zoom out"><Minus size={14}/></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(1.7, value + .1))} aria-label="Zoom in"><Plus size={14}/></button>
          <button onClick={resetView} aria-label="Reset view"><Target size={14}/></button>
          <button onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit expanded view" : "Expand view"}><Maximize2 size={14}/></button>
        </div>
      </div>
    </div>
    <div className="relationship-layout"><div ref={canvasRef} className={`relationship-canvas ${drawingEdge ? "is-connecting" : ""}`} onPointerDown={(event) => startDrag(event, "pan", "canvas", pan.x, pan.y)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="relationship-scene" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {layoutTeams.map((team) => <div key={team.id} data-connection-node={`team:${team.id}`} className={`relationship-team ${connectFrom === `team:${team.id}` || selectedNode === `team:${team.id}` ? "selected" : ""}`} style={{ left: team.x, top: team.y, width: team.width, height: team.height }} onPointerDown={(event) => startDrag(event, "team", team.id, team.x, team.y)} onClick={event => { event.stopPropagation(); if (suppressClickRef.current !== `team:${team.id}`) { setSelectedNode(`team:${team.id}`); setSelectedEdge(null); } }}><div><SquareDashed size={13}/><strong>{team.name}</strong><span>{team.memberIds?.length || 0} people</span><button className="node-edit" aria-label={`Edit ${team.name}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedNode(`team:${team.id}`); setSelectedEdge(null); onRequestEdit(); }}><Pencil size={12}/></button></div>{team.description && <p>{team.description}</p>}<button className="connection-handle" aria-label={`Draw relationship from ${team.name}`} onPointerDown={event => beginConnection(event, `team:${team.id}`)}/></div>)}
        {layoutNodes.map(node => <article key={node.id} data-connection-node={`node:${node.id}`} className={`relationship-free-node ${node.type} ${connectFrom === `node:${node.id}` || selectedNode === `node:${node.id}` ? "selected" : ""}`} style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }} onPointerDown={event => startDrag(event, "node", node.id, node.x, node.y)} onClick={event => { event.stopPropagation(); if (suppressClickRef.current !== `node:${node.id}`) { setSelectedNode(`node:${node.id}`); setSelectedEdge(null); } }}><small>{node.type}</small><strong>{node.title}</strong>{node.body && <p>{node.body}</p>}<button className="node-edit" aria-label={`Edit ${node.title}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedNode(`node:${node.id}`); setSelectedEdge(null); onRequestEdit(); }}><Pencil size={12}/></button><button className="connection-handle" aria-label={`Draw relationship from ${node.title}`} onPointerDown={event => beginConnection(event, `node:${node.id}`)}/></article>)}
        <svg viewBox="0 0 1100 620" aria-label="Relationship connections"><defs><marker id="relationship-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>{connections.map((edge) => { const source = nodePoint(edge.source); const target = nodePoint(edge.target); if (!source || !target) return null; const selected = selectedEdge === edge.id; const selectEdge = () => { setSelectedEdge(edge.id); setSelectedNode(null); onRequestEdit(); }; return <g key={edge.id} className={selected ? "selected-edge" : ""} role="button" tabIndex={0} aria-label={`Select ${edge.label || "relationship"}`} onPointerDown={event => event.stopPropagation()} onMouseDown={event => { event.stopPropagation(); selectEdge(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectEdge(); } }} onClick={event => event.stopPropagation()}><line className="edge-hit-area" x1={source.x} y1={source.y} x2={target.x} y2={target.y}/><line className="edge-visible-line" x1={source.x} y1={source.y} x2={target.x} y2={target.y} markerEnd="url(#relationship-arrow)"/></g>; })}{drawingEdge && (() => { const source = nodePoint(drawingEdge.source); return source ? <line className="relationship-preview-line" x1={source.x} y1={source.y} x2={drawingEdge.x} y2={drawingEdge.y}/> : null; })()}</svg>
        {connections.map((edge) => { const source = nodePoint(edge.source); const target = nodePoint(edge.target); if (!source || !target) return null; const middleX = (source.x + target.x) / 2; const middleY = (source.y + target.y) / 2; const selected = selectedEdge === edge.id; const selectEdge = () => { setSelectedEdge(edge.id); setSelectedNode(null); onRequestEdit(); }; return <div key={`controls:${edge.id}`} className="edge-actions edge-actions-overlay" style={{ left: middleX - 62, top: middleY - 14 }} onPointerDown={event => event.stopPropagation()}><button type="button" className="edge-label-control" aria-label={`Select ${edge.label || "relationship"}`} onClick={event => { event.stopPropagation(); selectEdge(); }}>{edge.label || "Relationship"}</button>{selected && <button type="button" className="edge-delete-control" aria-label={`Delete ${edge.label || "relationship"}`} title="Delete relationship" onClick={event => { event.stopPropagation(); deleteEdge(edge.id); }}><Trash2 size={13}/></button>}</div>; })}
        <article data-connection-node="account" className={`relationship-company ${connectFrom === "account" ? "selected" : ""}`} style={{ left: layoutAccount.x, top: layoutAccount.y }} onPointerDown={(event) => startDrag(event, "account", "account", layoutAccount.x, layoutAccount.y)}><span>{account.name.split(" ").map((part) => part[0]).join("").slice(0,2)}</span><small>Account</small><strong>{account.name}</strong><button className="connection-handle" aria-label={`Draw relationship from ${account.name}`} onPointerDown={event => beginConnection(event, "account")}/></article>
        {layoutContacts.map((contact) => <article data-connection-node={contact.id} className={`relationship-person ${connectFrom === contact.id ? "selected" : ""} ${selectedContacts.includes(contact.id!) ? "multi-selected" : ""}`} key={contact.id} style={{ left: contact.x, top: contact.y }} onPointerDown={(event) => startDrag(event, "contact", contact.id!, contact.x!, contact.y!)} onContextMenu={(event) => openSelectionMenu(event, contact.id!)} onClick={(event) => { event.stopPropagation(); if (suppressClickRef.current === `contact:${contact.id}`) return; if (event.metaKey || event.ctrlKey) setSelectedContacts((current) => current.includes(contact.id!) ? current.filter((id) => id !== contact.id) : [...current, contact.id!]); else { setSelectedNode(contact.id!); setSelectedEdge(null); } }}>
          <button className="contact-select" aria-label={`${selectedContacts.includes(contact.id!) ? "Remove" : "Add"} ${contact.name} ${selectedContacts.includes(contact.id!) ? "from" : "to"} team selection`} aria-pressed={selectedContacts.includes(contact.id!)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedContacts((current) => current.includes(contact.id!) ? current.filter((id) => id !== contact.id) : [...current, contact.id!]); }}>{selectedContacts.includes(contact.id!) ? "✓" : "+"}</button><button className="node-edit" aria-label={`Edit ${contact.name}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setSelectedNode(contact.id!); setSelectedEdge(null); onRequestEdit(); }}><Pencil size={12}/></button><header><span>{contact.name.split(" ").map((part) => part[0]).join("").slice(0,2) || "?"}</span><div><small>Person</small><strong>{contact.name}</strong></div></header>
          <dl>
            <div><dt>Position</dt><dd>{hasValue(contact.role) ? contact.role : "Add position"}</dd></div>
            <div><dt>Department</dt><dd>{hasValue(contact.department) ? contact.department : "Add department"}</dd></div>
            <div><dt>Relationship</dt><dd>{hasValue(contact.strength) ? contact.strength : "Define relationship"}</dd></div>
            <div><dt>QuickSort owner</dt><dd>{hasValue(contact.owner) ? contact.owner : "Assign owner"}</dd></div>
            <div className="known-by-summary"><dt>Known by</dt><dd>{contact.knownBy?.length ? contact.knownBy.map((item) => item.name).join(", ") : "Add QuickSort connection"}</dd></div>
          </dl>
          {contact.linkedin ? <a href={contact.linkedin} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>LinkedIn profile <ArrowUpRight size={11}/></a> : <span className="missing-profile">No LinkedIn added</span>}<button className="connection-handle" aria-label={`Draw relationship from ${contact.name}`} onPointerDown={event => beginConnection(event, contact.id!)}/>
        </article>)}
        {!layoutContacts.length && <div className="relationship-empty"><Users size={24}/><strong>No people mapped yet</strong><span>Add a person, place them in a team, then connect the reporting line.</span></div>}
      </div>
      {selectedContacts.length > 0 && <div className="relationship-selection-tray" role="toolbar" aria-label={`${selectedContacts.length} people selected`} onPointerDown={(event) => event.stopPropagation()}>
        <strong>{selectedContacts.length} selected</strong>
        <button type="button" onClick={addTeam}><SquareDashed size={13}/> Create team</button>
        <select aria-label="Assign selected people to department" defaultValue="" onChange={(event) => { const department = layoutNodes.find((node) => node.id === event.target.value); if (department) assignSelectedToDepartment(department); event.currentTarget.value = ""; }}>
          <option value="" disabled>Assign to department</option>
          {layoutNodes.filter((node) => node.type === "department").map((department) => <option key={department.id} value={department.id}>{department.title}</option>)}
        </select>
        <button type="button" className="selection-clear" onClick={() => setSelectedContacts([])}>Clear</button>
      </div>}
    </div>{selectedNode && <aside ref={inspectorRef} className="relationship-inspector"><div className="inspector-head"><div><small>Card inspector</small><strong>Edit details</strong></div><button onClick={() => setSelectedNode(null)} aria-label="Close inspector"><X size={15}/></button></div>{(() => { const contact = layoutContacts.find(item => item.id === selectedNode); if (contact) return <div className="inspector-fields"><label>Name<input value={contact.name} onChange={e => patchContact(contact.id!, { name: e.target.value })}/></label><label>Position<input value={contact.role} onChange={e => patchContact(contact.id!, { role: e.target.value })}/></label><label>Team<input value={contact.team || ""} onChange={e => patchContact(contact.id!, { team: e.target.value })}/></label><label>Department<input value={contact.department || ""} onChange={e => patchContact(contact.id!, { department: e.target.value })}/></label><label>Relationship<input value={contact.strength} onChange={e => patchContact(contact.id!, { strength: e.target.value })}/></label><label>QuickSort owner<select value={contact.owner} onChange={e => patchContact(contact.id!, { owner: e.target.value })}><option value="">Unassigned</option>{ownerOptions.map(owner => <option key={owner.id} value={owner.name}>{owner.name}</option>)}</select></label><label>LinkedIn<input value={contact.linkedin || ""} onChange={e => patchContact(contact.id!, { linkedin: e.target.value })}/></label><fieldset><legend>Known by at QuickSort</legend>{ownerOptions.length ? ownerOptions.map(owner => { const connection = (contact.knownBy || []).find(item => item.ownerId === owner.id || item.email === owner.email); return <label className="inspector-check" key={owner.id}><input type="checkbox" checked={Boolean(connection)} onChange={e => patchContact(contact.id!, { knownBy: e.target.checked ? [...(contact.knownBy || []), { ownerId: owner.id, name: owner.name, email: owner.email, relationship: "Known contact", strength: "Developing", createdAt: new Date().toISOString() }] : (contact.knownBy || []).filter(item => item.ownerId !== owner.id && item.email !== owner.email) })}/><span>{owner.name}<small>{connection ? `${connection.relationship} · ${connection.strength}` : owner.headline || "QuickSort teammate"}</small></span></label>; }) : <p>Add approved teammates in Admin before assigning internal connections.</p>}</fieldset><fieldset><legend>Linked Kanban cards</legend>{kanbanCards.length ? kanbanCards.map(card => <label className="inspector-check" key={card.id}><input type="checkbox" checked={(contact.kanbanCardIds || []).includes(card.id)} onChange={e => patchContact(contact.id!, { kanbanCardIds: e.target.checked ? [...(contact.kanbanCardIds || []), card.id] : (contact.kanbanCardIds || []).filter(id => id !== card.id) })}/><span>CARD-{String(card.card_number).padStart(6, "0")} · {card.title}<small>{card.boardName} · {card.columnName}</small></span></label>) : <p>No account boards are mapped yet.</p>}</fieldset><fieldset><legend>Comments</legend>{(contact.comments || []).map(item => <article className="contact-comment" key={item.id}><p>{item.text}</p><small>{item.author} · {new Date(item.createdAt).toLocaleString()}</small></article>)}<textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add context or a follow-up note"/><button className="secondary small" disabled={!comment.trim()} onClick={() => { patchContact(contact.id!, { comments: [...(contact.comments || []), { id: crypto.randomUUID(), text: comment.trim(), author: actorEmail || "Workspace admin", createdAt: new Date().toISOString() }] }); setComment(""); }}>Add comment</button></fieldset></div>; const teamId = selectedNode.startsWith("team:") ? selectedNode.slice(5) : ""; const team = layoutTeams.find(item => item.id === teamId); if (team) return <div className="inspector-fields"><label>Team name<input value={team.name} onChange={e => patchTeam(team.id, { name: e.target.value })}/></label><label>Description<textarea value={team.description || ""} onChange={e => patchTeam(team.id, { description: e.target.value })}/></label><fieldset><legend>People in this team</legend><p>Select people to place and align inside this team.</p>{layoutContacts.map(contactItem => <label className="inspector-check" key={contactItem.id}><input type="checkbox" checked={(team.memberIds || []).includes(contactItem.id!)} onChange={event => setTeamMembers(team, event.target.checked ? [...(team.memberIds || []), contactItem.id!] : (team.memberIds || []).filter(id => id !== contactItem.id))}/><span>{contactItem.name}<small>{contactItem.role || "Position not added"}</small></span></label>)}</fieldset></div>; const nodeId = selectedNode.startsWith("node:") ? selectedNode.slice(5) : ""; const node = layoutNodes.find(item => item.id === nodeId); return node ? <div className="inspector-fields"><label>Title<input value={node.title} onChange={e => patchNode(node.id, { title: e.target.value })}/></label><label>Details<textarea value={node.body} onChange={e => patchNode(node.id, { body: e.target.value })}/></label>{node.type === "department" && <fieldset><legend>Teams in this department</legend><p>Select teams to map beneath this department.</p>{layoutTeams.map(teamItem => <label className="inspector-check" key={teamItem.id}><input type="checkbox" checked={teamItem.departmentId === node.id} onChange={event => setDepartmentTeam(node, teamItem, event.target.checked)}/><span>{teamItem.name}<small>{teamItem.memberIds?.length || 0} people</small></span></label>)}</fieldset>}</div> : null; })()}</aside>}{selectedEdge && (() => { const edge = connections.find(item => item.id === selectedEdge); return edge ? <aside ref={inspectorRef} className="relationship-inspector"><div className="inspector-head"><div><small>Relationship mapping</small><strong>How are these connected?</strong></div><button onClick={() => setSelectedEdge(null)} aria-label="Close relationship editor"><X size={15}/></button></div><div className="inspector-fields"><p className="inspector-prompt">Name the relationship and add any context the team should know.</p><label>Relationship<input placeholder="Reports to, introduced by, works with…" value={edge.label} onChange={e => patchEdge(edge.id, { label: e.target.value })}/></label><label>Strength<select value={edge.strength || "Not assessed"} onChange={e => patchEdge(edge.id, { strength: e.target.value })}><option>Not assessed</option><option>Weak</option><option>Developing</option><option>Strong</option><option>Trusted</option></select></label><label>Owner<select value={edge.owner || ""} onChange={e => patchEdge(edge.id, { owner: e.target.value })}><option value="">Unassigned</option>{ownerOptions.map(owner => <option key={owner.id} value={owner.name}>{owner.name}</option>)}</select></label><label>Comment or context<textarea value={edge.notes || ""} placeholder="Add context about this relationship" onChange={e => patchEdge(edge.id, { notes: e.target.value })}/></label><button className="danger-link" onClick={() => { persist(layoutContacts, layoutTeams, layoutNodes, connections.filter(item => item.id !== edge.id)); setSelectedEdge(null); }}>Remove relationship</button></div></aside> : null; })()}</div>
    {selectionMenu && <div className="relationship-context-menu" role="menu" aria-label="Selected people actions" style={{ left: selectionMenu.x, top: selectionMenu.y }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      <header><strong>{selectedContacts.length} selected</strong><span>Group actions</span></header>
      <button type="button" role="menuitem" onClick={addTeam}><SquareDashed size={14}/> Create team</button>
      {layoutNodes.filter((node) => node.type === "department").length > 0 ? <div className="relationship-context-departments"><small>Assign to department</small>{layoutNodes.filter((node) => node.type === "department").map((department) => <button type="button" role="menuitem" key={department.id} onClick={() => assignSelectedToDepartment(department)}><Building2 size={14}/>{department.title}</button>)}</div> : <button type="button" role="menuitem" onClick={() => { addNode("department"); setSelectionMenu(null); }}><Building2 size={14}/> Add a department</button>}
      <button type="button" role="menuitem" className="context-clear" onClick={() => { setSelectedContacts([]); setSelectionMenu(null); }}><X size={14}/> Clear selection</button>
    </div>}
  </div>;
}

function AccountDetail({ account, intel, linkedStudies, ownerOptions, kanbanCards, actorEmail, onSave, onBack, notify }: { account: Account; intel: AccountIntel; linkedStudies: BusinessCaseStudyRecord[]; ownerOptions: OwnerOption[]; kanbanCards: (KanbanCard & { boardName: string; columnName: string })[]; actorEmail: string; onSave: (account: Account, intel: AccountIntel) => void; onBack: () => void; notify: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [opportunityEditing, setOpportunityEditing] = useState(false);
  const [draft, setDraft] = useState(account);
  const [draftIntel, setDraftIntel] = useState(intel);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const suppressEditRef = useRef(false);
  useEffect(() => { setDraft(account); setDraftIntel(intel); setEditing(false); setOpportunityEditing(false); }, [account, intel]);
  useEffect(() => {
    let activeRequest = true;
    let request = db().from("business_audit_logs").select("id, section, action, changes, actor_email, created_at").eq("entity_type", "business_accounts");
    request = account.databaseId ? request.eq("entity_id", account.databaseId) : request.eq("entity_slug", account.id);
    void request.order("created_at", { ascending: false }).limit(20).then(({ data, error }) => {
      if (activeRequest && !error && data) setAuditLogs(data as AuditLog[]);
    });
    return () => { activeRequest = false; };
  }, [account]);
  const patchAccount = (patch: Partial<Account>) => setDraft((current) => ({ ...current, ...patch }));
  const patchIntelItem = <K extends "contacts" | "leads" | "events">(group: K, index: number, patch: Partial<AccountIntel[K][number]>) => {
    setDraftIntel((current) => ({ ...current, [group]: current[group].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));
  };
  const beginEditing = () => { if (!editing && !suppressEditRef.current) setEditing(true); };
  const cancelEditing = () => {
    suppressEditRef.current = true;
    setDraft(account);
    setDraftIntel(intel);
    setEditing(false);
    window.setTimeout(() => { suppressEditRef.current = false; }, 1200);
  };
  const saveEditing = () => { onSave(draft, draftIntel); setEditing(false); };
  const cancelOpportunityEditing = () => {
    setDraft((current) => ({
      ...current,
      opportunity: account.opportunity,
      opportunitySummary: account.opportunitySummary,
      fitScore: account.fitScore,
      fit: account.fit,
      evidence: account.evidence,
    }));
    setOpportunityEditing(false);
  };
  const saveOpportunityEditing = () => { onSave(draft, draftIntel); setOpportunityEditing(false); };
  const saveRelationshipMap = (contacts: RelationshipContact[], teams: RelationshipTeam[], nodes: RelationshipCanvasNode[], connections: RelationshipEdge[], accountPosition: CanvasPoint) => {
    const nextAccount = { ...draft, contacts: contacts.length };
    const nextIntel = { ...draftIntel, contacts, teams, nodes, connections, accountPosition };
    setDraft(nextAccount);
    setDraftIntel(nextIntel);
    onSave(nextAccount, nextIntel);
  };
  const summary = draft.opportunitySummary ?? "";
  const evidence = draft.evidence ?? [];
  const editingOpportunity = editing || opportunityEditing;

  return <div className={`page account-detail-page ${editing ? "edit-mode" : ""}`}>
    <div className="account-page-actions">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Back to accounts</button>
      <div>{editing ? <><button className="secondary" onClick={cancelEditing}><X size={15}/> Cancel</button><button className="primary" onClick={saveEditing}><Save size={15}/> Save changes</button></> : <button className="secondary" onClick={() => setEditing(true)}><Pencil size={15}/> Edit account</button>}</div>
    </div>
    <div className="page-intro editable-block" onClick={beginEditing}>
      <div><h1><EditField editing={editing} value={draft.name} label="Account name" onChange={(name) => patchAccount({ name })}/></h1>
        <div className="account-subtitle"><EditField editing={editing} value={draft.sector} label="Sector" onChange={(sector) => patchAccount({ sector })}/><span>·</span><EditField editing={editing} value={draft.contacts} label="Mapped contacts" onChange={(contacts) => patchAccount({ contacts: Number(contacts) || 0 })}/><span>mapped contacts ·</span>{editing ? <select className="inline-edit" aria-label="Relationship strength" value={draft.signal} onChange={(event) => patchAccount({ signal: event.target.value })}><option>Not set</option><option>Cold</option><option>Warm</option><option>Strong</option></select> : <span className="editable-value">{hasValue(draft.signal) ? draft.signal : "Relationship not assessed"}</span>}</div>
      </div>
      {!editing && <span className="edit-hint"><Pencil size={13}/> Click content to edit</span>}
    </div>
    <section className="account-brief editable-block" onClick={beginEditing}>
      <div><span>Active opportunity</span><strong><EditField editing={editing} value={draft.opportunity} label="Active opportunity" onChange={(opportunity) => patchAccount({ opportunity })}/></strong></div>
      <div><span>Estimated value</span><strong><EditField editing={editing} value={draft.value} label="Estimated value" onChange={(value) => patchAccount({ value })}/></strong></div>
      <div><span>Opportunity stage</span><strong>{editing ? <select className="inline-edit" aria-label="Opportunity stage" value={draft.stage} onChange={(event) => patchAccount({ stage: normalizeAccountStage(event.target.value) })}>{accountStages.map((stage) => <option key={stage}>{stage}</option>)}</select> : <span className="editable-value">{draft.stage}</span>}</strong></div>
      <div><span>QuickSort owner</span><strong>{editing ? <select className="inline-edit" aria-label="QuickSort owner" value={draft.owner} onChange={(event) => patchAccount({ owner: event.target.value })}><option value="—">Unassigned</option>{ownerOptions.map((owner) => <option key={owner.id} value={owner.name}>{owner.name}{owner.headline ? ` · ${owner.headline}` : ""}</option>)}</select> : <span className="editable-value">{hasValue(draft.owner) ? draft.owner : "Assign an owner"}</span>}</strong></div>
    </section>
    <div className="account-detail-grid">
      <section className="surface org-surface">
        <div className="section-head"><div><h2>Relationship playground</h2><p>Arrange teams, map reporting lines, and show who can open the door.</p></div><span className="legend"><i/> Saved to this account</span></div>
        <RelationshipCanvas account={draft} contacts={draftIntel.contacts} teams={draftIntel.teams} nodes={draftIntel.nodes} connections={draftIntel.connections} accountPosition={draftIntel.accountPosition} ownerOptions={ownerOptions} kanbanCards={kanbanCards} actorEmail={actorEmail} onRequestEdit={() => undefined} onChange={saveRelationshipMap}/>
      </section>
      <aside className="surface opportunity-panel editable-block" onClick={(event) => { if ((event.target as HTMLElement).closest("button, input, textarea, select, a")) return; if (!editingOpportunity) setOpportunityEditing(true); }}>
        <div className="opportunity-panel-head">
          <span className="panel-label">Opportunity</span>
          {opportunityEditing && <div className="opportunity-panel-actions"><button type="button" className="opportunity-cancel" aria-label="Cancel opportunity editing" onClick={(event) => { event.stopPropagation(); cancelOpportunityEditing(); }}><X size={14}/><span>Cancel</span></button><button type="button" className="opportunity-save" onClick={(event) => { event.stopPropagation(); saveOpportunityEditing(); }}><Save size={14}/><span>Save</span></button></div>}
        </div>
        <h2><EditField editing={editingOpportunity} value={draft.opportunity} label="Opportunity name" onChange={(opportunity) => patchAccount({ opportunity })}/></h2>
        <p>{editingOpportunity || summary ? <EditField editing={editingOpportunity} multiline value={summary} label="Opportunity summary" onChange={(opportunitySummary) => patchAccount({ opportunitySummary })}/> : "No opportunity details added."}</p>
        <div className="opportunity-score"><strong><EditField editing={editingOpportunity} value={draft.fitScore ?? "—"} label="Capability fit" onChange={(fitScore) => patchAccount({ fitScore })}/></strong><span>capability fit</span></div>
        <h3>Recommended capabilities</h3>
        {editingOpportunity ? <input className="inline-edit" aria-label="Recommended capabilities" value={draft.fit.join(", ")} onChange={(event) => patchAccount({ fit: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}/> : draft.fit.length ? <div className="fit-tags">{draft.fit.map((fit) => <span key={fit}>{fit}</span>)}</div> : <div className="data-empty">No capability matches added.</div>}
        <h3>Evidence ready</h3>
        {editingOpportunity ? <textarea className="inline-edit textarea" aria-label="Evidence ready" value={evidence.join("\n")} onChange={(event) => patchAccount({ evidence: event.target.value.split("\n").filter(Boolean) })}/> : evidence.length ? <ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul> : <div className="data-empty">No evidence added.</div>}
      </aside>
    </div>
    <section className="surface case-studies-section">
      <div className="section-head"><div><h2>Company studies</h2><p>Assessments, business cases, strategic studies, and success stories linked to {draft.name}.</p></div><span className="case-count">{linkedStudies.length + draft.caseStudies.length} linked</span></div>
      {linkedStudies.length > 0 && <div className="case-study-grid account-linked-studies">{linkedStudies.map((study) => <article className="case-study-card" key={study.id}>
        <div className="case-study-top"><span><FileText size={16}/>{study.studyType}</span><em className={`study-status ${study.status.toLowerCase()}`}>{study.status}</em></div>
        <div><small>{study.client || draft.name}</small><h3>{study.title}</h3><p>{study.summary}</p></div>
        {study.outcome && <div className="case-study-outcome"><span>{study.studyType === "Success story" ? "Outcome" : "Expected impact"}</span><strong>{study.outcome}</strong></div>}
        <div className="fit-tags">{study.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </article>)}</div>}
      {draft.caseStudies.length ? <div className="case-study-grid legacy-account-studies" onClick={beginEditing}>{draft.caseStudies.map((study, index) => <article className="case-study-card" key={index}>
        <div className="case-study-top"><span><FileText size={16}/><EditField editing={editing} value={study.evidence} label={`Case study ${index + 1} evidence`} onChange={(evidence) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, evidence } : item) })}/></span>{!editing && <Pencil size={15}/>}</div>
        <div><small><EditField editing={editing} value={study.client} label={`Case study ${index + 1} client`} onChange={(client) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, client } : item) })}/></small><h3><EditField editing={editing} value={study.title} label={`Case study ${index + 1} title`} onChange={(title) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, title } : item) })}/></h3><p><EditField editing={editing} multiline value={study.summary} label={`Case study ${index + 1} summary`} onChange={(summary) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, summary } : item) })}/></p></div>
        <div className="case-study-outcome"><span>Proven outcome</span><strong><EditField editing={editing} value={study.outcome} label={`Case study ${index + 1} outcome`} onChange={(outcome) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, outcome } : item) })}/></strong></div>
        {editing ? <input className="inline-edit" aria-label={`Case study ${index + 1} tags`} value={study.tags.join(", ")} onChange={(event) => patchAccount({ caseStudies: draft.caseStudies.map((item, itemIndex) => itemIndex === index ? { ...item, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) } : item) })}/> : <div className="fit-tags">{study.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      </article>)}</div> : null}
      {!linkedStudies.length && !draft.caseStudies.length && <div className="data-empty">No studies are linked to this company yet.</div>}
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
    <section className="surface account-activity-log">
      <div className="section-head"><div><h2>Change history</h2><p>Server-recorded edits for this account, including who changed each section.</p></div><span className="case-count">{auditLogs.length} recent</span></div>
      {auditLogs.length ? <div className="activity-list">{auditLogs.map((log) => {
        const changes = auditChangeDetails(log);
        const fields = changes.map((change) => change.field);
        const expanded = expandedAuditId === log.id;
        return <article className={expanded ? "expanded" : ""} key={log.id}>
          <button className="activity-summary" type="button" aria-expanded={expanded} onClick={() => setExpandedAuditId(expanded ? null : log.id)}>
            <span className="activity-dot"/>
            <span className="activity-copy"><strong>{log.actor_email || "Workspace administrator"}</strong><span>{log.action === "created" ? "Created this account" : log.action === "deleted" ? "Deleted this account" : `Updated ${fields.map(auditFieldLabel).join(", ") || log.section}`}</span><small>{log.section} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(log.created_at))}</small></span>
            <ChevronDown className="activity-chevron" size={15}/>
          </button>
          {expanded && <div className="activity-details">
            <div className="activity-details-head"><strong>What changed</strong><span>{changes.length} field{changes.length === 1 ? "" : "s"}</span></div>
            {changes.length ? changes.map((change) => <section className="activity-change" key={change.field}>
              <h3>{auditFieldLabel(change.field)}</h3>
              <div className={`activity-comparison ${log.action === "created" || log.action === "deleted" ? "single" : ""}`}>
                {log.action !== "created" && <div><small>Previous</small><strong>{auditValueSummary(change.field, change.before)}</strong><pre>{auditValueDetail(change.before)}</pre></div>}
                {log.action !== "deleted" && <div><small>New</small><strong>{auditValueSummary(change.field, change.after)}</strong><pre>{auditValueDetail(change.after)}</pre></div>}
              </div>
            </section>) : <p className="activity-no-detail">No field-level details were recorded for this change.</p>}
          </div>}
        </article>;
      })}</div> : <div className="data-empty">No recorded changes yet. New saves will appear here automatically.</div>}
    </section>
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

function Leads({ leads, onChange, notify, createIntent }: { leads: LeadRecord[]; onChange: (leads: LeadRecord[]) => void; notify: (message: string) => void; createIntent: number }) {
  const [source, setSource] = useState<"All" | LeadSource>("All");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (createIntent) setAdding(true); }, [createIntent]);
  const stages: LeadStage[] = ["New", "Qualified", "Contacted", "Converted"];
  const visible = leads.filter((lead) => (source === "All" || lead.source === source) && `${lead.name} ${lead.company} ${lead.role}`.toLowerCase().includes(search.toLowerCase()));
  const advance = (lead: LeadRecord) => {
    const next = stages[Math.min(stages.indexOf(lead.stage) + 1, stages.length - 1)];
    onChange(leads.map((item) => item.id === lead.id ? { ...item, stage: next } : item));
    notify(next === lead.stage ? `${lead.name} is already converted` : `${lead.name} moved to ${next}`);
  };
  const addLead = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const lead: LeadRecord = { id: crypto.randomUUID(), name: String(values.get("name") || "").trim(), role: String(values.get("role") || "").trim(), company: String(values.get("company") || "").trim(), source: String(values.get("source") || "Tool") as LeadSource, origin: String(values.get("origin") || "").trim(), score: Math.min(100, Math.max(0, Number(values.get("score")) || 0)), reason: String(values.get("reason") || "").trim(), stage: "New", owner: String(values.get("owner") || "—").trim() || "—" };
    onChange([lead, ...leads]);
    setAdding(false);
    notify(`${lead.name} added to Leads`);
  };
  return <div className="page leads-page">
    <PageIntro title="Lead pipeline" text="Every prospect in one place, with the source and reason behind the signal." action={<button className="primary" onClick={() => setAdding(true)}><Plus size={16}/> Add lead</button>}/>
    {adding && <form className="surface quick-create-form" onSubmit={addLead}><div className="section-head"><div><h2>Add lead</h2><p>Record the person, their source, and why they matter.</p></div><button type="button" className="icon-button" onClick={() => setAdding(false)} aria-label="Close lead form"><X size={17}/></button></div><div className="quick-create-grid"><label>Full name<input name="name" required autoFocus placeholder="Lead name"/></label><label>Role<input name="role" placeholder="Job title"/></label><label>Company<input name="company" placeholder="Company"/></label><label>Source<select name="source"><option>Event</option><option>Tool</option><option>Network</option></select></label><label>Source detail<input name="origin" placeholder="Event, research, or relationship"/></label><label>Fit score<input name="score" type="number" min="0" max="100" defaultValue="0"/></label><label>QuickSort owner<input name="owner" placeholder="Owner"/></label><label className="quick-create-wide">Why this lead<textarea name="reason" placeholder="Fit, timing, signal, or reason to contact"/></label></div><div className="actions"><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button><button className="primary"><Save size={15}/> Create lead</button></div></form>}
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

const emptyBusinessPartner = (): BusinessPartnerRecord => ({
  id: "",
  name: "",
  company: "",
  role: "",
  origin: "",
  linkedin: "",
  email: "",
  phone: "",
  relationship: "",
  owner: "",
  notes: "",
  accountLinks: [],
});

const partnerContactKey = (contact: RelationshipContact) => contact.id || `name:${contact.name.trim().toLowerCase()}`;

function BusinessPartners({ partners, accounts, intel, onChange, openAccount, notify }: {
  partners: BusinessPartnerRecord[];
  accounts: Account[];
  intel: Record<string, AccountIntel>;
  onChange: (partners: BusinessPartnerRecord[]) => void;
  openAccount: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<BusinessPartnerRecord | null>(null);
  const [search, setSearch] = useState("");
  const visiblePartners = partners.filter((partner) => `${partner.name} ${partner.company} ${partner.role} ${partner.origin} ${partner.relationship}`.toLowerCase().includes(search.toLowerCase()));
  const startNew = () => setEditing(emptyBusinessPartner());
  const patch = (field: keyof BusinessPartnerRecord, value: string) => setEditing((current) => current ? { ...current, [field]: value } : current);
  const toggleAccount = (accountId: string) => setEditing((current) => {
    if (!current) return current;
    const exists = current.accountLinks.some((link) => link.accountId === accountId);
    return { ...current, accountLinks: exists ? current.accountLinks.filter((link) => link.accountId !== accountId) : [...current.accountLinks, { accountId, contactKeys: [] }] };
  });
  const toggleContact = (accountId: string, contactKey: string) => setEditing((current) => {
    if (!current) return current;
    return { ...current, accountLinks: current.accountLinks.map((link) => link.accountId !== accountId ? link : { ...link, contactKeys: link.contactKeys.includes(contactKey) ? link.contactKeys.filter((key) => key !== contactKey) : [...link.contactKeys, contactKey] }) };
  });
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const record = { ...editing, id: editing.id || crypto.randomUUID() };
    const next = editing.id ? partners.map((partner) => partner.id === editing.id ? record : partner) : [record, ...partners];
    onChange(next);
    setEditing(null);
    notify(editing.id ? "Business partner updated" : "Business partner added");
  };
  return <div className="page business-partners-page">
    <PageIntro title="Business partners" text="Manage external people who support QuickSort projects, referrals, or delivery on a commission or partnership basis. They are not QuickSort employees." action={<button className="primary" onClick={startNew}><Plus size={16}/> Add business partner</button>}/>
    <section className="partner-summary" aria-label="Business partner summary">
      <div><strong>{partners.length}</strong><span>partners mapped</span></div>
      <div><strong>{partners.filter((partner) => partner.linkedin).length}</strong><span>LinkedIn profiles</span></div>
      <div><strong>{new Set(partners.map((partner) => partner.origin.trim()).filter(Boolean)).size}</strong><span>origins represented</span></div>
    </section>
    <div className="toolbar partner-toolbar"><label><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search partners, companies or locations"/></label><span>{visiblePartners.length} partners</span></div>
    {editing && <form className="surface partner-form" onSubmit={save}>
      <div className="section-head"><div><h2>{editing.id ? "Edit business partner" : "Add business partner"}</h2><p>Record the person, their business context, and the relationship with QuickSort.</p></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Close business partner form"><X size={17}/></button></div>
      <div className="partner-form-grid">
        <label>Full name<input required value={editing.name} onChange={(event) => patch("name", event.target.value)} placeholder="Partner name"/></label>
        <label>Company or organisation<input value={editing.company} onChange={(event) => patch("company", event.target.value)} placeholder="Organisation"/></label>
        <label>Role<input value={editing.role} onChange={(event) => patch("role", event.target.value)} placeholder="Founder, investor, advisor…"/></label>
        <label>Where they come from<input required value={editing.origin} onChange={(event) => patch("origin", event.target.value)} placeholder="Paris, France · Event · Introduction…"/></label>
        <label>LinkedIn<input type="url" value={editing.linkedin} onChange={(event) => patch("linkedin", event.target.value)} placeholder="https://www.linkedin.com/in/…"/></label>
        <label>Email<input type="email" value={editing.email} onChange={(event) => patch("email", event.target.value)} placeholder="name@company.com"/></label>
        <label>Phone<input value={editing.phone} onChange={(event) => patch("phone", event.target.value)} placeholder="+33 …"/></label>
        <label>Relationship<input value={editing.relationship} onChange={(event) => patch("relationship", event.target.value)} placeholder="Referral partner, delivery partner…"/></label>
        <label>QuickSort owner<input value={editing.owner} onChange={(event) => patch("owner", event.target.value)} placeholder="Internal relationship owner"/></label>
        <label className="partner-notes">Notes<textarea value={editing.notes} onChange={(event) => patch("notes", event.target.value)} placeholder="How you met, mutual value, next step, and any useful context."/></label>
      </div>
      <fieldset className="partner-account-mapping">
        <legend>Optional account mapping</legend>
        <p>Choose the accounts this external partner supports. You can then select the people they are contacting or working with.</p>
        <div className="partner-account-options">{accounts.map((account) => {
          const link = editing.accountLinks.find((item) => item.accountId === account.id);
          const contacts = intel[account.id]?.contacts || [];
          return <section className={link ? "selected" : ""} key={account.id}>
            <label><input type="checkbox" checked={Boolean(link)} onChange={() => toggleAccount(account.id)}/><span><strong>{account.name}</strong><small>{account.sector}</small></span></label>
            {link && contacts.length > 0 && <div className="partner-contact-options">{contacts.map((contact) => {
              const key = partnerContactKey(contact);
              return <label key={key}><input type="checkbox" checked={link.contactKeys.includes(key)} onChange={() => toggleContact(account.id, key)}/><span>{contact.name}<small>{contact.role || "Contact"}</small></span></label>;
            })}</div>}
            {link && contacts.length === 0 && <small className="no-account-contacts">No contacts have been added to this account yet.</small>}
          </section>;
        })}</div>
      </fieldset>
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary"><Save size={15}/> Save business partner</button></div>
    </form>}
    {visiblePartners.length ? <div className="partner-list">{visiblePartners.map((partner) => <article className="surface partner-card" key={partner.id}>
      <div className="partner-monogram">{partner.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</div>
      <div className="partner-identity"><h2>{partner.name}</h2><p>{[partner.role, partner.company].filter(Boolean).join(" · ") || "Business partner"}</p><span><ContactRound size={13}/>{partner.origin}</span></div>
      <div className="partner-relationship"><small>Relationship</small><strong>{partner.relationship || "Not set"}</strong><span>Owner · {partner.owner || "Not set"}</span></div>
      <div className="partner-contact">{partner.linkedin && <a href={partner.linkedin} target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={12}/></a>}{partner.email && <a href={`mailto:${partner.email}`}>{partner.email}</a>}{partner.phone && <span>{partner.phone}</span>}</div>
      <button className="secondary small" onClick={() => setEditing(partner)}><Pencil size={13}/> Edit</button>
      {partner.accountLinks.length > 0 && <div className="partner-linked-accounts">{partner.accountLinks.map((link) => {
        const account = accounts.find((item) => item.id === link.accountId);
        if (!account) return null;
        const contacts = (intel[link.accountId]?.contacts || []).filter((contact) => link.contactKeys.includes(partnerContactKey(contact)));
        return <button key={link.accountId} onClick={() => openAccount(link.accountId)}><Building2 size={14}/><span><strong>{account.name}</strong><small>{contacts.length ? contacts.map((contact) => contact.name).join(", ") : "Account relationship"}</small></span><ArrowUpRight size={13}/></button>;
      })}</div>}
      {partner.notes && <p className="partner-card-notes">{partner.notes}</p>}
    </article>)}</div> : <section className="surface empty-workspace partner-empty"><Handshake size={26}/><h2>{partners.length ? "No partners match your search" : "No business partners added"}</h2><p>{partners.length ? "Try another name, company, location, or relationship." : "Add the first partner when you have a real person and relationship to record."}</p>{!partners.length && <button className="primary" onClick={startNew}><Plus size={15}/> Add first business partner</button>}</section>}
  </div>;
}

const caseStudyTypes: { id: BusinessCaseStudyRecord["studyType"]; title: string; description: string; empty: string }[] = [
  { id: "Success story", title: "Success stories", description: "What QuickSort delivered, the result achieved, and the proof behind it.", empty: "Add a completed engagement once its outcome can be documented." },
  { id: "Business case", title: "Business cases", description: "The investment rationale: costs, projected impact, ROI, and decision assumptions.", empty: "Build the first investment case when an opportunity needs commercial justification." },
  { id: "Opportunity assessment", title: "Opportunity assessments", description: "Prospective client research covering pain points, AI opportunities, and possible next steps.", empty: "Add an assessment when account research reveals a credible problem to solve." },
  { id: "Strategic study", title: "Strategic studies", description: "Deeper industry, operating-model, or transformation analysis for long-term decisions.", empty: "Create a strategic study when the question extends beyond a single opportunity." },
];

const emptyBusinessCaseStudy = (studyType: BusinessCaseStudyRecord["studyType"] = "Success story"): BusinessCaseStudyRecord => ({ id: "", title: "", client: "", accountId: "", summary: "", challenge: "", solution: "", outcome: "", evidenceUrl: "", tags: [], studyType, status: "Draft" });

function BusinessCaseStudies({ studies, accounts, onChange, notify }: {
  studies: BusinessCaseStudyRecord[];
  accounts: Account[];
  onChange: (studies: BusinessCaseStudyRecord[]) => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<BusinessCaseStudyRecord | null>(null);
  const startNew = (studyType: BusinessCaseStudyRecord["studyType"] = "Success story") => setEditing(emptyBusinessCaseStudy(studyType));
  const patch = <K extends keyof BusinessCaseStudyRecord>(field: K, value: BusinessCaseStudyRecord[K]) => setEditing((current) => current ? { ...current, [field]: value } : current);
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const account = accounts.find((item) => item.id === editing.accountId);
    const record = { ...editing, id: editing.id || crypto.randomUUID(), client: editing.client || account?.name || "" };
    onChange(editing.id ? studies.map((study) => study.id === editing.id ? record : study) : [record, ...studies]);
    setEditing(null);
    notify(editing.id ? "Case study updated" : "Case study saved");
  };
  return <div className="page business-case-studies-page">
    <PageIntro title="Business case studies" text="Build a living knowledge base for delivery evidence, investment decisions, account opportunities, and strategic research." action={<button className="primary" onClick={() => startNew()}><Plus size={16}/> Add study</button>}/>
    <div className="case-study-type-index">{caseStudyTypes.map((type) => <button key={type.id} onClick={() => startNew(type.id)}><span>{studies.filter((study) => study.studyType === type.id).length}</span><strong>{type.title}</strong><small>{type.description}</small><Plus size={14}/></button>)}</div>
    {editing && <form className="surface case-study-form" onSubmit={save}>
      <div className="section-head"><div><h2>{editing.id ? "Edit study" : `New ${editing.studyType.toLowerCase()}`}</h2><p>Keep the study type and publication status separate so the knowledge base remains clear.</p></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Close case study form"><X size={17}/></button></div>
      <div className="case-study-form-grid">
        <label>Title<input required value={editing.title} onChange={(event) => patch("title", event.target.value)} placeholder="Clear result-led title"/></label>
        <label>Account<select value={editing.accountId} onChange={(event) => patch("accountId", event.target.value)}><option value="">No linked account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Client name<input value={editing.client} onChange={(event) => patch("client", event.target.value)} placeholder="Client or organisation"/></label>
        <label>Study type<select value={editing.studyType} onChange={(event) => patch("studyType", event.target.value as BusinessCaseStudyRecord["studyType"])}>{caseStudyTypes.map((type) => <option key={type.id}>{type.id}</option>)}</select></label>
        <label>Status<select value={editing.status} onChange={(event) => patch("status", event.target.value as BusinessCaseStudyRecord["status"])}><option>Draft</option><option>Validated</option><option>Published</option></select></label>
        <label className="case-study-wide">Summary<textarea required value={editing.summary} onChange={(event) => patch("summary", event.target.value)} placeholder="A concise overview of the work and its value."/></label>
        <label className="case-study-wide">Business challenge<textarea value={editing.challenge} onChange={(event) => patch("challenge", event.target.value)} placeholder="What business problem needed to be solved?"/></label>
        <label className="case-study-wide">What QuickSort delivered<textarea value={editing.solution} onChange={(event) => patch("solution", event.target.value)} placeholder="Describe the solution, delivery, and key decisions."/></label>
        <label className="case-study-wide">Outcome<textarea value={editing.outcome} onChange={(event) => patch("outcome", event.target.value)} placeholder="Add measurable or observable business results."/></label>
        <label>Evidence or attachment link<input type="url" value={editing.evidenceUrl} onChange={(event) => patch("evidenceUrl", event.target.value)} placeholder="https://…"/></label>
        <label>Tags<input value={editing.tags.join(", ")} onChange={(event) => patch("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} placeholder="Voice AI, RAG, AWS"/></label>
      </div>
      <div className="actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary"><Save size={15}/> Save study</button></div>
    </form>}
    <div className="case-study-type-sections">{caseStudyTypes.map((type) => {
      const typeStudies = studies.filter((study) => study.studyType === type.id);
      return <section className="case-study-type-section" key={type.id}>
        <header><div><h2>{type.title}</h2><p>{type.description}</p></div><div><span>{typeStudies.length}</span><button className="secondary small" onClick={() => startNew(type.id)}><Plus size={13}/> Add</button></div></header>
        {typeStudies.length ? <div className="business-case-study-grid">{typeStudies.map((study) => <article className="surface business-case-study-card" key={study.id}>
          <div className="case-study-card-head"><span className={`study-status ${study.status.toLowerCase()}`}>{study.status}</span><button className="secondary small" onClick={() => setEditing(study)}><Pencil size={13}/> Edit</button></div>
          <small>{study.client || accounts.find((account) => account.id === study.accountId)?.name || "Independent study"}</small><h2>{study.title}</h2><p>{study.summary}</p>
          {study.outcome && <div><strong>{study.studyType === "Success story" ? "Outcome" : "Impact"}</strong><p>{study.outcome}</p></div>}
          <footer><div className="fit-tags">{study.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>{study.evidenceUrl && <a href={study.evidenceUrl} target="_blank" rel="noreferrer">Open evidence <ArrowUpRight size={13}/></a>}</footer>
        </article>)}</div> : <div className="case-study-type-empty"><p>{type.empty}</p><button onClick={() => startNew(type.id)}>Add {type.id.toLowerCase()}</button></div>}
      </section>;
    })}</div>
  </div>;
}

function Pipeline({ notify }: { notify: (m: string) => void }) {
  return <div className="page"><PageIntro title="Opportunity pipeline" text="Move from first signal to signed work, with delivery evidence attached." action={<button className="primary" onClick={() => notify("New opportunity ready to configure")}><Plus size={16}/> New opportunity</button>}/>
    <div className="pipeline-summary"><span><strong>0</strong> active opportunities</span><span><strong>0</strong> qualified opportunities</span><span><strong>—</strong> weighted confidence</span></div>
    <section className="surface empty-workspace"><Target size={24}/><h2>No opportunity data added</h2><p>Create an opportunity when you have a real account, value and stage to record.</p><button className="primary" onClick={() => notify("New opportunity ready to configure")}><Plus size={15}/> Add opportunity</button></section>
  </div>;
}

function OpenDoors({ accounts, intel, ownerOptions, actorEmail, onAdd, openAccount, notify }: {
  accounts: Account[];
  intel: Record<string, AccountIntel>;
  ownerOptions: OwnerOption[];
  actorEmail: string;
  onAdd: (input: OpenDoorInput) => void;
  openAccount: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const currentUser = actorEmail && !ownerOptions.some((owner) => owner.email.toLowerCase() === actorEmail.toLowerCase())
    ? [{ id: `current:${actorEmail}`, name: actorEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()), email: actorEmail, headline: "QuickSort team" }]
    : [];
  const connectors = [...currentUser, ...ownerOptions];
  const relationships = accounts.flatMap((account) => (intel[account.id]?.contacts || []).flatMap((contact) => (contact.knownBy || []).map((connection) => ({ account, contact, connection }))));
  const submitRelationship = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const connector = connectors.find((item) => item.id === String(values.get("connector")));
    if (!connector) { notify("Choose the QuickSort teammate who knows this person"); return; }
    onAdd({
      company: String(values.get("company") || "").trim(),
      sector: String(values.get("sector") || "").trim(),
      contactName: String(values.get("contactName") || "").trim(),
      role: String(values.get("role") || "").trim(),
      linkedin: String(values.get("linkedin") || "").trim(),
      connector,
      relationship: String(values.get("relationship") || "").trim(),
      strength: String(values.get("strength") || "Developing"),
      notes: String(values.get("notes") || "").trim(),
    });
    event.currentTarget.reset();
    setAdding(false);
  };
  return <div className="page"><PageIntro title="Open doors" text="Record who at QuickSort knows a person, then connect that relationship to the company account." action={<button className="primary" onClick={() => setAdding(true)}><Plus size={16}/> Add relationship</button>}/>
    {adding && <form className="surface open-door-form" onSubmit={submitRelationship}>
      <div className="section-head"><div><h2>Record a trusted connection</h2><p>The company will be created in Accounts if it does not already exist.</p></div><button type="button" className="icon-button" onClick={() => setAdding(false)} aria-label="Close relationship form"><X size={17}/></button></div>
      <div className="open-door-form-grid">
        <label>QuickSort teammate<select name="connector" required defaultValue=""><option value="" disabled>Choose teammate</option>{connectors.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.headline ? ` · ${owner.headline}` : ""}</option>)}</select></label>
        <label>Company<input name="company" required placeholder="Company name"/></label>
        <label>Sector<input name="sector" placeholder="Industry or sector"/></label>
        <label>Person<input name="contactName" required placeholder="Contact name"/></label>
        <label>Position<input name="role" placeholder="Role or position"/></label>
        <label>LinkedIn<input name="linkedin" type="url" placeholder="https://www.linkedin.com/in/…"/></label>
        <label>How they know this person<input name="relationship" required placeholder="Former colleague, client, friend…"/></label>
        <label>Relationship strength<select name="strength" defaultValue="Developing"><option>Weak</option><option>Developing</option><option>Strong</option><option>Trusted</option></select></label>
        <label className="open-door-notes">Context<textarea name="notes" placeholder="Useful history, introduction route, or next step"/></label>
      </div>
      <div className="actions"><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button><button className="primary"><Save size={15}/> Save relationship</button></div>
    </form>}
    {relationships.length ? <section className="surface door-map"><div className="section-head"><div><h2>Trusted paths</h2><p>Each connection is also visible on the contact card inside its Account.</p></div><span className="case-count">{relationships.length} relationships</span></div><div className="open-door-list">{relationships.map(({ account, contact, connection }) => <article className="open-door-card" key={`${account.id}:${contact.id}:${connection.ownerId || connection.email || connection.name}`}>
      <div className="open-door-connector"><span>{connection.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span><div><small>Known by</small><strong>{connection.name}</strong><em>{connection.email || "QuickSort teammate"}</em></div></div>
      <div className="open-door-path" aria-hidden="true"><i/><ArrowUpRight size={15}/></div>
      <div className="open-door-contact"><small>{connection.relationship}</small><strong>{contact.name}</strong><span>{[contact.role, account.name].filter(Boolean).join(" · ")}</span>{contact.linkedin && <a href={contact.linkedin} target="_blank" rel="noreferrer">LinkedIn <ArrowUpRight size={11}/></a>}</div>
      <div className="open-door-strength"><small>Strength</small><strong>{connection.strength}</strong>{connection.notes && <p>{connection.notes}</p>}</div>
      <button className="secondary small" onClick={() => openAccount(account.id)}>Open account <ArrowUpRight size={12}/></button>
    </article>)}</div></section> : <section className="surface door-map empty-workspace"><ContactRound size={26}/><h2>No relationships added</h2><p>Add the person, their company, and the QuickSort teammate who knows them. The company account and contact mapping are created together.</p><button className="secondary" onClick={() => setAdding(true)}><Plus size={15}/> Add first relationship</button></section>}
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
    { view: "businessPartners", title: "Business partners", purpose: "Maintain a clear directory of the real people behind QuickSort’s commercial partnerships.", when: "Use this when a named partner, introducer, advisor, investor, or delivery contact should be recorded and owned.", steps: [
      { title: "Add the person", detail: "Record the partner’s name, organisation, role, and where the relationship comes from." },
      { title: "Add direct context", detail: "Save LinkedIn, email, phone, and the internal QuickSort relationship owner." },
      { title: "Describe the relationship", detail: "State the partnership type, mutual value, current context, and agreed next step." },
      { title: "Keep it current", detail: "Edit the record after introductions, meetings, or ownership changes." },
    ], result: "A usable partner directory with clear origins, contact routes, and ownership.", icon: Handshake },
    { view: "caseStudies", title: "Business case studies", purpose: "Maintain the commercial knowledge attached to every account, from early research through proven delivery.", when: "Use this whenever the team creates an opportunity assessment, investment case, strategic study, or success story.", steps: [
      { title: "Choose the study type", detail: "Use Success story for delivered results, Business case for ROI and investment logic, Opportunity assessment for prospective account research, or Strategic study for deeper transformation analysis." },
      { title: "Link the account", detail: "Select the company so every related assessment, proposal, study, and outcome appears on its account page." },
      { title: "Capture the reasoning", detail: "Document the challenge, evidence, proposed or delivered approach, costs, impact, and outcome that matter for this study type." },
      { title: "Manage status separately", detail: "Keep work in Draft, move reviewed material to Validated, and use Published only when it is approved for wider reuse." },
    ], result: "A living account-linked knowledge base that supports business development and future website publishing.", icon: FileText },
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
