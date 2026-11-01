import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export function loadTregSettings() {
  return {
    token: process.env.TREG_TOKEN || "",
    org: process.env.TREG_ORG || "",
  };
}

export type UsageContext = { adminId: string; feature: string; record: (row: Record<string, unknown>) => Promise<void> };

export async function createUsageContext(adminId: string, feature: string): Promise<UsageContext> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Research usage storage is not configured.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ready = await client.from("treg_usage").select("call_id").limit(0);
  if (ready.error) throw new Error("Research usage storage is not ready.");
  return { adminId, feature, async record(row) {
    const { error } = await client.from("treg_usage").upsert(row, { onConflict: "call_id", ignoreDuplicates: true });
    if (error) throw new Error("Research usage could not be saved.");
  } };
}

function tag(value: string) {
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(value)) throw new Error("Invalid research attribution.");
  return value;
}

export function micro(value: string | null) {
  if (value === null) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid research cost.");
  return Number(value);
}

export async function callTreg(token: string, endpoint: string, body: Record<string, unknown>, ctx: UsageContext, maxCost = "0.10") {
  const meta = `customer=quicksort,admin=${tag(ctx.adminId)},workspace=business,feature=${tag(ctx.feature)}`;
  const requestId = randomUUID();
  const { org } = loadTregSettings();
  const response = await fetch(`https://treg.to/call/${endpoint}`, {
    method: "POST",
    headers: {
      "X-Treg-Token": token,
      ...(org ? { "X-Treg-Org": org } : {}),
      "X-Treg-Meta": meta,
      "Idempotency-Key": requestId,
      "X-Treg-Route-Max-Cost": maxCost,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const callId = response.headers.get("X-Treg-Call-Id");
  const cost = micro(response.headers.get("X-Treg-Cost-Micro"));
  if (callId) {
    await ctx.record({ call_id: callId, request_id: requestId, admin_id: ctx.adminId,
      customer: "quicksort", feature: ctx.feature, endpoint, status: response.status,
      cost_micro: micro(response.headers.get("X-Treg-Original-Cost-Micro")) ?? cost });
  } else if (response.ok || cost !== null) {
    throw new Error("Research response is missing its usage reference.");
  }
  if (!response.ok) throw new Error("Research service is unavailable. Contact a workspace owner.");
  return response.json() as Promise<Record<string, unknown>>;
}

type Attendee = { name: string; role: string; company: string; linkedin: string; email: string };
async function enrichOne(attendee: Attendee, token: string, ctx: UsageContext) {
  // Prefer the attendee's professional profile. Personal event-registration
  // email is a fallback when no profile URL was supplied.
  const identity = attendee.linkedin
    ? { linkedin_url: attendee.linkedin }
    : attendee.email
      ? { email: attendee.email }
      : null;
  if (!identity) return null;
  const payload = await callTreg(token, "treg.people.enrich", identity, ctx);
  const output = payload.output && typeof payload.output === "object" ? payload.output : null;
  if (!output) return null;
  return { attendee: attendee.name, supplied: { role: attendee.role, company: attendee.company }, profile: output, provider: (payload._treg as Record<string, unknown> | undefined)?.served_by };
}

export async function enrichWithTreg(attendees: Attendee[], ctx: UsageContext) {
  const { token } = loadTregSettings();
  if (!token) throw new Error("Backend research is not configured.");
  const configuredLimit = Number(process.env.TREG_ENRICHMENT_LIMIT || 300);
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(300, configuredLimit)) : 300;
  const queue = attendees.filter((attendee) => attendee.name || attendee.email || attendee.linkedin).slice(0, limit);
  const profiles: unknown[] = [];
  for (let index = 0; index < queue.length; index += 12) {
    const batch = await Promise.allSettled(queue.slice(index, index + 12).map((attendee) => enrichOne(attendee, token, ctx)));
    const failed = batch.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    profiles.push(...batch.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []));
  }
  return { provider: "Backend research", profiles };
}
