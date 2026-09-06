import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, errorMessage } from "./index";
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("account") === "password",
  );
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (!next) {
        setRole(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session || !supabase) return;
    let active = true;
    setLoading(true);
    setError("");
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (active) {
          setRole(data?.role ?? null);
          setError(error ? errorMessage(error) : "");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  return {
    session,
    role,
    loading,
    error,
    recovery,
    finishRecovery: () => {
      setRecovery(false);
      history.replaceState(null, "", location.pathname);
    },
  };
}
export type AuthState = ReturnType<typeof useAuth>;
