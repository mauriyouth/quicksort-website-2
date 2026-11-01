import { createClient } from "@supabase/supabase-js";
import { loadTregReport } from "../server/treg-report.ts";
type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
export function createUsageHandler(deps = { createClient, loadTregReport }) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to view research usage." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Workspace connection is not configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Business admin access is required." });
      const ledger = await deps.loadTregReport();
      const ids = ledger.rows.map(row => row.value).filter(id => /^[0-9a-f-]{36}$/i.test(id));
      const profiles = ids.length ? await client.from("profiles").select("id,full_name").in("id", ids) : { data: [] };
      const names = new Map((profiles.data || []).map(profile => [profile.id, profile.full_name]));
      return res.status(200).json({ ...ledger, rows: ledger.rows.map(row => ({ ...row, name: names.get(row.value) || row.value })), payer: "QuickSort", currency: "USD", fetchedAt: new Date().toISOString() });
    } catch {
      return res.status(503).json({ error: "Research usage could not be verified. Check the reporting configuration and ledger reconciliation." });
    }
  };
}
export default createUsageHandler();
