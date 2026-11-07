import { useEffect, useMemo, useState } from "react";
import { useClerk, useSession } from "@clerk/react";
import type { Row } from "@quicksort/hr-db";
import { Notice, Pill } from "@quicksort/hr-ui";
import "./impersonation.css";

/* Admin impersonation. The server (api/impersonate.ts) authorizes + audits
 * the request and returns a short-lived Clerk actor ticket. Clerk refuses a
 * ticket sign-in while a session is active, so the ticket is parked in
 * sessionStorage across sign-out and redeemed on the signed-out page load. */

const TICKET_KEY = "qs-impersonation-ticket";
const MAX_RESULTS = 8;

function readTicket() {
  try { return sessionStorage.getItem(TICKET_KEY); } catch { return null; }
}
function clearTicket() {
  try { sessionStorage.removeItem(TICKET_KEY); } catch { /* storage unavailable */ }
}

/** Redeems a parked impersonation ticket once the admin is signed out. */
export function useImpersonationTicket() {
  const clerk = useClerk();
  const { session, isLoaded } = useSession();
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (!isLoaded || session) return;
    const ticket = readTicket();
    if (!ticket || !clerk.client) return;
    clearTicket();
    clerk.client.signIn
      .create({ strategy: "ticket", ticket })
      .then((signIn) => clerk.setActive({ session: signIn.createdSessionId }))
      .catch(() => setFailed("The impersonation link expired. Sign in and try again."));
  }, [isLoaded, session?.id, clerk]);
  return failed;
}

/** Fixed bar shown on every screen while an admin acts as someone else. */
export function ImpersonationBanner() {
  const clerk = useClerk();
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.actor) return null;
  const email = session.user.primaryEmailAddress?.emailAddress || "another user";
  return (
    <div className="impersonation-banner" role="status">
      <span>
        Viewing the portal as <strong>{email}</strong>. Everything you do is recorded as them.
      </span>
      <button
        className="btn small"
        disabled={busy}
        onClick={() => { setBusy(true); void clerk.signOut(); }}
      >
        Stop impersonating
      </button>
    </div>
  );
}

/** Search box + "View as" action, shown on the Accounts page for admins. */
export function ImpersonatePanel({ people, roleOf, selfEmail }: {
  people: Row<"profiles">[];
  roleOf: (id: string) => string;
  selfEmail: string;
}) {
  const clerk = useClerk();
  const { session } = useSession();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => p.email !== selfEmail)
      .filter((p) => `${p.full_name} ${p.email}`.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [people, query, selfEmail]);

  async function impersonate(person: Row<"profiles">) {
    setBusyId(person.id);
    setError("");
    try {
      const token = await session?.getToken({ template: "supabase" });
      if (!token) throw new Error("Sign in again to impersonate users.");
      const response = await fetch("/api/impersonate", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: person.id }),
      });
      const body = (await response.json().catch(() => ({}))) as { ticket?: string; error?: string };
      if (!response.ok || !body.ticket) throw new Error(body.error || "Could not start impersonation.");
      sessionStorage.setItem(TICKET_KEY, body.ticket);
      await clerk.signOut({ redirectUrl: "/" });
    } catch (e) {
      clearTicket();
      setError(e instanceof Error ? e.message : "Could not start impersonation.");
      setBusyId("");
    }
  }

  return (
    <section className="panel" aria-label="Impersonate a user">
      <h2>Impersonate a user</h2>
      <p className="muted small-text">
        Open the portal exactly as someone else sees it, for up to one hour. You will be
        signed out of your admin session; sign back in when you stop. Every impersonation is
        logged in the access audit.
      </p>
      <Notice error>{error}</Notice>
      <label className="form">
        Find a user
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or email…"
          autoComplete="off"
        />
      </label>
      {query.trim() && results.length === 0 && <p className="muted small-text">No user matches “{query.trim()}”.</p>}
      {results.map((p) => (
        <div className="list-row" key={p.id}>
          <div>
            <h3>{p.full_name || "New account"}</h3>
            <p className="muted">{p.email}</p>
          </div>
          <div className="actions">
            <Pill status={roleOf(p.id)} />
            <button
              className="btn small"
              disabled={!!busyId}
              onClick={() => void impersonate(p)}
            >
              {busyId === p.id ? "Opening…" : "View as"}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
