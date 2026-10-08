import { createClient } from "@supabase/supabase-js";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { loadAiSettings } from "../server/ai-settings.ts";
import { callTreg, loadTregSettings } from "../server/treg.ts";

export const config = { maxDuration: 120 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
const inputSchema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("website"), url: z.string().url().max(1000) }), z.object({ mode: z.literal("discover"), market: z.string().trim().min(2).max(300) })]);
const competitor = z.object({ name: z.string().max(200), url: z.string().url().max(1000), location: z.string().max(200), summary: z.string().max(1200), positioning: z.string().max(900), audience: z.string().max(700), services: z.array(z.string().max(200)).max(12), differentiators: z.array(z.string().max(400)).max(10), threats: z.array(z.string().max(500)).max(8), opportunities: z.array(z.string().max(500)).max(8), evidence: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000) })).max(20) });
const outputSchema = z.object({ competitors: z.array(competitor).max(12), marketSummary: z.string().max(1800) });

export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store"); if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const authorization = req.headers.authorization; if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to research competitors." });
  const parsed = inputSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Enter a valid competitor URL or market description." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL; const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY; if (!url || !key) return res.status(503).json({ error: "The Admin workspace connection is not configured." });
  try {
    const client = createClient(url, key, { accessToken: async () => authorization.slice(7) }); const identity = await client.rpc("sync_clerk_profile"); if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
    const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single(); if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Business admin access is required." });
    const [{ apiKey, model }, { token }] = await Promise.all([loadAiSettings(client), loadTregSettings(client)]); if (!apiKey) return res.status(503).json({ error: "Add an OpenAI API key in Admin → AI configuration." }); if (!token) return res.status(503).json({ error: "Connect Treg in Admin → Settings." });
    const source = parsed.data.mode === "website" ? await callTreg(token, "treg.web.extract", { url: parsed.data.url }, "workspace=business,feature=competitors", "0.20") : await callTreg(token, "treg.web.search", { q: `${parsed.data.market} competitors alternatives similar companies websites`, limit: 10 }, "workspace=business,feature=competitors", "0.20");
    const { output } = await generateText({ model: createOpenAI({ apiKey })(model), instructions: "You are QuickSort's competitor analyst. Use only the supplied Treg website/search evidence. For website mode return exactly one researched company. For discovery mode return close service competitors, not software vendors, directories, news articles, or QuickSort itself. Focus on Paris and France when supported. Be concise and evidence-grounded; leave arrays empty rather than inventing facts.", prompt: JSON.stringify({ request: parsed.data, quicksortContext: "QuickSort is an AI engineering and consulting company spanning AI for Business, Infrastructure for AI, Data for AI, and Voice AI.", tregEvidence: source }), output: Output.object({ schema: outputSchema }), maxOutputTokens: 8000, maxRetries: 1, abortSignal: AbortSignal.timeout(90000), providerOptions: { openai: { store: false } } });
    return res.status(200).json({ ...outputSchema.parse(output), model, provider: "Treg", analyzedAt: new Date().toISOString() });
  } catch { return res.status(502).json({ error: "Competitor intelligence could not be completed. Check Treg and AI settings, then try again." }); }
}
