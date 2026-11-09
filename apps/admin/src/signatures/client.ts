import { getSessionToken } from "@quicksort/hr-db";

/**
 * Browser side of Youtrust signing: every call is a POST { action, ... } to
 * /api/signatures (apps/admin/api/signatures.ts), admins only. The token is
 * the Clerk "supabase" session token, as for /api/google-drive.
 */
export async function postSignatures<T>(action: { action: string } & Record<string, unknown>): Promise<T> {
  const token = await getSessionToken();
  if (!token) throw new Error("Sign in again to manage signatures.");
  const response = await fetch("/api/signatures", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("The signatures service is unavailable. Deploy the updated admin app first.");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The signatures request failed.");
  return result as T;
}

export type SignerKind = "person_and_quicksort" | "person" | "quicksort";
export type Signer = { role: "person" | "quicksort"; name: string; email: string; order: number };
export type SignatureSettings = {
  staging: boolean;
  signatoryName: string;
  signatoryEmail: string;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  serviceAccountEmail?: string;
  webhookUrl?: string;
};
export type SignatureTemplate = { id: string; name: string; google_doc_id: string; signers: SignerKind; type_code: string; active: boolean };
export type RequestStatus = "draft" | "sending" | "sent" | "signed_by_person" | "completed" | "declined" | "expired" | "cancelled" | "error";
export type SignatureRequest = {
  id: string;
  person_id: string;
  template_id: string | null;
  title: string;
  type_code: string;
  signers: Signer[];
  supersedes: string | null;
  status: RequestStatus;
  error: string;
  youtrust_request_id: string | null;
  signed_document_id: string | null;
  audit_document_id: string | null;
  created_at: string;
  updated_at: string;
};
export type PreparedField = { name: string; value: string; known: boolean };

export const SIGNER_LABELS: Record<SignerKind, string> = {
  person_and_quicksort: "Person, then Quicksort",
  person: "Person only",
  quicksort: "Quicksort only",
};
