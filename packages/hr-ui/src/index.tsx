export { usePortalRoute, resolvePortalRoute } from './routes';
// Design-system library — re-exported so portal apps depend on one package.
export {
  ThemeToggle,
  Logo,
  LogoMark,
  getTheme,
  setTheme,
  restoreTheme,
  type QuicksortTheme,
} from "@quicksort/design-system";
import {
  ThemeToggle,
} from "@quicksort/design-system";
import { SignIn, useClerk } from "@clerk/react";
import { useEffect, useState, type ReactNode } from "react";
import {
  LogOut,
  ShieldCheck,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { db, configured, errorMessage } from "@quicksort/hr-db";
import type { AuthState } from "@quicksort/hr-db/auth";
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
export type ShellNavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  children?: { id: string; href: string; label: string }[];
};
function currentLabel(nav: ShellNavItem[], current: string) {
  const top = nav.find((n) => n.id === current);
  if (top) return top.label;
  const child = nav.flatMap((n) => n.children ?? []).find((c) => c.id === current);
  return child?.label ?? "Page not found";
}
export function Shell({
  portal,
  email,
  nav,
  current,
  onNavigate,
  children,
  hideSubmenu = false,
  hideTopbar = false,
  sidebarAction,
}: {
  portal: string;
  email: string;
  nav: ShellNavItem[];
  current: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
  /** Suppress the automatic section submenu (screens that render their own). */
  hideSubmenu?: boolean;
  /** Suppress the breadcrumb top bar (screens styled without one). */
  hideTopbar?: boolean;
  /** Optional control rendered in the sidebar under the portal label. */
  sidebarAction?: ReactNode;
}) {
  const [error, setError] = useState("");
  const clerk = useClerk();
  const [collapsed, setCollapsed] = useState(
    () => {
      try { return localStorage.getItem("qs-shell-collapsed") === "1"; } catch { return false; }
    },
  );
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("qs-shell-collapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }
  // Section page (e.g. "/hr") shows its horizontal submenu, including when
  // the section landing route itself is the current page (e.g. "/sales").
  const submenu = hideSubmenu
    ? undefined
    : nav.find((item) =>
    item.children &&
    (item.children.some((child) => child.id === current) || item.id === current),
  );
  async function signOut() {
    try { await clerk.signOut(); } catch (error) { setError(errorMessage(error)); }
  }
  return (
    <div className={`shell ${collapsed ? "shell-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand />
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="portal-label">{portal} workspace</div>
        {sidebarAction}
        <nav className="nav" aria-label="Main navigation">
          {nav.map((item) => {
            const sectionActive = !!item.children?.some(
              (child) => child.id === current,
            );
            const active = current === item.id || sectionActive;
            return (
              <a href={item.href}
                key={item.id}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                title={item.label}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNavigate(item.id);
                }}
              >
                <item.icon size={18} />
                <span className="nav-label">{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={22} />
          <p className="sidebar-bottom-text">
            Your Quicksort workspace.
            <br />
            Connected, from day one.
          </p>
          <p className="sidebar-bottom-text">{email}</p>
          <button onClick={signOut}>
            <LogOut size={15} />
            <span className="sidebar-bottom-text">Sign out</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        {!hideTopbar && (
        <header className="topbar">
          <strong>
            {portal} / {currentLabel(nav, current)}
          </strong>
          <div className="topbar-actions">
            <ThemeToggle size="sm" />
            <button className="link-button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        )}
        <main className="content">
          <Notice error>{error}</Notice>
          {submenu && (
            <nav className="submenu" aria-label={`${submenu.label} sections`}>
              {submenu.children!.map((child) => (
                <a
                  href={child.href}
                  key={child.id}
                  className={current === child.id ? "active" : ""}
                  aria-current={current === child.id ? "page" : undefined}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNavigate(child.id);
                  }}
                >
                  {child.label}
                </a>
              ))}
            </nav>
          )}
          {current === 'not-found' ? <Empty title="Page not found" action={<a href={nav[0].href}>Return to your workspace</a>}>Choose a section from the navigation.</Empty> : children}
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
  return <><div className="eyebrow">{admin ? "Admin" : "HR"} portal</div>
    <h2>Welcome to Quicksort.</h2><p className="muted">{admin ? "Continue with Google. Workspace access requires owner approval." : "Continue with Google to follow your application, view your contracts and start onboarding."}</p>
    <SignIn routing="hash" forceRedirectUrl={location.origin + location.pathname + location.search} signUpForceRedirectUrl={location.origin + location.pathname + location.search} />
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
