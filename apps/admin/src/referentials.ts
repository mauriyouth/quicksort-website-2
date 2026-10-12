import { useCallback, useEffect, useState } from "react";
import { db, errorMessage, type Row } from "@quicksort/hr-db";

/**
 * Configurable referentials (BoondManager "paramètres globaux"). Statuses and
 * types are edited on the Administration → Global settings screen and stored
 * in admin_statuses / admin_types; every sales screen reads them through
 * useAdminReferentials() so the whole UI relabels/recolors together.
 *
 * The seeds below mirror the migration defaults, so a screen still renders
 * sanely before the migration has been applied or while the table is empty.
 */
export type AdminStatus = Row<"admin_statuses">;
export type AdminType = Row<"admin_types">;

export const STATUS_KINDS = ["project", "opportunity", "resource"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** Kinds whose keys are enforced by DB constraints elsewhere — the settings
 * screen locks add/delete and only relabels/recolors them. */
export const LOCKED_KINDS: Record<StatusKind, boolean> = {
  project: false,
  opportunity: true,
  resource: true,
};

export const DEFAULT_STATUSES: Record<StatusKind, AdminStatus[]> = {
  project: [
    {
      kind: "project",
      key: "en_cours",
      label: "En cours",
      color: "#3b82f6",
      position: 0,
      is_default: true,
      is_terminal: false,
      visible: true,
      updated_at: "",
    },
    {
      kind: "project",
      key: "archive",
      label: "Archivé",
      color: "#475569",
      position: 1,
      is_default: false,
      is_terminal: true,
      visible: true,
      updated_at: "",
    },
  ],
  opportunity: [
    { kind: "opportunity", key: "lead", label: "Piste identifiée", color: "#f59e0b", position: 0, is_default: true, is_terminal: false, visible: true, updated_at: "" },
    { kind: "opportunity", key: "qualified", label: "Qualifié", color: "#3b82f6", position: 1, is_default: false, is_terminal: false, visible: true, updated_at: "" },
    { kind: "opportunity", key: "meeting", label: "Rendez-vous", color: "#8b5cf6", position: 2, is_default: false, is_terminal: false, visible: true, updated_at: "" },
    { kind: "opportunity", key: "proposal", label: "Proposition", color: "#f59e0b", position: 3, is_default: false, is_terminal: false, visible: true, updated_at: "" },
    { kind: "opportunity", key: "negotiation", label: "Négociation", color: "#f97316", position: 4, is_default: false, is_terminal: false, visible: true, updated_at: "" },
    { kind: "opportunity", key: "won", label: "Gagné", color: "#16a34a", position: 5, is_default: false, is_terminal: true, visible: true, updated_at: "" },
    { kind: "opportunity", key: "lost", label: "Perdu", color: "#dc2626", position: 6, is_default: false, is_terminal: true, visible: true, updated_at: "" },
  ],
  resource: [
    { kind: "resource", key: "candidate", label: "Candidat", color: "#f59e0b", position: 0, is_default: true, is_terminal: false, visible: true, updated_at: "" },
    { kind: "resource", key: "employee", label: "En mission", color: "#16a34a", position: 1, is_default: false, is_terminal: false, visible: true, updated_at: "" },
    { kind: "resource", key: "alumni", label: "Sortie", color: "#475569", position: 2, is_default: false, is_terminal: true, visible: true, updated_at: "" },
  ],
};

export const DEFAULT_TYPES: AdminType[] = [
  { key: "regie", label: "Régie", mode: "regie", position: 0, visible: true, updated_at: "" },
  { key: "forfait", label: "Forfait", mode: "forfait", position: 1, visible: true, updated_at: "" },
  { key: "recrutement", label: "Recrutement", mode: "recrutement", position: 2, visible: true, updated_at: "" },
  { key: "produit", label: "Produit", mode: "produit", position: 3, visible: true, updated_at: "" },
];

export const sortStatuses = (rows: AdminStatus[]) =>
  [...rows].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

/** Visible statuses for a kind, in display order; falls back to defaults. */
export function statusesFor(
  statuses: AdminStatus[],
  kind: StatusKind,
  { includeHidden = false }: { includeHidden?: boolean } = {},
): AdminStatus[] {
  const rows = statuses.filter((s) => s.kind === kind && (includeHidden || s.visible));
  const merged = rows.length ? rows : DEFAULT_STATUSES[kind];
  return sortStatuses(merged);
}

export function statusMeta(
  statuses: AdminStatus[],
  kind: StatusKind,
  key: string,
): AdminStatus {
  return (
    statuses.find((s) => s.kind === kind && s.key === key) ||
    DEFAULT_STATUSES[kind].find((s) => s.key === key) || {
      kind,
      key,
      label: key,
      color: "#64748b",
      position: 0,
      is_default: false,
      is_terminal: false,
      visible: true,
      updated_at: "",
    }
  );
}

export function typesFor(types: AdminType[], { includeHidden = false } = {}): AdminType[] {
  const rows = types.filter((t) => includeHidden || t.visible);
  return [...(rows.length ? rows : DEFAULT_TYPES)].sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  );
}

export function typeLabel(types: AdminType[], key: string): string {
  return (
    types.find((t) => t.key === key)?.label ||
    DEFAULT_TYPES.find((t) => t.key === key)?.label ||
    key ||
    "—"
  );
}

export type Referentials = {
  statuses: AdminStatus[];
  types: AdminType[];
  loading: boolean;
  error: string;
  /** True when the admin_statuses/admin_types tables are missing (migration
   * not applied) — screens should keep working on the built-in defaults. */
  missing: boolean;
  reload: () => void;
};

export function useAdminReferentials(): Referentials {
  const [statuses, setStatuses] = useState<AdminStatus[]>([]);
  const [types, setTypes] = useState<AdminType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, t] = await Promise.all([
        db().from("admin_statuses").select("*"),
        db().from("admin_types").select("*"),
      ]);
      if (s.error || t.error) {
        // Missing table (migration pending) — degrade to built-in defaults.
        setMissing(true);
        setStatuses([]);
        setTypes([]);
      } else {
        setMissing(false);
        setStatuses(s.data || []);
        setTypes(t.data || []);
      }
    } catch (e) {
      setMissing(true);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tick]);

  return {
    statuses,
    types,
    loading,
    error,
    missing,
    reload: () => setTick((n) => n + 1),
  };
}
