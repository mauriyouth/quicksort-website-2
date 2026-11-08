import { useEffect, useMemo, useState } from "react";
import { useClerk, useSession } from "@clerk/react";
import type { Row } from "@quicksort/hr-db";
import { Search, VenetianMask } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@quicksort-sas/ui";
import { PageAlerts, StatusBadge } from "./ui";

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
    // Deliberately loud (full-width lime bar, pinned to the top): it is the
    // security cue that every action is recorded as someone else.
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-[1.5px] border-pivot-foreground bg-pivot px-4 py-2.5 text-sm text-pivot-foreground"
    >
      <span className="flex min-w-0 items-center gap-2">
        <VenetianMask className="size-4 shrink-0" aria-hidden="true" />
        <span>
          Viewing the portal as <strong className="font-semibold">{email}</strong>. Everything you do is recorded as them.
        </span>
      </span>
      <Button
        size="sm"
        className="border-pivot-foreground bg-pivot-foreground text-pivot hover:bg-pivot-foreground/85"
        disabled={busy}
        onClick={() => { setBusy(true); void clerk.signOut(); }}
      >
        Stop impersonating
      </Button>
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
    <Card role="region" aria-label="Impersonate a user" className="mb-6">
      <CardHeader>
        <CardTitle>Impersonate a user</CardTitle>
        <CardDescription className="max-w-prose">
          Open the portal exactly as someone else sees it, for up to one hour. You will be
          signed out of your admin session; sign back in when you stop. Every impersonation is
          logged in the access audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PageAlerts error={error} />
        <Field>
          <FieldLabel htmlFor="impersonate-search">Find a user</FieldLabel>
          <InputGroup>
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput
              id="impersonate-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email…"
              autoComplete="off"
            />
          </InputGroup>
        </Field>
        {query.trim() && results.length === 0 && <p className="m-0 text-sm text-muted-foreground">No user matches “{query.trim()}”.</p>}
        {results.length > 0 && (
          <ItemGroup className="gap-2">
            {results.map((p) => (
              <Item variant="outline" size="sm" key={p.id}>
                <ItemContent className="min-w-0">
                  <ItemTitle><h3 className="m-0 truncate text-sm font-medium">{p.full_name || "New account"}</h3></ItemTitle>
                  <ItemDescription className="truncate">{p.email}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <StatusBadge status={roleOf(p.id)} />
                  <Button size="sm" variant="outline" disabled={!!busyId} onClick={() => void impersonate(p)}>
                    {busyId === p.id ? "Opening…" : "View as"}
                  </Button>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  );
}
