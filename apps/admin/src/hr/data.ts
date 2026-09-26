import { db, errorMessage } from "@quicksort/hr-db";
import type { Row } from "@quicksort/hr-db";

export type Candidate = Row<"pipeline_candidates">;
export type Opportunity = Row<"opportunities">;
export type PipelineEvent = Row<"pipeline_events">;
export type Interview = Row<"interviews">;
export type Offer = Row<"offers">;
export type OnboardingItem = Row<"onboarding_items">;
export type Review = Row<"reviews">;
export type OffboardingRecord = Row<"offboarding_records">;
export type OffboardingItem = Row<"offboarding_items">;
export type CandidateRequest = Row<"candidate_requests">;
export type Contract = Row<"contracts">;
export type ContractSignature = Row<"contract_signatures">;

export type ScorecardEntry = {
  competency: string;
  rating: number | null;
  evidence: string;
};

export const emptyScorecard = (): ScorecardEntry[] => [
  { competency: "Technical skills", rating: null, evidence: "" },
  { competency: "Communication", rating: null, evidence: "" },
  { competency: "Motivation & fit", rating: null, evidence: "" },
];

export function parseScorecard(json: unknown): ScorecardEntry[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e) => ({
      competency: String(e.competency ?? ""),
      rating: typeof e.rating === "number" ? e.rating : null,
      evidence: String(e.evidence ?? ""),
    }));
}

/**
 * Gated transition check (prd-hr.md §3.2 rule 2). Returns an error message when
 * the move is blocked, or null when allowed.
 */
export function gateError(
  toStage: string,
  candidate: Candidate,
  offers: Offer[],
): string | null {
  if (toStage === "hr_interview" && !candidate.screening_summary.trim())
    return "Gated: complete the screening record before the HR interview.";
  const candidateOffers = offers.filter((o) => o.candidate_id === candidate.id);
  const approved = candidateOffers.some((o) =>
    ["approved", "sent", "accepted"].includes(o.status),
  );
  if (toStage === "offer" && !approved)
    return "Gated: an approved offer is required before entering Offer.";
  const accepted = candidateOffers.some((o) => o.status === "accepted");
  if (toStage === "contract" && !accepted)
    return "Gated: the offer must be accepted before the contract stage.";
  if (["preboarding", "onboarding", "probation", "confirmed"].includes(toStage))
    return "Gated: use “Mark as hired” on the candidate record to convert to an employee.";
  return null;
}

/** Move a candidate to a new stage and append the immutable event. */
export async function transitionCandidate(
  candidate: Candidate,
  toStage: string,
  actorEmail: string,
  rationale: string,
  offers: Offer[],
) {
  const gate = gateError(toStage, candidate, offers);
  if (gate) throw new Error(gate);
  const now = new Date().toISOString();
  const moved = await db()
    .from("pipeline_candidates")
    .update({ stage: toStage, updated_at: now })
    .eq("id", candidate.id)
    .select("id")
    .single();
  if (moved.error) throw moved.error;
  const event = await db()
    .from("pipeline_events")
    .insert({
      candidate_id: candidate.id,
      from_stage: candidate.stage,
      to_stage: toStage,
      actor_email: actorEmail,
      rationale,
    })
    .select("id")
    .single();
  if (event.error) throw event.error;
}

/** A candidate leaves the funnel only via a logged human disposition (§3.2 rule 3). */
export async function dispositionCandidate(
  candidate: Candidate,
  disposition: "rejected" | "withdrawn",
  reason: string,
  actorEmail: string,
) {
  if (!reason.trim()) throw new Error("A disposition reason is required.");
  const now = new Date().toISOString();
  const updated = await db()
    .from("pipeline_candidates")
    .update({
      disposition,
      disposition_reason: reason.trim(),
      updated_at: now,
    })
    .eq("id", candidate.id)
    .select("id")
    .single();
  if (updated.error) throw updated.error;
  const event = await db()
    .from("pipeline_events")
    .insert({
      candidate_id: candidate.id,
      from_stage: candidate.stage,
      to_stage: disposition,
      actor_email: actorEmail,
      rationale: reason.trim(),
    })
    .select("id")
    .single();
  if (event.error) throw event.error;
}

export { errorMessage };
