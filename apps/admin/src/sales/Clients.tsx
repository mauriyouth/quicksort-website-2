import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Empty, Notice } from "@quicksort/hr-ui";
import { db, type Row } from "@quicksort/hr-db";
import { ClientDetail } from "./ClientDetail";
import {
  HEALTH_META,
  STAGES,
  STAGE_COLORS,
  daysSince,
  isOpen,
  useSales,
  type SalesClient,
} from "./data";
import "./sales.css";

/**
 * Clients directory (sales.md §8.3) + Client 360 host (§8.4). The router
 * resolves both "/sales/clients" and "/sales/clients/:id" to this page; the
 * id is read from the URL so deep links stay shareable.
 *
 * Visual source: apps/Pipeline Redesign.html — display title with a
 * right-aligned stat rail, search well + filter chips, underline-free
 * raised table, tinted initial avatars, health dots. Directory only; the
 * Client 360 view keeps its own layout.
 */
const DETAIL_RE = /^\/sales\/clients\/([\w-]+)$/;

const HEALTH_SCORE: Record<string, number> = { good: 100, warning: 55, risk: 15 };
const SORTS = [
  { value: "name", label: "Name A–Z" },
  { value: "pipeline", label: "Pipeline value" },
  { value: "activity", label: "Last activity" },
  { value: "health", label: "Health" },
] as const;

/** Restrained tinted-initial avatars — deterministic per name. */
const AVATAR_TINTS: Array<[string, string]> = [
  ["#a78bfa", "rgba(167,139,250,0.20)"],
  ["#5eb1f0", "rgba(94,177,240,0.20)"],
  ["#4ade80", "rgba(74,222,128,0.18)"],
  ["#fbbf24", "rgba(251,191,36,0.18)"],
  ["#f472b6", "rgba(244,114,182,0.18)"],
  ["#2dd4bf", "rgba(45,212,191,0.18)"],
  ["#818cf8", "rgba(129,140,248,0.20)"],
  ["#a3e635", "rgba(163,230,53,0.18)"],
];

const moneyCompact = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);

function tintFor(name: string): [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
}

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const [fg, bg] = tintFor(name || "?");
  return (
    <span
      className="clients-avatar"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name || "?") || "?"}
    </span>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  if (!names.length) return <span className="muted">—</span>;
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;
  return (
    <span className="clients-stack">
      {shown.map((n) => (
        <Avatar key={n} name={n} size={24} />
      ))}
      {extra > 0 && <span className="clients-stack-more">+{extra}</span>}
    </span>
  );
}

function ownerName(email: string) {
  const local = (email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!local) return "—";
  return local.replace(/\b\w/g, (m) => m.toUpperCase());
}

function domainOf(website: string) {
  return (website || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

type View = "list" | "grid";

export function Clients({ actorEmail }: { actorEmail: string }) {
  const sales = useSales(actorEmail);
  const { data, loading, busy, error, message, action } = sales;
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [sort, setSort] = useState<string>("name");
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<SalesClient | null | undefined>(undefined);

  const detailId = () => {
    const match = window.location.pathname.match(DETAIL_RE);
    return match ? match[1] : "";
  };
  const [selectedId, setSelectedId] = useState(detailId);

  // Keep the detail view in sync with browser back/forward navigation.
  useEffect(() => {
    const sync = () => setSelectedId(detailId());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    document.title = "Clients · Quicksort Admin";
  }, []);

  const openClient = useCallback((id: string) => {
    window.history.pushState(null, "", `/sales/clients/${id}`);
    setSelectedId(id);
    setEditing(undefined);
    window.scrollTo(0, 0);
  }, []);

  const closeClient = useCallback(() => {
    window.history.pushState(null, "", "/sales/clients");
    setSelectedId("");
  }, []);

  const client = data.clients.find((c) => c.id === selectedId);
  if (selectedId) {
    return (
      <>
        <Notice error={!!sales.error}>{sales.error}</Notice>
        <Notice>{sales.message}</Notice>
        {client ? (
          <ClientDetail
            key={client.id}
            client={client}
            sales={sales}
            actorEmail={actorEmail}
            onBack={closeClient}
          />
        ) : (
          !loading && (
            <Empty title="Client not found" action={<button className="btn" onClick={closeClient}>Back to clients</button>}>
              This client may have been removed. Return to the directory.
            </Empty>
          )
        )}
      </>
    );
  }

  const industries = [...new Set(data.clients.map((c) => c.industry).filter(Boolean))].sort();
  const sizes = [...new Set(data.clients.map((c) => c.size).filter(Boolean))].sort();
  const term = search.toLowerCase();

  const rows = data.clients
    .filter((c) => {
      if (health && c.health !== health) return false;
      if (industry && c.industry !== industry) return false;
      if (size && c.size !== size) return false;
      const open = data.opportunities.some((o) => o.client_id === c.id && isOpen(o));
      if (openOnly && !open) return false;
      if (
        term &&
        ![c.name, c.industry, c.location, c.notes, ...(c.tags || [])]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
        return false;
      return true;
    })
    .map((c) => {
      const openOpps = data.opportunities.filter((o) => o.client_id === c.id && isOpen(o));
      const people = data.people.filter((p) => p.client_id === c.id);
      const best = openOpps.reduce<string | null>((acc, o) => {
        if (acc === null) return o.stage;
        const rank = (s: string) => STAGES.findIndex((x) => x.key === s);
        return rank(o.stage) > rank(acc) ? o.stage : acc;
      }, null);
      return {
        client: c,
        openPipeline: openOpps.reduce((t, o) => t + Number(o.amount), 0),
        openDeals: openOpps.length,
        people,
        bestStage: best,
        idle: daysSince(c.last_activity_at),
      };
    })
    .sort((a, b) => {
      if (sort === "pipeline") return b.openPipeline - a.openPipeline;
      if (sort === "activity")
        return String(b.client.last_activity_at || "").localeCompare(
          String(a.client.last_activity_at || ""),
        );
      if (sort === "health")
        return (HEALTH_SCORE[a.client.health] ?? 0) - (HEALTH_SCORE[b.client.health] ?? 0);
      return a.client.name.localeCompare(b.client.name);
    });

  const openDealCount = data.opportunities.filter(isOpen).length;
  const combinedPipeline = data.opportunities
    .filter(isOpen)
    .reduce((t, o) => t + Number(o.amount), 0);
  const avgHealth = data.clients.length
    ? Math.round(
        data.clients.reduce((t, c) => t + (HEALTH_SCORE[c.health] ?? 0), 0) / data.clients.length,
      )
    : 0;
  const avgHealthColor =
    avgHealth >= 70 ? HEALTH_META.good.color : avgHealth >= 40 ? HEALTH_META.warning.color : HEALTH_META.risk.color;

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = {
      name: String(f.get("name")).trim(),
      industry: String(f.get("industry")).trim(),
      size: String(f.get("size")).trim(),
      website: String(f.get("website")).trim(),
      location: String(f.get("location")).trim(),
      revenue: String(f.get("revenue")).trim(),
      tags: String(f.get("tags"))
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      health: String(f.get("health")),
      owner_email: String(f.get("owner_email")).trim(),
      notes: String(f.get("notes")).trim(),
      updated_at: new Date().toISOString(),
    };
    void action(async () => {
      const result = editing
        ? await db().from("sales_clients").update(values).eq("id", editing.id).select("id").single()
        : await db().from("sales_clients").insert(values).select("id").single();
      if (result.error) throw result.error;
      if (!editing && result.data) openClient((result.data as Row<"sales_clients">).id);
      setEditing(undefined);
    }, editing ? "Client updated." : "Client created.");
  }

  const openRow = (id: string) => () => openClient(id);
  const rowKeys = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter") openClient(id);
  };

  return (
    <>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      <div className="pipeline-head">
        <div className="clients-head-actions">
          <button className="btn" onClick={() => setEditing(null)}>
            <Plus size={16} />
            New client
          </button>
          <div className="pipeline-stats">
            <div className="pipeline-stat">
              <span>Total clients</span>
              <strong>{data.clients.length}</strong>
            </div>
            <div className="pipeline-stat">
              <span>Active deals</span>
              <strong>{openDealCount}</strong>
            </div>
            <div className="pipeline-stat">
              <span>Combined pipeline</span>
              <strong>{moneyCompact(combinedPipeline)}</strong>
            </div>
            <div className="pipeline-stat">
              <span>Avg. health</span>
              <strong className="clients-stat-health">
                <span className="clients-health-dot" style={{ background: avgHealthColor }} />
                {data.clients.length ? `${avgHealth}%` : "—"}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {editing !== undefined && (
        <section className="panel">
          <h2>{editing ? `Edit ${editing.name}` : "Create a client"}</h2>
          <form className="form" key={editing?.id || "new"} onSubmit={save}>
            <div className="form-columns">
              <label>
                Company name
                <input name="name" defaultValue={editing?.name} required maxLength={200} />
              </label>
              <label>
                Industry
                <input name="industry" defaultValue={editing?.industry} maxLength={200} placeholder="e.g. Banking" />
              </label>
              <label>
                Size
                <select name="size" defaultValue={editing?.size}>
                  <option value="">Unknown</option>
                  {["1-50", "51-200", "201-1000", "1000+"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <input name="location" defaultValue={editing?.location} maxLength={200} />
              </label>
              <label>
                Website
                <input name="website" type="url" defaultValue={editing?.website} maxLength={300} placeholder="https://…" />
              </label>
              <label>
                Revenue
                <input name="revenue" defaultValue={editing?.revenue} maxLength={100} placeholder="e.g. €50M" />
              </label>
              <label>
                Health
                <select name="health" defaultValue={editing?.health || "good"}>
                  <option value="good">Good</option>
                  <option value="warning">Warning</option>
                  <option value="risk">At risk</option>
                </select>
              </label>
              <label>
                Owner
                <input name="owner_email" type="email" defaultValue={editing?.owner_email || actorEmail} maxLength={200} />
              </label>
            </div>
            <label>
              Tags (comma-separated)
              <input name="tags" defaultValue={(editing?.tags || []).join(", ")} maxLength={300} placeholder="strategic, framework agreement…" />
            </label>
            <label>
              Notes
              <textarea name="notes" defaultValue={editing?.notes} rows={3} maxLength={5000} />
            </label>
            <div className="actions">
              <button className="btn" disabled={busy}>
                Save client
              </button>
              <button type="button" className="btn secondary" onClick={() => setEditing(undefined)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="panel">
        <div className="pipeline-toolbar">
          <label className="pipeline-search">
            <Search size={14} />
            <input
              aria-label="Search clients"
              placeholder="Search clients by name, industry, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="pipeline-filter">
            Industry
            <select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
              <option value="">All</option>
              {industries.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="pipeline-filter">
            Size
            <select aria-label="Size" value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="">Any</option>
              {sizes.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <label className="pipeline-filter">
            Health
            <select aria-label="Health" value={health} onChange={(e) => setHealth(e.target.value)}>
              <option value="">Any</option>
              <option value="good">Good</option>
              <option value="warning">Warning</option>
              <option value="risk">At risk</option>
            </select>
            <ChevronDown size={13} />
          </label>
          <button
            type="button"
            className={`pipeline-filter${openOnly ? " on" : ""}`}
            aria-pressed={openOnly}
            onClick={() => setOpenOnly((v) => !v)}
          >
            Has open deals
          </button>
          <div className="view-switch" role="group" aria-label="Directory view">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              aria-pressed={view === "list"}
              aria-label="List view"
              onClick={() => setView("list")}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              className={view === "grid" ? "active" : ""}
              aria-pressed={view === "grid"}
              aria-label="Grid view"
              onClick={() => setView("grid")}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          <label className="pipeline-filter">
            <ArrowUpDown size={13} />
            <select aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
          <button className="btn secondary small" disabled={loading} onClick={() => void sales.load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <p className="clients-count">
          {rows.length} of {data.clients.length} clients
        </p>

        {!data.clients.length && !loading && (
          <Empty title="No clients yet">
            Create the first client to start mapping relationships.
          </Empty>
        )}
        {!!data.clients.length && !rows.length && (
          <Empty title="No clients match">
            Try a different search or clear the filters.
          </Empty>
        )}

        {!!rows.length && view === "list" && (
          <div className="pipeline-table-wrap">
            <table className="pipeline-table clients-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Industry</th>
                  <th>Contacts</th>
                  <th>Open deals</th>
                  <th>Pipeline value</th>
                  <th>Health</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ client: c, openPipeline, openDeals, people, bestStage, idle }) => (
                  <tr
                    key={c.id}
                    className="clients-row"
                    tabIndex={0}
                    onClick={openRow(c.id)}
                    onKeyDown={rowKeys(c.id)}
                  >
                    <td>
                      <div className="clients-client">
                        <Avatar name={c.name} size={34} />
                        <div>
                          <div className="cell-main">{c.name}</div>
                          <div className="cell-sub">{domainOf(c.website) || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {c.industry ? <span className="clients-tag">{c.industry}</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      <AvatarStack names={people.map((p) => p.name)} />
                    </td>
                    <td>
                      <span className="clients-deals">
                        <strong>{openDeals}</strong>
                        {bestStage && (
                          <span
                            className="clients-deal-dot"
                            style={{ background: STAGE_COLORS[bestStage] }}
                            title={`Most advanced open deal: ${bestStage}`}
                          />
                        )}
                      </span>
                    </td>
                    <td className="cell-main">{moneyCompact(openPipeline)}</td>
                    <td>
                      <span className="clients-health">
                        <span
                          className="clients-health-dot"
                          style={{ background: HEALTH_META[c.health]?.color }}
                        />
                        {idle === null ? "No activity yet" : `Active ${idle}d ago`}
                      </span>
                    </td>
                    <td>
                      <span className="clients-owner">
                        <Avatar name={ownerName(c.owner_email)} size={22} />
                        {ownerName(c.owner_email)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!!rows.length && view === "grid" && (
          <div className="clients-grid">
            {rows.map(({ client: c, openPipeline, openDeals, people, idle }) => (
              <article
                key={c.id}
                className="client-card"
                role="link"
                tabIndex={0}
                onClick={openRow(c.id)}
                onKeyDown={rowKeys(c.id)}
              >
                <div className="client-card-top">
                  <Avatar name={c.name} size={40} />
                  <div className="client-card-title">
                    <div className="cell-main">{c.name}</div>
                    <div className="cell-sub">{domainOf(c.website) || c.industry || "—"}</div>
                  </div>
                  <span
                    className="clients-health-dot"
                    style={{ background: HEALTH_META[c.health]?.color }}
                    title={HEALTH_META[c.health]?.label || c.health}
                  />
                </div>
                <div className="client-card-tags">
                  {c.industry && <span className="clients-tag">{c.industry}</span>}
                  {c.size && <span className="clients-tag">{c.size} employees</span>}
                  {!c.industry && !c.size && <span className="muted small-text">—</span>}
                </div>
                <div className="client-card-metrics">
                  <div>
                    <strong>{moneyCompact(openPipeline)}</strong>
                    <small>pipeline</small>
                  </div>
                  <div>
                    <strong>{openDeals}</strong>
                    <small>open {openDeals === 1 ? "deal" : "deals"}</small>
                  </div>
                  <div>
                    <strong>{people.length}</strong>
                    <small>{people.length === 1 ? "person" : "people"}</small>
                  </div>
                </div>
                <div className="client-card-foot">
                  <AvatarStack names={people.map((p) => p.name)} />
                  <span className="cell-sub">
                    {idle === null ? "No activity yet" : `Active ${idle}d ago`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
