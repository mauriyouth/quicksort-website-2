import { useEffect, useState } from "react";
import { useSession } from "@clerk/react";
import { db, configured, setSessionToken, errorMessage } from "./index";

type WorkspaceIdentity = {
  clerkSessionId: string;
  session: { user: { id: string; email: string } };
  role: string | null;
  isOwner: boolean;
};
export function useAuth() {
  const { session: clerkSession, isLoaded } = useSession();
  const [identity, setIdentity] = useState<WorkspaceIdentity | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    setIdentity(null);
    setError("");
    setSessionToken(async () => clerkSession?.getToken() ?? null);
    if (!isLoaded) return;
    if (!clerkSession || !configured) { setLoading(false); return; }
    setLoading(true);
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const client = db();
        const {data: userId, error: syncError} = await client.rpc("sync_clerk_profile");
        if (syncError) throw syncError;
        if (!userId) throw new Error("Your workspace profile could not be opened.");
        const [roles, owners, profile] = await Promise.all([
          client.from("user_roles").select("role").eq("user_id",userId).single(),
          client.from("portal_owners").select("user_id").eq("user_id",userId).maybeSingle(),
          client.from("profiles").select("email").eq("id",userId).single(),
        ]);
        if (roles.error) throw roles.error;
        if (owners.error) throw owners.error;
        if (profile.error) throw profile.error;
        if (active) {
          setIdentity({clerkSessionId: clerkSession!.id, session: {user: {id:userId,email:profile.data.email}}, role:roles.data.role, isOwner:Boolean(owners.data)});
          setError("");
        }
      } catch (err) { if (active) { setIdentity(null); setError(errorMessage(err)); } }
      finally { refreshing=false; if (active) setLoading(false); }
    }
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus",refresh);
    return () => { active=false; clearInterval(timer); window.removeEventListener("focus",refresh); setSessionToken(async()=>null); };
  }, [clerkSession?.id, isLoaded]);
  const current = identity?.clerkSessionId === clerkSession?.id ? identity : null;
  return {session:current?.session??null,role:current?.role??null,isOwner:current?.isOwner??false,loading:!isLoaded||loading,error};
}
export type AuthState = ReturnType<typeof useAuth>;
