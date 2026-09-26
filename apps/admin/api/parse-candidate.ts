import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { loadAiSettings } from "../server/ai-settings.ts";
import { createClient } from "@supabase/supabase-js";
import {
  intakeRequest,
  INTAKE_SYSTEM_INSTRUCTIONS,
  MAX_INTAKE_PDF_BYTES,
  parsedProfileSchema,
} from "../src/candidate-intake.ts";

export const config = { maxDuration: 60 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

export function createParser(deps = { createClient, generateText, loadAiSettings }) {
return async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to parse profiles." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ error: "The portal connection is not configured." });
  try {
    // Supabase verifies the Clerk token and applies the existing RLS policies.
    // Never use a service-role key here or trust a role supplied by the browser.
    const client = await deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
    const identity = await client.rpc("sync_clerk_profile");
    if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
    const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
    if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });
    const parsed = intakeRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a PDF up to 3 MB, or profile text between 50 and 60,000 characters (LinkedIn: profile URL plus pasted sections)." });
    const input = parsed.data.profile;
    const aiSettings = await deps.loadAiSettings(client);
    if (!aiSettings.apiKey) return res.status(503).json({ error: "Add an OpenAI API key in Settings → AI configuration." });
    const pdf = input.kind === "pdf" ? Buffer.from(input.data, "base64") : null;
    if (pdf && (pdf.length > MAX_INTAKE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-")) return res.status(400).json({ error: "Upload a valid PDF up to 3 MB." });
    const sourceLabel = input.kind === "pdf" ? `resume PDF "${input.name}"` : input.kind === "linkedin" ? "LinkedIn profile" : "pasted CV text";
    const { output } = await deps.generateText({
      model: createOpenAI({ apiKey: aiSettings.apiKey })(aiSettings.model),
      instructions: INTAKE_SYSTEM_INSTRUCTIONS,
      output: Output.object({ schema: parsedProfileSchema }),
      messages: [{ role: "user", content: [
        { type: "text", text: `Extract the candidate profile from this ${sourceLabel}.${input.kind === "linkedin" && input.url ? ` Profile URL provided by the recruiter (verify it matches the source): ${input.url}.` : ""}${input.kind !== "pdf" ? "\n\n" + input.text : ""}` },
        ...(pdf ? [{ type: "file" as const, data: pdf, mediaType: "application/pdf" as const }] : []),
      ] }],
      maxOutputTokens: 1800, maxRetries: 1, abortSignal: AbortSignal.timeout(50000),
      providerOptions: { openai: { store: false } },
    });
    return res.status(200).json({ profile: parsedProfileSchema.parse(output), model: aiSettings.model });
  } catch {
    // Do not log CVs, prompts, tokens, or provider request/response bodies.
    return res.status(502).json({ error: "The profile could not be parsed. Try again or paste the profile text." });
  }
}
}
export default createParser();
