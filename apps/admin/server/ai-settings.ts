import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function settingsReady() { return /^[a-fA-F0-9]{64}$/.test(process.env.AI_SETTINGS_ENCRYPTION_KEY || ""); }
function encryptionKey() {
  if (!settingsReady()) throw new Error("Settings encryption is not configured.");
  return Buffer.from(process.env.AI_SETTINGS_ENCRYPTION_KEY!, "hex");
}
export function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("quicksort/cv-analyzer/v1"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}
export function decryptApiKey(value: string) {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("Invalid encrypted setting.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from("quicksort/cv-analyzer/v1"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
export async function loadAiSettings(client: SupabaseClient) {
  const { data, error } = await client.from("ai_settings").select("encrypted_key,model,updated_at").eq("id", "cv-analyzer").maybeSingle();
  // Existing environment-based installations work before the new migration is applied.
  if (error && !["42P01", "PGRST205"].includes(error.code)) throw new Error("Could not read AI settings.");
  if (data) return { apiKey: decryptApiKey(data.encrypted_key), model: data.model };
  return { apiKey: process.env.OPENAI_API_KEY || "", model: process.env.CV_ANALYZER_MODEL || "gpt-4.1-mini" };
}
