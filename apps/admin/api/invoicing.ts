import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ProviderError } from "../server/invoicing/provider.ts";
import type { InvoicingProvider } from "../server/invoicing/provider.ts";
import { encryptCredentials, loadInvoicingSettings, providerFromSettings } from "../server/invoicing/settings.ts";
import * as lifecycle from "../server/invoicing/lifecycle.ts";
import { HttpError } from "../server/invoicing/lifecycle.ts";
import { STATUS_LABELS } from "../server/invoicing/list.ts";
import type { LifecycleCtx } from "../server/invoicing/lifecycle.ts";

type Request = { method?: string; query?: Record<string, string | string[] | undefined>; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = { createClient: typeof createClient; createProvider: typeof providerFromSettings; now?: () => Date };
type Ctx = {
  client: SupabaseClient; userId: string; deps: Deps; settings: Awaited<ReturnType<typeof loadInvoicingSettings>>;
  provider: () => InvoicingProvider; query: Record<string, string | undefined>; life: LifecycleCtx;
};
type Result = { status: number; body: unknown };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = z.object({
  tab: z.enum(["invoices", "unassigned"]).default("invoices"),
  q: z.string().max(200).default(""),
  status: z.enum(["", ...STATUS_LABELS]).default(""),
  client: z.string().max(100).default(""),
  month: z.union([z.literal(""), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).default(""),
  from: z.union([z.literal(""), z.string().regex(DAY)]).default(""),
  to: z.union([z.literal(""), z.string().regex(DAY)]).default(""),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  group: z.enum(["month", "client"]).default("month"),
});

const NOT_CONFIGURED = "Connect Qonto in Invoicing settings first.";

const saveSettings = z.object({
  action: z.literal("save_settings"),
  login: z.string().trim().max(200),
  secret: z.string().trim().min(1).max(500).optional(),
  stagingToken: z.string().trim().min(1).max(500).optional(),
  iban: z.string().trim().max(60),
  staging: z.boolean(),
  dueDays: z.number().int().min(1).max(120),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
const linkClient = z.object({
  action: z.literal("link_client"),
  clientId: z.uuid(),
  providerClientId: z.string().trim().min(1).max(200).nullable(),
  providerClientName: z.string().trim().max(300).default(""),
});
const product = z.object({
  id: z.string().min(1).max(200), title: z.string().max(500), description: z.string().max(5000),
  unit: z.string().max(50).nullable(), unitPrice: z.string().nullable().optional(), vatRate: z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/),
});
const linkProduct = z.object({
  action: z.literal("link_product"),
  projectId: z.uuid(),
  pricingLine: z.string().trim().min(1).max(300),
  product: product.nullable(),
});
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const invoiceRef = { invoiceId: z.string().min(1).max(100) };
const createDraft = z.object({ action: z.literal("create_draft"), projectId: z.uuid(), employeeId: z.uuid(), month: z.string().regex(MONTH) });
const draftLineEdit = z.object({
  id: z.string().min(1).max(100),
  quantity: z.coerce.string().trim().regex(/^\d{1,6}(\.\d{1,4})?$/).refine((q) => Number(q) > 0, "Quantity must be positive."),
  unitPrice: z.coerce.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/).transform((p) => Number(p).toFixed(2)),
  description: z.string().max(5000),
});
const updateDraft = z.object({
  action: z.literal("update_draft"), ...invoiceRef,
  dueDate: z.string().regex(DATE), purchaseOrder: z.string().trim().max(200), lines: z.array(draftLineEdit).max(100),
});
const regenerateDraft = z.object({ action: z.literal("regenerate_draft"), ...invoiceRef });
const deleteDraft = z.object({ action: z.literal("delete_draft"), ...invoiceRef });
const finalize = z.object({ action: z.literal("finalize"), ...invoiceRef });
const send = z.object({ action: z.literal("send"), ...invoiceRef, resend: z.boolean().optional() });
const cancel = z.object({ action: z.literal("cancel"), ...invoiceRef });
const assign = z.object({ action: z.literal("assign"), ...invoiceRef, projectId: z.uuid().nullable(), ignored: z.boolean().optional() });
const setPeriod = z.object({ action: z.literal("set_period"), ...invoiceRef, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable() });
const assignConsultant = z.object({ action: z.literal("assign_consultant"), ...invoiceRef, employeeId: z.uuid().nullable() });
const linkInvoice = z.object({
  action: z.literal("link_invoice"), ...invoiceRef, projectId: z.uuid(), employeeId: z.uuid(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});
const actionSchema = z.discriminatedUnion("action", [
  saveSettings, linkClient, linkProduct, createDraft, updateDraft, regenerateDraft, deleteDraft, finalize, send, cancel, assign, setPeriod, assignConsultant, linkInvoice,
]);

function fail(error: { message?: string } | null | undefined, fallback: string): never {
  if (error) throw new Error(error.message || fallback);
  throw new Error(fallback);
}

// GET ?resource=<name>
const resources: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  async settings({ settings }) {
    const { secret: _s, stagingToken: _t, ...visible } = settings;
    return visible;
  },
  async "provider-clients"({ client, provider }) {
    const [clients, links] = await Promise.all([provider().listClients(), client.from("invoicing_client_links").select("*")]);
    if (links.error) fail(links.error, "Could not read client links.");
    return { clients, links: links.data ?? [] };
  },
  async "provider-products"({ provider }) { return { products: await provider().listProducts() }; },
  async "payment-accounts"({ provider }) { return { accounts: await provider().listPaymentAccounts() }; },
  async month({ life, query }) {
    if (!MONTH.test(query.month ?? "")) throw new HttpError("Choose a month (YYYY-MM).", 400);
    return lifecycle.monthRows(life, query.month as string);
  },
  async invoices({ life, query }) {
    const parsed = listQuery.safeParse(query);
    if (!parsed.success) throw new HttpError("Invalid invoice filters.", 400);
    return lifecycle.listInvoices(life, query.refresh === "1", parsed.data);
  },
  async "link-candidates"({ life, query }) {
    if (!z.uuid().safeParse(query.projectId).success) throw new HttpError("Choose a project.", 400);
    if (!MONTH.test(query.month ?? "")) throw new HttpError("Choose a month (YYYY-MM).", 400);
    return lifecycle.invoiceLinkCandidates(life, { projectId: query.projectId as string, billedClientId: query.billedClientId || null, month: query.month as string });
  },
  async invoice({ life, query }) {
    if (!query.id) throw new HttpError("Choose an invoice.", 400);
    return lifecycle.invoiceDetail(life, query.id);
  },
  async project({ life, query }) {
    if (!z.uuid().safeParse(query.projectId).success) throw new HttpError("Choose a project.", 400);
    return lifecycle.projectSummary(life, query.projectId as string);
  },
};

// POST { action }
const actions: Record<string, (ctx: Ctx, input: any) => Promise<Result>> = {
  async save_settings({ client, userId, deps, settings }, input: z.infer<typeof saveSettings>) {
    const secret = input.secret ?? settings.secret;
    const stagingToken = input.stagingToken ?? settings.stagingToken;
    if (input.staging && !stagingToken) return { status: 400, body: { error: "Add the Qonto staging token to use the sandbox." } };
    if (input.secret) {
      try {
        await deps.createProvider({ login: input.login, iban: input.iban, staging: input.staging, secret: input.secret, stagingToken }).listPaymentAccounts();
      } catch (error) {
        if (error instanceof ProviderError) return { status: 400, body: { error: error.message } };
        throw error;
      }
    }
    const now = (deps.now?.() ?? new Date()).toISOString();
    const row: Record<string, unknown> = {
      id: "default", provider: "qonto",
      options: { login: input.login, iban: input.iban, staging: input.staging, due_days: input.dueDays },
      start_month: `${input.startMonth}-01`, updated_by: userId, updated_at: now,
    };
    if (secret && (input.secret || input.stagingToken)) row.encrypted_credentials = encryptCredentials({ secret, stagingToken });
    const result = await client.from("invoicing_settings").upsert(row, { onConflict: "id" });
    if (result.error) fail(result.error, "Could not save invoicing settings.");
    return { status: 200, body: { saved: true } };
  },
  async link_client({ client, userId, deps, settings }, input: z.infer<typeof linkClient>) {
    if (input.providerClientId === null) {
      const result = await client.from("invoicing_client_links").delete().eq("client_id", input.clientId);
      if (result.error) fail(result.error, "Could not remove the client link.");
      return { status: 200, body: { linked: false } };
    }
    const result = await client.from("invoicing_client_links").upsert({
      client_id: input.clientId, provider: settings.provider, provider_client_id: input.providerClientId,
      provider_client_name: input.providerClientName, linked_by: userId, linked_at: (deps.now?.() ?? new Date()).toISOString(),
    }, { onConflict: "client_id" });
    if (result.error) fail(result.error, "Could not save the client link.");
    return { status: 200, body: { linked: true } };
  },
  async link_product({ client, settings }, input: z.infer<typeof linkProduct>) {
    if (input.product === null) {
      const result = await client.from("invoicing_product_links").delete().eq("project_id", input.projectId).eq("pricing_line", input.pricingLine);
      if (result.error) fail(result.error, "Could not remove the product link.");
      return { status: 200, body: { linked: false } };
    }
    const p = input.product;
    const result = await client.from("invoicing_product_links").upsert({
      project_id: input.projectId, pricing_line: input.pricingLine, provider: settings.provider, provider_product_id: p.id,
      title: p.title, description: p.description, unit: p.unit, vat_rate: Number(p.vatRate),
    }, { onConflict: "project_id,pricing_line" });
    if (result.error) fail(result.error, "Could not save the product link.");
    return { status: 200, body: { linked: true } };
  },
  create_draft: ({ life }, input: z.infer<typeof createDraft>) => lifecycle.createDraft(life, input),
  update_draft: ({ life }, input: z.infer<typeof updateDraft>) => lifecycle.updateDraft(life, input),
  regenerate_draft: ({ life }, input: z.infer<typeof regenerateDraft>) => lifecycle.regenerateDraft(life, input),
  delete_draft: ({ life }, input: z.infer<typeof deleteDraft>) => lifecycle.deleteDraft(life, input),
  finalize: ({ life }, input: z.infer<typeof finalize>) => lifecycle.finalizeInvoice(life, input),
  send: ({ life }, input: z.infer<typeof send>) => lifecycle.sendInvoice(life, input),
  cancel: ({ life }, input: z.infer<typeof cancel>) => lifecycle.cancelInvoice(life, input),
  assign: ({ life }, input: z.infer<typeof assign>) => lifecycle.assignInvoice(life, input),
  set_period: ({ life }, input: z.infer<typeof setPeriod>) => lifecycle.setInvoicePeriod(life, input),
  link_invoice: ({ life }, input: z.infer<typeof linkInvoice>) => lifecycle.linkInvoice(life, input),
  assign_consultant: ({ life }, input: z.infer<typeof assignConsultant>) => lifecycle.assignConsultant(life, input),
};
// Actions that work before a provider is connected.
const worksUnconfigured = new Set(["save_settings"]);

export function createInvoicingHandler(deps: Deps = { createClient, createProvider: providerFromSettings }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "POST"].includes(req.method || "")) { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Use GET or POST." }); }
    const token = req.headers.authorization;
    if (typeof token !== "string" || !token.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to manage invoicing." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(503).json({ error: "The invoicing module needs its portal connection configured." });
    try {
      const client = deps.createClient(url, key, { accessToken: async () => token.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Your session expired. Sign in again." });
      const role = await client.from("user_roles").select("role").eq("user_id", identity.data).single();
      if (role.error || role.data?.role !== "admin") return res.status(403).json({ error: "Admin access is required." });

      const settings = await loadInvoicingSettings(client);
      const userId = String(identity.data);
      let cached: InvoicingProvider | null = null;
      const provider = () => {
        if (!settings.secret) throw new HttpError(NOT_CONFIGURED, 409);
        return (cached ??= deps.createProvider(settings));
      };
      const query: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) query[k] = Array.isArray(v) ? v[0] : v;
      const ctx: Ctx = {
        client, userId, deps, settings, provider, query,
        life: { client, provider, actor: userId, now: () => deps.now?.() ?? new Date(), settings },
      };
      if (req.method === "GET") {
        const name = query.resource;
        const load = name && Object.hasOwn(resources, name) ? resources[name] : undefined;
        if (!load) return res.status(400).json({ error: "Unknown resource." });
        return res.status(200).json(await load(ctx));
      }
      const parsed = actionSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid invoicing request." });
      const act = parsed.data.action;
      if (!worksUnconfigured.has(act) && !settings.secret) return res.status(409).json({ error: NOT_CONFIGURED });
      const result = await actions[act](ctx, parsed.data);
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
      if (error instanceof ProviderError) return res.status(502).json({ error: error.message });
      return res.status(502).json({ error: "The invoicing request failed. Please try again." });
    }
  };
}
export default createInvoicingHandler();
