import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultStorage } from "../server/documents/handler.ts";
import type { DocumentStorage } from "../server/documents/storage/types.ts";
import { completeRequest } from "../server/signatures/complete.ts";
import type { SignatureRequestRow } from "../server/signatures/complete.ts";
import { loadSignatureSettings, youtrustFromSettings } from "../server/signatures/settings.ts";
import { canMoveTo, statusFromEvent, verifyWebhook } from "../server/signatures/webhook.ts";

/**
 * Youtrust webhook receiver. Youtrust POSTs JSON events signed with the
 * subscription's secret (header X-Yousign-Signature-256, an HMAC of the raw
 * body). Payload: { event_id, event_name, event_time, data: { signature_request: { id }, ... } }.
 *
 * There is no caller identity, so everything runs on the service-role client.
 * Each event_id is recorded in signature_webhook_events before it is applied;
 * a redelivery of a recorded event is acknowledged without effect. When the
 * work fails (500) or another caller is mid-filing (503), the event row is
 * removed so Youtrust's retry runs it again.
 *
 * Request contract: the raw body is read from the request stream (an async
 * iterable of byte chunks, which Vercel's Node request is as long as req.body
 * is never touched). The HMAC must be computed on those exact bytes.
 */
export const config = { maxDuration: 60 };

type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
};
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type Deps = {
  createClient: typeof createClient;
  createYoutrust: typeof youtrustFromSettings;
  storage: (client: SupabaseClient) => Promise<DocumentStorage | null>;
  now?: () => Date;
};
type WebhookEvent = { event_id: string; event_name: string; data: { signature_request?: { id?: unknown } } & Record<string, unknown> };

const SIGNATURE_HEADER = "x-yousign-signature-256";
const MAX_BODY_BYTES = 1024 * 1024;

class BodyTooLarge extends Error {}

async function readRawBody(req: Request): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(headers: Request["headers"], name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function parseEvent(raw: string): WebhookEvent | null {
  try {
    const event = JSON.parse(raw);
    if (!event || typeof event !== "object") return null;
    if (typeof event.event_id !== "string" || !event.event_id) return null;
    if (typeof event.event_name !== "string") return null;
    if (!event.data || typeof event.data !== "object") return null;
    return event as WebhookEvent;
  } catch {
    return null;
  }
}

export function createYoutrustWebhookHandler(deps: Deps = { createClient, createYoutrust: youtrustFromSettings, storage: defaultStorage }) {
  return async function handler(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return res.status(503).json({ error: "The signatures webhook is not configured." });

    let raw: string;
    try {
      raw = await readRawBody(req);
    } catch (error) {
      if (error instanceof BodyTooLarge) return res.status(413).json({ error: "Payload too large." });
      return res.status(400).json({ error: "Could not read the request body." });
    }

    const client = deps.createClient(url, serviceKey);
    let settings: Awaited<ReturnType<typeof loadSignatureSettings>>;
    try {
      settings = await loadSignatureSettings(client);
    } catch {
      return res.status(500).json({ error: "Could not read signature settings." });
    }
    // Rejected before any write; with no secret configured nothing can verify.
    if (!settings.webhookSecret || !verifyWebhook(raw, header(req.headers, SIGNATURE_HEADER), settings.webhookSecret))
      return res.status(401).json({ error: "Invalid signature." });

    const event = parseEvent(raw);
    if (!event) return res.status(400).json({ error: "Invalid event." });
    const youtrustId = event.data.signature_request?.id;
    if (typeof youtrustId !== "string" || !youtrustId) return res.status(200).json({ ignored: true });

    const found = await client.from("signature_requests").select("*").eq("youtrust_request_id", youtrustId).maybeSingle();
    if (found.error) return res.status(500).json({ error: "Could not read the signature request." });
    if (!found.data) return res.status(200).json({ ignored: true });
    const row = found.data as SignatureRequestRow;

    const recorded = await client.from("signature_webhook_events").insert({ event_id: event.event_id });
    if (recorded.error?.code === "23505") return res.status(200).json({ duplicate: true });
    if (recorded.error) return res.status(500).json({ error: "Could not record the event." });
    const forget = () =>
      client.from("signature_webhook_events").delete().eq("event_id", event.event_id).then(() => undefined, () => undefined);

    try {
      // The email the request was sent to (HR may have overridden the person's), as Send and Refresh use.
      const personEmail = (row.signers ?? []).find((x) => x.role === "person")?.email ?? "";
      const next = statusFromEvent(event, personEmail);

      if (next === "completed") {
        const filed = row.signed_document_id && row.audit_document_id;
        if (row.status === "completed" ? filed : !canMoveTo(row.status, "completed"))
          return res.status(200).json({ status: row.status });
        const storage = await deps.storage(client);
        if (!storage) throw new Error("Google Drive is not connected.");
        await completeRequest(client, deps.createYoutrust(settings), storage, row, deps.now?.() ?? new Date());
        const after = await client.from("signature_requests").select("status").eq("id", row.id).single();
        if (after.error) throw new Error("Could not read the signature request.");
        const status = after.data.status as SignatureRequestRow["status"];
        // Still movable to completed: another caller holds the filing claim. Let Youtrust retry.
        if (status !== "completed" && canMoveTo(status, "completed")) {
          await forget();
          return res.status(503).json({ error: "Filing is in progress elsewhere; retry later." });
        }
        return res.status(200).json({ status });
      }

      if (next && canMoveTo(row.status, next)) {
        // Conditional on the status read above, so a concurrent move is never overwritten.
        const { error } = await client.from("signature_requests").update({ status: next }).eq("id", row.id).eq("status", row.status);
        if (error) throw new Error("Could not update the signature request.");
        return res.status(200).json({ status: next });
      }
      return res.status(200).json({ status: row.status });
    } catch {
      await forget();
      return res.status(500).json({ error: "Could not process the event." });
    }
  };
}

export default createYoutrustWebhookHandler();
