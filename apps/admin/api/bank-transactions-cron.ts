import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NotConfiguredError, syncWithSettings } from "../server/bank/run.ts";
import type { RunDeps } from "../server/bank/run.ts";
import { runFreelancerInvoicesCycle } from "../server/freelancer-invoices/run.ts";

export const config = { maxDuration: 120 };
type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = RunDeps & { createClient: typeof createClient; runFreelancerInvoicesCycle?: typeof runFreelancerInvoicesCycle; clock?: () => number };
// The freelancer matching runs only with this much of maxDuration (120 s) left.
const BUDGET_MS = 120_000;
const MATCHING_RESERVE_MS = 30_000;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBankCronHandler(deps: Deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    const clock = deps.clock ?? Date.now;
    const startedAt = clock();
    res.setHeader("Cache-Control", "no-store");
    // Vercel cron invokes with GET.
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Use GET." }); }
    const secret = process.env.CRON_SECRET || "";
    const given = req.headers.authorization;
    if (!secret || typeof given !== "string" || !sameSecret(given, `Bearer ${secret}`)) return res.status(401).json({ error: "Unauthorized." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Le module bancaire n'est pas configuré." });
    try {
      const client = deps.createClient(url, key);
      const result = await syncWithSettings(client, deps);
      // New debits may pay freelancer invoices. Never fails the bank sync.
      let freelancerInvoices: unknown;
      if (BUDGET_MS - (clock() - startedAt) < MATCHING_RESERVE_MS) {
        console.error("Freelancer invoice matching skipped: the bank sync left less than 30 s of the function budget.");
      } else {
        try {
          freelancerInvoices = await (deps.runFreelancerInvoicesCycle ?? runFreelancerInvoicesCycle)(client, { pollMail: false, fetch: deps.fetch, now: deps.now });
        } catch (error) {
          console.error("Freelancer invoice matching after the bank sync failed:", error);
        }
      }
      return res.status(200).json(freelancerInvoices === undefined ? result : { ...result, freelancerInvoices });
    } catch (error) {
      if (error instanceof NotConfiguredError) return res.status(409).json({ error: error.message });
      return res.status(502).json({ error: "La synchronisation bancaire a échoué." });
    }
  };
}
export default createBankCronHandler();
