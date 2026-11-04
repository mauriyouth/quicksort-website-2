import type { SupabaseClient } from "@supabase/supabase-js";
import { createKimiClassifier } from "./classifier.ts";
import { createQontoTransactions } from "./qonto-transactions.ts";
import { runBankSync } from "./sync.ts";
import type { BankSyncResult } from "./sync.ts";
import { loadClassifierSettings } from "./settings.ts";
import { createSupabaseBankStore } from "./store.ts";
import { loadInvoicingSettings } from "../invoicing/settings.ts";

export const QONTO_NOT_CONNECTED = "Connectez Qonto dans les réglages de facturation.";

export class NotConfiguredError extends Error {}

export type RunDeps = { fetch?: typeof fetch; now?: () => Date; runBankSync?: typeof runBankSync };

/** Wires the stores and clients from saved settings, then runs one sync pass. */
export async function syncWithSettings(client: SupabaseClient, deps: RunDeps = {}): Promise<BankSyncResult> {
  const qontoSettings = await loadInvoicingSettings(client);
  if (!qontoSettings.secret) throw new NotConfiguredError(QONTO_NOT_CONNECTED);
  const classifierSettings = await loadClassifierSettings(client);
  const fetchImpl = deps.fetch ?? fetch;
  const qonto = createQontoTransactions({
    login: qontoSettings.login, secretKey: qontoSettings.secret, iban: qontoSettings.iban,
    ...(qontoSettings.staging && qontoSettings.stagingToken ? { stagingToken: qontoSettings.stagingToken } : {}),
  }, fetchImpl);
  return (deps.runBankSync ?? runBankSync)({
    store: createSupabaseBankStore(client),
    qonto,
    classifier: classifierSettings.apiKey ? createKimiClassifier({ apiKey: classifierSettings.apiKey, model: classifierSettings.model }, fetchImpl) : null,
    model: classifierSettings.model,
    now: deps.now ?? (() => new Date()),
  });
}
