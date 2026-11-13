import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runFreelancerInvoicesCycle, type CycleDeps, type CycleResult } from "../server/freelancer-invoices/run.ts";

// The mailbox poll has a 4-minute budget.
export const config = { maxDuration: 300 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = Pick<CycleDeps, "fetch" | "now"> & {
  createClient: typeof createClient;
  runCycle?: (client: SupabaseClient, deps: CycleDeps) => Promise<CycleResult>;
};

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createFreelancerInvoicesCronHandler(deps: Deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    // Vercel cron invokes with GET.
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Use GET." }); }
    const secret = process.env.CRON_SECRET || "";
    const given = req.headers.authorization;
    if (!secret || typeof given !== "string" || !sameSecret(given, `Bearer ${secret}`)) return res.status(401).json({ error: "Unauthorized." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Freelancer invoices are not configured." });
    try {
      const client = deps.createClient(url, key);
      const run = deps.runCycle ?? runFreelancerInvoicesCycle;
      return res.status(200).json(await run(client, { fetch: deps.fetch, now: deps.now }));
    } catch (error) {
      console.error("Freelancer invoices cron failed:", error);
      return res.status(502).json({ error: "The freelancer invoice cycle failed." });
    }
  };
}
export default createFreelancerInvoicesCronHandler();
