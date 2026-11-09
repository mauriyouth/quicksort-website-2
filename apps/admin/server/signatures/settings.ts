import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../ai-settings.ts";
import { NotConfiguredError } from "../bank/run.ts";
import { createYoutrustClient } from "./youtrust.ts";
import type { YoutrustClient } from "./youtrust.ts";

export const SIGNATURES_AAD = "quicksort/signatures/v1";

export type SignatureSettings = {
  staging: boolean; signatoryName: string; signatoryEmail: string; hasApiKey: boolean; hasWebhookSecret: boolean;
};
export type SignatureCredentials = { apiKey: string | null; webhookSecret: string | null };

export function encryptSignatureCredentials(credentials: SignatureCredentials) {
  return encryptSecret(JSON.stringify(credentials), SIGNATURES_AAD);
}

/**
 * Credentials that cannot be decrypted (e.g. after the encryption key changed)
 * are treated as absent, so HR can enter them again in Settings.
 */
function decryptCredentials(value: string | null | undefined): SignatureCredentials {
  if (!value) return { apiKey: null, webhookSecret: null };
  try {
    const parsed = JSON.parse(decryptSecret(value, SIGNATURES_AAD));
    return { apiKey: parsed?.apiKey || null, webhookSecret: parsed?.webhookSecret || null };
  } catch (error) {
    console.error("signatures: the stored Youtrust credentials cannot be decrypted; treating them as absent.", (error as Error)?.message);
    return { apiKey: null, webhookSecret: null };
  }
}

export async function loadSignatureSettings(
  client: SupabaseClient,
): Promise<SignatureSettings & SignatureCredentials> {
  const { data, error } = await client.from("signature_settings").select("*").eq("id", "default").maybeSingle();
  if (error) throw new Error("Could not read signature settings.");
  const options = (data?.options ?? {}) as Record<string, unknown>;
  const credentials = decryptCredentials(data?.encrypted_credentials);
  return {
    staging: options.staging === true,
    signatoryName: typeof options.signatory_name === "string" ? options.signatory_name : "",
    signatoryEmail: typeof options.signatory_email === "string" ? options.signatory_email : "",
    hasApiKey: Boolean(credentials.apiKey),
    hasWebhookSecret: Boolean(credentials.webhookSecret),
    ...credentials,
  };
}

export function youtrustFromSettings(
  s: { staging: boolean; apiKey: string | null },
  fetchImpl?: typeof fetch,
): YoutrustClient {
  if (!s.apiKey) throw new NotConfiguredError("Connect Youtrust in Settings → Signatures first.");
  return createYoutrustClient({ apiKey: s.apiKey, staging: s.staging }, fetchImpl);
}
