import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

type Request = { method?: string; headers: Record<string, string | string[] | undefined>; body: unknown };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(body: unknown): void };
type ClerkUser = { id: string; public_metadata?: Record<string, unknown>; email_addresses?: { email_address: string }[] };

const CLERK_API = "https://api.clerk.com/v1";
const SESSION_SECONDS = 60 * 60;
const inputSchema = z.object({ targetId: z.string().uuid() });

/** Reads the (already Supabase-verified) token payload without re-checking the signature. */
function tokenClaims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"));
  } catch { return {}; }
}

/**
 * POST /api/impersonate { targetId } — lets an admin open the portal as another
 * user. Authorization and the audit row live in public.begin_impersonation();
 * this handler only runs once that succeeds, then mints a one-hour Clerk actor
 * token whose ticket the browser exchanges for the impersonated session.
 */
export function createImpersonateHandler(deps = { createClient, fetch: globalThis.fetch as typeof fetch }) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed." }); }
    const authorization = req.headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Sign in to impersonate users." });
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Choose a user to impersonate." });
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!url || !key || !clerkSecret) return res.status(503).json({ error: "Impersonation is not configured (CLERK_SECRET_KEY missing)." });

    const token = authorization.slice(7);
    const claims = tokenClaims(token);
    // An impersonated session never starts another impersonation.
    if (claims.act) return res.status(403).json({ error: "Stop impersonating before starting a new session." });
    const actorClerkId = typeof claims.sub === "string" ? claims.sub : "";
    if (!actorClerkId) return res.status(401).json({ error: "Sign in again." });

    try {
      const client = deps.createClient(url, key, { accessToken: async () => token });
      const identity = await client.rpc("sync_clerk_profile");
      if (identity.error || !identity.data) return res.status(401).json({ error: "Sign in again." });
      const gate = await client.rpc("begin_impersonation", { target_id: parsed.data.targetId });
      if (gate.error || typeof gate.data !== "string") {
        return res.status(403).json({ error: gate.error?.message || "You cannot impersonate this user." });
      }
      const email = gate.data;

      const clerk = (path: string, init?: RequestInit) => deps.fetch(`${CLERK_API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${clerkSecret}`, "Content-Type": "application/json" },
      });
      const lookup = await clerk(`/users?email_address=${encodeURIComponent(email)}&limit=2`);
      if (!lookup.ok) return res.status(502).json({ error: "Could not reach the sign-in service." });
      const users = (await lookup.json()) as ClerkUser[];
      // When the Clerk account carries the workspace id, it must be this profile.
      const match = users.filter((u) => {
        const workspaceId = u.public_metadata?.user_id;
        return workspaceId === undefined || workspaceId === parsed.data.targetId;
      });
      if (match.length !== 1) return res.status(404).json({ error: "This user has no sign-in account yet." });
      if (match[0].id === actorClerkId) return res.status(400).json({ error: "You are already signed in as this user." });

      const minted = await clerk("/actor_tokens", {
        method: "POST",
        body: JSON.stringify({
          user_id: match[0].id,
          actor: { sub: actorClerkId },
          expires_in_seconds: 120,
          session_max_duration_in_seconds: SESSION_SECONDS,
        }),
      });
      if (!minted.ok) return res.status(502).json({ error: "The sign-in service refused the impersonation." });
      const actorToken = (await minted.json()) as { token?: string };
      if (!actorToken.token) return res.status(502).json({ error: "The sign-in service refused the impersonation." });
      return res.status(200).json({ ticket: actorToken.token, email });
    } catch {
      return res.status(502).json({ error: "Could not start impersonation. Please try again." });
    }
  };
}

export default createImpersonateHandler();
