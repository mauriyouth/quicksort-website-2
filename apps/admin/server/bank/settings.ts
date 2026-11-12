import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../ai-settings.ts";
import { DEFAULT_KIMI_MODEL } from "./classifier.ts";

export const CLASSIFIER_ID = "bank-classifier";
export const CLASSIFIER_AAD = "quicksort/bank-classifier/v1";

/** "invalid": a stored key exists but cannot be decrypted; the sync then runs without a classifier. */
export type ClassifierSettings = { apiKey: string; model: string; source: "settings" | "environment" | "none" | "invalid" };

/** The caller may not write ai_settings (RLS: portal owners only). */
export class ClassifierForbiddenError extends Error {}

export async function loadClassifierSettings(client: SupabaseClient): Promise<ClassifierSettings> {
  const { data, error } = await client.from("ai_settings").select("encrypted_key,model").eq("id", CLASSIFIER_ID).maybeSingle();
  if (error) throw new Error("Could not read classifier settings.");
  if (data) {
    try {
      return { apiKey: decryptSecret(data.encrypted_key, CLASSIFIER_AAD), model: data.model, source: "settings" };
    } catch {
      return { apiKey: "", model: data.model, source: "invalid" };
    }
  }
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
  ).select("id");
  const { error } = result;
  if (error && (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? ""))) {
    throw new ClassifierForbiddenError("Seuls les propriétaires du portail peuvent modifier cette clé.");
  }
  if (error) throw new Error("Could not save classifier settings.");
  if (!result.data || result.data.length === 0) {
    throw new ClassifierForbiddenError("Seuls les propriétaires du portail peuvent modifier cette clé.");
  }
}
