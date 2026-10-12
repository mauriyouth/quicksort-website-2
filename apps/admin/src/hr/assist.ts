import { z } from "zod";

export const assistanceRequestSchema = z.object({
  kind: z.enum(["interview_prep", "onboarding_plan", "staffing_match", "handover", "alumni_reconnect"]),
  person_id: z.uuid(),
  application_id: z.uuid().optional(),
  employee_id: z.uuid().optional(),
}).strict();

export const assistancePayloadSchema = z.object({
  summary: z.string().min(1).max(3000),
  items: z.array(z.object({
    title: z.string().min(1).max(200),
    detail: z.string().min(1).max(2000),
    source_ids: z.array(z.uuid()).max(20),
  })).min(1).max(12),
});

export const assistanceSourceSchema = z.object({ type: z.string(), id: z.uuid(), version: z.number().int().nonnegative() });
export const assistanceResponseSchema = z.object({
  suggestion_id: z.uuid(),
  payload: assistancePayloadSchema,
  sources: z.array(assistanceSourceSchema),
});
export type AssistanceRequest = z.infer<typeof assistanceRequestSchema>;
export type AssistanceResult = z.infer<typeof assistanceResponseSchema>;

export async function generateSuggestion({ token, ...input }: AssistanceRequest & { token: string }): Promise<AssistanceResult> {
  const response = await fetch("/api/hr-assist", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(assistanceRequestSchema.parse(input)),
    signal: AbortSignal.timeout(110000),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(result);
    throw new Error(failure.success ? failure.data.error : "The suggestion could not be generated.");
  }
  return assistanceResponseSchema.parse(result);
}
