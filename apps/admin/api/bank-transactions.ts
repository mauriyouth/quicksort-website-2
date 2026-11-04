import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { FIXED_CHARGE_LINES, REQUEST_TIMEOUT_MS } from "../server/bank/classifier.ts";
import { NotConfiguredError, syncWithSettings } from "../server/bank/run.ts";
import type { RunDeps } from "../server/bank/run.ts";
import { ClassifierForbiddenError, loadClassifierSettings, saveClassifierSettings } from "../server/bank/settings.ts";
import { createSupabaseBankStore } from "../server/bank/store.ts";
import { HttpError } from "../server/invoicing/lifecycle.ts";
import { settingsReady } from "../server/ai-settings.ts";

export const config = { maxDuration: 120 };
type Request = { method?: string; query?: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = RunDeps & { createClient: typeof createClient };
type Ctx = { client: SupabaseClient; userId: string; deps: Deps; query: Record<string, string | undefined> };
type Result = { status: number; body: unknown };

const MODELS_URL = "https://api.moonshot.ai/v1/models";
const PAGE = 1000;
const COLUMNS = "id, month, settled_at, emitted_at, label, counterparty, amount_cents, amount_ht_cents, status, line, ai_line, ai_confidence, manual_line, needs_review";

const line = z.enum(FIXED_CHARGE_LINES as [string, ...string[]]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("classify"), id: z.string().min(1).max(200), line }),
  z.object({
    action: z.literal("save_classifier"),
    apiKey: z.string().trim().min(1).max(1000).optional(),
    model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._-]+$/),
  }),
]);

async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(offset, offset + PAGE - 1);
    if (page.error) throw page.error;
    const data = (page.data || []) as T[];
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const resources: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  async status({ client }) {
    const [state, classifier, review] = await Promise.all([
      createSupabaseBankStore(client).state(),
      loadClassifierSettings(client),
      client.from("bank_transactions_effective").select("id", { count: "exact", head: true }).eq("needs_review", true),
    ]);
    if (review.error) throw new Error("Could not count transactions to review.");
    return {
      state,
      classifier: { configured: Boolean(classifier.apiKey), model: classifier.model, source: classifier.source },
      reviewCount: review.count ?? 0,
    };
  },
  async transactions({ client, query }) {
    if (!/^\d{4}$/.test(query.year ?? "")) throw new HttpError("Choisissez une année (AAAA).", 400);
    const year = query.year as string;
    const rows = await paged<Record<string, unknown>>((from, to) =>
      client.from("bank_transactions_effective").select(COLUMNS)
        .gte("month", `${year}-01-01`).lte("month", `${year}-12-01`)
        .order("month", { ascending: true }).order("id", { ascending: true })
        .range(from, to));
    return { transactions: rows.map((r) => ({ ...r, needs_review: r.needs_review === true })) };
  },
};

async function moonshotAcceptsKey(apiKey: string, fetchImpl: typeof fetch): Promise<boolean> {
  const res = await fetchImpl(MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return res.ok;
}

const actions: Record<string, (ctx: Ctx, input: any) => Promise<Result>> = {
  async sync({ client, deps }) {
    return { status: 200, body: await syncWithSettings(client, deps) };
  },
  async classify({ client, userId, deps }, input: { id: string; line: string }) {
    const result = await client.from("bank_transactions")
      .update({ manual_line: input.line, manual_by: userId, manual_at: (deps.now?.() ?? new Date()).toISOString() })
      .eq("id", input.id).select("id").maybeSingle();
    if (result.error) throw new Error("Could not save the classification.");
    if (!result.data) return { status: 404, body: { error: "Transaction introuvable." } };
    return { status: 200, body: { saved: true } };
  },
  async save_classifier({ client, deps }, input: { apiKey?: string; model: string }) {
    if (!settingsReady()) return { status: 503, body: { error: "Définissez AI_SETTINGS_ENCRYPTION_KEY sur le serveur avant d'enregistrer une clé." } };
    if (input.apiKey) {
      let ok: boolean;
      try { ok = await moonshotAcceptsKey(input.apiKey, deps.fetch ?? fetch); } catch { return { status: 502, body: { error: "Impossible de joindre Kimi. Réessayez." } }; }
      if (!ok) return { status: 400, body: { error: "Kimi a refusé cette clé API. Vérifiez-la." } };
    } else if (!(await loadClassifierSettings(client)).apiKey) {
      return { status: 400, body: { error: "Ajoutez d'abord une clé API Kimi." } };
    }
    try {
      await saveClassifierSettings(client, input, deps.now?.());
    } catch (e) {
      if (e instanceof ClassifierForbiddenError) return { status: 403, body: { error: e.message } };
      throw e;
    }
    return { status: 200, body: { saved: true } };
  },
};

export function createBankHandler(deps: Deps = { createClient }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method || "")) { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET or POST." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Connectez-vous pour gérer la banque." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "Le module bancaire n'est pas configuré." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Votre session a expiré. Reconnectez-vous." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Accès administrateur requis." });

      const query: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) query[k] = Array.isArray(v) ? v[0] : v;
      const ctx: Ctx = { client, userId: String(identity.data), deps, query };
      if (req.method === "GET") {
        const name = query.resource;
        const load = name && Object.hasOwn(resources, name) ? resources[name] : undefined;
        if (!load) return res.status(400).json({ error: "Ressource inconnue." });
        return res.status(200).json(await load(ctx));
      }
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Requête bancaire invalide." });
      const result = await actions[parsed.data.action](ctx, parsed.data);
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
      if (error instanceof NotConfiguredError) return res.status(409).json({ error: error.message });
      return res.status(502).json({ error: "La requête bancaire a échoué. Réessayez." });
    }
  };
}
export default createBankHandler();
