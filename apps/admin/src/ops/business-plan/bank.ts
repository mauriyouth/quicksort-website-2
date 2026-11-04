import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSession } from "@clerk/react";
import type { BankRow } from "./actuals";
import type { FixedChargeLine } from "./model";

const PATH = "/api/bank-transactions";

/** A failed /api/bank-transactions call, with the HTTP status (409 = Qonto not connected, 0 = unreachable). */
export class BankError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "BankError";
    this.status = status;
  }
}

export type BankSyncState = {
  cursor: string | null;
  coverageStart: string | null;
  backfillDone: boolean;
  lockedUntil: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

export type BankStatus = {
  state: BankSyncState;
  classifier: { configured: boolean; model: string; source: string };
  reviewCount: number;
};

export type BankSyncResult = { status: "ok" | "locked" | "partial"; fetched: number; classified: number; remaining: number };

/**
 * Client for /api/bank-transactions (Qonto debits and their fixed-charge
 * classification), authenticated with the Clerk session's Supabase token,
 * same pattern as the invoicing client.
 */
export function useBankApi() {
  const { session } = useSession();
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const sessionId = session?.id;
  const request = useCallback(async <T,>(method: "GET" | "POST", query: string, body?: object): Promise<T> => {
    const token = await sessionRef.current?.getToken({ template: "supabase" });
    if (!token) throw new BankError("Reconnectez-vous pour charger les transactions Qonto.", 401);
    let response: Response;
    try {
      response = await fetch(`${PATH}${query}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new BankError("Données Qonto indisponibles.", 0);
    }
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new BankError("Données Qonto indisponibles.", 0);
    }
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new BankError(typeof result.error === "string" && result.error ? result.error : "La requête bancaire a échoué.", response.status);
    }
    return result as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return useMemo(() => ({
    status: () => request<BankStatus>("GET", "?resource=status"),
    transactions: async (year: number) =>
      (await request<{ transactions: BankRow[] }>("GET", `?resource=transactions&year=${year}`)).transactions,
    sync: () => request<BankSyncResult>("POST", "", { action: "sync" }),
    saveClassifier: (model: string, apiKey?: string) =>
      request<{ saved: true }>("POST", "", { action: "save_classifier", model, ...(apiKey ? { apiKey } : {}) }),
    classify: (id: string, line: FixedChargeLine) => request<{ saved: true }>("POST", "", { action: "classify", id, line }),
  }), [request]);
}
