import { useMemo, useState } from "react";
import { UserCheck } from "lucide-react";
import { db } from "@quicksort/hr-db";
import { Pill, formatDate } from "@quicksort/hr-ui";
import {
  KANBAN_STAGES,
  STAGES,
  dwellDays,
  sourceLabel,
  stageLabel,
  stageSla,
} from "./stages";
import {
  gateError,
  parseScorecard,
  transitionCandidate,
  dispositionCandidate,
  type Candidate,
  type Contract,
  type ContractSignature,
  type Interview,
  type Offer,
  type PipelineEvent,
  type Opportunity,
} from "./data";
import {
  historyFor,
  historyKindLabel,
  stageGates,
  stageRecords,
  type HistoryEntry,
} from "./gates";

const DISPO_REASONS = [
  "Rejected · role fit",
  "Rejected · compensation mismatch",
  "Rejected · skills gap",
  "Withdrawn · accepted another offer",
  "Withdrawn · personal reasons",
];

const initials = (name: string) =>
  name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The one candidate record — opened from the kanban, the table, the funnel
 * or the talent pool. Two tabs share a single source of truth:
 *
 * - Pipeline: stage stepper, derived gate checklist, per-stage records, the
 *   gated advance action, note composer and the append-only history.
 * - Profile: contact details, the advisory AI match (FR-4.3), the screening
 *   record (FR-4.4.3), skills & notes, interviews and offers — the fields
 *   the gate checklist reads, editable where they are inspected.
 *
 * Dispositions and the hire conversion are header actions (prd-hr.md §3.2
 * rules 1-3: every exit is a logged human decision).
 */
export function CandidateRecord({
  candidate: c,
  actorEmail,
  opportunities,
  gateCtx,
  busy,
  onClose,
  onRun,
}: {
  candidate: Candidate;
  actorEmail: string;
  opportunities: Opportunity[];
  gateCtx: {
    interviews: Interview[];
    offers: Offer[];
    contracts: Contract[];
    signatures: ContractSignature[];
    events: PipelineEvent[];
  };
  busy: boolean;
  onClose: () => void;
  onRun: (work: () => Promise<string>, fallback: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"pipeline" | "profile">("pipeline");
  const [viewStage, setViewStage] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [histFilter, setHistFilter] = useState<"all" | "notes" | "stage">("all");
  const [dispoOpen, setDispoOpen] = useState(false);
  const [dispoReason, setDispoReason] = useState(DISPO_REASONS[0]);

  const active = !c.disposition;
  const curIdx = KANBAN_STAGES.findIndex((s) => s.key === c.stage);
  const vsIdx = viewStage
    ? KANBAN_STAGES.findIndex((s) => s.key === viewStage)
    : curIdx;
  const stageKey = KANBAN_STAGES[vsIdx]?.key ?? c.stage;
  const isCur = vsIdx === curIdx;
  const isPast = vsIdx < curIdx;
  const stage = KANBAN_STAGES[vsIdx];
  const inKanban = curIdx >= 0;

  const myEvents = useMemo(
    () => gateCtx.events.filter((e) => e.candidate_id === c.id),
    [gateCtx.events, c.id],
  );
  const history = useMemo(
    () => historyFor(c, gateCtx.events, gateCtx.interviews),
    [c, gateCtx.events, gateCtx.interviews],
  );
  const myInterviews = useMemo(
    () =>
      gateCtx.interviews.filter(
        (i) => i.candidate_id === c.id,
      ),
    [gateCtx.interviews, c.id],
  );
  const myOffers = useMemo(
    () => gateCtx.offers.filter((o) => o.candidate_id === c.id),
    [gateCtx.offers, c.id],
  );

  const derivedGates = useMemo(
    () => stageGates(c, stageKey, gateCtx),
    [c, stageKey, gateCtx],
  );
  const gates = isPast ? derivedGates.map((g) => ({ ...g, done: true })) : derivedGates;
  const doneN = gates.filter((g) => g.done).length;
  const records = useMemo(
    () => stageRecords(c, stageKey, gateCtx),
    [c, stageKey, gateCtx],
  );

  const nextStage = inKanban ? KANBAN_STAGES[curIdx + 1] : undefined;
  const blockReason = !nextStage
    ? "This candidate is past the Kanban stages."
    : gateError(nextStage.key, c, gateCtx.offers);
  const ready = active && isCur && !!nextStage && !blockReason;
  const noteText = !inKanban
    ? "Hired or outside the Kanban — the journey stays on this tab; edit details on the Profile tab."
    : isPast
      ? `Completed · moved to ${KANBAN_STAGES[vsIdx + 1]?.label ?? "the next stage"}`
      : !isCur
        ? `Unlocks when ${KANBAN_STAGES[vsIdx - 1]?.label ?? "the previous stage"} is complete`
        : ready
          ? ""
          : blockReason ??
            `${gates.length - doneN} requirement${gates.length - doneN > 1 ? "s" : ""} left`;

  const dwell = dwellDays(c.updated_at, myEvents);
  const sla = stageSla(c.stage);
  const meta = [
    opportunities.find((o) => o.id === c.opportunity_id)?.title ??
      sourceLabel(c.source),
    c.email,
    `added ${formatDate(c.created_at)}`,
    `owner ${myEvents.length ? myEvents[myEvents.length - 1].actor_email : actorEmail}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const filtered = history.filter((e) =>
    histFilter === "all"
      ? true
      : histFilter === "notes"
        ? e.kind === "note"
        : e.stageKey === stageKey,
  );

  const postNote = async () => {
    const text = noteDraft.trim();
    if (!text || busy) return;
    setNoteDraft("");
    await onRun(async () => {
      const result = await db()
        .from("pipeline_events")
        .insert({
          candidate_id: c.id,
          from_stage: stageKey,
          to_stage: stageKey,
          actor_email: actorEmail,
          rationale: text,
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      return "Note posted to the record.";
    }, "Note posted.");
  };

  const confirmDispo = async () => {
    const kind = dispoReason.startsWith("Rejected") ? "rejected" : "withdrawn";
    await onRun(async () => {
      await dispositionCandidate(c, kind, dispoReason, actorEmail);
      onClose();
      return `${c.full_name} · ${dispoReason}. Logged to the record.`;
    }, "Disposition logged.");
    setDispoOpen(false);
  };

  const advance = async () => {
    if (!nextStage || busy) return;
    const rationale = window.prompt(
      `Move ${c.full_name} to “${nextStage.label}” — reason (optional):`,
      "",
    );
    if (rationale === null) return;
    await onRun(async () => {
      await transitionCandidate(c, nextStage.key, actorEmail, rationale.trim(), gateCtx.offers);
      return `${c.full_name} → ${nextStage.label}`;
    }, "Candidate moved.");
  };

  /** Backward / corrective moves — still gated, still logged (§3.2 rule 2). */
  const correctStage = (toStage: string) => {
    if (toStage === c.stage || busy) return;
    const rationale = window.prompt(
      `Correct ${c.full_name}'s stage to “${stageLabel(toStage)}” — reason (required):`,
      "",
    );
    if (rationale === null || !rationale.trim()) return;
    void onRun(async () => {
      await transitionCandidate(c, toStage, actorEmail, rationale.trim(), gateCtx.offers);
      return `Stage corrected → ${stageLabel(toStage)}`;
    }, "Stage corrected.");
  };

  const markHired = () => {
    const start = window.prompt(
      "Start date (YYYY-MM-DD):",
      new Date().toISOString().slice(0, 10),
    );
    if (start === null) return;
    void onRun(async () => {
      const now = new Date().toISOString();
      const updated = await db()
        .from("pipeline_candidates")
        .update({
          person_status: "employee",
          disposition: "hired",
          disposition_reason: "Offer accepted — converted to employee (FR-5.4.1).",
          stage: "preboarding",
          start_date: start || null,
          updated_at: now,
        })
        .eq("id", c.id)
        .select("id")
        .single();
      if (updated.error) throw updated.error;
      const event = await db()
        .from("pipeline_events")
        .insert({
          candidate_id: c.id,
          from_stage: c.stage,
          to_stage: "preboarding",
          actor_email: actorEmail,
          rationale: `Candidate → employee conversion. Start ${start}. Zero re-entry; full history preserved.`,
        })
        .select("id")
        .single();
      if (event.error) throw event.error;
      return "Converted to employee. Pre-boarding can start — see Onboarding.";
    }, "Converted to employee.");
  };

  return (
    <div className="record-overlay" onClick={onClose}>
      <div
        className="record-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Candidate record for ${c.full_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="record-top">
          <div className="record-id">
            <span className="record-avatar">{initials(c.full_name)}</span>
            <div>
              <div className="record-name">{c.full_name}</div>
              <div className="record-meta">{meta}</div>
              <span className="actions" style={{ marginTop: 8 }}>
                <Pill status={c.person_status} />
                <Pill status={c.stage} />
                {c.disposition && <Pill status={c.disposition} />}
              </span>
            </div>
          </div>
          <div className="record-actions">
            {active && c.person_status === "candidate" && (
              <button className="record-btn" disabled={busy} onClick={markHired}>
                <UserCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Mark as hired
              </button>
            )}
            {active && (
              <button className="record-btn" onClick={() => setDispoOpen((v) => !v)}>
                Log disposition
              </button>
            )}
            <button className="record-btn record-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {dispoOpen && (
          <div className="record-dispo">
            <span className="record-dispo-note">
              A disposition closes this application and moves the profile to the
              talent pool. The reason is kept on the record.
            </span>
            <select
              aria-label="Disposition reason"
              value={dispoReason}
              onChange={(e) => setDispoReason(e.target.value)}
            >
              {DISPO_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="record-dispo-confirm"
              disabled={busy}
              onClick={() => void confirmDispo()}
            >
              Log and close
            </button>
          </div>
        )}

        <div className="record-tabs" role="tablist" aria-label="Record sections">
          {(
            [
              ["pipeline", "Pipeline"],
              ["profile", "Profile"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? "active" : ""}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "pipeline" && (
          <>
            {inKanban && (
              <div className="record-steps" role="tablist" aria-label="Pipeline stages">
                {KANBAN_STAGES.map((st, i) => {
                  const past = i < curIdx;
                  const cur = i === curIdx;
                  return (
                    <button
                      key={st.key}
                      role="tab"
                      aria-selected={i === vsIdx}
                      className={`record-step ${i === vsIdx ? "selected" : ""}`}
                      onClick={() => setViewStage(st.key)}
                    >
                      <span className={`record-step-bar ${past || cur ? "on" : ""}`} />
                      <span className={`record-step-label ${past || cur ? "on" : ""}`}>
                        {st.label}
                      </span>
                      <span className="record-step-sub">
                        {past ? "Done" : cur ? `Current · day ${dwell}` : "Locked"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="record-grid">
              <div className="record-card">
                <div className="record-card-head">
                  <div>
                    <div className="record-eyebrow">
                      {inKanban ? `Stage ${vsIdx + 1} of ${KANBAN_STAGES.length}` : "Lifecycle"}
                    </div>
                    <div className="record-stage-label">
                      {stage?.label ?? stageLabel(c.stage)}
                    </div>
                  </div>
                  <span className="record-status">
                    {isPast
                      ? "Completed"
                      : isCur
                        ? sla !== null
                          ? `Day ${dwell} of ${sla}`
                          : `Day ${dwell}`
                        : "Locked"}
                  </span>
                </div>

                {!!gates.length && (
                  <div className="record-gates">
                    <div className="record-gates-head">
                      <span>Gate</span>
                      <span>
                        {doneN} of {gates.length}
                      </span>
                    </div>
                    <div className="record-gate-list">
                      {gates.map((g, i) => (
                        <div key={i} className={`record-gate ${g.done ? "done" : ""}`}>
                          <span className="record-gate-box">{g.done ? "✓" : ""}</span>
                          <span>{g.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(isPast || isCur) && !!records.length && (
                  <div className="record-records">
                    <div className="record-gates-head">Records</div>
                    {records.map((r, i) => (
                      <div className="record-record" key={i}>
                        <span className="record-record-label">{r.label}</span>
                        <span className={`record-record-meta ${r.ok ? "ok" : ""}`}>{r.meta}</span>
                        <span className="record-record-value">{r.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {ready ? (
                  <button className="record-cta" disabled={busy} onClick={() => void advance()}>
                    Advance to {nextStage?.label} →
                  </button>
                ) : (
                  noteText && <div className="record-cta-note">{noteText}</div>
                )}

                {active && (
                  <label className="record-correct">
                    Correct stage
                    <select value={c.stage} disabled={busy} onChange={(e) => correctStage(e.target.value)}>
                      {STAGES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="record-card">
                <div>
                  <div className="record-history-title">History</div>
                  <div className="record-history-sub">
                    Append-only. Entries can&rsquo;t be edited or deleted.
                  </div>
                </div>
                <div className="record-note">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void postNote();
                      }
                    }}
                    rows={3}
                    placeholder="Add a note"
                    aria-label="Add a note"
                  />
                  <div className="record-note-foot">
                    <span>Tagged to {stage?.label ?? stageLabel(c.stage)} · ⌘↵ to post</span>
                    <button
                      className="record-note-post"
                      disabled={busy || !noteDraft.trim()}
                      onClick={() => void postNote()}
                    >
                      Post note
                    </button>
                  </div>
                </div>
                <div className="record-hist-tabs" role="tablist" aria-label="History filter">
                  {(
                    [
                      ["all", "All"],
                      ["notes", "Notes"],
                      ["stage", stage?.label ?? "Stage"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={histFilter === k}
                      className={histFilter === k ? "active" : ""}
                      onClick={() => setHistFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="record-timeline">
                  {filtered.map((e) => (
                    <HistoryRow key={e.id} entry={e} />
                  ))}
                  {!filtered.length && (
                    <div className="record-timeline-empty">
                      Nothing logged for this filter yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "profile" && (
          <div className="record-grid">
            <div className="record-card">
              <div>
                <div className="record-history-title">Contact</div>
                <div className="record-contact">
                  <span>{c.email || "No email"}</span>
                  {c.phone && <span>{c.phone}</span>}
                  <span>
                    {sourceLabel(c.source)}
                    {c.referrer ? ` · referred by ${c.referrer}` : ""}
                  </span>
                  {c.disposition_reason && (
                    <span>Disposition reason: {c.disposition_reason}</span>
                  )}
                </div>
              </div>

              <div>
                <div className="record-history-title">AI match — advisory, never auto-rejects</div>
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void onRun(async () => {
                      const result = await db()
                        .from("pipeline_candidates")
                        .update({
                          match_score:
                            f.get("match_score") === "" ? null : Number(f.get("match_score")),
                          match_explanation: String(f.get("match_explanation")).trim(),
                          updated_at: new Date().toISOString(),
                        })
                        .eq("id", c.id)
                        .select("id")
                        .single();
                      if (result.error) throw result.error;
                      return "Match score updated. Ranking stays advisory only.";
                    }, "Match score updated.");
                  }}
                >
                  <label>
                    Score (0-100)
                    <input
                      name="match_score"
                      type="number"
                      min="0"
                      max="100"
                      defaultValue={c.match_score ?? ""}
                    />
                  </label>
                  <label>
                    Explanation — evidence-linked factors (FR-4.3.1)
                    <textarea
                      name="match_explanation"
                      rows={3}
                      maxLength={5000}
                      defaultValue={c.match_explanation}
                      placeholder="Skills match 82%: Kubernetes, 3 yrs (stated, 2 projects); seniority fit: lead role 2 yrs; availability: 1 month; location: Paris on-site…"
                    />
                  </label>
                  <button className="record-note-post" disabled={busy}>
                    Save match
                  </button>
                </form>
              </div>

              <div>
                <div className="record-history-title">Screening record (gates the HR interview)</div>
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void onRun(async () => {
                      const result = await db()
                        .from("pipeline_candidates")
                        .update({
                          screening_summary: String(f.get("screening_summary")).trim(),
                          screening_recommendation: String(f.get("screening_recommendation")).trim(),
                          updated_at: new Date().toISOString(),
                        })
                        .eq("id", c.id)
                        .select("id")
                        .single();
                      if (result.error) throw result.error;
                      return "Screening record saved.";
                    }, "Screening record saved.");
                  }}
                >
                  <label>
                    Screening summary (FR-4.4.3)
                    <textarea
                      name="screening_summary"
                      rows={4}
                      maxLength={5000}
                      defaultValue={c.screening_summary}
                      placeholder="Knockout criteria, stated expectations vs. corridor, flagged inconsistencies, suggested HR-interview questions…"
                    />
                  </label>
                  <label>
                    Advisory recommendation
                    <select
                      name="screening_recommendation"
                      defaultValue={c.screening_recommendation}
                    >
                      <option value="">No recommendation</option>
                      <option value="advance">Advance to HR interview</option>
                      <option value="hold">Hold — needs clarification</option>
                      <option value="decline">Decline advisory — human decides</option>
                    </select>
                  </label>
                  <button className="record-note-post" disabled={busy}>
                    Save screening
                  </button>
                </form>
              </div>

              <div>
                <div className="record-history-title">Skills & notes</div>
                <form
                  className="form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void onRun(async () => {
                      const result = await db()
                        .from("pipeline_candidates")
                        .update({
                          skills: String(f.get("skills")).trim(),
                          notes: String(f.get("notes")).trim(),
                          updated_at: new Date().toISOString(),
                        })
                        .eq("id", c.id)
                        .select("id")
                        .single();
                      if (result.error) throw result.error;
                      return "Profile saved.";
                    }, "Profile saved.");
                  }}
                >
                  <label>
                    Skills
                    <textarea name="skills" rows={2} maxLength={2000} defaultValue={c.skills} />
                  </label>
                  <label>
                    Notes
                    <textarea name="notes" rows={3} maxLength={5000} defaultValue={c.notes} />
                  </label>
                  <button className="record-note-post" disabled={busy}>
                    Save profile
                  </button>
                </form>
              </div>
            </div>

            <div className="record-card">
              <div>
                <div className="record-history-title">Interviews</div>
                {myInterviews.length ? (
                  myInterviews.map((i) => {
                    const card = parseScorecard(i.scorecard);
                    return (
                      <div className="record-record" key={i.id}>
                        <span className="record-record-label">
                          {i.kind === "hr"
                            ? "HR interview"
                            : i.kind === "technical"
                              ? "Technical interview"
                              : "Client presentation"}
                        </span>
                        <span className={`record-record-meta ${i.status === "completed" ? "ok" : ""}`}>
                          {i.status}
                        </span>
                        <span className="record-record-value">
                          {formatDate(i.scheduled_at)} · panel: {i.panel || "—"} ·{" "}
                          {i.location || "—"}
                          {i.status === "completed" && card.length > 0 && (
                            <> · {card.map((s) => `${s.competency}: ${s.rating ?? "—"}/5`).join(" · ")}</>
                          )}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="record-contact">No interviews yet — schedule one in Pipeline · Interviews.</p>
                )}
              </div>

              <div>
                <div className="record-history-title">Offers</div>
                {myOffers.length ? (
                  myOffers.map((o) => (
                    <div className="record-record" key={o.id}>
                      <span className="record-record-label">{o.title}</span>
                      <span
                        className={`record-record-meta ${
                          ["approved", "sent", "accepted"].includes(o.status) ? "ok" : ""
                        }`}
                      >
                        {o.status.replace(/_/g, " ")}
                      </span>
                      <span className="record-record-value">
                        {o.contract_type} · {o.salary_monthly} €/month · margin {o.margin_pct}%
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="record-contact">No offers yet — create one in Offers.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryRow({ entry: e }: { entry: HistoryEntry }) {
  return (
    <div className="record-event">
      <div className="record-event-rail">
        <span
          className={`record-event-dot ${
            e.kind === "note"
              ? "note"
              : e.kind === "stage"
                ? "stage"
                : e.kind === "disposition"
                  ? "dispo"
                  : "interview"
          }`}
        />
      </div>
      <div className="record-event-body">
        <div className="record-event-meta">
          <span className="record-event-kind">{historyKindLabel(e.kind)}</span>
          {!!e.stageKey && <span>{stageLabel(e.stageKey)}</span>}
          <span title={e.author}>{e.author}</span>
          <span>{formatDate(e.when)}</span>
        </div>
        <div
          className={`record-event-text ${
            e.kind === "note" || e.kind === "stage" ? "strong" : ""
          }`}
        >
          {e.text}
        </div>
      </div>
    </div>
  );
}
