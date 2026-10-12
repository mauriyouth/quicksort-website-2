import { useCallback, useEffect, useState } from "react";
import { db, errorMessage, type Row } from "@quicksort/hr-db";

/**
 * Shared sales data layer (sales.md §9). All five tables are loaded together
 * so every screen works from one consistent snapshot; RLS keeps the same
 * admin policies as the rest of the operations app.
 */
export type SalesClient = Row<"sales_clients">;
export type SalesContact = Row<"sales_contacts">;
export type SalesOpportunity = Row<"sales_opportunities">;
export type SalesSponsor = Row<"sales_sponsors">;
export type SalesActivity = Row<"sales_activities">;

export type SalesData = {
  clients: SalesClient[];
  people: SalesContact[];
  opportunities: SalesOpportunity[];
  sponsors: SalesSponsor[];
  activities: SalesActivity[];
};

export const STAGES = [
  { key: "lead", label: "Lead", probability: 10 },
  { key: "qualified", label: "Qualified", probability: 25 },
  { key: "meeting", label: "Meeting", probability: 40 },
  { key: "proposal", label: "Proposal", probability: 60 },
  { key: "negotiation", label: "Negotiation", probability: 80 },
  { key: "won", label: "Won", probability: 100 },
  { key: "lost", label: "Lost", probability: 0 },
] as const;

export const STAGE_COLORS: Record<string, string> = {
  lead: "#64748b",
  qualified: "#3b82f6",
  meeting: "#8b5cf6",
  proposal: "#f59e0b",
  negotiation: "#f97316",
  won: "#22c55e",
  lost: "#ef4444",
};

export const HEALTH_META: Record<string, { label: string; color: string }> = {
  good: { label: "Good", color: "#22c55e" },
  warning: { label: "Warning", color: "#f59e0b" },
  risk: { label: "At risk", color: "#ef4444" },
};

export const INFLUENCE_META: Record<string, { label: string; color: string }> = {
  champion: { label: "Champion", color: "#16a34a" },
  supporter: { label: "Supporter", color: "#65a30d" },
  neutral: { label: "Neutral", color: "#64748b" },
  blocker: { label: "Blocker", color: "#dc2626" },
};

export const ACTIVITY_TYPES = ["call", "email", "meeting", "note"] as const;

export const stageLabel = (key: string) =>
  STAGES.find((s) => s.key === key)?.label || key;

export const isOpen = (o: Pick<SalesOpportunity, "stage">) =>
  o.stage !== "won" && o.stage !== "lost";

export const money = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value || 0);

export const daysSince = (iso: string | null | undefined) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

const STALE_DAYS = 21;

export const isStaleDeal = (o: SalesOpportunity) =>
  isOpen(o) && (daysSince(o.updated_at) ?? 0) >= STALE_DAYS;

export const isStaleContact = (p: SalesContact) =>
  (daysSince(p.last_contact_at) ?? 9999) >= 90;

/** Régie shows the TJM × days build-up; forfait the fixed price. */
export function amountDetail(o: SalesOpportunity): string {
  if (o.pricing_model === "regie")
    return `${money(Number(o.tjm ?? 0), o.currency)} × ${Number(o.estimated_days ?? 0)} j`;
  return money(Number(o.fixed_price ?? 0), o.currency);
}

export async function loadSalesData(): Promise<SalesData> {
  const results = await Promise.all([
    db().from("sales_clients").select("*").order("name"),
    db().from("sales_contacts").select("*").order("name"),
    db().from("sales_opportunities").select("*").order("updated_at", { ascending: false }),
    db().from("sales_sponsors").select("*"),
    db().from("sales_activities").select("*").order("created_at", { ascending: false }),
  ]);
  for (const r of results) if (r.error) throw r.error;
  return {
    clients: results[0].data || [],
    people: results[1].data || [],
    opportunities: results[2].data || [],
    sponsors: results[3].data || [],
    activities: results[4].data || [],
  };
}

/** Loads the five sales tables and exposes a shared action() helper. */
export function useSales(actorEmail: string) {
  const [data, setData] = useState<SalesData>({
    clients: [],
    people: [],
    opportunities: [],
    sponsors: [],
    activities: [],
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadSalesData());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(work: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Log an activity and bump the client/person last-activity timestamps. */
  async function logActivity(
    entry: Omit<SalesActivity, "id" | "created_at" | "author_email">,
    success = "Activity logged.",
  ) {
    await action(async () => {
      const result = await db()
        .from("sales_activities")
        .insert({ ...entry, author_email: actorEmail })
        .select("id")
        .single();
      if (result.error) throw result.error;
      const stamp = new Date().toISOString();
      const client = await db()
        .from("sales_clients")
        .update({ last_activity_at: stamp })
        .eq("id", entry.client_id || "");
      if (client.error) throw client.error;
      if (entry.person_id) {
        const person = await db()
          .from("sales_contacts")
          .update({ last_contact_at: stamp })
          .eq("id", entry.person_id);
        if (person.error) throw person.error;
      }
    }, success);
  }

  return { data, loading, busy, error, message, load, action, logActivity };
}
