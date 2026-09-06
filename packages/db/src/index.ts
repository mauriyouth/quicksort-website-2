import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export type { Database } from "./database.types";
export type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Job = Row<"jobs">;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key);
export const supabase = configured ? createClient<Database>(url, key) : null;
// Marketing pages never reuse an authenticated admin session, even on localhost.
export const publicDb = configured
  ? createClient<Database>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "quicksort-public",
      },
    })
  : null;
export function db() {
  if (!supabase)
    throw new Error(
      "This portal is not connected yet. Please contact Quicksort.",
    );
  return supabase;
}
export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Something went wrong. Please try again.";
}
export async function downloadFile(bucket: string, path: string, name: string) {
  const { data, error } = await db().storage.from(bucket).download(path);
  if (error) throw error;
  saveBlob(data, name);
}
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function sha256(file: File) {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
