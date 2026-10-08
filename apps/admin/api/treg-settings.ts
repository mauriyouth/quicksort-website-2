import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { encryptApiKey, settingsReady } from "../server/ai-settings.ts";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
const inputSchema = z.object({ token: z.string().trim().min(12).max(2000) });

export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "PUT", "DELETE"].includes(req.method || "")) { res.setHeader("Allow", "GET, PUT, DELETE"); return res.status(405).json({ error: "Method not allowed." }); }
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage tool access." });
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
  try {
    const client = createClient(url, key, { accessToken: async () => authorization.slice(7) });
    const identity = await client.rpc("sync_clerk_profile");
    if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
    const owner = await client.from("portal_owners").select("user_id").eq("user_id", identity.data).maybeSingle();
    if (owner.error || !owner.data) return res.status(403).json({ error: "Only portal owners can manage tool access." });
    if (req.method === "GET") {
      const { data, error } = await client.from("ai_settings").select("updated_at").eq("id", "business-treg").maybeSingle();
      if (error) throw error;
      return res.status(200).json({ configured: Boolean(data || process.env.TREG_TOKEN), source: data ? "settings" : process.env.TREG_TOKEN ? "environment" : "none", updatedAt: data?.updated_at || null, canSave: settingsReady() });
    }
    if (req.method === "DELETE") {
      const result = await client.from("ai_settings").delete().eq("id", "business-treg");
      if (result.error) throw result.error;
      return res.status(200).json({ saved: false });
    }
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid Treg agent token." });
    if (!settingsReady()) return res.status(503).json({ error: "Set AI_SETTINGS_ENCRYPTION_KEY on the server before saving tool credentials." });
    const result = await client.from("ai_settings").upsert({ id: "business-treg", encrypted_key: encryptApiKey(parsed.data.token), model: "treg.people.enrich", updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (result.error) throw result.error;
    return res.status(200).json({ saved: true });
  } catch { return res.status(502).json({ error: "Could not update Treg access. Please try again." }); }
}
