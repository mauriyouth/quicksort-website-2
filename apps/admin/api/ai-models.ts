import { z } from "zod";
import { requirePortalOwner } from "../server/portal-auth.ts";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

const inputSchema = z.object({ apiKey: z.string().trim().min(20).max(1000).regex(/^sk-[^\s]+$/) });
// Chat-capable model families only; newest first so the select leads with current models.
const KEEP = /^(gpt-|o\d|chatgpt-)/i;
const SKIP = /embedding|whisper|tts|dall-e|realtime|audio|moderation|image|transcrib|search/i;

export function createModelsHandler() {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
    const auth = await requirePortalOwner(req.headers.authorization);
    if ("error" in auth) return res.status(auth.status).json({ error: auth.error });
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter an OpenAI API key starting with sk-." });
    try {
      const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${parsed.data.apiKey}` }, signal: AbortSignal.timeout(15_000) });
      if (response.status === 401 || response.status === 403) return res.status(502).json({ error: "OpenAI rejected this API key. Check the key and try again." });
      if (!response.ok) return res.status(502).json({ error: `OpenAI model list request failed (HTTP ${response.status}).` });
      const payload = await response.json() as { data?: { id?: string; created?: number }[] };
      const models = (payload.data || [])
        .map(entry => ({ id: String(entry.id || ""), created: Number(entry.created) || 0 }))
        .filter(entry => KEEP.test(entry.id) && !SKIP.test(entry.id))
        .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
        .map(entry => entry.id);
      if (!models.length) return res.status(502).json({ error: "OpenAI returned no usable chat models for this key." });
      return res.status(200).json({ models });
    } catch {
      return res.status(502).json({ error: "Could not reach OpenAI to list models. Please try again." });
    }
  };
}
export default createModelsHandler();
