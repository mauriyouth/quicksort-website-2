import { createClient } from "@supabase/supabase-js";

export type OwnerAuth = { userId: string } | { error: string; status: number };

/** Verifies the Clerk→Supabase token and requires portal owner membership. */
export async function requirePortalOwner(authorization: string | string[] | undefined): Promise<OwnerAuth> {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return { error: "Sign in to manage AI settings.", status: 401 };
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { error: "Portal connection is not configured.", status: 503 };
  const client = createClient(url, key, { accessToken: async () => authorization.slice(7) });
  const identity = await client.rpc("sync_clerk_profile");
  if (identity.error || !identity.data) return { error: "Sign in again.", status: 401 };
  const owner = await client.from("portal_owners").select("user_id").eq("user_id", identity.data).maybeSingle();
  if (owner.error || !owner.data) return { error: "Only portal owners can manage the AI key.", status: 403 };
  return { userId: identity.data as string };
}
