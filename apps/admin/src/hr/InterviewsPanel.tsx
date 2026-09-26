import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { db } from "@quicksort/hr-db";
import { Empty, Pill, formatDate } from "@quicksort/hr-ui";
import {
  emptyScorecard,
  parseScorecard,
  type Candidate,
  type Interview,
  type ScorecardEntry,
} from "./data";

/**
 * Interviews — a Pipeline view (prd-hr.md FR-5.1), not a page of its own:
 * the upcoming list (score / no-show / cancel) and the past list share
 * this screen's data, search box, toast and candidate record, and
 * scheduling happens from the page action row above every view. The
 * former standalone Interviews tab loaded its own copy of interviews and
 * candidates — one canonical home means one load and no drift between
 * what the board and the list show. Structured, versioned scorecards
 * carry mandatory written evidence per rating (FR-5.1.2); the
 * interviewer's submission is the system of record — AI drafts are
 * advisory and never feed automated disposition (FR-5.2.2).
 */
export function InterviewsPanel({
  interviews,
  candidates,
  query,
  busy,
  onRun,
  onOpen,
}: {
  interviews: Interview[];
  candidates: Candidate[];
  /** Page search box, narrows rows by candidate, panel or location. */
  query: string;
  busy: boolean;
  onRun: (work: () => Promise<string>, success: string) => Promise<void>;
  onOpen: (candidateId: string) => void;
}) {
  const [scoring, setScoring] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const name = (id: string) =>
    candidates.find((c) => c.id === id)?.full_name || "Candidate";
  const matches = (i: Interview) =>
    !q ||
    name(i.candidate_id).toLowerCase().includes(q) ||
    (i.panel || "").toLowerCase().includes(q) ||
    (i.location || "").toLowerCase().includes(q);

  const upcoming = interviews.filter(
    (i) => i.status === "scheduled" && matches(i),
  );
  const past = interviews.filter(
    (i) => i.status !== "scheduled" && matches(i),
  );

  return (
    <div>
      <div className="panel-head">
        <h2>
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <CalendarClock size={15} aria-hidden="true" /> Upcoming (
            {upcoming.length})
          </span>
        </h2>
      </div>

      {!interviews.length && (
        <Empty title="Nothing scheduled">
          Schedule the next interview to keep the SLA clock honest — gates on
          the board only clear when the record says the work happened.
        </Empty>
      )}
      {!!interviews.length && !upcoming.length && !past.length && (
        <Empty title="No interviews match your search">
          Try another name, panel member or location.
        </Empty>
      )}

      {upcoming.map((i) => (
        <InterviewRow
          key={i.id}
          interview={i}
          candidateName={name(i.candidate_id)}
          busy={busy}
          scoringOpen={scoring === i.id}
          onScore={() => setScoring(scoring === i.id ? null : i.id)}
          onOpen={() => onOpen(i.candidate_id)}
          onStatus={(status) =>
            void onRun(async () => {
              const result = await db()
                .from("interviews")
                .update({ status })
                .eq("id", i.id)
                .select("id")
                .single();
              if (result.error) throw result.error;
              return `Interview with ${name(i.candidate_id)} marked ${status}.`;
            }, `Interview marked ${status}.`)
          }
          onSubmitScorecard={(entries) =>
            void onRun(async () => {
              const result = await db()
                .from("interviews")
                .update({ status: "completed", scorecard: entries })
                .eq("id", i.id)
                .select("id")
                .single();
              if (result.error) throw result.error;
              setScoring(null);
              return "Scorecard submitted — the interviewer's record is the system of record.";
            }, "Scorecard submitted.")
          }
        />
      ))}

      {!!past.length && (
        <>
          <h2 style={{ marginTop: 24 }}>Past & cancelled</h2>
          {past.slice(0, 20).map((i) => (
            <div className="list-row" key={i.id}>
              <div>
                <h3>{name(i.candidate_id)}</h3>
                <p className="muted small-text">
                  {i.kind === "hr" ? "HR" : i.kind === "technical" ? "Technical" : "Client"} ·{" "}
                  {formatDate(i.scheduled_at)} · panel: {i.panel || "—"}
                </p>
                <Pill status={i.status} />
                {i.status === "completed" && (
                  <p className="small-text muted">
                    {parseScorecard(i.scorecard)
                      .map((c) => `${c.competency}: ${c.rating ?? "—"}/5`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <button className="btn secondary small" onClick={() => onOpen(i.candidate_id)}>
                Open record
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function InterviewRow({
  interview,
  candidateName,
  busy,
  scoringOpen,
  onScore,
  onOpen,
  onStatus,
  onSubmitScorecard,
}: {
  interview: Interview;
  candidateName: string;
  busy: boolean;
  scoringOpen: boolean;
  onScore: () => void;
  onOpen: () => void;
  onStatus: (status: string) => void;
  onSubmitScorecard: (entries: ScorecardEntry[]) => void;
}) {
  const [entries, setEntries] = useState<ScorecardEntry[]>(emptyScorecard());
  const incomplete = entries.some(
    (en) => !en.competency.trim() || en.rating === null || !en.evidence.trim(),
  );
  return (
    <div className="list-row" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <h3>{candidateName}</h3>
        <p className="muted small-text">
          {interview.kind === "hr" ? "HR interview" : interview.kind === "technical" ? "Technical interview" : "Client presentation"}{" "}
          · {formatDate(interview.scheduled_at)} · panel: {interview.panel || "—"} ·{" "}
          {interview.location || "no location"}
        </p>
        <Pill status={interview.status} />
        {scoringOpen && (
          <form
            className="form"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!incomplete) onSubmitScorecard(entries);
            }}
          >
            {entries.map((entry, index) => (
              <div className="scorecard-row" key={index}>
                <input
                  aria-label="Competency"
                  value={entry.competency}
                  maxLength={100}
                  onChange={(e) =>
                    setEntries((prev) => prev.map((p, i) => (i === index ? { ...p, competency: e.target.value } : p)))
                  }
                />
                <select
                  aria-label="Rating"
                  value={entry.rating ?? ""}
                  onChange={(e) =>
                    setEntries((prev) =>
                      prev.map((p, i) => (i === index ? { ...p, rating: e.target.value === "" ? null : Number(e.target.value) } : p)),
                    )
                  }
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}/5
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Evidence"
                  placeholder="Written evidence for this rating"
                  value={entry.evidence}
                  maxLength={1000}
                  onChange={(e) =>
                    setEntries((prev) => prev.map((p, i) => (i === index ? { ...p, evidence: e.target.value } : p)))
                  }
                />
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => setEntries((prev) => prev.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
            ))}
            <p className="muted small-text">
              Every competency needs a rating and written evidence (FR-5.1.2).
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn secondary small"
                onClick={() => setEntries((prev) => [...prev, { competency: "", rating: null, evidence: "" }])}
              >
                Add competency
              </button>
              <button className="btn small" disabled={busy || incomplete}>
                Submit scorecard
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="actions">
        <button className="btn secondary small" disabled={busy} onClick={onScore}>
          {scoringOpen ? "Close scorecard" : "Score"}
        </button>
        <button className="btn secondary small" disabled={busy} onClick={() => onStatus("no_show")}>
          No-show
        </button>
        <button className="btn danger small" disabled={busy} onClick={() => onStatus("cancelled")}>
          Cancel
        </button>
        <button className="btn secondary small" onClick={onOpen}>
          Open record
        </button>
      </div>
    </div>
  );
}
