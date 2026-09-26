import { useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Search, Star, X } from "lucide-react";
import { db } from "@quicksort/hr-db";
import { Empty, Notice } from "@quicksort/hr-ui";
import {
  ACTIVITY_TYPES,
  INFLUENCE_META,
  amountDetail,
  daysSince,
  isOpen,
  isStaleContact,
  money,
  stageLabel,
  useSales,
  type SalesPerson,
} from "./data";
import "./sales.css";

/**
 * People directory (sales.md §8.5): every contact across all clients,
 * searchable by name, role, client, email and notes. Champions and sponsors
 * are highlighted. The person drawer opens at /sales/people?focus=<personId>
 * with contact details, sponsor relationships (influence + primary champion)
 * and an activity composer that stamps last-contact.
 */
export function People({ actorEmail }: { actorEmail: string }) {
  const sales = useSales(actorEmail);
  const { data, loading, busy, error, message } = sales;
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [onlyDecisionMakers, setOnlyDecisionMakers] = useState(false);
  const [onlySponsors, setOnlySponsors] = useState(false);
  const [onlyStale, setOnlyStale] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [focusId, setFocusId] = useState("");

  const readFocus = () =>
    new URLSearchParams(window.location.search).get("focus") || "";
  useEffect(() => {
    setFocusId(readFocus());
    const sync = () => setFocusId(readFocus());
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const openPerson = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("focus", id);
    window.history.pushState(null, "", url.pathname + url.search);
    setFocusId(id);
  };
  const closePerson = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("focus");
    window.history.pushState(null, "", url.pathname + url.search);
    setFocusId("");
  };

  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name || "";
  const sponsorPersonIds = new Set(data.sponsors.map((s) => s.person_id));

  const term = search.toLowerCase();
  const visible = data.people.filter((p) => {
    if (clientFilter && p.client_id !== clientFilter) return false;
    if (onlyDecisionMakers && !p.is_decision_maker) return false;
    if (onlySponsors && !sponsorPersonIds.has(p.id)) return false;
    if (onlyStale && !isStaleContact(p)) return false;
    if (
      term &&
      ![p.name, p.role, p.email, p.notes, clientName(p.client_id)]
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
      return false;
    return true;
  });

  function addPerson(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    const clientId = String(f.get("client_id"));
    if (!name || !clientId) return;
    void sales.action(async () => {
      const result = await db()
        .from("sales_people")
        .insert({
          name,
          role: String(f.get("role")).trim(),
          client_id: clientId,
          email: String(f.get("email")).trim(),
          phone: String(f.get("phone")).trim(),
          linkedin: String(f.get("linkedin")).trim(),
          is_decision_maker: f.get("is_decision_maker") === "on",
          notes: String(f.get("notes")).trim(),
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      setShowNew(false);
    }, `${name} added.`);
  }

  const focused = data.people.find((p) => p.id === focusId);

  return (
    <>
      <div className="sales-actions">
        <button className="btn" onClick={() => setShowNew((v) => !v)}>
          <Plus size={16} />
          New person
        </button>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>

      {showNew && (
        <section className="panel">
          <h2>Create a person</h2>
          <form className="form" onSubmit={addPerson}>
            <div className="form-columns">
              <label>
                Name
                <input name="name" required maxLength={200} />
              </label>
              <label>
                Client
                <select name="client_id" required defaultValue="">
                  <option value="" disabled>
                    Select a client…
                  </option>
                  {data.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Role
                <input name="role" maxLength={200} placeholder="e.g. Head of Data" />
              </label>
              <label>
                Email
                <input name="email" type="email" maxLength={200} />
              </label>
              <label>
                Phone
                <input name="phone" maxLength={40} />
              </label>
              <label>
                LinkedIn
                <input name="linkedin" type="url" maxLength={300} placeholder="https://linkedin.com/in/…" />
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" rows={3} maxLength={5000} />
            </label>
            <label className="check">
              <input type="checkbox" name="is_decision_maker" />
              Decision-maker
            </label>
            <div className="actions">
              <button className="btn" disabled={busy}>
                Save person
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowNew(false)}>
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
            aria-label="Search people"
            placeholder="Search people, roles, clients, emails…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Client"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
          >
            <option value="">All clients</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn secondary small" disabled={loading} onClick={() => void sales.load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        <div className="filter-chips">
          <label className="check">
            <input
              type="checkbox"
              checked={onlyDecisionMakers}
              onChange={(e) => setOnlyDecisionMakers(e.target.checked)}
            />
            Decision-makers
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={onlySponsors}
              onChange={(e) => setOnlySponsors(e.target.checked)}
            />
            Sponsors / champions
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={onlyStale}
              onChange={(e) => setOnlyStale(e.target.checked)}
            />
            Stale (90d+ no contact)
          </label>
        </div>
        {!data.people.length && !loading && (
          <Empty title="No people yet">
            Add contacts from a client page or with “New person” above.
          </Empty>
        )}
        {data.people.length > 0 && !visible.length && (
          <Empty title="No people match">Try a different search or clear the filters.</Empty>
        )}
        {visible.map((p) => {
          const links = data.sponsors.filter((s) => s.person_id === p.id);
          const stale = isStaleContact(p);
          return (
            <div
              className="list-row client-row"
              key={p.id}
              role="link"
              tabIndex={0}
              onClick={() => openPerson(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openPerson(p.id);
              }}
            >
              <div>
                <h3>
                  {p.name}
                  {links.some((s) => s.is_primary) && (
                    <span className="pill" style={{ background: "#16a34a", marginLeft: 8 }}>
                      <Star size={10} /> Primary champion
                    </span>
                  )}
                  {!!links.length && !links.some((s) => s.is_primary) && (
                    <span className="pill" style={{ background: "#65a30d", marginLeft: 8 }}>
                      Sponsor
                    </span>
                  )}
                  {p.is_decision_maker && (
                    <span className="pill" style={{ background: "#7c3aed", marginLeft: 4 }}>
                      Decision-maker
                    </span>
                  )}
                </h3>
                <p className="muted small-text">
                  {[p.role, clientName(p.client_id)].filter(Boolean).join(" · ") || "—"}
                  {p.email ? ` · ${p.email}` : ""}
                </p>
              </div>
              <span className={`small-text ${stale ? "stale-flag" : "muted"}`}>
                {daysSince(p.last_contact_at) === null
                  ? "Never contacted"
                  : `${daysSince(p.last_contact_at)}d since contact`}
              </span>
            </div>
          );
        })}
      </section>

      {focused && (
        <PersonDrawer
          key={focused.id}
          person={focused}
          sales={sales}
          actorEmail={actorEmail}
          clientName={clientName(focused.client_id)}
          onClose={closePerson}
        />
      )}
    </>
  );
}

function PersonDrawer({
  person,
  sales,
  actorEmail,
  clientName,
  onClose,
}: {
  person: SalesPerson;
  sales: ReturnType<typeof useSales>;
  actorEmail: string;
  clientName: string;
  onClose: () => void;
}) {
  const { data, busy, action, logActivity } = sales;
  const clientOpportunities = data.opportunities.filter(
    (o) => o.client_id === person.client_id,
  );
  const links = data.sponsors.filter((s) => s.person_id === person.id);

  function setSponsor(opportunityId: string, influence: string) {
    void action(async () => {
      const result = await db()
        .from("sales_sponsors")
        .upsert({ opportunity_id: opportunityId, person_id: person.id, influence })
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: person.client_id,
          opportunity_id: opportunityId,
          person_id: person.id,
          type: "note",
          text: `${person.name} marked as ${INFLUENCE_META[influence]?.label || influence} on “${
            data.opportunities.find((o) => o.id === opportunityId)?.title || "opportunity"
          }”.`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
    }, "Sponsor updated.");
  }

  function setPrimary(opportunityId: string, primary: boolean) {
    void action(async () => {
      // Only one primary champion per opportunity.
      await db()
        .from("sales_sponsors")
        .update({ is_primary: false })
        .eq("opportunity_id", opportunityId);
      const result = await db()
        .from("sales_sponsors")
        .update({ is_primary: primary })
        .eq("opportunity_id", opportunityId)
        .eq("person_id", person.id)
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
    }, primary ? "Marked as primary champion." : "Primary champion removed.");
  }

  function removeSponsor(opportunityId: string) {
    void action(async () => {
      const result = await db()
        .from("sales_sponsors")
        .delete()
        .eq("opportunity_id", opportunityId)
        .eq("person_id", person.id)
        .select("opportunity_id")
        .single();
      if (result.error) throw result.error;
    }, "Removed from the opportunity.");
  }

  function log(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = String(f.get("text")).trim();
    if (!text) return;
    void logActivity(
      {
        client_id: person.client_id,
        opportunity_id: String(f.get("opportunity_id") || "") || null,
        person_id: person.id,
        type: String(f.get("type")),
        text,
      },
      "Activity logged.",
    ).then(() => e.currentTarget.reset());
  }

  const history = data.activities.filter((a) => a.person_id === person.id);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`${person.name} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{clientName}</div>
            <h2>{person.name}</h2>
            <p className="muted small-text">
              {[person.role, person.email, person.phone].filter(Boolean).join(" · ") || "—"}
            </p>
            <p className="small-text">
              {person.is_decision_maker && (
                <span className="pill" style={{ background: "#7c3aed" }}>
                  Decision-maker
                </span>
              )}{" "}
              {daysSince(person.last_contact_at) === null
                ? "Never contacted"
                : `Last contact ${daysSince(person.last_contact_at)}d ago`}
            </p>
          </div>
          <button className="btn secondary small" onClick={onClose} aria-label="Close drawer">
            <X size={14} />
          </button>
        </div>
        {person.linkedin && (
          <p className="small-text">
            <a href={person.linkedin} target="_blank" rel="noopener noreferrer">
              LinkedIn profile
            </a>
          </p>
        )}
        {person.notes && <p className="wrap small-text">{person.notes}</p>}

        <h3 className="drawer-section">Sponsor relationships</h3>
        {links.length ? (
          links.map((s) => {
            const opp = data.opportunities.find((o) => o.id === s.opportunity_id);
            return (
              <div className="list-row" key={s.opportunity_id}>
                <div>
                  <h3>
                    {opp?.title || "Opportunity"}
                    {s.is_primary && (
                      <span className="pill" style={{ background: "#16a34a", marginLeft: 8 }}>
                        <Star size={10} /> Primary
                      </span>
                    )}
                  </h3>
                  <p className="muted small-text">
                    {opp ? `${money(Number(opp.amount), opp.currency)} · ${amountDetail(opp)} · ${stageLabel(opp.stage)}${isOpen(opp) ? "" : " (closed)"}` : ""}
                  </p>
                </div>
                <div className="actions">
                  <select
                    aria-label="Influence"
                    value={s.influence}
                    disabled={busy}
                    onChange={(e) => setSponsor(s.opportunity_id, e.target.value)}
                  >
                    {Object.entries(INFLUENCE_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn secondary small"
                    disabled={busy}
                    title={s.is_primary ? "Unmark primary champion" : "Mark as primary champion"}
                    onClick={() => setPrimary(s.opportunity_id, !s.is_primary)}
                  >
                    <Star size={14} />
                  </button>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    title="Remove from opportunity"
                    onClick={() => removeSponsor(s.opportunity_id)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <p className="muted small-text">
            Not sponsoring any opportunity yet — mark an influence below.
          </p>
        )}
        {!!clientOpportunities.length && (
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const id = String(f.get("opportunity_id"));
              if (id) setSponsor(id, "neutral");
            }}
          >
            <label style={{ flex: 1 }}>
              <span className="muted small-text">Add as sponsor on…</span>
              <select name="opportunity_id" defaultValue="" required>
                <option value="" disabled>
                  Select an opportunity…
                </option>
                {clientOpportunities
                  .filter((o) => !links.some((s) => s.opportunity_id === o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title} ({o.pricing_model === "regie" ? "Régie" : "Forfait"})
                    </option>
                  ))}
              </select>
            </label>
            <button className="btn secondary small" disabled={busy}>
              <Plus size={14} />
              Sponsor
            </button>
          </form>
        )}

        <h3 className="drawer-section">Log activity</h3>
        <form className="form" onSubmit={log}>
          <div className="form-columns">
            <label>
              Type
              <select name="type" defaultValue="call">
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Related opportunity
              <select name="opportunity_id" defaultValue="">
                <option value="">None</option>
                {clientOpportunities.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            What happened?
            <textarea name="text" required rows={2} maxLength={5000} />
          </label>
          <div className="actions">
            <button className="btn small" disabled={busy}>
              Log activity
            </button>
          </div>
        </form>

        {!!history.length && (
          <>
            <h3 className="drawer-section">History</h3>
            {history.slice(0, 10).map((a) => (
              <div className="list-row" key={a.id}>
                <div>
                  <h3>{a.text}</h3>
                  <p className="muted small-text">
                    {a.type.replace("_", " ")} · {a.author_email} ·{" "}
                    {new Date(a.created_at).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </aside>
    </div>
  );
}
