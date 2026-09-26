import type { FormEvent } from "react";
import { X } from "lucide-react";
import { db } from "@quicksort/hr-db";
import type { Candidate } from "./data";

/**
 * Schedule-interview sheet — the same centered-dialog pattern as the
 * intake sheet: opened from the page action row above every pipeline
 * view, closed on backdrop click or the × button. The inline schedule
 * form it replaces sat inside the panel and pushed the active view
 * down; a dialog keeps the board where it was and matches how a
 * candidate is added. Panel members get scoped, time-boxed access.
 */
export function ScheduleInterviewSheet({
  candidates,
  busy,
  onRun,
  onClose,
}: {
  /** Active (in-funnel) candidates — the only ones worth interviewing. */
  candidates: Candidate[];
  busy: boolean;
  onRun: (work: () => Promise<string>, fallback: string) => Promise<void>;
  onClose: () => void;
}) {
  function schedule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const candidateId = String(f.get("candidate_id"));
    void onRun(async () => {
      const result = await db()
        .from("interviews")
        .insert({
          candidate_id: candidateId,
          kind: String(f.get("kind")),
          scheduled_at: new Date(String(f.get("scheduled_at"))).toISOString(),
          panel: String(f.get("panel")).trim(),
          location: String(f.get("location")).trim(),
        })
        .select("id")
        .single();
      if (result.error) throw result.error;
      const who =
        candidates.find((c) => c.id === candidateId)?.full_name || "candidate";
      return `Interview scheduled for ${who}.`;
    }, "Interview scheduled. Panel members get scoped, time-boxed access.").then(
      onClose,
    );
  }

  return (
    <div className="intake-overlay" onClick={onClose}>
      <div
        className="intake-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Schedule an interview"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="intake-sheet-head">
          <div>
            <div className="intake-sheet-eyebrow">Interviews</div>
            <h2>Schedule an interview</h2>
          </div>
          <button className="intake-sheet-close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form className="form" onSubmit={schedule}>
          <div className="form-columns">
            <label>
              Candidate
              <select name="candidate_id" required defaultValue="">
                <option value="" disabled>
                  Select a candidate
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stage
              <select name="kind" defaultValue="hr">
                <option value="hr">HR interview</option>
                <option value="technical">Technical interview</option>
                <option value="client">Client presentation</option>
              </select>
            </label>
            <label>
              Date & time
              <input name="scheduled_at" type="datetime-local" required />
            </label>
            <label>
              Location / link
              <input name="location" maxLength={300} placeholder="Office, Meet link…" />
            </label>
          </div>
          <label>
            Panel (comma-separated emails)
            <input name="panel" maxLength={500} placeholder="interviewer@quicksort.fr" />
          </label>
          <div className="actions">
            <button className="btn" disabled={busy || !candidates.length}>
              Schedule
            </button>
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
