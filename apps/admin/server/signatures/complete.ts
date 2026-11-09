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

/**
 * Files a completed request's signed PDF and audit trail in the person's
 * registry, then marks it completed. `client` must be a service-role client
 * (register_signed_document is service-role only). Each document ID is stored
 * right after its filing and checked before any upload, so a retry (webhook
 * redelivery or Refresh) only files what is still missing.
 */
export async function completeRequest(
  client: SupabaseClient,
  youtrust: YoutrustClient,
  storage: DocumentStorage,
  request: Pick<SignatureRequestRow, "id">,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<void> {
  let row = await reread(client, request.id);
  if (row.status !== "completed" && !canMoveTo(row.status, "completed")) return;
  const youtrustId = row.youtrust_request_id;
  if (!youtrustId) throw new Error("This request was never sent to Youtrust.");

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
}
