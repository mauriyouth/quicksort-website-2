import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Sales pipeline API (sales.md §8.2, §8.6). The Clerk token is forwarded to
 * Supabase so RLS applies the same admin policies as the rest of the admin
 * app — no service-role key, no role supplied by the browser.
 *
 * GET   /api/sales-pipeline — board grouped by stage with column counts,
 *       totals (régie: TJM × days, forfait: fixed price) and weighted
 *       forecast, plus the régie/forfait split. Filters: owner, client,
 *       pricingModel, q.
 * PATCH /api/sales-pipeline — move an opportunity to a stage. Won sets
 *       probability to 100, lost to 0 and requires a lost reason; every
 *       move is written to the activity timeline.
 */
type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body: unknown;
};
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };

const STAGES = [
  { key: "lead", label: "Lead", probability: 10 },
  { key: "qualified", label: "Qualified", probability: 25 },
  { key: "meeting", label: "Meeting", probability: 40 },
  { key: "proposal", label: "Proposal", probability: 60 },
  { key: "negotiation", label: "Negotiation", probability: 80 },
  { key: "won", label: "Won", probability: 100 },
  { key: "lost", label: "Lost", probability: 0 },
] as const;
const STAGE_KEYS = STAGES.map((s) => s.key) as [string, ...string[]];

const moveRequest = z.object({
  id: z.uuid(),
  stage: z.enum(STAGE_KEYS),
  lostReason: z.string().trim().min(1).max(2000).optional(),
});

function derivedAmount(r: Record<string, unknown>): number {
  if (typeof r.amount === "number") return r.amount;
  return r.pricing_model === "regie"
    ? Number(r.tjm || 0) * Number(r.estimated_days || 0)
    : Number(r.fixed_price || 0);
}

export function createSalesPipelineHandler(deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer "))
      return res.status(401).json({ error: "Sign in to view the sales pipeline." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "The sales module needs its portal connection configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });

      if (req.method === "GET") return await board(req, res, client);
      if (req.method === "PATCH") return await move(req, res, client, String(identity.data));
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ error: "Use GET or PATCH." });
    } catch {
      return res.status(503).json({ error: "The sales pipeline could not be loaded. Please try again." });
    }
  };

  async function board(req: Request, res: Response, client: SupabaseClient) {
    const query = z
      .object({
        owner: z.string().trim().max(200).optional(),
        client: z.uuid().optional(),
        pricingModel: z.enum(["regie", "forfait"]).optional(),
        q: z.string().trim().max(120).optional(),
      })
      .safeParse(req.query || {});
    if (!query.success) return res.status(400).json({ error: "Invalid pipeline filters." });
    const filters = query.data;

    const results = await Promise.all([
      client.from("sales_opportunities").select("*").order("updated_at", { ascending: false }),
      client.from("sales_clients").select("id,name,health"),
      client.from("sales_contacts").select("id,name,role,client_id"),
      client.from("sales_sponsors").select("opportunity_id,person_id,influence,is_primary"),
    ]);
    for (const r of results) {
      if (!r.error) continue;
      // PostgREST 205: the sales migration has not been applied to this project.
      if (String(r.error.code || "").includes("205") || String(r.error.message || "").includes("schema cache") || String(r.error.message || "").includes("Could not find the table"))
        return res.status(503).json({ error: "The sales tables are missing. Apply the 20261001090000_sales_pipeline migration (supabase db push) and refresh." });
      throw r.error;
    }
    const opportunities = (results[0].data || []) as Record<string, unknown>[];
    const clients = new Map((results[1].data || []).map((c: Record<string, unknown>) => [c.id, c]));
    const people = new Map((results[2].data || []).map((p: Record<string, unknown>) => [p.id, p]));
    const sponsors = (results[3].data || []) as Record<string, unknown>[];

    const term = filters.q?.toLowerCase() || "";
    const visible = opportunities.filter((r) => {
      const client = clients.get(r.client_id) as Record<string, unknown> | undefined;
      if (filters.owner && r.owner_email !== filters.owner) return false;
      if (filters.client && r.client_id !== filters.client) return false;
      if (filters.pricingModel && r.pricing_model !== filters.pricingModel) return false;
      if (term) {
        const sponsorNames = sponsors
          .filter((s) => s.opportunity_id === r.id)
          .map((s) => String((people.get(s.person_id) as Record<string, unknown> | undefined)?.name || ""))
          .join(" ");
        const haystack = `${r.title} ${client?.name || ""} ${r.owner_email} ${sponsorNames}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const items = visible.map((r) => {
      const amount = derivedAmount(r);
      const probability = Number(r.probability || 0);
      const client = clients.get(r.client_id) as Record<string, unknown> | undefined;
      const dealSponsors = sponsors
        .filter((s) => s.opportunity_id === r.id)
        .map((s) => {
          const person = people.get(s.person_id) as Record<string, unknown> | undefined;
          return {
            personId: s.person_id,
            name: person?.name || "",
            role: person?.role || "",
            influence: s.influence,
            isPrimary: Boolean(s.is_primary),
          };
        })
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      return {
        id: r.id,
        title: r.title,
        stage: r.stage,
        clientId: r.client_id,
        clientName: client?.name || "",
        clientHealth: client?.health || "good",
        pricingModel: r.pricing_model,
        currency: r.currency,
        tjm: r.tjm ?? null,
        estimatedDays: r.estimated_days ?? null,
        fixedPrice: r.fixed_price ?? null,
        amount,
        weighted: Math.round(amount * probability) / 100,
        probability,
        expectedClose: r.expected_close ?? null,
        ownerEmail: r.owner_email,
        lostReason: r.lost_reason || "",
        sponsors: dealSponsors,
        updatedAt: r.updated_at,
      };
    });

    const open = items.filter((i) => i.stage !== "won" && i.stage !== "lost");
    const by = (list: typeof items, model: string) => list.filter((i) => i.pricingModel === model);
    const sum = (list: typeof items, field: "amount" | "weighted") => list.reduce((total, i) => total + i[field], 0);
    const stages = STAGES.map((stage) => {
      const column = items.filter((i) => i.stage === stage.key);
      return {
        key: stage.key,
        label: stage.label,
        probability: stage.probability,
        count: column.length,
        total: Math.round(sum(column, "amount") * 100) / 100,
        weighted: Math.round(sum(column, "weighted") * 100) / 100,
        items: column,
      };
    });
    const closingSoon = open
      .filter((i) => i.expectedClose && new Date(String(i.expectedClose)).getTime() <= Date.now() + 30 * 86400000)
      .sort((a, b) => String(a.expectedClose).localeCompare(String(b.expectedClose)));
    return res.status(200).json({
      stages,
      summary: {
        openCount: open.length,
        openTotal: Math.round(sum(open, "amount") * 100) / 100,
        weightedTotal: Math.round(sum(open, "weighted") * 100) / 100,
        regie: { count: by(open, "regie").length, total: Math.round(sum(by(open, "regie"), "amount") * 100) / 100 },
        forfait: { count: by(open, "forfait").length, total: Math.round(sum(by(open, "forfait"), "amount") * 100) / 100 },
        wonTotal: Math.round(sum(items.filter((i) => i.stage === "won"), "amount") * 100) / 100,
        closingSoon,
      },
    });
  }

  async function move(req: Request, res: Response, client: SupabaseClient, actorId: string) {
    const parsed = moveRequest.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide the opportunity id and a target stage." });
    const input = parsed.data;
    const current = await client.from("sales_opportunities").select("*").eq("id", input.id).single();
    if (current.error || !current.data) return res.status(404).json({ error: "This opportunity is no longer available. Refresh the pipeline." });
    const row = current.data as Record<string, unknown>;
    if (row.stage === input.stage) return res.status(200).json({ opportunity: row });
    if (input.stage === "lost" && !input.lostReason)
      return res.status(422).json({ error: "A lost deal needs a reason before it can be moved." });

    const stage = STAGES.find((s) => s.key === input.stage)!;
    const values = {
      stage: input.stage,
      probability: stage.probability,
      lost_reason: input.stage === "lost" ? input.lostReason!.trim() : input.stage === "won" ? "" : row.lost_reason,
      updated_at: new Date().toISOString(),
    };
    const updated = await client.from("sales_opportunities").update(values).eq("id", input.id).select("*").single();
    if (updated.error || !updated.data) throw updated.error;

    const profile = await client.from("profiles").select("email").eq("id", actorId).single();
    const author = String(profile.data?.email || "");
    const fromLabel = STAGES.find((s) => s.key === row.stage)?.label || row.stage;
    const logged = await client.from("sales_activities").insert({
      opportunity_id: input.id,
      client_id: row.client_id,
      type: "stage_change",
      text:
        input.stage === "lost"
          ? `Moved from ${fromLabel} to ${stage.label}: ${values.lost_reason}`
          : `Moved from ${fromLabel} to ${stage.label}.`,
      author_email: author,
    });
    if (logged.error) throw logged.error;
    await client.from("sales_clients").update({ last_activity_at: new Date().toISOString() }).eq("id", row.client_id);
    return res.status(200).json({ opportunity: updated.data });
  }
}
export default createSalesPipelineHandler();
