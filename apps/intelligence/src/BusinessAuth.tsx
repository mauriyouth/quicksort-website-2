import { SignIn, useClerk } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import { db } from "@quicksort/candidate-db";
import { useAuth } from "@quicksort/candidate-db/auth";

function Brand() {
  return <a className="auth-brand" href="https://www.quicksort.fr" aria-label="Quicksort home">
    <span className="auth-brand-mark" aria-hidden="true"><i/><b/></span>
    <span>Quicksort</span>
  </a>;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="business-auth">
    <section className="business-auth-story">
      <Brand/>
      <div><span>Business intelligence</span><h1>Know the account.<br/><em>Move with context.</em></h1><p>Commercial relationships, delivery evidence and opportunities in one private QuickSort workspace.</p></div>
      <small>QuickSort · Paris, France</small>
    </section>
    <section className="business-auth-main"><div className="business-auth-box">{children}</div></section>
  </main>;
}

function AccessPending({ userId }: { userId: string }) {
  const clerk = useClerk();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    db().from("admin_access_requests").select("status").eq("user_id", userId).maybeSingle().then(({ data, error }) => {
      if (active) { setStatus(data?.status ?? null); if (error) setError(error.message); }
    });
    return () => { active = false; };
  }, [userId]);
  async function requestAccess() {
    setBusy(true); setError("");
    const { error } = await db().from("admin_access_requests").insert({ user_id: userId });
    if (error && error.code !== "23505") setError(error.message); else setStatus("pending");
    setBusy(false);
  }
  return <AuthLayout><span className="auth-eyebrow">Business access</span><h2>{status === "pending" ? "Awaiting approval." : status === "revoked" ? "Access revoked." : status === "rejected" ? "Request not approved." : "Approval required."}</h2><p>Your account is signed in. Business Intelligence currently requires administrator access approved in the QuickSort Admin portal.</p>{error && <div className="auth-error" role="alert">{error}</div>}{!status && <button className="auth-primary" disabled={busy} onClick={requestAccess}>{busy ? "Sending…" : "Request administrator access"}</button>}<button className="auth-link" onClick={() => clerk.signOut()}>Sign out</button></AuthLayout>;
}

export function BusinessAuth({ children }: { children: (email: string) => ReactNode }) {
  const auth = useAuth();
  const clerk = useClerk();
  if (auth.loading) return <div className="business-auth-loading" role="status">Opening your workspace…</div>;
  if (auth.error) return <AuthLayout><span className="auth-eyebrow">Business intelligence</span><h2>Workspace unavailable.</h2><div className="auth-error" role="alert">{auth.error}</div><button className="auth-primary" onClick={() => location.reload()}>Retry</button><button className="auth-link" onClick={() => clerk.signOut()}>Sign out</button></AuthLayout>;
  if (!auth.session) return <AuthLayout><span className="auth-eyebrow">Business portal</span><h2>Welcome to QuickSort.</h2><p>Continue with your company account. Workspace access requires administrator approval.</p><SignIn routing="hash" forceRedirectUrl={location.origin + location.pathname + location.search} signUpForceRedirectUrl={location.origin + location.pathname + location.search}/></AuthLayout>;
  if (auth.role !== "admin") return <AccessPending userId={auth.session.user.id}/>;
  return <>{children(auth.session.user.email)}</>;
}

export function AuthFailure() {
  return <AuthLayout><span className="auth-eyebrow">Business intelligence</span><h2>Sign-in setup is in progress.</h2><p>Contact QuickSort to finish connecting this workspace.</p></AuthLayout>;
}
