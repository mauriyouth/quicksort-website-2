import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { db, errorMessage } from "@quicksort/hr-db";
import { Notice, Empty, Pill, formatDate } from "@quicksort/hr-ui";
import { stageLabel } from "./stages";
import type { Candidate, OnboardingItem, Review } from "./data";

const PHASES = [
  { key: "preboarding", label: "Pre-boarding" },
  { key: "onboarding", label: "Onboarding" },
  { key: "probation", label: "Probation" },
] as const;

const DEFAULT_PREBOARDING = [
  "Identity document collected",
  "Diplomas collected",
  "Work permit verified",
  "Banking details collected",
  "Social-security details collected",
  "IT accounts provisioned",
  "Equipment ordered",
];

const DEFAULT_ONBOARDING = [
  "Day-1 readiness confirmed",
  "Parrain assigned (≤ day 7)",
  "Week-1 expectation check-in",
  "Week-2 expectation check-in",
  "Week-4 expectation check-in & follow-on projection",
  "Six-month objectives agreed (≤ month 1)",
];

/**
 * Onboarding & employment — prd-hr.md §6.1-6.2. Day-1 readiness checklists,
 * parrainage ≤ day 7, week 1/2/4 recalibration, six-month objectives and
 * probation reviews where the confirm / renew / terminate decision is always
 * human and logged (FR-6.2.1).
 */
export function Onboarding() {
  const [hires, setHires] = useState<Candidate[]>([]);
  const [items, setItems] = useState<OnboardingItem[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        db()
          .from("pipeline_candidates")
          .select("*")
          .eq("person_status", "employee")
          .order("updated_at", { ascending: false }),
        db().from("onboarding_items").select("*").order("created_at"),
        db().from("reviews").select("*").order("due_date"),
      ]);
      for (const r of results) if (r.error) throw r.error;
      setHires(results[0].data || []);
      setItems(results[1].data || []);
      setReviews(results[2].data || []);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Onboarding · Quicksort Admin";
    void load();
  }, [load]);

  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function instantiatePlan(candidate: Candidate) {
    void action(async () => {
      const existing = items.filter((i) => i.candidate_id === candidate.id);
      const templates = [
        ...DEFAULT_PREBOARDING.map((title) => ({ phase: "preboarding", title })),
        ...DEFAULT_ONBOARDING.map((title) => ({ phase: "onboarding", title })),
      ].filter((t) => !existing.some((e) => e.phase === t.phase && e.title === t.title));
      if (!templates.length) throw new Error("The plan is already instantiated for this hire.");
      const result = await db()
        .from("onboarding_items")
        .insert(templates.map((t) => ({ candidate_id: candidate.id, ...t })));
      if (result.error) throw result.error;
    }, "Onboarding plan instantiated (FR-6.1.2).");
  }

  function setProbation(candidate: Candidate, value: string) {
    void action(async () => {
      const result = await db()
        .from("pipeline_candidates")
        .update({ probation_end: value || null, updated_at: new Date().toISOString() })
        .eq("id", candidate.id)
        .select("id")
        .single();
      if (result.error) throw result.error;
    }, "Probation dates updated.");
  }

  function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const f = new FormData(e.currentTarget);
    void action(async () => {
      const result = await db()
        .from("onboarding_items")
        .insert({
          candidate_id: selected,
          phase: String(f.get("phase")),
          title: String(f.get("title")).trim(),
          assignee: String(f.get("assignee")).trim(),
          due_date: String(f.get("due_date") || "") || null,
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      e.currentTarget.reset();
    }, "Task added.");
  }

  const probationAlerts = hires.filter((h) => {
    if (!h.probation_end) return false;
    const days = (new Date(h.probation_end).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= -15 && h.stage !== "confirmed";
  });

  const current = hires.find((h) => h.id === selected) || null;

  return (
    <>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <div className="stats">
        <StatRow label="Employees" value={hires.length} detail="Canonical records, history intact" />
        <StatRow
          label="Pre-boarding"
          value={hires.filter((h) => h.stage === "preboarding").length}
          detail="Until day 1"
        />
        <StatRow
          label="Onboarding"
          value={hires.filter((h) => h.stage === "onboarding").length}
          detail="30-day plan"
        />
        <StatRow
          label="Probation alerts (≤30d)"
          value={probationAlerts.length}
          detail="Decision due before expiry"
        />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>Hires ({hires.length})</h2>
          <button className="btn secondary small" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        {!hires.length && !loading && (
          <Empty title="No hires yet">
            Mark a candidate as hired from their record — conversion preserves
            the full history with zero re-entry (FR-5.4.1).
          </Empty>
        )}
        {hires.map((h) => (
          <div className="list-row" key={h.id}>
            <div>
              <h3>{h.full_name}</h3>
              <p className="muted small-text">
                {stageLabel(h.stage)}
                {h.start_date ? ` · started ${formatDate(h.start_date)}` : ""}
                {h.parrain ? ` · parrain: ${h.parrain}` : ""}
              </p>
              <Pill status={h.stage} />
            </div>
            <div className="actions">
              <button className="btn secondary small" onClick={() => setSelected(h.id)}>
                Open plan
              </button>
              <button className="btn secondary small" disabled={busy} onClick={() => instantiatePlan(h)}>
                Instantiate plan
              </button>
            </div>
          </div>
        ))}
      </section>
      {current && (
        <section className="panel">
          <div className="panel-head">
            <h2>Plan — {current.full_name}</h2>
            <button className="btn secondary small" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="form-columns" style={{ marginBottom: 16 }}>
            <label className="inline-field">
              Probation end
              <input
                type="date"
                defaultValue={current.probation_end || ""}
                disabled={busy}
                onChange={(e) => setProbation(current, e.target.value)}
              />
            </label>
            <form
              className="form inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(async () => {
                  const result = await db()
                    .from("pipeline_candidates")
                    .update({ parrain: String(f.get("parrain")).trim(), updated_at: new Date().toISOString() })
                    .eq("id", current.id)
                    .select("id")
                    .single();
                  if (result.error) throw result.error;
                }, "Parrain assigned (FR-6.1.3).");
              }}
            >
              <label className="inline-field" style={{ flex: 1 }}>
                Parrain (≤ day 7)
                <input name="parrain" defaultValue={current.parrain} maxLength={200} placeholder="Mentor name" />
              </label>
              <button className="btn secondary small" disabled={busy}>
                Assign
              </button>
            </form>
          </div>
          {PHASES.map((phase) => {
            const phaseItems = items.filter((i) => i.candidate_id === current.id && i.phase === phase.key);
            return (
              <div key={phase.key}>
                <h3 className="subsection-title">
                  {phase.label} ({phaseItems.filter((i) => i.done).length}/{phaseItems.length})
                </h3>
                {!phaseItems.length && (
                  <p className="muted small-text">
                    {phase.key === "probation"
                      ? "Schedule the probation review below."
                      : "No tasks — use “Instantiate plan” for the default checklist."}
                  </p>
                )}
                {phaseItems.map((item) => (
                  <div className="check-row" key={item.id}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={busy}
                        onChange={(e) =>
                          void action(async () => {
                            const result = await db()
                              .from("onboarding_items")
                              .update({
                                done: e.target.checked,
                                done_at: e.target.checked ? new Date().toISOString() : null,
                              })
                              .eq("id", item.id)
                              .select("id")
                              .single();
                            if (result.error) throw result.error;
                          }, e.target.checked ? "Task done." : "Task reopened.")
                        }
                      />
                      <span className={item.done ? "done-text" : ""}>{item.title}</span>
                    </label>
                    <span className="muted small-text">
                      {item.assignee ? `${item.assignee} · ` : ""}
                      {item.due_date ? `due ${formatDate(item.due_date)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          <form className="form" onSubmit={addItem} style={{ marginTop: 12 }}>
            <div className="form-columns">
              <label>
                Phase
                <select name="phase" defaultValue="onboarding">
                  {PHASES.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Task
                <input name="title" required maxLength={300} />
              </label>
              <label>
                Assignee
                <input name="assignee" maxLength={200} placeholder="HR, manager, IT, parrain…" />
              </label>
              <label>
                Due date
                <input name="due_date" type="date" />
              </label>
            </div>
            <div>
              <button className="btn secondary small" disabled={busy}>
                <Plus size={14} />
                Add task
              </button>
            </div>
          </form>

          <h3 className="subsection-title">Probation reviews</h3>
          <ProbationReviews
            candidateId={current.id}
            reviews={reviews.filter((r) => r.candidate_id === current.id)}
            probationEnd={current.probation_end}
            busy={busy}
            action={action}
            onConfirm={() =>
              void action(async () => {
                const result = await db()
                  .from("pipeline_candidates")
                  .update({ stage: "confirmed", updated_at: new Date().toISOString() })
                  .eq("id", current.id)
                  .select("id")
                  .single();
                if (result.error) throw result.error;
              }, "Probation confirmed — full employee record active (FR-6.2.1).")
            }
          />
        </section>
      )}
    </>
  );
}

function ProbationReviews({
  candidateId,
  reviews,
  probationEnd,
  busy,
  action,
  onConfirm,
}: {
  candidateId: string;
  reviews: Review[];
  probationEnd: string | null;
  busy: boolean;
  action: (work: () => Promise<void>, success: string) => Promise<void>;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button
          className="btn secondary small"
          disabled={busy}
          onClick={() => {
            if (!probationEnd) {
              alert("Set the probation end date first.");
              return;
            }
            void action(async () => {
              const end = new Date(probationEnd);
              const j30 = new Date(end.getTime() - 30 * 86400000).toISOString().slice(0, 10);
              const result = await db()
                .from("reviews")
                .insert({ candidate_id: candidateId, kind: "probation", due_date: j30 })
                .select("id")
                .single();
              if (result.error) throw result.error;
            }, "Probation review scheduled at J-30.");
          }}
        >
          Schedule J-30 review
        </button>
        <button
          className="btn secondary small"
          disabled={busy}
          onClick={() => {
            if (!probationEnd) {
              alert("Set the probation end date first.");
              return;
            }
            void action(async () => {
              const end = new Date(probationEnd);
              const j15 = new Date(end.getTime() - 15 * 86400000).toISOString().slice(0, 10);
              const result = await db()
                .from("reviews")
                .insert({ candidate_id: candidateId, kind: "probation", due_date: j15 })
                .select("id")
                .single();
              if (result.error) throw result.error;
            }, "Probation review scheduled at J-15.");
          }}
        >
          Schedule J-15 review
        </button>
      </div>
      {reviews.length ? (
        reviews.map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              <h3>
                {r.kind === "probation" ? "Probation review" : "Annual review"} — due {formatDate(r.due_date)}
              </h3>
              <Pill status={r.status} />
              {r.status === "held" && (
                <p className="small-text muted">
                  Outcome: {r.outcome || "—"} · {r.rationale}
                </p>
              )}
            </div>
            {r.status === "scheduled" && (
              <button
                className="btn small"
                disabled={busy}
                onClick={() => {
                  const outcome = window.prompt(
                    "Decision: confirm / renew / terminate (required):",
                    "confirm",
                  );
                  if (outcome === null) return;
                  if (!outcome.trim()) return;
                  const rationale = window.prompt("Documented rationale (required):", "");
                  if (rationale === null || !rationale.trim()) {
                    alert("A rationale is required — the decision must be explainable.");
                    return;
                  }
                  void action(async () => {
                    const result = await db()
                      .from("reviews")
                      .update({ status: "held", outcome: outcome.trim(), rationale: rationale.trim(), held_at: new Date().toISOString() })
                      .eq("id", r.id)
                      .select("id")
                      .single();
                    if (result.error) throw result.error;
                  }, `Review held: ${outcome}. Logged.`);
                }}
              >
                Hold review…
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="muted small-text">No reviews scheduled.</p>
      )}
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy} onClick={onConfirm}>
          Confirm probation
        </button>
        <span className="muted small-text">
          Use the review decision above to record renew / terminate with rationale.
        </span>
      </div>
    </>
  );
}

function StatRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="stat">
      <div className="stat-top">{label}</div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{detail}</small>
    </div>
  );
}
