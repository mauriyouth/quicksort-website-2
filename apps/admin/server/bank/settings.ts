import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../ai-settings.ts";
import { DEFAULT_KIMI_MODEL } from "./classifier.ts";

export const CLASSIFIER_ID = "bank-classifier";
export const CLASSIFIER_AAD = "quicksort/bank-classifier/v1";

export type ClassifierSettings = { apiKey: string; model: string; source: "settings" | "environment" | "none" };

export async function loadClassifierSettings(client: SupabaseClient): Promise<ClassifierSettings> {
  const { data, error } = await client.from("ai_settings").select("encrypted_key,model").eq("id", CLASSIFIER_ID).maybeSingle();
  if (error) throw new Error("Could not read classifier settings.");
  if (data) return { apiKey: decryptSecret(data.encrypted_key, CLASSIFIER_AAD), model: data.model, source: "settings" };
  const apiKey = process.env.MOONSHOT_API_KEY || "";
  return { apiKey, model: DEFAULT_KIMI_MODEL, source: apiKey ? "environment" : "none" };
}

/** With `apiKey`, stores a new encrypted key. Without, keeps the stored key (or the environment key) and only changes the model. */
export async function saveClassifierSettings(
  client: SupabaseClient,
  input: { apiKey?: string; model: string },
  now: Date = new Date(),
): Promise<void> {
  let apiKey = input.apiKey;
  if (!apiKey) {
    const current = await loadClassifierSettings(client);
    if (!current.apiKey) throw new Error("No Kimi API key to keep.");
    apiKey = current.apiKey;
  }
  const result = await client.from("ai_settings").upsert(
    { id: CLASSIFIER_ID, encrypted_key: encryptSecret(apiKey, CLASSIFIER_AAD), model: input.model, updated_at: now.toISOString() },
    { onConflict: "id" },
  );
  if (result.error) throw new Error("Could not save classifier settings.");
}
