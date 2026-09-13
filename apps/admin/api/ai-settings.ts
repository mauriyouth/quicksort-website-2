import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { encryptApiKey, settingsReady } from "../server/ai-settings.ts";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
const inputSchema = z.object({ apiKey: z.string().trim().min(20).max(1000).regex(/^sk-[^\s]+$/), model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/) });
export function createSettingsHandler(deps = { createClient }) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "PUT", "DELETE"].includes(req.method || "")) { res.setHeader("Allow", "GET, PUT, DELETE"); return res.status(405).json({ error: "Method not allowed." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage AI settings." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const owner = await client.from("portal_owners").select("user_id").eq("user_id", identity.data).maybeSingle();
      if (owner.error || !owner.data) return res.status(403).json({ error: "Only portal owners can manage the AI key." });
      if (req.method === "GET") {
        const { data, error } = await client.from("ai_settings").select("model,updated_at").eq("id", "cv-analyzer").maybeSingle();
        if (error) return res.status(503).json({ error: "AI settings storage is not ready. Apply the AI settings database migration." });
        return res.status(200).json({ configured: Boolean(data || process.env.OPENAI_API_KEY), source: data ? "settings" : process.env.OPENAI_API_KEY ? "environment" : "none", model: data?.model || process.env.CV_ANALYZER_MODEL || "gpt-4.1-mini", updatedAt: data?.updated_at || null, canSave: settingsReady() });
      }
      if (req.method === "DELETE") {
        const result = await client.from("ai_settings").delete().eq("id", "cv-analyzer");
        if (result.error) throw result.error;
        return res.status(200).json({ saved: false });
      }
      if (!settingsReady()) return res.status(503).json({ error: "Set AI_SETTINGS_ENCRYPTION_KEY on the server before saving API keys." });
      const parsed = inputSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Enter an OpenAI API key starting with sk- and a valid model ID." });
      const result = await client.from("ai_settings").upsert({ id: "cv-analyzer", encrypted_key: encryptApiKey(parsed.data.apiKey), model: parsed.data.model, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (result.error) throw result.error;
      return res.status(200).json({ saved: true });
    } catch { return res.status(502).json({ error: "Could not update AI settings. Please try again." }); }
  };
}
export default createSettingsHandler();
