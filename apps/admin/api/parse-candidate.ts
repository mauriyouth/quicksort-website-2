import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { loadAiSettings } from "../server/ai-settings.ts";
import { classifyAiFailure } from "../server/ai-failure.ts";
import { createClient } from "@supabase/supabase-js";
import { createDriveStorage, loadDriveSettings } from "../server/documents/storage/google-drive.ts";
import { personCvs } from "../server/recruitment-cv.ts";
import { loadClassifierSettings } from "../server/bank/settings.ts";
import { extractPdfText } from "../server/cv-text.ts";
import { KimiError, kimiProfile } from "../server/kimi-profile.ts";
import {
  intakeRequest,
  INTAKE_SYSTEM_INSTRUCTIONS,
  MAX_INTAKE_PDF_BYTES,
  MAX_INTAKE_TEXT_CHARS,
  parsedProfileSchema,
} from "../src/candidate-intake.ts";

// Kimi answers a long CV more slowly than the old OpenAI path; the browser waits up to 115 s.
export const config = { maxDuration: 120 };
const BUDGET_MS = 100_000;
// Fewer characters than this from a PDF means no text layer (a scanned CV).
const MIN_PDF_TEXT = 200;
type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

/**
 * Resume / profile extraction. Kimi (Moonshot) by default, with the key from
 * Settings → Kimi (Moonshot): the PDF's text is read here and
 * only that text is sent. OpenAI (Settings → AI configuration) is the fallback
 * when no Kimi key is set, or for scanned PDFs, which it can read as images.
 */
const defaults = { createClient, generateText, loadAiSettings, loadKimiSettings: loadClassifierSettings, extractPdfText, kimiFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) };
export function createParser(overrides: Partial<typeof defaults> = {}) {
const deps = { ...defaults, ...overrides };
return async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to parse profiles." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ error: "The portal connection is not configured." });
  let configuredModel: string | null = null;
  try {
    // Supabase verifies the Clerk token and applies the existing RLS policies.
    // Never use a service-role key here or trust a role supplied by the browser.
    const client = await deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
    const identity = await client.rpc("sync_clerk_profile");
    if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
    const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
    if (role.error || !["admin", "hr"].includes(role.data?.role || "")) return res.status(403).json({ error: "HR access is required." });
    const parsed = intakeRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide a PDF up to 10 MB, or profile text between 50 and 60,000 characters (LinkedIn: profile URL plus pasted sections)." });
    const input = parsed.data.profile;
    let pdf: Buffer | null = null;
    let pdfName = input.kind === "pdf" || input.kind === "storage" ? input.name : "";
    if (input.kind === "drive") {
      const sa = await loadDriveSettings(client);
      if (!sa) return res.status(503).json({ error: "Google Drive is not connected. Set it up in Settings → Google Drive." });
      const [cv] = await personCvs(sa, input.personId);
      if (!cv) return res.status(404).json({ error: "No CV is filed on Google Drive for this person." });
      const download = await createDriveStorage(sa).download(cv.id);
      pdf = Buffer.from(await download.arrayBuffer());
      pdfName = cv.name;
    } else if (input.kind === "pdf") {
      pdf = Buffer.from(input.data, "base64");
    } else if (input.kind === "storage") {
      // RLS decides which bucket paths this user may read — same check as their own browser.
      const download = await client.storage.from("candidate-documents").download(input.path);
      if (download.error || !download.data) return res.status(404).json({ error: "Could not retrieve this resume. Upload it again." });
      pdf = Buffer.from(await download.data.arrayBuffer());
    }
    if (pdf && (pdf.length > MAX_INTAKE_PDF_BYTES || pdf.subarray(0, 5).toString() !== "%PDF-")) return res.status(400).json({ error: "Upload a valid PDF up to 10 MB." });
    const sourceLabel = pdf ? `resume PDF "${pdfName}"` : input.kind === "linkedin" ? "LinkedIn profile" : "pasted CV text";
    const linkedinHint = input.kind === "linkedin" && input.url ? ` Profile URL provided by the recruiter (verify it matches the source): ${input.url}.` : "";
    const kimi = await deps.loadKimiSettings(client).catch(() => ({ apiKey: "", model: "" }));
    let sourceText = input.kind === "text" || input.kind === "linkedin" ? input.text : "";
    if (pdf && kimi.apiKey) {
      sourceText = await deps.extractPdfText(new Uint8Array(pdf), MAX_INTAKE_TEXT_CHARS).catch(() => "");
    }
    if (kimi.apiKey && (!pdf || sourceText.length >= MIN_PDF_TEXT)) {
      configuredModel = kimi.model;
      const profile = await kimiProfile(kimi, `Extract the candidate profile from this ${sourceLabel}.${linkedinHint}\n\n${sourceText}`, Date.now() + BUDGET_MS, deps.kimiFetch);
      return res.status(200).json({ profile, model: kimi.model });
    }
    // OpenAI fallback: no Kimi key, or a PDF without a text layer.
    const aiSettings = await deps.loadAiSettings(client);
    configuredModel = aiSettings.model;
    if (!aiSettings.apiKey) {
      return res.status(503).json({ error: kimi.apiKey
        ? "This PDF has no selectable text (it looks scanned). Paste the profile text, or add an OpenAI API key in Settings → AI configuration to read scanned CVs."
        : "Add a Kimi API key in Settings → Kimi (Moonshot)." });
    }
    const { output } = await deps.generateText({
      model: createOpenAI({ apiKey: aiSettings.apiKey })(aiSettings.model),
      instructions: INTAKE_SYSTEM_INSTRUCTIONS,
      output: Output.object({ schema: parsedProfileSchema }),
      messages: [{ role: "user", content: [
        { type: "text", text: `Extract the candidate profile from this ${sourceLabel}.${linkedinHint}${sourceText ? "\n\n" + sourceText : ""}` },
        ...(pdf ? [{ type: "file" as const, data: pdf, mediaType: "application/pdf" as const }] : []),
      ] }],
      maxOutputTokens: 8000, maxRetries: 1, abortSignal: AbortSignal.timeout(50000),
      providerOptions: { openai: { store: false } },
    });
    return res.status(200).json({ profile: parsedProfileSchema.parse(output), model: aiSettings.model });
  } catch (failure) {
    // Log only a sanitized signature — never CVs, prompts, tokens, or provider bodies.
    if (failure instanceof KimiError) {
      console.error(`[parse-candidate] kimi status=${failure.status ?? 0} model=${configuredModel}: ${failure.message}${failure.issues ? ` issues=${failure.issues}` : ""}`);
      const status = failure.status ?? 0;
      return res.status(502).json({ error: status === 401 || status === 403
        ? "Moonshot rejected the saved Kimi API key. Update it in Settings → Kimi (Moonshot)."
        : status === 429 || status === 402
          ? "The Kimi account is rate-limited or out of credit. Wait a moment or top it up, then try again."
          : status ? "Kimi could not process the CV. Try again, or paste the profile text." : "Kimi returned an unreadable profile. Try again, or paste the profile text." });
    }
    const { log, client } = classifyAiFailure(failure, {
      model: configuredModel,
      fallback: "The profile could not be parsed. Try again or paste the profile text.",
    });
    console.error(`[parse-candidate] ${log}`);
    return res.status(502).json({ error: client });
  }
}
}
export default createParser();
