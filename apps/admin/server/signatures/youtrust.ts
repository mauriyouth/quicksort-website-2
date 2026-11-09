// Youtrust (formerly Yousign) e-signature API v3 client.
//
// Confirmed against the official reference (developers.yousign.com 301-redirects to
// developers.youtrust.com), 2026-11-09:
// - Base URLs: https://api.yousign.app/v3 (prod), https://api-sandbox.yousign.app/v3 (sandbox);
//   auth `Authorization: Bearer <key>`.
//   https://developers.youtrust.com/reference/post-signature_requests-1.md
// - POST /signature_requests {name, delivery_mode: none|email, ordered_signers, external_id}.
//   external_id must match ^[\w\-@.%+]+$ (max 255).
// - POST /signature_requests/{id}/documents (multipart: file, nature=signable_document) ->
//   201 {id, total_pages, ...}. total_pages gives the page count, so no pdf parsing is needed.
//   https://developers.youtrust.com/reference/post-signature_requests-signaturerequestid-documents-1.md
// - POST /signature_requests/{id}/signers: info{first_name,last_name,email,locale} all required,
//   signature_level=electronic_signature, signature_authentication_mode=otp_email (matches brief),
//   fields[{type:"signature",document_id,page,x,y,width,height}]. There is NO `order` field:
//   sequencing is `insert_after_id` (previous signer id) with ordered_signers=true.
//   https://developers.youtrust.com/reference/post-signature_requests-signaturerequestid-signers-1.md
// - POST .../activate; DELETE /signature_requests/{id} (draft cleanup).
// - POST .../cancel {reason: contractualization_aborted|errors_in_document|other, custom_note<=500};
//   only valid in approval/ongoing status. The brief's free-text reason goes in custom_note.
//   https://developers.youtrust.com/reference/post-signature_requests-signaturerequestid-cancel-1.md
// - GET /signature_requests/{id}: status enum draft|ongoing|done|deleted|expired|canceled|approval|
//   rejected|declined|paused; its signers[] carry no email, so getStatus also calls
//   GET /signature_requests/{id}/signers (each has info.email and status).
// - GET .../documents/download (signed PDF; a single document is returned as PDF) and
//   GET .../audit_trails/download (PDF, only when status is done).
//   https://developers.youtrust.com/reference/electronic-signature/llms.txt
// Smart anchors are marked "Available soon" in the reference, so the signature field is placed at
// a fixed position on the last page.

export type YoutrustSigner = { name: string; email: string; order: number };
export type YoutrustStatus =
  "draft" | "ongoing" | "done" | "declined" | "expired" | "canceled" | "approval" | "rejected" | "deleted";

export class YoutrustError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YoutrustError";
    this.status = status;
  }
}

export interface YoutrustClient {
  createRequest(input: {
    name: string; signers: YoutrustSigner[]; pdf: Uint8Array; fileName: string; externalId: string;
  }): Promise<{ requestId: string; documentId: string }>;
  getStatus(requestId: string): Promise<{ status: YoutrustStatus; signers: { email: string; status: string }[] }>;
  cancel(requestId: string, reason: string): Promise<void>;
  downloadSigned(requestId: string): Promise<Uint8Array>;
  downloadAuditTrail(requestId: string): Promise<Uint8Array>;
}

const PROD_URL = "https://api.yousign.app/v3";
const SANDBOX_URL = "https://api-sandbox.yousign.app/v3";

// Signature box: 180pt wide, near the bottom of the page, signers side by side.
const FIELD_WIDTH = 180;
const FIELD_Y = 650;

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] || "-", last_name: parts[0] || "-" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function createYoutrustClient(
  { apiKey, staging }: { apiKey: string; staging: boolean },
  fetchImpl: typeof fetch = fetch,
): YoutrustClient {
  const base = staging ? SANDBOX_URL : PROD_URL;

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(`${base}${path}`, { method, headers, body: payload });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new YoutrustError(`Youtrust ${method} ${path} failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status);
    }
    return res;
  }
  const callJson = async (method: string, path: string, body?: unknown) =>
    (await call(method, path, body)).json() as Promise<any>;
  const callBytes = async (path: string) => new Uint8Array(await (await call("GET", path)).arrayBuffer());

  return {
    async createRequest({ name, signers, pdf, fileName, externalId }) {
      const created = await callJson("POST", "/signature_requests", {
        name, delivery_mode: "email", ordered_signers: true, external_id: externalId,
      });
      const requestId: string = created.id;
      try {
        const form = new FormData();
        form.append("file", new Blob([pdf], { type: "application/pdf" }), fileName);
        form.append("nature", "signable_document");
        const doc = await callJson("POST", `/signature_requests/${requestId}/documents`, form);
        const documentId: string = doc.id;
        const lastPage: number = doc.total_pages ?? 1;

        let previousId: string | null = null;
        const ordered = [...signers].sort((a, b) => a.order - b.order);
        for (const [i, signer] of ordered.entries()) {
          const added: any = await callJson("POST", `/signature_requests/${requestId}/signers`, {
            info: { ...splitName(signer.name), email: signer.email, locale: "fr" },
            ...(previousId ? { insert_after_id: previousId } : {}),
            signature_level: "electronic_signature",
            signature_authentication_mode: "otp_email",
            fields: [{
              type: "signature", document_id: documentId, page: lastPage,
              x: 60 + i * (FIELD_WIDTH + 40), y: FIELD_Y, width: FIELD_WIDTH,
            }],
          });
          previousId = added.id;
        }
        await call("POST", `/signature_requests/${requestId}/activate`);
        return { requestId, documentId };
      } catch (err) {
        // Best effort: do not leave an orphaned draft behind.
        try { await call("DELETE", `/signature_requests/${requestId}`); } catch { /* ignore */ }
        throw err;
      }
    },

    async getStatus(requestId) {
      const req = await callJson("GET", `/signature_requests/${requestId}`);
      const list = await callJson("GET", `/signature_requests/${requestId}/signers`);
      const rows: any[] = Array.isArray(list) ? list : list?.data ?? [];
      return {
        status: req.status as YoutrustStatus,
        signers: rows.map((s) => ({ email: String(s?.info?.email ?? ""), status: String(s?.status ?? "") })),
      };
    },

    async cancel(requestId, reason) {
      await call("POST", `/signature_requests/${requestId}/cancel`, {
        reason: "other", custom_note: reason.slice(0, 500),
      });
    },

    downloadSigned: (requestId) => callBytes(`/signature_requests/${requestId}/documents/download`),
    downloadAuditTrail: (requestId) => callBytes(`/signature_requests/${requestId}/audit_trails/download`),
  };
}
