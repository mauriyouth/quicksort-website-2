import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronDown, Plus, Search } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Empty } from "@quicksort/hr-ui";
import {
  KANBAN_STAGES,
  dwellDays,
  slaState,
  sourceLabel,
  stageLabel,
  stageSla,
} from "./stages";
import {
  transitionCandidate,
  type Candidate,
  type Contract,
  type ContractSignature,
  type Interview,
  type Offer,
  type PipelineEvent,
  type Opportunity,
} from "./data";
import { stageGates } from "./gates";
import { CandidateRecord } from "./CandidateRecord";
import { TalentPool } from "./TalentPool";
import { InterviewsPanel } from "./InterviewsPanel";
import { IntakeSheet } from "./IntakeSheet";
import { ScheduleInterviewSheet } from "./ScheduleInterviewSheet";
import { Onboarding } from "./Onboarding";
import { Offboarding } from "./Offboarding";
import { Offers } from "./Offers";

/**
 * Recruitment pipeline — prd-hr.md §3.2, and the single home for candidate
 * records (the former CVthèque tab is a view of this page) and for
 * interviews (the former Interviews tab is the Interviews view here). The
 * Board / Table / Funnel views show the active funnel: stages 3-11 as
 * drag-and-drop columns, SLA heat first, every move a gated, logged human
 * action (§3.2 rules 1-3). The Interviews view holds the upcoming list
 * with scorecards and the past list — one canonical place, fed by the
 * same data as the gates; scheduling opens from the page action row in
 * any view. The Talent pool view is the CVthèque: one canonical record
 * per person — candidates, employees, alumni and rejected profiles stay
 * searchable for rediscovery. The Offers view carries the offer lifecycle
 * (prd-hr.md FR-5.3.3): unit economics before issuance, the HR → Direction
 * approval chain and declined offers as first-class backward moves. The
 * Onboarding and Offboarding views carry
 * the employee lifecycle (prd-hr.md §6) — day-1 readiness, probation
 * reviews, managed exits — so the pipeline is the single home for the
 * whole journey; the Employees tab is the directory of that same data.
 * Intake (resume drop or manual) and interview scheduling open from the
 * action row and land straight on the record / upcoming list.
 */
type View =
  | "Board"
  | "Table"
  | "Funnel"
  | "Interviews"
  | "Offers"
  | "Onboarding"
  | "Offboarding"
  | "Talent pool";
const VIEWS: View[] = [
  "Board",
  "Table",
  "Funnel",
  "Interviews",
  "Offers",
  "Onboarding",
  "Offboarding",
  "Talent pool",
];

export function Pipeline({ actorEmail }: { actorEmail: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [signatures, setSignatures] = useState<ContractSignature[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [roleFilter, setRoleFilter] = useState("");
  const [view, setView] = useState<View>("Board");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  // Intake sheet and the unified candidate record.
  const [adding, setAdding] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Core tables decide whether the pipeline can render at all — a
      // failure here must surface as the sync banner. Auxiliary tables
      // (interviews, contracts, signatures) only feed gate checklists and
      // record rows; a permission hiccup there degrades those sections to
      // "Pending" instead of blanking the whole board. Candidates load in
      // full — the funnel views filter to active records, the talent pool
      // needs everyone.
      const core = await Promise.all([
        db().from("pipeline_candidates").select("*").order("updated_at"),
        db().from("pipeline_events").select("*").order("created_at"),
        db().from("offers").select("*"),
        db().from("opportunities").select("*"),
      ]);
      for (const r of core) if (r.error) throw r.error;
      setCandidates(core[0].data || []);
      setEvents(core[1].data || []);
      setOffers(core[2].data || []);
      setOpportunities(core[3].data || []);
      const aux = await Promise.all([
        db().from("interviews").select("*").order("scheduled_at"),
        db().from("contracts").select("*").order("created_at"),
        db().from("contract_signatures").select("*"),
      ]);
      setInterviews(aux[0].error ? [] : aux[0].data || []);
      setContracts(aux[1].error ? [] : aux[1].data || []);
      setSignatures(aux[2].error ? [] : aux[2].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title =
      view === "Offers"
        ? "Offers · Quicksort Admin"
        : view === "Onboarding"
          ? "Onboarding · Quicksort Admin"
          : view === "Offboarding"
            ? "Offboarding · Quicksort Admin"
            : "Pipeline · Quicksort Admin";
  }, [view]);

  // A fresh failure re-arms the banner even after a previous dismiss.
  useEffect(() => {
    if (error) setBannerDismissed(false);
  }, [error]);

  const active = useMemo(
    () => candidates.filter((c) => !c.disposition),
    [candidates],
  );

  const eventsByCandidate = useMemo(() => {
    const map = new Map<string, PipelineEvent[]>();
    for (const e of events) {
      const list = map.get(e.candidate_id) || [];
      list.push(e);
      map.set(e.candidate_id, list);
    }
    return map;
  }, [events]);

  const gateCtx = useMemo(
    () => ({ interviews, offers, contracts, signatures, events }),
    [interviews, offers, contracts, signatures, events],
  );

  const run = useCallback(
    async (work: () => Promise<string>, successFallback: string) => {
      setBusy(true);
      setError("");
      try {
        const note = await work();
        showToast(note || successFallback);
        await load();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [load, showToast],
  );

  /** Offer / gate transitions go through run; the schedule form lives in
   * the ScheduleInterviewSheet dialog, fed with run + the active list. */
  async function drop(toStage: string) {
    const candidate = active.find((c) => c.id === dragId);
    setDragId(null);
    setOverStage(null);
    if (!candidate || candidate.stage === toStage) return;
    const rationale = window.prompt(
      `Move ${candidate.full_name} to “${stageLabel(toStage)}” — reason (optional):`,
      "",
    );
    if (rationale === null) return;
    await run(
      async () => {
        await transitionCandidate(candidate, toStage, actorEmail, rationale.trim(), offers);
        return `${candidate.full_name} → ${stageLabel(toStage)}`;
      },
      "Candidate moved.",
    );
  }

  /** Card / row rendering data, shared by board, table and the record CTA. */
  const cardState = useCallback(
    (c: Candidate) => {
      const evs = eventsByCandidate.get(c.id) || [];
      const dwell = dwellDays(c.updated_at, evs);
      const state = slaState(c.stage, dwell);
      const sla = stageSla(c.stage);
      const gates = stageGates(c, c.stage, gateCtx);
      const nextGate = gates.find((g) => !g.done);
      const actor = evs.length ? evs[evs.length - 1].actor_email : actorEmail;
      return {
        evs,
        dwell,
        state,
        sla,
        gates,
        doneN: gates.filter((g) => g.done).length,
        next: nextGate ? `Next → ${nextGate.text}` : "Gate complete → ready to advance",
        nextText: nextGate?.text ?? "",
        daysLabel: sla !== null ? `Day ${dwell} of ${sla}` : `Day ${dwell}`,
        actor,
        actorInitials: initials(actor.split("@")[0] || "Q"),
      };
    },
    [eventsByCandidate, gateCtx, actorEmail],
  );

  const openRecord = useCallback((id: string) => setOpenId(id), []);
  const closeRecord = useCallback(() => setOpenId(null), []);

  const record = candidates.find((c) => c.id === openId) || null;

  const query = search.toLowerCase();
  const matchesQuery = (c: Candidate) =>
    !query ||
    c.full_name.toLowerCase().includes(query) ||
    c.email.toLowerCase().includes(query) ||
    (c.skills || "").toLowerCase().includes(query);

  // Funnel views: active candidates only, with SLA and role filters.
  const visible = active.filter((c) => {
    if (!matchesQuery(c)) return false;
    if (riskOnly && cardState(c).state === "ok") return false;
    if (roleFilter && c.opportunity_id !== roleFilter) return false;
    return true;
  });

  // Talent pool: everyone, the page search narrows it, the pool's own
  // lifecycle chips do the rest.
  const poolVisible = candidates.filter(matchesQuery);

  const terminalStage = KANBAN_STAGES[KANBAN_STAGES.length - 1].key;
  const isPool = view === "Talent pool";
  const isInterviews = view === "Interviews";
  const isOffers = view === "Offers";
  const isLifecycle = view === "Onboarding" || view === "Offboarding";
  const isFunnel = !isPool && !isInterviews && !isLifecycle && !isOffers;

  return (
    <>
      <div className="hr-actions">
        <button className="btn" onClick={() => setAdding(true)}>
          <Plus size={14} />
          Add candidate
        </button>
        <button className="btn secondary" onClick={() => setScheduling(true)}>
          <CalendarClock size={14} />
          Schedule an interview
        </button>
      </div>

      {error && !bannerDismissed && (
        <div className="sync-banner" role="alert">
          <span className="sync-dot" />
          <p>{error}</p>
          <button
            className="sync-retry"
            disabled={loading || busy}
            onClick={() => void load()}
          >
            Retry
          </button>
          <button
            className="sync-dismiss"
            aria-label="Dismiss"
            onClick={() => setBannerDismissed(true)}
          >
            ×
          </button>
        </div>
      )}

      <nav className="view-menu" aria-label="Pipeline view">
        {VIEWS.map((name) => (
          <button
            key={name}
            aria-pressed={view === name}
            className={view === name ? "active" : ""}
            onClick={() => setView(name)}
          >
            {name}
          </button>
        ))}
      </nav>

      {isOffers ? (
        <Offers actorEmail={actorEmail} />
      ) : isLifecycle ? (
        view === "Onboarding" ? (
          <Onboarding />
        ) : (
          <Offboarding actorEmail={actorEmail} />
        )
      ) : (
      <section className="panel">
        <div className="pipeline-toolbar">
          <div className="pipeline-search">
            <Search size={14} />
            <input
              aria-label="Search pipeline"
              placeholder={
                isPool
                  ? "Search the talent pool"
                  : isInterviews
                    ? "Search interviews — candidate, panel, location"
                    : "Search candidates, roles or skills"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isFunnel && (
            <>
              <label className="pipeline-filter">
                <select
                  aria-label="Filter by role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                >
                  <option value="">Role: all</option>
                  {opportunities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </label>
              <button
                className={`pipeline-filter${riskOnly ? " risk-on" : ""}`}
                aria-pressed={riskOnly}
                onClick={() => setRiskOnly((v) => !v)}
              >
                SLA risk only
              </button>
            </>
          )}
        </div>

        {!loading && isFunnel && !active.length && (
          <Empty title="The funnel is empty">
            Add a candidate — drop a resume PDF or use the form — and link them
            to an opportunity to start moving people through the pipeline.
          </Empty>
        )}

        {view === "Board" && !!active.length && (
          <div className="kanban" role="list" aria-label="Pipeline stages">
            {KANBAN_STAGES.map((stage) => {
              const cards = visible.filter((c) => c.stage === stage.key);
              const colBreach = cards.filter(
                (c) => cardState(c).state === "breach",
              ).length;
              const sla = stageSla(stage.key);
              return (
                <div
                  key={stage.key}
                  className={`kanban-column ${overStage === stage.key ? "drop-target" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverStage(stage.key);
                  }}
                  onDragLeave={() => setOverStage((s) => (s === stage.key ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(stage.key);
                  }}
                >
                  <div className="kanban-head">
                    <span className={`kanban-dot ${stage.key === terminalStage ? "done" : ""}`} />
                    <h3>{stage.label}</h3>
                    <span className="kanban-count">{cards.length}</span>
                    {colBreach > 0 && (
                      <span className="kanban-breach">
                        {colBreach} breach{colBreach === 1 ? "" : "es"}
                      </span>
                    )}
                    <span className="kanban-sla">
                      {sla !== null ? `SLA ${sla}d` : "No SLA"}
                    </span>
                  </div>
                  <div className="kanban-divider" />
                  <div className="kanban-cards">
                    {cards.map((c) => {
                      const cs = cardState(c);
                      const req = opportunities.find((r) => r.id === c.opportunity_id);
                      return (
                        <article
                          key={c.id}
                          className={`kanban-card sla-${cs.state} ${dragId === c.id ? "dragging" : ""}`}
                          draggable
                          role="listitem"
                          onClick={() => openRecord(c.id)}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", c.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDragId(c.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setOverStage(null);
                          }}
                        >
                          <div className="kanban-card-top">
                            <div>
                              <h4>{c.full_name}</h4>
                              <p className="kanban-role">
                                {req?.title || sourceLabel(c.source)}
                              </p>
                            </div>
                            {cs.state === "breach" && (
                              <span className="card-badge breach">Breached</span>
                            )}
                            {cs.state === "warn" && (
                              <span className="card-badge near">Near SLA</span>
                            )}
                          </div>
                          <div className="kanban-gate">
                            <div className="kanban-segs" aria-hidden="true">
                              {cs.gates.map((g, i) => (
                                <span
                                  key={i}
                                  className={g.done ? "on" : ""}
                                />
                              ))}
                            </div>
                            <span className="kanban-next">{cs.next}</span>
                          </div>
                          <div className="kanban-card-foot">
                            <span
                              className="kanban-avatar"
                              title={cs.actor}
                            >
                              {cs.actorInitials}
                            </span>
                            <span className="kanban-days">{cs.daysLabel}</span>
                          </div>
                        </article>
                      );
                    })}
                    {!cards.length && <div className="kanban-empty">No one here</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "Table" && !!active.length && (
          visible.length ? (
            <div className="pipeline-rows-wrap">
              <div className="pipeline-rows pipeline-rows-head">
                <span>Candidate</span>
                <span>Role</span>
                <span>Stage</span>
                <span>Next step</span>
                <span>In stage</span>
                <span>Owner</span>
              </div>
              {visible.map((c) => {
                const cs = cardState(c);
                const req = opportunities.find((r) => r.id === c.opportunity_id);
                return (
                  <div
                    className="pipeline-rows pipeline-row"
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRecord(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openRecord(c.id);
                      }
                    }}
                  >
                    <span className="cell-main">{c.full_name}</span>
                    <span className="cell-sub">{req?.title || sourceLabel(c.source)}</span>
                    <span>{stageLabel(c.stage)}</span>
                    <span className="cell-sub">{cs.nextText || "Ready to advance"}</span>
                    <span className="cell-sub">{cs.daysLabel}</span>
                    <span className="cell-sub" title={cs.actor}>{cs.actor}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="No candidates match">
              Try a different search, role or SLA filter.
            </Empty>
          )
        )}

        {view === "Funnel" && !!active.length && (
          visible.length ? (
            <div className="funnel">
              {KANBAN_STAGES.map((stage, i) => {
                const count = visible.filter((c) => c.stage === stage.key).length;
                const pct = visible.length
                  ? Math.round((count / visible.length) * 100)
                  : 0;
                const prev = i
                  ? visible.filter((c) => c.stage === KANBAN_STAGES[i - 1].key).length
                  : 0;
                const conv = i && prev ? Math.round((count / prev) * 100) : null;
                return (
                  <div className="funnel-row" key={stage.key}>
                    <span className="funnel-label">{stage.label}</span>
                    <div className="funnel-track">
                      <span
                        className={`funnel-fill ${stage.key === terminalStage ? "terminal" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="funnel-meta">
                      {count}
                      {conv !== null ? ` · ${conv}%` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="No candidates match">
              Try a different search, role or SLA filter.
            </Empty>
          )
        )}

        {isInterviews && (
          <InterviewsPanel
            interviews={interviews}
            candidates={candidates}
            query={search}
            busy={busy}
            onRun={run}
            onOpen={openRecord}
          />
        )}

        {isPool && (
          <TalentPool
            candidates={poolVisible}
            total={candidates.length}
            opportunities={opportunities}
            onOpen={openRecord}
          />
        )}

        {isFunnel && (
          <p className="muted small-text" style={{ marginTop: 18 }}>
            Candidates never leave the funnel by timeout or by AI. Rejections
            and withdrawals are logged human dispositions with a reason, from
            the candidate record. Past profiles stay searchable in the Talent
            pool view.
          </p>
        )}
      </section>
      )}

      {adding && (
        <IntakeSheet
          actorEmail={actorEmail}
          opportunities={opportunities}
          onRun={run}
          onError={(m) => setError(m)}
          onAdded={openRecord}
          onClose={() => setAdding(false)}
        />
      )}

      {scheduling && (
        <ScheduleInterviewSheet
          candidates={active}
          busy={busy}
          onRun={run}
          onClose={() => setScheduling(false)}
        />
      )}

      {record && (
        <CandidateRecord
          key={record.id}
          candidate={record}
          actorEmail={actorEmail}
          opportunities={opportunities}
          gateCtx={gateCtx}
          busy={busy}
          onClose={closeRecord}
          onRun={run}
        />
      )}

      {toast && (
        <div className="pipeline-toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
