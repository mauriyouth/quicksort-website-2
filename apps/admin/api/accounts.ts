import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type ClerkUser = { id: string; public_metadata?: Record<string, unknown> };

const CLERK_API = "https://api.clerk.com/v1";
const inputSchema = z.union([
  // From an HR person: email and name come from the record, and the account is linked to it.
  z.object({ personId: z.uuid(), role: z.enum(["candidate", "employee"]) }),
  z.object({ email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["candidate", "employee", "hr", "sales"]) }),
]);

/**
 * POST /api/accounts { email, role } — an admin creates a sign-in account.
 * POST /api/accounts { personId, role } — HR or an admin creates the portal
 * account of an HR person: email and name come from the record, and the
 * account is linked to it. The name is never typed here; a linked profile
 * takes the HR name (see 20261215090000_profile_name_from_person.sql).
 * The Clerk user carries public_metadata.user_id (the workspace uuid the
 * `supabase` JWT template forwards), and public.create_workspace_account()
 * creates the profile, role, link and audit row. The person then signs in
 * with that email (Google or email code); no password is set.
 */
export function createAccountsHandler(deps = { createClient, fetch: globalThis.fetch as typeof fetch, randomUUID }) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to create accounts." });
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address and role." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!url || !key || !clerkSecret) return res.status(503).json({ error: "Account creation is not configured (CLERK_SECRET_KEY missing)." });
    const { role } = parsed.data;
    const personId = "personId" in parsed.data ? parsed.data.personId : null;

    const clerk = (path: string, init?: RequestInit) => deps.fetch(`${CLERK_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
    });

    try {
      const client = deps.createClient(url, key, { accessToken: async () => authorization.slice(7) });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      // Check rights before touching Clerk; the RPC re-checks inside the transaction.
      const actorRole = await client.from("user_roles").select("role").eq("user_id", identity.data).maybeSingle();
      const allowed = actorRole.data?.role === "admin" || (actorRole.data?.role === "hr" && personId !== null);
      if (actorRole.error || !allowed) return res.status(403).json({ error: "Only administrators can create accounts." });

      let email: string;
      let fullName = "";
      if (personId) {
        const person = await client.from("hr_people").select("full_name,email").eq("id", personId).maybeSingle();
        if (person.error || !person.data) return res.status(404).json({ error: "Person not found." });
        email = String(person.data.email || "").trim().toLowerCase();
        fullName = String(person.data.full_name || "").trim();
        if (!z.string().email().safeParse(email).success) return res.status(400).json({ error: `Add a valid email address to ${fullName || "this person"} first.` });
      } else {
        email = (parsed.data as { email: string }).email;
      }

      const lookup = await clerk(`/users?email_address=${encodeURIComponent(email)}&limit=2`);
      if (!lookup.ok) return res.status(502).json({ error: "Could not reach the sign-in service." });
      const existing = (await lookup.json()) as ClerkUser[];
      if (existing.some((u) => u.public_metadata?.user_id)) {
        return res.status(409).json({ error: `An account already exists for ${email}.` });
      }

      const workspaceId = deps.randomUUID();
      let clerkUserId: string;
      let created = false;
      if (existing.length === 1) {
        // Signed up on their own but never linked to the workspace: link them now.
        clerkUserId = existing[0].id;
        const linked = await clerk(`/users/${clerkUserId}/metadata`, {
          method: "PATCH",
          body: JSON.stringify({ public_metadata: { user_id: workspaceId } }),
        });
        if (!linked.ok) return res.status(502).json({ error: "Could not link the existing sign-in account." });
      } else if (existing.length === 0) {
        const [firstName, ...rest] = fullName.split(/\s+/).filter(Boolean);
        const made = await clerk("/users", {
          method: "POST",
          body: JSON.stringify({
            email_address: [email],
            ...(firstName ? { first_name: firstName } : {}),
            ...(rest.length ? { last_name: rest.join(" ") } : {}),
            public_metadata: { user_id: workspaceId },
            skip_password_requirement: true,
          }),
        });
        if (!made.ok) return res.status(502).json({ error: "The sign-in service refused to create this account." });
        clerkUserId = ((await made.json()) as ClerkUser).id;
        created = true;
      } else {
        return res.status(409).json({ error: `Several sign-in accounts use ${email}; resolve it in Clerk first.` });
      }

      const workspace = await client.rpc("create_workspace_account", {
        new_id: workspaceId, account_email: email, account_role: role, ...(personId ? { link_person: personId } : {}),
      });
      if (workspace.error) {
        // Undo the Clerk side so a retry starts clean.
        if (created) await clerk(`/users/${clerkUserId}`, { method: "DELETE" }).catch(() => undefined);
        else await clerk(`/users/${clerkUserId}/metadata`, { method: "PATCH", body: JSON.stringify({ public_metadata: { user_id: null } }) }).catch(() => undefined);
        return res.status(400).json({ error: workspace.error.message || "Could not create the workspace account." });
      }
      return res.status(200).json({ id: workspaceId, email, role, linkedExisting: !created });
    } catch {
      return res.status(502).json({ error: "Could not create the account. Please try again." });
    }
  };
}

export default createAccountsHandler();
