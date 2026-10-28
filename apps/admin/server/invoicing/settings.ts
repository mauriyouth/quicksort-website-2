import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../ai-settings.ts";
import { createQontoProvider } from "./qonto.ts";
import type { InvoicingProvider } from "./provider.ts";

export const INVOICING_AAD = "quicksort/invoicing/v1";
export const DEFAULT_DUE_DAYS = 30;

export type InvoicingSettings = {
  provider: "qonto"; login: string; iban: string; staging: boolean; dueDays: number;
  startMonth: string | null; lastSyncedAt: string | null; hasSecret: boolean;
};
export type Credentials = { secret: string | null; stagingToken: string | null };

export function encryptCredentials(credentials: Credentials) {
  return encryptSecret(JSON.stringify(credentials), INVOICING_AAD);
}

function decryptCredentials(value: string | null | undefined): Credentials {
  if (!value) return { secret: null, stagingToken: null };
  const parsed = JSON.parse(decryptSecret(value, INVOICING_AAD));
  return { secret: parsed?.secret || null, stagingToken: parsed?.stagingToken || null };
}

export async function loadInvoicingSettings(client: SupabaseClient): Promise<InvoicingSettings & Credentials> {
  const { data, error } = await client.from("invoicing_settings").select("*").eq("id", "default").maybeSingle();
  if (error) throw new Error("Could not read invoicing settings.");
  const options = (data?.options ?? {}) as Record<string, unknown>;
  const credentials = decryptCredentials(data?.encrypted_credentials);
  return {
    provider: "qonto",
    login: typeof options.login === "string" ? options.login : "",
    iban: typeof options.iban === "string" ? options.iban : "",
    staging: options.staging === true,
    dueDays: typeof options.due_days === "number" ? options.due_days : DEFAULT_DUE_DAYS,
    startMonth: typeof data?.start_month === "string" ? data.start_month.slice(0, 7) : null,
    lastSyncedAt: data?.last_synced_at ?? null,
    hasSecret: Boolean(credentials.secret),
    ...credentials,
  };
}

export function providerFromSettings(
  s: { login: string; iban: string; staging: boolean; secret: string | null; stagingToken: string | null },
  fetchImpl?: typeof fetch,
): InvoicingProvider {
  if (!s.secret) throw new Error("Invoicing provider is not configured.");
  if (s.staging && !s.stagingToken) throw new Error("Add the Qonto staging token to use the sandbox.");
  return createQontoProvider({
    login: s.login, secretKey: s.secret, iban: s.iban,
    ...(s.staging && s.stagingToken ? { stagingToken: s.stagingToken } : {}),
  }, fetchImpl);
}
