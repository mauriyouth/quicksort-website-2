// Stage gates, per-stage records and the candidate history timeline.
// Visual + interaction source: "Hiring Pipeline.html" (the pipeline
// redesign prototype). Unlike the prototype, gates are DERIVED from the
// real record — a gate reads as done when the underlying data says the
// work happened (screening summary written, interview held, offer
// approved…). Nothing is toggleable fiction; the checklist shows what the
// CVthèque already knows and what is still missing before the next stage.
import type {
  Candidate,
  Contract,
  ContractSignature,
  Interview,
  Offer,
  PipelineEvent,
} from "./data";

const has = (s: string | null | undefined) => !!s && !!s.trim();

export type GateItem = { text: string; done: boolean };

const DISPOSITION_STAGES = new Set(["rejected", "withdrawn", "hired"]);

const interviewKindStage: Record<string, string> = {
  hr: "hr_interview",
  technical: "technical_interview",
  client: "client_presentation",
};

export const interviewStageKey = (kind: string) =>
  interviewKindStage[kind] ?? kind;

const interviewsFor = (
  candidateId: string,
  kind: string,
  interviews: Interview[],
) => interviews.filter((i) => i.candidate_id === candidateId && i.kind === kind);

const offersFor = (candidateId: string, offers: Offer[]) =>
  offers.filter((o) => o.candidate_id === candidateId);

export const offerAccepted = (candidateId: string, offers: Offer[]) =>
  offersFor(candidateId, offers).some((o) => o.status === "accepted");

export const offerApproved = (candidateId: string, offers: Offer[]) =>
  offersFor(candidateId, offers).some((o) =>
    ["approved", "sent", "accepted"].includes(o.status),
  );

const scorecardOf = (i: Interview) =>
  Array.isArray(i.scorecard) ? (i.scorecard as { rating?: number | null }[]) : [];

const scorecardIn = (i: Interview) =>
  i.status === "completed" && scorecardOf(i).some((e) => e.rating != null);

/** Gate checklist for one stage, derived from the candidate's real record. */
export function stageGates(
  candidate: Candidate,
  stageKey: string,
  ctx: {
    interviews: Interview[];
    offers: Offer[];
    contracts: Contract[];
    signatures: ContractSignature[];
    events: PipelineEvent[];
  },
): GateItem[] {
  const myInterviews = ctx.interviews.filter(
    (i) => i.candidate_id === candidate.id,
  );
  const gate = (text: string, done: boolean): GateItem => ({ text, done });

  switch (stageKey) {
    case "application":
      return [
        gate("Linked to an open role", !!candidate.opportunity_id),
        gate("Skills recorded on the CVthèque", has(candidate.skills)),
        gate("AI match computed", candidate.match_score !== null),
      ];
    case "matching":
      return [
        gate("AI match score computed", candidate.match_score !== null),
        gate("Match explanation on file", has(candidate.match_explanation)),
        gate("Human review of the AI output", has(candidate.screening_recommendation)),
      ];
    case "screening":
      return [
        gate("AI initial screening recorded", has(candidate.screening_recommendation)),
        gate("Screening summary written", has(candidate.screening_summary)),
        gate("Recruiter note on the record", has(candidate.notes)),
      ];
    case "hr_interview":
    case "technical_interview":
    case "client_presentation": {
      const kind =
        stageKey === "hr_interview"
          ? "hr"
          : stageKey === "technical_interview"
            ? "technical"
            : "client";
      const list = interviewsFor(candidate.id, kind, ctx.interviews);
      return [
        gate("Interview scheduled", list.length > 0),
        gate("Interview held", list.some((i) => i.status === "completed")),
        gate("Scorecard submitted", list.some(scorecardIn)),
      ];
    }
    case "decision": {
      const scheduled = myInterviews.filter((i) => i.status === "scheduled");
      const completed = myInterviews.filter((i) => i.status === "completed");
      const debriefLogged = ctx.events.some(
        (e) =>
          e.candidate_id === candidate.id &&
          e.from_stage === "decision" &&
          (e.to_stage === "decision" || has(e.rationale)),
      );
      return [
        gate("All interviews completed", scheduled.length === 0 && completed.length > 0),
        gate("Every scorecard submitted", completed.every(scorecardIn)),
        gate("Debrief decision logged", debriefLogged),
      ];
    }
    case "offer":
      return [
        gate("Compensation approved", offerApproved(candidate.id, ctx.offers)),
        gate("Offer letter sent", offersFor(candidate.id, ctx.offers).some((o) => ["sent", "accepted"].includes(o.status))),
        gate("Candidate accepted verbally", offerAccepted(candidate.id, ctx.offers)),
      ];
    case "contract": {
      const mine = ctx.contracts.filter((c) => c.candidate_id === candidate.id);
      const signed = mine.some((c) =>
        ctx.signatures.some((s) => s.contract_id === c.id),
      );
      return [
        gate("Accepted offer on file", offerAccepted(candidate.id, ctx.offers)),
        gate("Contract shared with the candidate", mine.length > 0),
        gate("Contract signed by both parties", signed),
      ];
    }
    default:
      return [];
  }
}

export type StageRecord = {
  label: string;
  value: string;
  meta: string;
  ok: boolean;
};

/** Evidence rows for the record panel's "Records" list on one stage. */
export function stageRecords(
  candidate: Candidate,
  stageKey: string,
  ctx: {
    interviews: Interview[];
    offers: Offer[];
    contracts: Contract[];
    signatures: ContractSignature[];
  },
): StageRecord[] {
  const ok = (label: string, value: string, done: boolean): StageRecord => ({
    label,
    value,
    meta: done ? "✓ On file" : "Pending",
    ok: done,
  });
  const kindLabel = (kind: string) =>
    kind === "hr"
      ? "HR interview"
      : kind === "technical"
        ? "Technical interview"
        : "Client presentation";

  switch (stageKey) {
    case "application":
      return [
        {
          label: "Source",
          value:
            candidate.referrer && candidate.source === "referral"
              ? `Referral · ${candidate.referrer}`
              : candidate.source.replace(/_/g, " "),
          meta: "✓ Logged",
          ok: true,
        },
        ok(
          "Role match",
          candidate.match_score !== null
            ? `${candidate.match_score}% skills overlap · advisory only`
            : "Not computed yet",
          candidate.match_score !== null,
        ),
        ok("Recruiter note", candidate.notes || "No note yet", has(candidate.notes)),
      ];
    case "matching":
      return [
        ok(
          "Match score",
          candidate.match_score !== null ? `${candidate.match_score}%` : "Not computed",
          candidate.match_score !== null,
        ),
        ok("Explanation", candidate.match_explanation || "Missing", has(candidate.match_explanation)),
        ok(
          "Recommendation",
          candidate.screening_recommendation || "Not recorded",
          has(candidate.screening_recommendation),
        ),
      ];
    case "screening":
      return [
        ok("Screening summary", candidate.screening_summary || "Not written", has(candidate.screening_summary)),
        ok(
          "Recommendation",
          candidate.screening_recommendation || "Not recorded",
          has(candidate.screening_recommendation),
        ),
        ok("Recruiter note", candidate.notes || "No note yet", has(candidate.notes)),
      ];
    case "hr_interview":
    case "technical_interview":
    case "client_presentation": {
      const kind =
        stageKey === "hr_interview"
          ? "hr"
          : stageKey === "technical_interview"
            ? "technical"
            : "client";
      const list = interviewsFor(candidate.id, kind, ctx.interviews);
      if (!list.length)
        return [
          {
            label: kindLabel(kind),
            value: "Not scheduled",
            meta: "To schedule",
            ok: false,
          },
        ];
      return list.map((i) => {
        const done = i.status === "completed";
        const ratings = scorecardOf(i)
          .map((e) => e.rating)
          .filter((r): r is number => typeof r === "number");
        const avg =
          ratings.length && done
            ? ` · ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}/5`
            : "";
        return {
          label: kindLabel(kind),
          value: i.panel || "Panel TBC",
          meta: `${done ? "✓ " : ""}${i.status}${avg}`,
          ok: done,
        };
      });
    }
    case "decision": {
      const my = ctx.interviews.filter((i) => i.candidate_id === candidate.id);
      const completed = my.filter((i) => i.status === "completed");
      const cards = completed.filter(scorecardIn).length;
      return [
        ok(
          "Interviews held",
          `${completed.length} of ${my.length || "—"}`,
          my.length > 0 && completed.length === my.length,
        ),
        ok("Scorecards in", `${cards} of ${completed.length || "—"}`, my.length > 0 && cards === completed.length && completed.length > 0),
        ok("Scheduled outstanding", `${my.filter((i) => i.status === "scheduled").length} pending`, my.every((i) => i.status !== "scheduled")),
      ];
    }
    case "offer": {
      const list = offersFor(candidate.id, ctx.offers);
      if (!list.length)
        return [
          {
            label: "Offer",
            value: "No offer drafted",
            meta: "Draft in Offers",
            ok: false,
          },
        ];
      return list.map((o) => ({
        label: o.title,
        value: `€${o.salary_monthly.toLocaleString("en-US")}/mo · margin ${o.margin_pct}%`,
        meta: `${["approved", "sent", "accepted"].includes(o.status) ? "✓ " : ""}${o.status.replace(/_/g, " ")}`,
        ok: ["approved", "sent", "accepted"].includes(o.status),
      }));
    }
    case "contract": {
      const mine = ctx.contracts.filter((c) => c.candidate_id === candidate.id);
      if (!mine.length)
        return [
          {
            label: "Contract",
            value: "Nothing shared yet",
            meta: "Share in Contracts",
            ok: false,
          },
        ];
      return mine.map((c) => {
        const signed = ctx.signatures.some((s) => s.contract_id === c.id);
        return {
          label: c.title,
          value: signed
            ? `Signed by ${ctx.signatures.find((s) => s.contract_id === c.id)?.signer_name ?? "candidate"}`
            : "Awaiting signature",
          meta: signed ? "✓ Signed" : "Sent",
          ok: signed,
        };
      });
    }
    default:
      return [];
  }
}

export type HistoryEntry = {
  id: string;
  kind: "stage" | "note" | "disposition" | "interview";
  stageKey: string;
  author: string;
  when: string;
  text: string;
};

const KIND_LABEL: Record<HistoryEntry["kind"], string> = {
  stage: "Stage change",
  note: "Note",
  disposition: "Disposition",
  interview: "Interview",
};

export const historyKindLabel = (kind: HistoryEntry["kind"]) => KIND_LABEL[kind];

/**
 * Append-only timeline for the record panel: pipeline events (stage moves,
 * notes, dispositions) merged with interviews, newest first.
 */
export function historyFor(
  candidate: Candidate,
  events: PipelineEvent[],
  interviews: Interview[],
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const e of events) {
    if (e.candidate_id !== candidate.id) continue;
    const disposition = DISPOSITION_STAGES.has(e.to_stage ?? "");
    const kind: HistoryEntry["kind"] = disposition
      ? "disposition"
      : (e.from_stage ?? "") === (e.to_stage ?? "")
        ? "note"
        : "stage";
    out.push({
      id: `e${e.id}`,
      kind,
      stageKey:
        kind === "note" ? (e.from_stage ?? "") : (e.to_stage ?? e.from_stage ?? ""),
      author: e.actor_email,
      when: e.created_at,
      text: e.rationale || (kind === "note" ? "Note" : `Moved to ${e.to_stage}`),
    });
  }
  for (const i of interviews) {
    if (i.candidate_id !== candidate.id) continue;
    const ratings = scorecardOf(i)
      .map((e) => e.rating)
      .filter((r): r is number => typeof r === "number");
    const avg = ratings.length
      ? ` · ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)}/5`
      : "";
    out.push({
      id: `i${i.id}`,
      kind: "interview",
      stageKey: interviewStageKey(i.kind),
      author: i.panel || "Panel TBC",
      when: i.created_at,
      text: `${i.kind === "hr" ? "HR interview" : i.kind === "technical" ? "Technical interview" : "Client presentation"}${avg} · ${i.status}`,
    });
  }
  return out.sort(
    (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
  );
}
