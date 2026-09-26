import { useState, type FormEvent } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@quicksort/hr-db";
import { Empty, Notice } from "@quicksort/hr-ui";
import {
  ACTIVITY_TYPES,
  HEALTH_META,
  INFLUENCE_META,
  STAGE_COLORS,
  amountDetail,
  daysSince,
  money,
  stageLabel,
  useSales,
  type SalesClient,
} from "./data";

type Sales = ReturnType<typeof useSales>;

/**
 * Client 360 (sales.md §8.4): company info, health, people inside the
 * client, linked opportunities with régie/forfait labels and sponsor
 * influence, plus the activity timeline with a composer. People and
 * opportunities can be added in context.
 */
export function ClientDetail({
  client,
  sales,
  actorEmail,
  onBack,
}: {
  client: SalesClient;
  sales: Sales;
  actorEmail: string;
  onBack: () => void;
}) {
  const { data, busy, action, logActivity } = sales;
  const [editing, setEditing] = useState(false);
  const [showPerson, setShowPerson] = useState(false);
  const [showOpportunity, setShowOpportunity] = useState(false);

  const people = data.people.filter((p) => p.client_id === client.id);
  const opportunities = data.opportunities.filter((o) => o.client_id === client.id);
  const activities = data.activities.filter((a) => a.client_id === client.id);

  function saveClient(e: FormEvent<HTMLFormElement>) {
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
      const result = await db()
        .from("sales_clients")
        .update(values)
        .eq("id", client.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
      setEditing(false);
    }, "Client updated.");
  }

  function addPerson(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    if (!name) return;
    void action(async () => {
      const result = await db()
        .from("sales_people")
        .insert({
          name,
          role: String(f.get("role")).trim(),
          client_id: client.id,
          email: String(f.get("email")).trim(),
          phone: String(f.get("phone")).trim(),
          is_decision_maker: f.get("is_decision_maker") === "on",
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: client.id,
          type: "note",
          text: `Added ${name} (${String(f.get("role")).trim() || "contact"}) to the relationship map.`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
      setShowPerson(false);
    }, `${name} added to ${client.name}.`);
  }

  function addOpportunity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const pricingModel = String(f.get("pricing_model"));
    const values = {
      title: String(f.get("title")).trim(),
      client_id: client.id,
      pricing_model: pricingModel,
      tjm: pricingModel === "regie" ? Number(f.get("tjm")) : null,
      estimated_days: pricingModel === "regie" ? Number(f.get("estimated_days")) : null,
      fixed_price: pricingModel === "forfait" ? Number(f.get("fixed_price")) : null,
      expected_close: String(f.get("expected_close") || "") || null,
      owner_email: String(f.get("owner_email")).trim() || actorEmail,
      notes: "",
      updated_at: new Date().toISOString(),
    };
    if (pricingModel === "regie" && (!values.tjm || !values.estimated_days)) {
      window.alert("A régie opportunity needs a TJM and an estimated number of days.");
      return;
    }
    if (pricingModel === "forfait" && !values.fixed_price) {
      window.alert("A forfait opportunity needs a fixed price.");
      return;
    }
    void action(async () => {
      const result = await db().from("sales_opportunities").insert(values).select("id").single();
      if (result.error) throw result.error;
      const note = await db()
        .from("sales_activities")
        .insert({
          client_id: client.id,
          opportunity_id: (result.data as { id: string }).id,
          type: "note",
          text: `Opportunity “${values.title}” created (${pricingModel === "regie" ? "régie" : "forfait"}).`,
          author_email: actorEmail,
        });
      if (note.error) throw note.error;
      setShowOpportunity(false);
    }, "Opportunity created.");
  }

  function log(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = String(f.get("text")).trim();
    if (!text) return;
    void logActivity(
      {
        client_id: client.id,
        opportunity_id: null,
        person_id: String(f.get("person_id") || "") || null,
        type: String(f.get("type")),
        text,
      },
      "Activity logged.",
    ).then(() => e.currentTarget.reset());
  }

  const idle = daysSince(client.last_activity_at);

  return (
    <>
      <div className="detail-nav">
        <button className="btn secondary small" onClick={onBack}>
          <ArrowLeft size={14} />
          Clients
        </button>
        <button className="btn secondary small" onClick={() => setEditing((v) => !v)}>
          <Pencil size={14} />
          {editing ? "Close editor" : "Edit"}
        </button>
      </div>
      <div className="client-head">
        <div>
          <div className="eyebrow">Client 360</div>
          <h1>{client.name}</h1>
          <p className="muted">
            {[client.industry, client.size, client.location].filter(Boolean).join(" · ") || "—"}
            {" · "}
            <span style={{ color: HEALTH_META[client.health]?.color }}>
              {HEALTH_META[client.health]?.label || client.health}
            </span>
            {idle !== null && ` · last activity ${idle}d ago`}
          </p>
        </div>
      </div>
      <Notice error={!!sales.error}>{sales.error}</Notice>
      <Notice>{sales.message}</Notice>

      {editing ? (
        <section className="panel">
          <h2>Company information</h2>
          <form className="form" onSubmit={saveClient}>
            <div className="form-columns">
              <label>
                Company name
                <input name="name" defaultValue={client.name} required maxLength={200} />
              </label>
              <label>
                Industry
                <input name="industry" defaultValue={client.industry} maxLength={200} />
              </label>
              <label>
                Size
                <select name="size" defaultValue={client.size}>
                  <option value="">Unknown</option>
                  {["1-50", "51-200", "201-1000", "1000+"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <input name="location" defaultValue={client.location} maxLength={200} />
              </label>
              <label>
                Website
                <input name="website" type="url" defaultValue={client.website} maxLength={300} />
              </label>
              <label>
                Revenue
                <input name="revenue" defaultValue={client.revenue} maxLength={100} />
              </label>
              <label>
                Health
                <select name="health" defaultValue={client.health}>
                  <option value="good">Good</option>
                  <option value="warning">Warning</option>
                  <option value="risk">At risk</option>
                </select>
              </label>
              <label>
                Owner
                <input name="owner_email" type="email" defaultValue={client.owner_email} maxLength={200} />
              </label>
            </div>
            <label>
              Tags (comma-separated)
              <input name="tags" defaultValue={(client.tags || []).join(", ")} maxLength={300} />
            </label>
            <label>
              Notes
              <textarea name="notes" defaultValue={client.notes} rows={3} maxLength={5000} />
            </label>
            <div className="actions">
              <button className="btn" disabled={busy}>
                Save client
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="panel">
          <h2>Company information</h2>
          <div className="info-grid">
            <Info label="Industry" value={client.industry} />
            <Info label="Size" value={client.size} />
            <Info label="Location" value={client.location} />
            <Info
              label="Website"
              value={
                client.website ? (
                  <a href={client.website} target="_blank" rel="noopener noreferrer">
                    {client.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  ""
                )
              }
            />
            <Info label="Revenue" value={client.revenue} />
            <Info label="Owner" value={client.owner_email} />
            <Info label="Last activity" value={idle === null ? "—" : `${idle} days ago`} />
          </div>
          {!!client.tags?.length && (
            <p className="small-text">
              {client.tags.map((t) => (
                <span className="pill tag" key={t}>{t}</span>
              ))}
            </p>
          )}
          {client.notes && <p className="wrap">{client.notes}</p>}
        </section>
      )}

      <div className="grid-two">
        <section className="panel">
          <div className="panel-head">
            <h2>People ({people.length})</h2>
            <button className="btn secondary small" onClick={() => setShowPerson((v) => !v)}>
              <Plus size={14} />
              Add person
            </button>
          </div>
          {showPerson && (
            <form className="form panel-inset" onSubmit={addPerson}>
              <div className="form-columns">
                <label>
                  Name
                  <input name="name" required maxLength={200} />
                </label>
                <label>
                  Role
                  <input name="role" maxLength={200} placeholder="e.g. CTO" />
                </label>
                <label>
                  Email
                  <input name="email" type="email" maxLength={200} />
                </label>
                <label>
                  Phone
                  <input name="phone" maxLength={40} />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" name="is_decision_maker" />
                Decision-maker
              </label>
              <div className="actions">
                <button className="btn small" disabled={busy}>
                  Add person
                </button>
              </div>
            </form>
          )}
          {people.length ? (
            people.map((p) => {
              const sponsorLinks = data.sponsors.filter((s) => s.person_id === p.id);
              return (
                <div className="list-row" key={p.id}>
                  <div>
                    <h3>
                      {p.name}
                      {p.is_decision_maker && (
                        <span className="pill" style={{ background: "#7c3aed", marginLeft: 8 }}>
                          Decision-maker
                        </span>
                      )}
                    </h3>
                    <p className="muted small-text">
                      {[p.role, p.email].filter(Boolean).join(" · ") || "—"}
                      {daysSince(p.last_contact_at) !== null &&
                        ` · last contact ${daysSince(p.last_contact_at)}d ago`}
                    </p>
                    {!!sponsorLinks.length && (
                      <p className="small-text">
                        {sponsorLinks.map((s) => {
                          const opp = data.opportunities.find((o) => o.id === s.opportunity_id);
                          return (
                            <span
                              className="pill"
                              key={s.opportunity_id}
                              style={{
                                background: INFLUENCE_META[s.influence]?.color,
                                marginRight: 4,
                              }}
                              title={opp?.title}
                            >
                              {s.is_primary ? "★ " : ""}
                              {opp?.title || "Opportunity"} · {INFLUENCE_META[s.influence]?.label}
                            </span>
                          );
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    className="btn danger small"
                    disabled={busy}
                    title={`Remove ${p.name}`}
                    onClick={() => {
                      if (!confirm(`Remove ${p.name}? They will also be removed from opportunity sponsors.`)) return;
                      void action(async () => {
                        const result = await db().from("sales_people").delete().eq("id", p.id);
                        if (result.error) throw result.error;
                      }, `${p.name} removed.`);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          ) : (
            <Empty title="No people yet">
              Add the contacts inside {client.name} to build the relationship map.
            </Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Opportunities ({opportunities.length})</h2>
            <button className="btn secondary small" onClick={() => setShowOpportunity((v) => !v)}>
              <Plus size={14} />
              Add opportunity
            </button>
          </div>
          {showOpportunity && (
            <form className="form panel-inset" onSubmit={addOpportunity}>
              <div className="form-columns">
                <label>
                  Title
                  <input name="title" required maxLength={200} />
                </label>
                <label>
                  Pricing model
                  <select name="pricing_model" defaultValue="regie">
                    <option value="regie">Régie (TJM × days)</option>
                    <option value="forfait">Forfait (fixed price)</option>
                  </select>
                </label>
                <label>
                  TJM (€ / day)
                  <input name="tjm" type="number" min="0" step="10" />
                </label>
                <label>
                  Estimated days
                  <input name="estimated_days" type="number" min="0" step="1" />
                </label>
                <label>
                  Fixed price (€)
                  <input name="fixed_price" type="number" min="0" step="100" />
                </label>
                <label>
                  Expected close
                  <input name="expected_close" type="date" />
                </label>
                <label>
                  Owner
                  <input name="owner_email" type="email" defaultValue={actorEmail} maxLength={200} />
                </label>
              </div>
              <p className="small-text muted">
                Régie needs TJM + estimated days; forfait needs the fixed price.
                The amount is derived automatically.
              </p>
              <div className="actions">
                <button className="btn small" disabled={busy}>
                  Create opportunity
                </button>
              </div>
            </form>
          )}
          {opportunities.length ? (
            opportunities.map((o) => {
              const sponsors = data.sponsors.filter((s) => s.opportunity_id === o.id);
              return (
                <div className="list-row" key={o.id}>
                  <div>
                    <h3>
                      {o.title}
                      <span
                        className="pill"
                        style={{
                          background: o.pricing_model === "regie" ? "#0ea5e9" : "#a855f7",
                          marginLeft: 8,
                        }}
                      >
                        {o.pricing_model === "regie" ? "Régie" : "Forfait"}
                      </span>
                      <span
                        className="pill"
                        style={{ background: STAGE_COLORS[o.stage], marginLeft: 4 }}
                      >
                        {stageLabel(o.stage)}
                      </span>
                    </h3>
                    <p className="muted small-text">
                      {money(Number(o.amount), o.currency)} ({amountDetail(o)}) · {o.probability}%
                      {o.expected_close ? ` · closes ${o.expected_close}` : ""}
                      {o.owner_email ? ` · ${o.owner_email}` : ""}
                    </p>
                    {!!sponsors.length && (
                      <p className="small-text">
                        {sponsors.map((s) => {
                          const person = data.people.find((p) => p.id === s.person_id);
                          return (
                            <span
                              className="pill"
                              key={s.person_id}
                              style={{
                                background: INFLUENCE_META[s.influence]?.color,
                                marginRight: 4,
                              }}
                              title={`${INFLUENCE_META[s.influence]?.label} on “${o.title}”`}
                            >
                              {s.is_primary ? "★ " : ""}
                              {person?.name || "?"} · {INFLUENCE_META[s.influence]?.label}
                            </span>
                          );
                        })}
                      </p>
                    )}
                    {o.lost_reason && <p className="small-text muted">Lost: {o.lost_reason}</p>}
                  </div>
                </div>
              );
            })
          ) : (
            <Empty title="No opportunities yet">
              Create the first opportunity for {client.name} to start the funnel.
            </Empty>
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Activity timeline</h2>
        <form className="form timeline-composer" onSubmit={log}>
          <select name="type" defaultValue="note" aria-label="Activity type">
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select name="person_id" defaultValue="" aria-label="Related person">
            <option value="">No person</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            name="text"
            required
            maxLength={5000}
            placeholder="Log a call, email, meeting or note…"
          />
          <button className="btn small" disabled={busy}>
            Log
          </button>
        </form>
        {activities.length ? (
          activities.map((a) => (
            <div className="list-row" key={a.id}>
              <div>
                <h3>{a.text}</h3>
                <p className="muted small-text">
                  {a.type.replace("_", " ")} · {a.author_email} ·{" "}
                  {new Date(a.created_at).toLocaleString("fr-FR")}
                  {a.person_id &&
                    ` · with ${data.people.find((p) => p.id === a.person_id)?.name || "contact"}`}
                </p>
              </div>
            </div>
          ))
        ) : (
          <Empty title="No activity yet">
            Log calls, emails and meetings to keep the relationship history.
          </Empty>
        )}
      </section>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <small className="muted">{label}</small>
      <p>{value || "—"}</p>
    </div>
  );
}
