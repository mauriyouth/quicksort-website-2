import { useSession } from "@clerk/react";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(supabaseUrl && supabaseKey);
let sessionToken: () => Promise<string | null> = async () => null;

const client = configured
  ? createClient(supabaseUrl, supabaseKey, { accessToken: () => sessionToken() })
  : null;

export function db() {
  if (!client) throw new Error("This portal is not connected yet. Please contact Quicksort.");
  return client;
}

type WorkspaceIdentity = {
  clerkSessionId: string;
  session: { user: { id: string; email: string } };
  role: string | null;
};

export function useWorkspaceAuth() {
  const { session: clerkSession, isLoaded } = useSession();
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    setIdentity(null);
    setError("");
    sessionToken = async () => clerkSession?.getToken() ?? null;
    if (!isLoaded) return;
    if (!clerkSession || !configured) { setLoading(false); return; }
    setLoading(true);

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const database = db();
        const { data: userId, error: syncError } = await database.rpc("sync_clerk_profile");
        if (syncError) throw syncError;
        if (!userId) throw new Error("Your workspace profile could not be opened.");
        const [roles, profile] = await Promise.all([
          database.from("user_roles").select("role").eq("user_id", userId).single(),
          database.from("profiles").select("email").eq("id", userId).single(),
        ]);
        if (roles.error) throw roles.error;
        if (profile.error) throw profile.error;
        if (active) {
          setIdentity({
            clerkSessionId: clerkSession!.id,
            session: { user: { id: userId, email: profile.data.email } },
            role: roles.data.role,
          });
          setError("");
        }
      } catch (problem) {
        if (active) {
          setIdentity(null);
          setError(problem && typeof problem === "object" && "message" in problem
            ? String(problem.message)
            : "Something went wrong. Please try again.");
        }
      } finally {
        refreshing = false;
        if (active) setLoading(false);
      }
    }

    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      sessionToken = async () => null;
    };
  }, [clerkSession?.id, isLoaded]);

  const current = identity?.clerkSessionId === clerkSession?.id ? identity : null;
  return {
    session: current?.session ?? null,
    role: current?.role ?? null,
    loading: !isLoaded || loading,
    error,
  };
}
