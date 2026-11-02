import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { loadAiSettings } from "../server/ai-settings.ts";
import { classifyAiFailure } from "../server/ai-failure.ts";

export const config = { maxDuration: 60 };

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): Response };

/** Serverless bodies cap around 4.5 MB and base64 inflates ~4/3 — keep raw files at 3 MB. */
export const MAX_EXTRACT_BYTES = 3 * 1024 * 1024;

const extractRequest = z.object({
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().max(100),
  data: z.string().base64(),
});

/** What we want off the paper: day-level dates, ISO, null when absent or unreadable. */
const datesSchema = z.object({
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM_INSTRUCTIONS = `You read administrative documents (French mostly: carte vitale, carte d'identité, passeport, titre de séjour, attestations, KBIS, contracts) and pull two dates off them.
- "issuedOn": the issuance/delivery/establishment date ("Date d'émission", "Délivré le", "Fait le", "Établi le").
- "expiresOn": the expiration/validity-end date ("Date d'expiration", "Expire le", "Fin de validité", "Valable jusqu'au").
Answer in ISO format YYYY-MM-DD, the day actually printed on the document (French documents print DD/MM/YYYY). Use null for a date that is absent, illegible or not applicable — never guess, never invent, and never treat a birth date ("Date de naissance") as an issuance date.`;

export function createExtractor(deps = { createClient, generateText, loadAiSettings }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to extract dates." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "The documents service needs its portal connection configured." });
    let configuredModel: string | null = null;
    try {
      // Supabase verifies the Clerk token and applies RLS — same user as their browser.
      const client = deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || !["admin", "hr"].includes(role.data?.role || "")) return res.status(403).json({ error: "HR access is required." });
      const parsed = extractRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Send the document as base64 with its file name and MIME type." });
      const input = parsed.data;
      if (input.mimeType !== "application/pdf" && !IMAGE_TYPES.has(input.mimeType))
        return res.status(400).json({ error: "Date extraction works on PDFs and images (JPEG, PNG, GIF, WebP)." });
      const bytes = Buffer.from(input.data, "base64");
      if (bytes.length > MAX_EXTRACT_BYTES) return res.status(400).json({ error: "The file is too large to scan for dates." });
      const aiSettings = await deps.loadAiSettings(client);
      configuredModel = aiSettings.model;
      if (!aiSettings.apiKey) return res.status(503).json({ error: "Configure the AI connection in Settings → AI configuration." });
      const model = createOpenAI({ apiKey: aiSettings.apiKey })(aiSettings.model);
      const common = {
        model,
        instructions: SYSTEM_INSTRUCTIONS,
        output: Output.object({ schema: datesSchema }),
        maxOutputTokens: 400,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(45_000),
        providerOptions: { openai: { store: false } },
      } as const;
      const text = `File: ${input.fileName}. Read the attached document and extract its issuance and expiration dates.`;
      // Both part types ride as files; the mediaType distinguishes them.
      const { output } = input.mimeType === "application/pdf"
        ? await deps.generateText({
            ...common,
            messages: [{ role: "user", content: [
              { type: "text" as const, text },
              { type: "file" as const, data: bytes, mediaType: "application/pdf" as const },
            ] }],
          })
        : await deps.generateText({
            ...common,
            messages: [{ role: "user", content: [
              { type: "text" as const, text },
              { type: "file" as const, data: bytes, mediaType: input.mimeType as "image/jpeg" },
            ] }],
          });
      const dates = datesSchema.parse(output);
      return res.status(200).json({ ...dates, model: aiSettings.model });
    } catch (failure) {
      const { log, client: message } = classifyAiFailure(failure, {
        model: configuredModel,
        fallback: "Dates could not be read from this file. Fill them in by hand.",
      });
      console.error(`[documents-extract] ${log}`);
      return res.status(502).json({ error: message });
    }
  };
}
export default createExtractor();
