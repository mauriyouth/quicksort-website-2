import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  LogOut,
  ShieldCheck,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { db, configured, errorMessage } from "@quicksort/db";
import type { AuthState } from "@quicksort/db/auth";
export function Brand() {
  return (
    <a className="brand" href="https://www.quicksort.fr" aria-label="Quicksort home"><img src={new URL("./assets/quicksort-wordmark.svg", import.meta.url).href} alt="Quicksort" width="176" height="36" /></a>
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
  async function signOut() {
    const { error } = await db().auth.signOut();
    if (error) setError(error.message);
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
  if (auth.session && auth.recovery)
    return (
      <AuthLayout admin={admin}>
        <PasswordForm onDone={auth.finishRecovery} />
      </AuthLayout>
    );
  if (!auth.session)
    return (
      <AuthLayout admin={admin}>
        <AuthForm admin={admin} />
      </AuthLayout>
    );
  if (auth.error)
    return (
      <AuthLayout admin={admin}>
        <Notice error>{auth.error}</Notice>
        <button className="btn" onClick={() => location.reload()}>
          Retry
        </button>
      </AuthLayout>
    );
  if (admin && auth.role !== "admin")
    return (
      <AuthLayout admin>
        <h2>Account created</h2>
        <p className="muted">
          Your account needs an administrator to grant admin access. Candidate
          accounts cannot manage this workspace.
        </p>
        <button
          className="btn secondary"
          onClick={() => {
            db().auth.signOut();
          }}
        >
          Sign out
        </button>
      </AuthLayout>
    );
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
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password") || "");
    try {
      if (mode === "signup") {
        if (password !== form.get("confirm"))
          throw new Error("Passwords do not match.");
        const { error } = await db().auth.signUp({
          email,
          password,
          options: {
            data: { full_name: String(form.get("name")).trim() },
            emailRedirectTo: location.origin,
          },
        });
        if (error) throw error;
        setMessage("Check your email to confirm your account, then sign in.");
      } else if (mode === "reset") {
        const { error } = await db().auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/?account=password",
        });
        if (error) throw error;
        setMessage(
          "If an account exists, you’ll receive a password reset email.",
        );
      } else {
        const { error } = await db().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function change(next: typeof mode) {
    setMode(next);
    setError("");
    setMessage("");
  }
  return (
    <>
      <div className="eyebrow">{admin ? "Admin" : "Candidate"} portal</div>
      <h2>
        {mode === "login"
          ? "Welcome back."
          : mode === "signup"
            ? "Create your account."
            : "Reset your password."}
      </h2>
      <p className="muted">
        {mode === "login"
          ? "Sign in to your Quicksort workspace."
          : mode === "signup"
            ? "A few details to get you started."
            : "We’ll send a link to your email address."}
      </p>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <form className="form" onSubmit={submit}>
        {mode === "signup" && (
          <label>
            Full name
            <input name="name" autoComplete="name" required maxLength={200} />
          </label>
        )}
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required />
        </label>
        {mode !== "reset" && (
          <label>
            Password
            <input
              aria-label="Password"
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "signup" ? 12 : 1}
            />
            {mode === "signup" && (
              <span className="muted">At least 12 characters.</span>
            )}
          </label>
        )}
        {mode === "signup" && (
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
            />
          </label>
        )}
        <button className="btn" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : "Send reset link"}
          <ArrowUpRight size={16} />
        </button>
      </form>
      <div className="auth-links">
        <button
          className="link-button"
          onClick={() => change(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Create an account" : "Back to sign in"}
        </button>
        {mode === "login" && (
          <button className="link-button" onClick={() => change("reset")}>
            Forgot password?
          </button>
        )}
      </div>
    </>
  );
}
export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError("");
    setMessage("");
    if (data.get("password") !== data.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await db().auth.updateUser({
        password: String(data.get("password")),
      });
      if (error) throw error;
      form.reset();
      setMessage("Your password has been updated.");
      onDone?.();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Set your password</h2>
      <p className="muted">
        Use at least 12 characters to protect your account.
      </p>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <form className="form" onSubmit={submit}>
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <button className="btn" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </button>
      </form>
    </>
  );
}
export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
