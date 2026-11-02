import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSession } from "@clerk/react";

const PATH = "/api/invoicing";

/** A failed /api/invoicing call, with the HTTP status and the JSON body (422 blockers carry `blocker`). */
export class InvoicingError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "InvoicingError";
    this.status = status;
    this.body = body;
  }
  get blocker(): string | undefined {
    return typeof this.body.blocker === "string" ? this.body.blocker : undefined;
  }
}

export function errorText(error: unknown, fallback = "The invoicing request failed. Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Client for /api/invoicing, authenticated with the Clerk session's
 * Supabase token (same pattern as AiSettings.request). Requests are never
 * retried here: a send must not go out twice.
 */
export function useInvoicingApi() {
  const { session } = useSession();
  // Clerk replaces the session object on refresh/focus; keying callbacks on it
  // would re-run loads and wipe unsaved edits. Track it in a ref, key on the id.
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const sessionId = session?.id;
  const request = useCallback(async <T,>(method: "GET" | "POST", query: string, body?: object): Promise<T> => {
    const token = await sessionRef.current?.getToken({ template: "supabase" });
    if (!token) throw new Error("Sign in again to manage invoicing.");
    const response = await fetch(`${PATH}${query}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Invoicing is unavailable. Deploy the updated admin app first.");
    }
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new InvoicingError(typeof result.error === "string" && result.error ? result.error : "The invoicing request failed.", response.status, result);
    }
    return result as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return useMemo(() => ({
    get<T>(params: Record<string, string>): Promise<T> {
      return request<T>("GET", `?${new URLSearchParams(params).toString()}`);
    },
    post<T>(action: string, body: object): Promise<T> {
      return request<T>("POST", "", { ...body, action });
    },
  }), [request]);
}

export type InvoicingApi = ReturnType<typeof useInvoicingApi>;
