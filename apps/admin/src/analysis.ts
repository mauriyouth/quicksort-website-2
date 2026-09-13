import { z } from "zod";
export const MAX_CV_BYTES = 3 * 1024 * 1024;
export const MAX_BATCH_FILES = 100;
export const CRITERIA = ["Relevant skills", "Relevant experience", "Demonstrated outcomes", "Tools and methods", "Required qualifications", "Role-specific knowledge"] as const;
export const analysisRequest = z.object({
  jobId: z.string().uuid(), expectedUpdatedAt: z.string().optional(), requestId: z.string().uuid().optional(),
  cv: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().trim().min(50).max(60000) }),
    z.object({ kind: z.literal("pdf"), data: z.string().min(8).max(MAX_CV_BYTES * 4 / 3).regex(/^[A-Za-z0-9+/]+={0,2}$/), name: z.string().max(250) }),
    z.object({ kind: z.literal("document"), id: z.string().uuid() }),
  ]),
}).strict();
const finding = z.object({ aspect: z.string(), assessment: z.string(), evidence: z.string(), followUp: z.string() });
const question = z.object({ question: z.string(), context: z.string(), listenFor: z.string() });
export const evaluationSchema = z.object({
  candidateName: z.string(), headline: z.string(), summary: z.string(), confidence: z.enum(["low", "medium", "high"]),
  scorecards: z.array(z.object({ criterion: z.enum(CRITERIA), requirement: z.string(), score: z.number().int().min(0).max(5).nullable(), evidence: z.string(), rationale: z.string() })).length(6),
  advantages: z.array(finding).max(4), disadvantages: z.array(finding).max(4), risks: z.array(finding).max(4), aspectCritiques: z.array(finding).max(4),
  experienceQuestions: z.array(question).max(5), gapQuestions: z.array(question).max(5),
});
export type Evaluation = z.infer<typeof evaluationSchema>;
export type AnalysisRequest = z.infer<typeof analysisRequest>;
export type Report = { job: { id: string; title: string; updated_at: string }; evaluation: Evaluation; analyzedAt: string; model: string };
export type CandidateResult = { id: string; fileName: string; report: Report };
export function matchMetrics(evaluation: Evaluation) {
  const assessed = evaluation.scorecards.filter(s => s.score !== null);
  return { score: Math.round(assessed.reduce((total, s) => total + (s.score || 0), 0) / 30 * 100), coverage: Math.round(assessed.length / 6 * 100), assessable: assessed.length > 0 };
}
export function topProfiles(results: CandidateResult[]) {
  return results.filter(r => matchMetrics(r.report.evaluation).assessable).sort((a, b) => {
    const first = matchMetrics(a.report.evaluation), second = matchMetrics(b.report.evaluation);
    return second.score - first.score || second.coverage - first.coverage || a.id.localeCompare(b.id);
  }).slice(0, 10);
}
