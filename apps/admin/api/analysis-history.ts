import { createClient } from "@supabase/supabase-js";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
export function createHistoryHandler(deps = { createClient }) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Use GET." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to view analysis history." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Portal connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });
      const id = req.query?.id;
      if (id !== undefined) {
        if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Invalid report ID." });
        const source = req.query?.source === "1";
        const result = await client.from("cv_evaluations").select(source ? "source_cv,file_name" : "id,file_name,report").eq("id", id).single();
        if (result.error || !result.data) return res.status(404).json({ error: "Saved evaluation unavailable." });
        return res.status(200).json(result.data);
      }
      const page = Number(req.query?.page || 0);
      const search = req.query?.search || "";
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || typeof search !== "string" || search.length > 120) return res.status(400).json({ error: "Invalid history filters." });
      let query = client.from("cv_evaluations").select("id,created_at,candidate_name,job_title,file_name", { count: "exact" });
      const term = search.replace(/[^\p{L}\p{N}\s@._-]/gu, " ").trim();
      if (term) query = query.or(`candidate_name.ilike.%${term}%,job_title.ilike.%${term}%,file_name.ilike.%${term}%`);
      const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(page * 25, page * 25 + 24);
      if (result.error) throw result.error;
      return res.status(200).json({ rows: result.data, total: result.count });
    } catch { return res.status(503).json({ error: "Analysis history could not be loaded. Please try again." }); }
  };
}
export default createHistoryHandler();
