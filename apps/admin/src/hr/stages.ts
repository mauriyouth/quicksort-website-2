// Canonical pipeline stage model — prd-hr.md §3.1.
// Every stage has one accountable owner, a default SLA in days, and the
// Kanban operating model (§3.2) renders stages 3-11 as drag-and-drop columns.

export type Stage = {
  key: string;
  label: string;
  owner: string;
  slaDays: number | null;
};

export const STAGES: Stage[] = [
  { key: "opportunity", label: "Job opportunity", owner: "Hiring Manager (BM)", slaDays: 2 },
  { key: "published", label: "Published / sourcing", owner: "Recruiter", slaDays: 1 },
  { key: "application", label: "Application / intake", owner: "System → Recruiter", slaDays: 2 },
  { key: "matching", label: "AI matching", owner: "AI (recruiter reviews)", slaDays: null },
  { key: "screening", label: "AI initial screening", owner: "AI + Recruiter", slaDays: 2 },
  { key: "hr_interview", label: "HR interview", owner: "Recruiter / HR", slaDays: 5 },
  { key: "technical_interview", label: "Technical interview", owner: "Tech interviewer", slaDays: 7 },
  { key: "client_presentation", label: "Client presentation", owner: "Hiring Manager (BM)", slaDays: 1 },
  { key: "decision", label: "Decision", owner: "Hiring Mgr / BU Director", slaDays: 2 },
  { key: "offer", label: "Offer", owner: "HR + BM", slaDays: 2 },
  { key: "contract", label: "Contract signed", owner: "HR", slaDays: null },
  { key: "preboarding", label: "Pre-boarding", owner: "HR", slaDays: null },
  { key: "onboarding", label: "Onboarding", owner: "Manager + parrain", slaDays: 30 },
  { key: "probation", label: "Hired (probation)", owner: "Manager", slaDays: null },
  { key: "confirmed", label: "Confirmed", owner: "HR", slaDays: null },
  { key: "offboarding", label: "Offboarding", owner: "HR + Manager", slaDays: null },
];

// Stages 3-11 render as the recruitment Kanban (prd-hr.md §3.2).
export const KANBAN_STAGES = STAGES.slice(2, 11);

export const stageLabel = (key: string) =>
  STAGES.find((s) => s.key === key)?.label ?? key;

export const stageSla = (key: string) =>
  STAGES.find((s) => s.key === key)?.slaDays ?? null;

export const DISPOSITIONS = [
  { key: "rejected", label: "Rejected" },
  { key: "withdrawn", label: "Withdrawn" },
  { key: "hired", label: "Hired" },
] as const;

export const SOURCES = [
  { key: "career_site", label: "Career site" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "resume", label: "Resume drop" },
  { key: "referral", label: "Referral" },
  { key: "job_board", label: "Job board" },
  { key: "spontaneous", label: "Spontaneous" },
  { key: "rediscovery", label: "CVthèque rediscovery" },
  { key: "other", label: "Other" },
] as const;

export const sourceLabel = (key: string) =>
  SOURCES.find((s) => s.key === key)?.label ?? key;

/** Healthy gross-margin corridor of 25-40% of target TJM (prd-hr.md FR-5.3.3). */
export const MARGIN_CORRIDOR = { min: 25, max: 40 } as const;

export const marginPct = (cjm: number, targetTjm: number) =>
  targetTjm > 0 ? Math.round(((targetTjm - cjm) / targetTjm) * 1000) / 10 : 0;

export const inCorridor = (pct: number) =>
  pct >= MARGIN_CORRIDOR.min && pct <= MARGIN_CORRIDOR.max;

/** Dwell in days for a candidate's current stage, measured from their last event. */
export function dwellDays(
  updatedAt: string,
  events: { created_at: string }[],
): number {
  const last = events.length
    ? events[events.length - 1].created_at
    : updatedAt;
  return Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
}

/** "ok" | "warn" (>75% of SLA) | "breach" (past SLA). Null SLA stages never breach. */
export function slaState(stage: string, dwell: number): "ok" | "warn" | "breach" {
  const sla = stageSla(stage);
  if (sla === null) return "ok";
  if (dwell > sla) return "breach";
  if (dwell >= sla * 0.75) return "warn";
  return "ok";
}
