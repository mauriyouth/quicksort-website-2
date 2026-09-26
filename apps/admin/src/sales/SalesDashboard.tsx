import { ArrowUpRight, CalendarClock, HeartPulse, Target, Users } from "lucide-react";
import { Empty, Notice } from "@quicksort/hr-ui";
import {
  HEALTH_META,
  STAGE_COLORS,
  amountDetail,
  isOpen,
  isStaleDeal,
  money,
  stageLabel,
  useSales,
  type SalesOpportunity,
} from "./data";
import "./sales.css";

/**
 * Sales dashboard (sales.md §8.1): the command center. Open pipeline,
 * weighted forecast, the régie/forfait split, deals closing soon, stale
 * deals, the stage funnel and the latest activity — every number derived
 * from the opportunity records, régie priced as TJM × days.
 */
export function SalesDashboard({ actorEmail, onOpenClient }: {
  actorEmail: string;
  onOpenClient: (id: string) => void;
}) {
  const { data, loading, error, message } = useSales(actorEmail);
  const { clients, opportunities, activities } = data;

  const open = opportunities.filter(isOpen);
  const openTotal = open.reduce((t, o) => t + Number(o.amount), 0);
  const weightedTotal =
    Math.round(open.reduce((t, o) => t + (Number(o.amount) * o.probability) / 100, 0) * 100) / 100;
  const regie = open.filter((o) => o.pricing_model === "regie");
  const regieTotal = regie.reduce((t, o) => t + Number(o.amount), 0);

  const closingSoon = open
    .filter(
      (o) =>
        o.expected_close &&
        new Date(o.expected_close).getTime() <= Date.now() + 30 * 86400000,
    )
    .sort((a, b) => String(a.expected_close).localeCompare(String(b.expected_close)))
    .slice(0, 6);
  const stale = opportunities.filter(isStaleDeal).slice(0, 6);
  const stageCounts = (["lead", "qualified", "meeting", "proposal", "negotiation"] as const).map(
    (key) => ({
      key,
      count: open.filter((o) => o.stage === key).length,
      total: open.filter((o) => o.stage === key).reduce((t, o) => t + Number(o.amount), 0),
    }),
  );

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "";
  const riskClients = clients.filter((c) => c.health !== "good").slice(0, 5);

  return (
    <>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <div className="stats stats-head">
        <div className="stat">
          <span className="stat-label">Open pipeline</span>
          <strong className="stat-value">{money(openTotal)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Weighted forecast</span>
          <strong className="stat-value">{money(weightedTotal)}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Régie</span>
          <strong className="stat-value">{money(regieTotal)}</strong>
        </div>
      </div>
      <div className="grid-two">
        <section className="panel">
          <div className="panel-head">
            <h2>
              <CalendarClock size={16} /> Closing in the next 30 days
            </h2>
          </div>
          {closingSoon.length ? (
            closingSoon.map((o) => (
              <div className="list-row" key={o.id}>
                <div>
                  <h3>{o.title}</h3>
                  <p className="muted small-text">
                    {clientName(o.client_id)} · closes {o.expected_close} ·{" "}
                    {money(Number(o.amount), o.currency)} ({o.pricing_model === "regie" ? "Régie" : "Forfait"})
                  </p>
                </div>
                <button className="btn secondary small" onClick={() => onOpenClient(o.client_id)}>
                  Client
                  <ArrowUpRight size={14} />
                </button>
              </div>
            ))
          ) : (
            <Empty title="Nothing closing soon">
              Expected-close dates on open deals will line up here.
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>
              <HeartPulse size={16} /> Needs attention
            </h2>
          </div>
          {stale.length ? (
            stale.map((o) => <StaleRow key={o.id} o={o} clientName={clientName(o.client_id)} onOpenClient={onOpenClient} />)
          ) : (
            <Empty title="No stale deals">
              Open deals untouched for 21 days show up here.
            </Empty>
          )}
          {!!riskClients.length && (
            <>
              <h2 className="section-subhead">Clients to watch</h2>
              {riskClients.map((c) => (
                <div className="list-row" key={c.id}>
                  <div>
                    <h3>{c.name}</h3>
                    <p className="muted small-text">
                      {c.industry || "—"} ·{" "}
                      <span style={{ color: HEALTH_META[c.health]?.color }}>
                        {HEALTH_META[c.health]?.label || c.health}
                      </span>
                    </p>
                  </div>
                  <button className="btn secondary small" onClick={() => onOpenClient(c.id)}>
                    Open
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      </div>
      <div className="grid-two">
        <section className="panel">
          <h2>
            <Target size={16} /> Stage funnel
          </h2>
          {stageCounts.map((s) => {
            const width = Math.max(
              4,
              (s.total / Math.max(1, openTotal || 1)) * 100,
            );
            return (
              <div className="step" key={s.key}>
                <span className="step-num">{s.count}</span>
                <div style={{ flex: 1 }}>
                  <h3>{stageLabel(s.key)}</h3>
                  <div className="meter" aria-hidden="true">
                    <span style={{ width: `${width}%`, background: STAGE_COLORS[s.key] }} />
                  </div>
                  <p className="muted small-text">{money(s.total)}</p>
                </div>
              </div>
            );
          })}
          {!open.length && !loading && (
            <Empty title="No open opportunities">
              Deals entered on the pipeline fill this funnel.
            </Empty>
          )}
        </section>
        <section className="panel">
          <h2>
            <Users size={16} /> Recent activity
          </h2>
          {activities.length ? (
            activities.slice(0, 8).map((a) => (
              <div className="list-row" key={a.id}>
                <div>
                  <h3>{a.text}</h3>
                  <p className="muted small-text">
                    {a.type.replace("_", " ")} · {a.author_email} ·{" "}
                    {new Date(a.created_at).toLocaleDateString("fr-FR")}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <Empty title="No activity yet">
              Calls, emails, meetings and stage changes will appear here.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}

function StaleRow({ o, clientName, onOpenClient }: {
  o: SalesOpportunity;
  clientName: string;
  onOpenClient: (id: string) => void;
}) {
  const days = Math.floor(
    (Date.now() - new Date(o.updated_at).getTime()) / 86400000,
  );
  return (
    <div className="list-row">
      <div>
        <h3>{o.title}</h3>
        <p className="muted small-text">
          {clientName} · {money(Number(o.amount), o.currency)} ({amountDetail(o)}) ·
          untouched {days}d
        </p>
      </div>
      <button className="btn secondary small" onClick={() => onOpenClient(o.client_id)}>
        Client
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
