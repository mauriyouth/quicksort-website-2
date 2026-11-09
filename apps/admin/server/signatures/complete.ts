import type { SupabaseClient } from "@supabase/supabase-js";
import { fileBuffer } from "../documents/file.ts";
import type { DocumentStorage } from "../documents/storage/types.ts";
import { canMoveTo } from "./webhook.ts";
import type { RequestStatus } from "./webhook.ts";
import type { YoutrustClient } from "./youtrust.ts";

export type SignatureRequestRow = {
  id: string;
  person_id: string;
  title: string;
  type_code: string;
  supersedes: string | null;
  status: RequestStatus;
  youtrust_request_id: string | null;
  signed_document_id: string | null;
  audit_document_id: string | null;
};

async function reread(client: SupabaseClient, id: string): Promise<SignatureRequestRow> {
  const { data, error } = await client.from("signature_requests").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Could not read the signature request.");
  return data as SignatureRequestRow;
}

async function setColumns(client: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await client.from("signature_requests").update(values).eq("id", id);
  if (error) throw new Error("Could not update the signature request.");
}

/** A claim older than this is treated as abandoned (a crashed function) and can be taken over. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Takes the filing claim on the request: a conditional update that only one
 * concurrent caller wins. Returns the claimed row, or null when someone else
 * holds a live claim.
 */
async function claimFiling(client: SupabaseClient, id: string, now: Date): Promise<SignatureRequestRow | null> {
  const cutoff = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  const { data, error } = await client.from("signature_requests")
    .update({ filing_claimed_at: now.toISOString() })
    .eq("id", id)
    .or(`filing_claimed_at.is.null,filing_claimed_at.lt."${cutoff}"`)
    .select();
  if (error) throw new Error("Could not claim the signature request for filing.");
  return ((data ?? [])[0] as SignatureRequestRow | undefined) ?? null;
}

/**
 * Files a completed request's signed PDF and audit trail in the person's
 * registry, then marks it completed. `client` must be a service-role client
 * (register_signed_document is service-role only).
 *
 * The caller first claims the request (filing_claimed_at), so a webhook and a
 * Refresh running together never both file; the loser returns without filing.
 * Each document ID is stored right after its filing and read from the claimed
 * row before any upload, so a retry only files what is still missing. A failed
 * filing releases the claim and rethrows; a successful one keeps it.
 */
export async function completeRequest(
  client: SupabaseClient,
  youtrust: YoutrustClient,
  storage: DocumentStorage,
  request: Pick<SignatureRequestRow, "id">,
  now: Date = new Date(),
): Promise<void> {
  const current = await reread(client, request.id);
  if (current.status !== "completed" && !canMoveTo(current.status, "completed")) return;
  if (!current.youtrust_request_id) throw new Error("This request was never sent to Youtrust.");

  const claimed = await claimFiling(client, request.id, now);
  if (!claimed) return;
  const release = () =>
    client.from("signature_requests").update({ filing_claimed_at: null }).eq("id", request.id).then(() => undefined, () => undefined);
  let row = claimed;
  // The status may have moved (e.g. cancelled) between the read and the claim.
  if (row.status !== "completed" && !canMoveTo(row.status, "completed")) return release();
  try {
    const youtrustId = row.youtrust_request_id!;
    const today = now.toISOString().slice(0, 10);

    if (!row.signed_document_id) {
      const bytes = await youtrust.downloadSigned(youtrustId);
      const signed = await fileBuffer(client, storage, {
        personId: row.person_id, typeCode: row.type_code, title: row.title, fileName: `${row.title} (signé).pdf`,
        bytes, signatureRequestId: row.id, supersedes: row.supersedes, issuedOn: today,
      });
      await setColumns(client, row.id, { signed_document_id: signed.id });
      row = { ...row, signed_document_id: signed.id };
    }

    if (!row.audit_document_id) {
      const bytes = await youtrust.downloadAuditTrail(youtrustId);
      const audit = await fileBuffer(client, storage, {
        personId: row.person_id, typeCode: "OTHER", title: `Piste d'audit – ${row.title}`, fileName: `${row.title} (piste d'audit).pdf`,
        bytes, signatureRequestId: row.id, parentDocumentId: row.signed_document_id,
      });
      await setColumns(client, row.id, { audit_document_id: audit.id });
    }

    if (row.status !== "completed") {
      // Conditional on the status read above, so a concurrent move is never overwritten.
      const { error } = await client.from("signature_requests").update({ status: "completed", error: "" }).eq("id", row.id).eq("status", row.status);
      if (error) throw new Error("Could not update the signature request.");
    }
  } catch (error) {
    await release();
    throw error;
  }
}
