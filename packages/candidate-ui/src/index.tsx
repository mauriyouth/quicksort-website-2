import { SignIn, useClerk } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  LogOut,
  ShieldCheck,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { db, configured, errorMessage } from "@quicksort/candidate-db";
import type { AuthState } from "@quicksort/candidate-db/auth";
export function Brand() {
  return (
    <a className="brand" href="https://www.quicksort.fr" aria-label="Quicksort home">
      {/* Exact geometry and lettering from the live Quicksort.fr header. */}
      <span className="brand-word">Quicksort</span>
      <span className="brand-symbol" aria-hidden="true">
        <span className="brand-disc" />
        <span className="brand-cut" />
        <span className="brand-dot" />
      </span>
    </a>
  );
}
export function Notice({
  error,
  children,
}: {
  error?: boolean;
  children: ReactNode;
}) {
  return children ? (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <CircleHelp size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Pill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status}</span>;
}
export function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        {label}
        <Icon size={18} />
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function Shell({
  portal,
  email,
  nav,
  current,
  onNavigate,
  children,
}: {
  portal: string;
  email: string;
  nav: { id: string; label: string; icon: LucideIcon }[];
  current: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  const clerk = useClerk();
  async function signOut() {
    try { await clerk.signOut(); } catch (error) { setError(errorMessage(error)); }
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="portal-label">{portal} workspace</div>
        <nav className="nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={current === id ? "active" : ""}
              aria-current={current === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={22} />
          <p>
            Your Quicksort workspace.
            <br />
            Connected, from day one.
          </p>
          <p>{email}</p>
          <button onClick={signOut}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <strong>
            {portal} / {nav.find((n) => n.id === current)?.label}
          </strong>
          <button className="link-button" onClick={signOut}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Notice error>{error}</Notice>
          {children}
        </main>
      </div>
    </div>
  );
}
export function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function AuthGate({
  auth,
  admin = false,
  children,
}: {
  auth: AuthState;
  admin?: boolean;
  children: ReactNode;
}) {
  const clerk = useClerk();
  if (!configured)
    return (
      <AuthLayout admin={admin}>
        <h2>Workspace coming online</h2>
        <p className="muted">
          This portal is not connected yet. Please contact Quicksort to complete
          setup.
        </p>
      </AuthLayout>
    );
  if (auth.loading)
    return (
      <div className="loading" role="status">
        Opening your workspace…
      </div>
    );
  if (auth.error)
    return (
      <AuthLayout admin={admin}>
        <Notice error>{auth.error}</Notice>
        <button className="btn" onClick={() => location.reload()}>
          Retry
        </button>
        <button className="link-button" onClick={() => clerk.signOut()}>Sign out</button>
      </AuthLayout>
    );
  if (!auth.session) return <AuthLayout admin={admin}><AuthForm admin={admin} /></AuthLayout>;
  if (admin && auth.role !== "admin") return <AuthLayout admin><AdminAccessPending userId={auth.session.user.id} /></AuthLayout>;
  return <>{children}</>;
}
function AuthLayout({
  admin,
  children,
}: {
  admin?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div>
          <div className="eyebrow">Human + AI. Better, together.</div>
          <h1>
            {admin ? "Great teams." : "Your next chapter."}
            <br />
            <span>{admin ? "Start here." : "Starts here."}</span>
          </h1>
          <p>
            {admin
              ? "Bring the right people on board. Manage opportunities, documents and access from your team’s workspace."
              : "Get ready for your first day. Share your documents, review your contracts and get the tools you need."}
          </p>
        </div>
        <div className="eyebrow">Quicksort · Paris, France</div>
      </section>
      <section className="auth-main">
        <div className="auth-box">{children}</div>
      </section>
    </div>
  );
}
function AuthForm({ admin }: { admin: boolean }) {
  return <><div className="eyebrow">{admin ? "Admin" : "Candidate"} portal</div>
    <h2>Welcome to Quicksort.</h2><p className="muted">{admin ? "Continue with Google. Workspace access requires owner approval." : "Continue with Google to view your contracts and start onboarding."}</p>
    <SignIn routing="hash" forceRedirectUrl={location.origin + "/"} signUpForceRedirectUrl={location.origin + "/"} />
  </>;
}
export function AccountSecurity() {
  const clerk = useClerk();
  return <><h2>Your account</h2><p className="muted">Manage your Google connection and active sessions.</p><button className="btn" onClick={() => clerk.openUserProfile()}>Manage account</button></>;
}
export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function AdminAccessPending({userId}:{userId:string}){
  const clerk = useClerk();
  const [status,setStatus]=useState<string|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;db().from("admin_access_requests").select("status").eq("user_id",userId).maybeSingle().then(({data,error})=>{if(active){setStatus(data?.status??null);if(error)setError(error.message)}});return()=>{active=false}},[userId]);
  async function request(){setBusy(true);setError("");const {error}=await db().from("admin_access_requests").insert({user_id:userId});if(error&&error.code!=="23505")setError(error.message);else setStatus("pending");setBusy(false)}
  return <><div className="eyebrow">Admin access</div><h2>{status==="pending"?"Awaiting approval.":status==="revoked"?"Access revoked.":status==="rejected"?"Request not approved.":"Approval required."}</h2><p className="muted">You are signed in. Only accounts approved by Quicksort’s owners can enter the admin workspace.</p><Notice error>{error}</Notice>{status?<p className="muted">{status==="pending"?"Your request is with the owners. This page checks for approval automatically.":"Contact a workspace owner to discuss your access."}</p>:<button className="btn" disabled={busy} onClick={request}>{busy?"Sending…":"Request admin access"}</button>}<button className="link-button" style={{marginTop:24,display:"block"}} onClick={()=>clerk.signOut()}>Sign out</button></>;
}
