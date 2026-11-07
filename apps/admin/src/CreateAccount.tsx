import { useState, type FormEvent } from "react";
import { useSession } from "@clerk/react";
import { Notice } from "@quicksort/hr-ui";

const ROLE_LABELS = { candidate: "Candidate", employee: "Employee", hr: "HR", sales: "Sales" } as const;

/** Accounts > Create account (admins). Calls api/accounts.ts. */
export function CreateAccountPanel({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Sign in again to create accounts.");
      const response = await fetch("/api/accounts", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(data.get("email") || ""),
          role: String(data.get("role") || "employee"),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { email?: string; role?: keyof typeof ROLE_LABELS; linkedExisting?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create the account.");
      setMessage(
        `${body.linkedExisting ? "Linked the existing sign-in for" : "Account created for"} ${body.email} (${ROLE_LABELS[body.role || "employee"]}). ` +
        "They can sign in now with that email, using Google or an email code.",
      );
      form.reset();
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Create an account">
      <h2>Create an account</h2>
      <p className="muted small-text">
        No password is set: the person signs in with this email. Their name comes from their
        HR record once the account is linked (or create it from the person page, which links it
        straight away). Admin rights are granted separately, in Admin access.
      </p>
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      <form className="form" onSubmit={submit}>
        <label>Email address<input name="email" type="email" required autoComplete="off" placeholder="colleague@quicksort.fr" /></label>
        <label>Role
          <select name="role" defaultValue="employee">
            {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div><button className="btn" disabled={busy}>{busy ? "Creating…" : "Create account"}</button></div>
      </form>
    </section>
  );
}
