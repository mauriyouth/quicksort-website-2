import { useMemo, useState } from "react";
import { ArrowUpRight, BellRing, Bookmark, CalendarClock, Check, FileSearch, Landmark, MapPin, Search, SlidersHorizontal } from "lucide-react";

type OpportunityTrack = "All" | "AI strategy" | "AI software" | "Responsible AI" | "Health AI" | "Computer vision" | "AI skills";
type Opportunity = {
  id: string;
  title: string;
  buyer: string;
  region: string;
  procedure: string;
  contract: "Services" | "Supplies";
  published: string;
  deadline: string;
  deadlineLabel: string;
  track: Exclude<OpportunityTrack, "All">;
  fit: "Strong" | "Review" | "Watch";
  lots: string;
  dossierCount: number;
  cpv: string;
};

const sourceUrl = "https://marches-publics.com/theme/intelligence-artificielle";
const tracks: OpportunityTrack[] = ["All", "AI strategy", "AI software", "Responsible AI", "Health AI", "Computer vision", "AI skills"];

const opportunities: Opportunity[] = [
  { id: "social-ministries-ai", title: "Digital and artificial intelligence advisory support", buyer: "French social ministries", region: "Île-de-France", procedure: "Open tender", contract: "Services", published: "9 Oct 2026", deadline: "2026-11-10", deadlineLabel: "10 Nov 2026", track: "AI strategy", fit: "Strong", lots: "Single contract", dossierCount: 8, cpv: "79414000" },
  { id: "emfor-ai-integration", title: "Strategic and operational support for AI integration", buyer: "EMFOR Bourgogne-Franche-Comté", region: "Bourgogne-Franche-Comté", procedure: "Formal procedure", contract: "Services", published: "25 Sep 2026", deadline: "2026-10-21", deadlineLabel: "21 Oct 2026", track: "AI strategy", fit: "Strong", lots: "Single contract", dossierCount: 4, cpv: "Not listed" },
  { id: "suresnes-legal-ai", title: "Legal document and specialist AI software platform", buyer: "City of Suresnes", region: "Île-de-France", procedure: "Public procurement", contract: "Supplies", published: "18 Sep 2026", deadline: "2026-10-15", deadlineLabel: "15 Oct 2026", track: "AI software", fit: "Review", lots: "Single contract", dossierCount: 5, cpv: "48611000" },
  { id: "sictiam-dynamic-ai", title: "Dynamic purchasing system for AI solutions and advisory services", buyer: "SICTIAM", region: "Provence-Alpes-Côte d’Azur", procedure: "Dynamic purchasing system", contract: "Supplies", published: "1 Sep 2025", deadline: "2035-10-08", deadlineLabel: "8 Oct 2035", track: "AI software", fit: "Strong", lots: "Ongoing admissions", dossierCount: 45, cpv: "45223220" },
  { id: "resah-health-ai", title: "AI software solutions for healthcare organisations", buyer: "RESAH", region: "Île-de-France", procedure: "Other procedure", contract: "Supplies", published: "7 Jun 2024", deadline: "2028-06-30", deadlineLabel: "30 Jun 2028", track: "Health AI", fit: "Strong", lots: "Single contract", dossierCount: 6, cpv: "48000000" },
  { id: "lyon-ai-act", title: "GDPR and AI Act compliance assessment", buyer: "City of Lyon and CCAS", region: "Auvergne-Rhône-Alpes", procedure: "Formal procedure", contract: "Services", published: "15 Sep 2026", deadline: "2026-10-21", deadlineLabel: "21 Oct 2026", track: "Responsible AI", fit: "Strong", lots: "2 lots", dossierCount: 20, cpv: "71621000" },
  { id: "emfor-skills-2027", title: "Regional training and professionalisation programme for 2027", buyer: "EMFOR Bourgogne-Franche-Comté", region: "Bourgogne-Franche-Comté", procedure: "Formal procedure", contract: "Services", published: "11 Sep 2026", deadline: "2026-10-14", deadlineLabel: "14 Oct 2026", track: "AI skills", fit: "Watch", lots: "Single contract", dossierCount: 17, cpv: "Not listed" },
  { id: "interior-video-rfi", title: "RFI for video protection and airborne camera systems", buyer: "French Ministry of the Interior", region: "National", procedure: "Request for information", contract: "Supplies", published: "8 Oct 2026", deadline: "2026-11-09", deadlineLabel: "9 Nov 2026", track: "Computer vision", fit: "Review", lots: "Single contract", dossierCount: 2, cpv: "Not listed" },
];

const daysUntil = (deadline: string) => Math.ceil((new Date(`${deadline}T23:59:59`).getTime() - Date.now()) / 86_400_000);

export default function PublicOpportunities({ notify }: { notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState<OpportunityTrack>("All");
  const [region, setRegion] = useState("All regions");
  const [procedure, setProcedure] = useState("All procedures");
  const [shortlist, setShortlist] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("quicksort-public-opportunity-shortlist-v1") || "[]");
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
    }
    catch { return []; }
  });

  const regions = ["All regions", ...new Set(opportunities.map((item) => item.region))];
  const procedures = ["All procedures", ...new Set(opportunities.map((item) => item.procedure))];
  const visible = useMemo(() => opportunities.filter((item) => {
    const text = `${item.title} ${item.buyer} ${item.region} ${item.track} ${item.cpv}`.toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase()))
      && (track === "All" || item.track === track)
      && (region === "All regions" || item.region === region)
      && (procedure === "All procedures" || item.procedure === procedure);
  }), [procedure, query, region, track]);

  const toggleShortlist = (id: string) => {
    const next = shortlist.includes(id) ? shortlist.filter((item) => item !== id) : [...shortlist, id];
    setShortlist(next);
    window.localStorage.setItem("quicksort-public-opportunity-shortlist-v1", JSON.stringify(next));
    notify(next.includes(id) ? "Opportunity added to shortlist" : "Opportunity removed from shortlist");
  };
  const closingSoon = opportunities.filter((item) => daysUntil(item.deadline) >= 0 && daysUntil(item.deadline) <= 14).length;
  const strongFits = opportunities.filter((item) => item.fit === "Strong").length;

  return <div className="page public-opportunities-page">
    <header className="opportunity-heading">
      <div><span><Landmark size={18}/> Public opportunities</span><h1>AI tenders and RFPs</h1><p>Find public-sector demand early, qualify the right projects, and keep deadlines visible.</p></div>
      <a href={sourceUrl} target="_blank" rel="noreferrer">Open source feed <ArrowUpRight size={14}/></a>
    </header>

    <section className="opportunity-pulse" aria-label="Opportunity summary">
      <div><strong>{opportunities.length}</strong><span>open opportunities</span></div>
      <div><strong>{closingSoon}</strong><span>closing in 14 days</span></div>
      <div><strong>{strongFits}</strong><span>strong QuickSort fits</span></div>
      <div><strong>{shortlist.length}</strong><span>on your shortlist</span></div>
      <small>Source reviewed 9 October 2026</small>
    </section>

    <nav className="opportunity-tracks" aria-label="AI opportunity tracks">
      {tracks.map((item) => <button key={item} className={track === item ? "active" : ""} onClick={() => setTrack(item)}><span>{item}</span><small>{item === "All" ? opportunities.length : opportunities.filter((opportunity) => opportunity.track === item).length}</small></button>)}
    </nav>

    <section className="opportunity-filters" aria-label="Filter opportunities">
      <label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search buyer, scope, region or CPV"/></label>
      <label><MapPin size={15}/><select value={region} onChange={(event) => setRegion(event.target.value)}>{regions.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><SlidersHorizontal size={15}/><select value={procedure} onChange={(event) => setProcedure(event.target.value)}>{procedures.map((item) => <option key={item}>{item}</option>)}</select></label>
      <span>{visible.length} shown</span>
    </section>

    <div className="opportunity-layout">
      <section className="opportunity-ledger" aria-label="Tender and RFP opportunities">
        {visible.map((item) => {
          const remaining = daysUntil(item.deadline);
          const urgency = remaining < 0 ? "closed" : remaining <= 7 ? "urgent" : remaining <= 30 ? "soon" : "open";
          const saved = shortlist.includes(item.id);
          return <article className={`opportunity-row ${urgency}`} key={item.id}>
            <div className="opportunity-deadline"><CalendarClock size={16}/><strong>{item.deadlineLabel}</strong><span>{remaining < 0 ? "Closed" : remaining === 0 ? "Closes today" : `${remaining} days left`}</span></div>
            <div className="opportunity-copy"><div><span>{item.track}</span><em className={item.fit.toLowerCase()}>{item.fit} fit</em></div><h2>{item.title}</h2><p>{item.buyer}</p><dl><div><dt>Region</dt><dd>{item.region}</dd></div><div><dt>Procedure</dt><dd>{item.procedure}</dd></div><div><dt>Contract</dt><dd>{item.contract}</dd></div><div><dt>Published</dt><dd>{item.published}</dd></div></dl><footer><span>{item.lots}</span><span>CPV {item.cpv}</span><span>{item.dossierCount} dossier files</span></footer></div>
            <div className="opportunity-actions"><button aria-pressed={saved} onClick={() => toggleShortlist(item.id)}>{saved ? <Check size={15}/> : <Bookmark size={15}/>} {saved ? "Shortlisted" : "Shortlist"}</button><a href={sourceUrl} target="_blank" rel="noreferrer">Review notice <ArrowUpRight size={13}/></a></div>
          </article>;
        })}
        {!visible.length && <div className="opportunity-empty"><FileSearch size={24}/><strong>No opportunities match</strong><span>Clear a filter or try a broader search term.</span></div>}
      </section>

      <aside className="opportunity-side">
        <section><div><BellRing size={17}/><h2>Watch brief</h2></div><p>Monitor French public procurement for AI strategy, software, data, infrastructure, compliance, health, and computer vision work.</p><button onClick={() => notify("Tender watch brief saved")}>Save watch brief</button></section>
        <section><h2>Shortlist</h2>{shortlist.length ? shortlist.map((id) => { const item = opportunities.find((opportunity) => opportunity.id === id); return item ? <button key={id} onClick={() => { setQuery(item.buyer); setTrack("All"); setRegion("All regions"); setProcedure("All procedures"); }}><strong>{item.buyer}</strong><span>{item.deadlineLabel}</span></button> : null; }) : <p>No saved opportunities yet. Shortlist the tenders worth qualifying.</p>}</section>
        <small>Opportunity metadata is an initial workspace feed from Marchés-Publics.com. Confirm the official notice and dossier before deciding to bid.</small>
      </aside>
    </div>
  </div>;
}
