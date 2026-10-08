import { createClient } from "@supabase/supabase-js";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { loadAiSettings } from "../server/ai-settings.ts";
import { enrichWithTreg } from "../server/treg.ts";

export const config = { maxDuration: 120 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
const requestSchema = z.object({ event: z.object({ id: z.string().min(1).max(200), title: z.string().min(1).max(300) }), attendees: z.array(z.object({ name: z.string().max(200), role: z.string().max(300), company: z.string().max(300), linkedin: z.string().max(500), email: z.string().max(320), custom: z.record(z.string(), z.string().max(1500)) })).min(1).max(300) });
const outputSchema = z.object({ summary: z.string().max(1800), priorityPeople: z.array(z.object({ name: z.string().max(200), company: z.string().max(300), role: z.string().max(300), category: z.enum(["Professional", "Founder", "Student", "Unknown"]), confidence: z.enum(["High", "Medium", "Low"]), fitScore: z.number().int().min(0).max(100), why: z.string().max(900), reachOut: z.string().max(900), seniorContact: z.string().max(500), linkedin: z.string().max(500), email: z.string().max(320), publicEvidence: z.string().max(900) })).max(30), organisations: z.array(z.object({ name: z.string().max(300), attendeeCount: z.number().int().min(1), relevance: z.string().max(900), decisionMakerRoles: z.array(z.string().max(200)).max(8), nextStep: z.string().max(900) })).max(30), segments: z.array(z.object({ name: z.string().max(200), count: z.number().int().min(0), reason: z.string().max(600) })).max(12), recommendations: z.array(z.string().max(700)).max(12), researchSources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000) })).max(40) });

export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store"); if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const authorization = req.headers.authorization; if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to analyze events." });
  const parsed = requestSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Provide a mapped attendee list with no more than 300 people." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL; const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY; if (!url || !key) return res.status(503).json({ error: "The Admin workspace connection is not configured." });
  try {
    const client = createClient(url, key, { accessToken: async () => authorization.slice(7) }); const identity = await client.rpc("sync_clerk_profile"); if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
    const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single(); if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Business admin access is required." });
    const settings = await loadAiSettings(client); if (!settings.apiKey) return res.status(503).json({ error: "Add an OpenAI API key in Admin → AI configuration." });
    const enrichment = await enrichWithTreg(parsed.data.attendees, parsed.data.event.id);
    const { output } = await generateText({ model: createOpenAI({ apiKey: settings.apiKey })(settings.model), instructions: "You are QuickSort's GTM event analyst. Personal email addresses are normal for Luma and must never reduce fit or imply student status. Use uploaded fields and supplied public professional-profile evidence to distinguish professionals, founders, students, and unknowns. Never merge people only because their names match. Rank B2B prospects, map represented organisations, identify likely buyer or decision-maker roles, colleagues already present in the attendee list, and specific human-reviewed outreach. Do not claim access to private LinkedIn data. Put only URLs actually present in supplied evidence in researchSources. Mark uncertain facts Low confidence. Never infer sensitive personal traits.", prompt: JSON.stringify({ ...parsed.data, publicProfessionalEnrichment: enrichment.profiles }), output: Output.object({ schema: outputSchema }), maxOutputTokens: 10000, maxRetries: 1, abortSignal: AbortSignal.timeout(100000), providerOptions: { openai: { store: false } } });
    return res.status(200).json({ ...outputSchema.parse(output), model: settings.model, analyzedAt: new Date().toISOString(), enrichmentProvider: enrichment.provider });
  } catch (problem) { return res.status(502).json({ error: problem instanceof Error && problem.message === "Backend research is not configured." ? problem.message : "Event intelligence could not be completed. Check the backend connection and AI configuration, then try again." }); }
}
