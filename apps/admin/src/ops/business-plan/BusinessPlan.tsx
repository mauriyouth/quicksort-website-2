import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
import { DetailPanel, type DetailKind } from "./DetailPanel";
import { db, errorMessage, isMissingRelationError } from "@quicksort/hr-db";
import { Notice } from "@quicksort/hr-ui";
import { loadWorkspace } from "../../hr/data";
import { loadPlanMultipliers, type PlanMultipliers, type PlanScenario } from "../../hr/economics";
import { BankError, useBankApi, type BankStatus } from "./bank";
import {
  aggregateActuals,
  aggregateFixedCharges,
  aggregateVat,
  loadCra,
  loadExtensions,
  loadInvoices,
  loadSavedPlan,
  loadStructureStaff,
  saveSavedPlan,
  setStructure,
  type BankRow,
  type PlanSources,
  type SavedPlan,
  type StructureEntry,
} from "./actuals";
import {
  computePlan,
  DEFAULT_HYPOTHESES,
  firstOpenMonth,
  fmt,
  HYPOTHESIS_KEYS,
  kEur,
  MONTH_NAMES,
  num,
  pct,
  planRows,
  type FixedChargeLine,
  type FixedLineKey,
  type HypothesisKey,
  type Hypotheses,
} from "./model";
import "./business-plan.css";

/**
 * Operations › Business plan. Monthly consulting P&L for one year: closed
 * months come from real data (actuals.ts), open months are projected from
 * the hypotheses (model.ts). Hypotheses and forecast sales / departures
 * are saved per year in business_plans. Layout follows the "Business plan
 * 2027" design mockup, on admin tokens.
 */

type Field = { key: HypothesisKey; label: string; unit: string; step?: number };
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: "Activité et prix", fields: [
    { key: "consDebut", label: "Consultants staffés au 1er janvier", unit: "nb" },
    { key: "tjm", label: "TJM moyen facturé", unit: "€" },
    { key: "jours", label: "Jours ouvrés facturables / mois", unit: "j" },
    { key: "occ", label: "Taux d’occupation des salariés", unit: "%" },
    { key: "pctFree", label: "Part de freelances", unit: "%" },
  ] },
  { title: "Coûts de production", fields: [
    { key: "coutFree", label: "Coût journalier freelance", unit: "€" },
    { key: "salaire", label: "Salaire chargé consultant / mois", unit: "€", step: 100 },
    { key: "commFactor", label: "Commission factor sur CA", unit: "%", step: 0.1 },
    { key: "primeIC", label: "Prime IC par vente", unit: "€", step: 50 },
    { key: "primeChasseur", label: "Prime chasseur par vente", unit: "€", step: 50 },
  ] },
  { title: "Charges fixes mensuelles", fields: [
    { key: "fLoyer", label: "Loyer et locaux", unit: "€", step: 100 },
    { key: "fOutils", label: "Outils, cloud, licences IA", unit: "€", step: 100 },
    { key: "fMarketing", label: "Marketing et événements", unit: "€", step: 100 },
    { key: "fHonoraires", label: "Honoraires", unit: "€", step: 100 },
    { key: "fDivers", label: "Divers", unit: "€", step: 100 },
    { key: "fAmort", label: "Dotations aux amortissements et provisions", unit: "€", step: 100 },
  ] },
  { title: "Trésorerie et impôt", fields: [
    { key: "tresoDebut", label: "Trésorerie au 1er janvier", unit: "€", step: 1000 },
    { key: "dso", label: "Délai de paiement clients", unit: "jours", step: 30 },
    { key: "tauxIS", label: "Taux d’IS appliqué", unit: "%", step: 0.5 },
  ] },
];

type Loaded = Omit<PlanSources, "cra" | "cjmMultiplier"> & { salariesVisible: boolean; multipliers: PlanMultipliers };

const SCENARIOS: { id: PlanScenario; param: string; label: string }[] = [
  { id: "pessimistic", param: "pessimiste", label: "Pessimiste" },
  { id: "optimistic", param: "optimiste", label: "Optimiste" },
];
const multLabel = (v: number) => `×${String(v).replace(".", ",")}`;
type Draft = { hyp: Record<HypothesisKey, string>; ventes: string[]; departs: string[] };

const untyped = () => db() as unknown as SupabaseClient;
const FIXED_KEYS: readonly string[] = ["loyer", "outils", "marketing", "honoraires", "divers"] satisfies FixedLineKey[];
const isFixedKey = (k: string): k is FixedLineKey => FIXED_KEYS.includes(k);
/** Background sync on page open when the last run is older than this. */
const SYNC_STALE_MS = 12 * 3600_000;
/** Follow-up runs while a partial sync still has work left. */
const MAX_SYNC_RELAUNCHES = 10;

/** "à l’instant", "12 min", "3 h", "2 j". */
function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "à l’instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}
const str = (v: number) => String(v);

export function BusinessPlan({ actorEmail }: { actorEmail: string }) {
  const today = useMemo(() => new Date(), []);
  // Current year by default, so the months already elapsed show measured figures.
  const [year, setYear] = useState(today.getFullYear());
  // Plan (P&L + chart) or Hypothèses, kept in the URL so the tab is linkable.
  const [params, setParams] = useSearchParams();
  const view: "plan" | "hyp" = params.get("vue") === "hypotheses" ? "hyp" : "plan";
  const setView = (v: "plan" | "hyp") =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === "hyp") next.set("vue", "hypotheses");
        else next.delete("vue");
        return next;
      },
      { replace: true },
    );
  // Employer-cost scenario (salary multiplier), also kept in the URL.
  const scenario: PlanScenario = SCENARIOS.find((s) => s.param === params.get("charges"))?.id ?? "pessimistic";
  const setScenario = (id: PlanScenario) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "pessimistic") next.delete("charges");
        else next.set("charges", SCENARIOS.find((s) => s.id === id)!.param);
        return next;
      },
      { replace: true },
    );
  const [base, setBase] = useState<Loaded | null>(null);
  const [cra, setCra] = useState<PlanSources["cra"] | null>(null);
  const [saved, setSaved] = useState<SavedPlan | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  /** Open drill-down panel: which P&L row and month (null = closed). */
  const [detail, setDetail] = useState<{ kind: DetailKind; month: number } | null>(null);

  // Qonto debits behind the fixed-charge rows. Any failure leaves the plan on hypotheses.
  const bankApi = useBankApi();
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null);
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  /** Year whose transactions are in bankRows (null = none loaded): other years stay on hypotheses. */
  const [rowsYear, setRowsYear] = useState<number | null>(null);
  /** Manual lines saved (or being saved) here, re-applied over any reload that started before them. */
  const manualLines = useRef(new Map<string, FixedChargeLine>());
  const [loadNote, setLoadNote] = useState("");
  const [syncNote, setSyncNote] = useState("");
  const bankNote = syncNote || loadNote;
  const [syncing, setSyncing] = useState(false);
  const [bankVersion, setBankVersion] = useState(0);
  const autoSynced = useRef(false);

  const bankError = (e: unknown) =>
    e instanceof BankError && e.status === 409 ? "Connectez Qonto dans les réglages de facturation."
      : e instanceof BankError && e.status !== 0 ? e.message
        : "Données Qonto indisponibles.";

  useEffect(() => {
    let cancelled = false;
    setLoadNote("");
    (async () => {
      const status = await bankApi.status();
      if (cancelled) return;
      setBankStatus(status);
      const rows = await bankApi.transactions(year);
      if (cancelled) return;
      const local = manualLines.current;
      setBankRows(rows.map((r) => {
        const line = local.get(r.id);
        return line && r.manual_line !== line ? { ...r, manual_line: line, line, needs_review: false } : r;
      }));
      setRowsYear(year);
    })().catch((e) => {
      if (cancelled) return;
      setRowsYear(null);
      setLoadNote(bankError(e));
    });
    return () => {
      cancelled = true;
    };
  }, [bankApi, year, bankVersion]);

  const syncQonto = useCallback(async () => {
    setSyncing(true);
    setSyncNote("");
    try {
      for (let run = 0; run <= MAX_SYNC_RELAUNCHES; run++) {
        const result = await bankApi.sync();
        const status = await bankApi.status();
        setBankStatus(status);
        if (result.status === "locked") {
          setSyncNote("Une synchronisation est déjà en cours.");
          break;
        }
        // Relaunch only for work left by the time budget, not after a Qonto error.
        const more = result.status === "partial" && !status.state.lastError && (result.remaining > 0 || !status.state.backfillDone);
        if (!more) break;
      }
    } catch (e) {
      setSyncNote(bankError(e));
    } finally {
      setSyncing(false);
      setBankVersion((v) => v + 1);
    }
  }, [bankApi]);

  // Background refresh on page open when the last run is stale.
  useEffect(() => {
    if (!bankStatus || autoSynced.current) return;
    autoSynced.current = true;
    const last = bankStatus.state.lastRunAt;
    if (!last || Date.now() - Date.parse(last) > SYNC_STALE_MS) void syncQonto();
  }, [bankStatus, syncQonto]);

  async function classifyBank(id: string, line: FixedChargeLine) {
    const before = bankRows.find((r) => r.id === id);
    if (!before) return;
    const patch = (r: BankRow) => (r.id === id ? { ...r, manual_line: line, line, needs_review: false } : r);
    manualLines.current.set(id, line);
    setBankRows((rows) => rows.map(patch));
    if (before.needs_review) setBankStatus((s) => s && { ...s, reviewCount: Math.max(0, s.reviewCount - 1) });
    try {
      await bankApi.classify(id, line);
    } catch (e) {
      if (manualLines.current.get(id) === line) {
        if (before.manual_line) manualLines.current.set(id, before.manual_line as FixedChargeLine);
        else manualLines.current.delete(id);
      }
      setBankRows((rows) => rows.map((r) => (r.id === id ? before : r)));
      if (before.needs_review) setBankStatus((s) => s && { ...s, reviewCount: s.reviewCount + 1 });
      throw new Error(bankError(e));
    }
  }

  // Year-independent sources, loaded once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client = untyped();
      const [ws, invoices, extensions, mult, structureStaff] = await Promise.all([
        loadWorkspace(),
        loadInvoices(client).catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
        loadExtensions(client).catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
        loadPlanMultipliers(),
        loadStructureStaff(client).catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
      ]);
      if (cancelled) return;
      setBase({
        employees: ws.employees,
        salaries: ws.salaries,
        assignments: ws.assignments,
        projects: ws.projects,
        extensions,
        invoices,
        multipliers: mult.multipliers,
        people: ws.people.map((p) => ({ id: p.id, full_name: p.full_name })),
        clients: ws.clients,
        structureStaff,
        // The snapshot only returns salaries to HR operators.
        salariesVisible: ws.salaries.length > 0 || ws.employees.length === 0,
      });
    })().catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-year: CRA days and the saved plan.
  useEffect(() => {
    let cancelled = false;
    setCra(null);
    setSaved(null);
    setDraft(null);
    setDirty(false);
    (async () => {
      const client = untyped();
      const [craRows, plan] = await Promise.all([
        loadCra(client, year).catch(() => []),
        loadSavedPlan(client, year).catch((e) => {
          if (isMissingRelationError(e)) {
            setTableMissing(true);
            return null;
          }
          throw e;
        }),
      ]);
      if (cancelled) return;
      setCra(craRows);
      setSaved(plan);
    })().catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [year]);

  const openFrom = firstOpenMonth(year, today);
  // Real fixed charges only once the first full sync is done.
  // Only for the year whose rows are loaded: no rows must never read as 0 € real.
  const coverageStart = rowsYear === year && bankStatus?.state.backfillDone ? bankStatus.state.coverageStart : null;
  const bank = useMemo(
    () => aggregateFixedCharges(bankRows, year, openFrom, coverageStart),
    [bankRows, year, openFrom, coverageStart],
  );
  const vat = useMemo(
    () => aggregateVat(base?.invoices ?? [], bankRows, year, openFrom, coverageStart),
    [base, bankRows, year, openFrom, coverageStart],
  );
  const unclassifiedTotal = bank.unclassifiedCount.reduce((a, b) => a + b, 0);
  const multiplier = base ? base.multipliers[scenario] : 0;
  const agg = useMemo(
    () => (base && cra ? aggregateActuals({ ...base, cjmMultiplier: multiplier, cra }, year, openFrom, today) : null),
    [base, cra, year, openFrom, today, multiplier],
  );
  // Switching scenario re-seeds the forecast loaded salary, unless it was edited.
  const seededSalaire = useRef<number | undefined>(undefined);
  useEffect(() => {
    const next = agg?.seeds.salaire;
    const prev = seededSalaire.current;
    seededSalaire.current = next;
    if (next === undefined || prev === undefined || prev === next || saved?.hypotheses?.salaire !== undefined) return;
    setDraft((d) => (d && num(d.hyp.salaire) === prev ? { ...d, hyp: { ...d.hyp, salaire: str(next) } } : d));
  }, [agg, saved]);

  /** Draft as it would be with no edits: saved values, else data seeds, else mockup defaults. */
  const initialDraft = useCallback((): Draft | null => {
    if (!agg || !cra) return null;
    const hyp = {} as Record<HypothesisKey, string>;
    for (const k of HYPOTHESIS_KEYS)
      hyp[k] = str(saved?.hypotheses?.[k] ?? agg.seeds[k] ?? DEFAULT_HYPOTHESES[k]);
    const pick = (stored: (number | null)[] | undefined, seed: (m: number) => number) =>
      Array.from({ length: 12 }, (_, m) => str(stored?.[m] ?? seed(m)));
    return {
      hyp,
      ventes: pick(saved?.monthly?.ventes, () => agg.avgVentes),
      departs: pick(saved?.monthly?.departs, (m) => agg.plannedDeparts[m]),
    };
  }, [agg, cra, saved]);

  useEffect(() => {
    if (!draft) {
      const d = initialDraft();
      if (d) setDraft(d);
    }
  }, [draft, initialDraft]);

  const H: Hypotheses | null = useMemo(() => {
    if (!draft) return null;
    const h = { ...DEFAULT_HYPOTHESES };
    for (const k of HYPOTHESIS_KEYS) h[k] = num(draft.hyp[k]);
    return h;
  }, [draft]);

  const plan = useMemo(() => {
    if (!agg || !draft || !H) return null;
    return computePlan(
      H,
      agg.months.map((actual, m) => ({
        actual,
        ventes: num(draft.ventes[m]),
        departs: num(draft.departs[m]),
        structure: agg.structure[m],
        fixed: bank.fixed[m] ?? undefined,
        vat: vat.vat[m] ?? undefined,
      })),
    );
  }, [agg, draft, H, bank, vat]);

  const edit = (fn: (d: Draft) => Draft) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };
  const setHyp = (k: HypothesisKey, v: string) => edit((d) => ({ ...d, hyp: { ...d.hyp, [k]: v } }));
  const setMonth = (which: "ventes" | "departs", m: number, v: string) =>
    edit((d) => ({ ...d, [which]: d[which].map((x, i) => (i === m ? v : x)) }));

  async function saveStructure(employeeId: string, entry: StructureEntry | null) {
    setError("");
    try {
      await setStructure(untyped(), employeeId, entry, actorEmail);
      setBase((b) => {
        if (!b) return b;
        const rest = b.structureStaff.filter((s) => s.employee_id !== employeeId);
        return { ...b, structureStaff: entry ? [...rest, { ...entry, employee_id: employeeId }] : rest };
      });
    } catch (e) {
      setError(isMissingRelationError(e) ? "La table business_plan_structure n’existe pas encore — appliquez la migration." : errorMessage(e));
    }
  }

  function changeYear(next: number) {
    if (dirty && !window.confirm("Modifications non enregistrées — changer d’année quand même ?")) return;
    setYear(next);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const hypotheses = {} as Record<HypothesisKey, number>;
      for (const k of HYPOTHESIS_KEYS) hypotheses[k] = num(draft.hyp[k]);
      // Closed months are measured, so only open months keep manual entries.
      const open = (a: string[]) => a.map((v, m) => (m >= openFrom ? num(v) : null));
      const payload = { year, hypotheses, monthly: { ventes: open(draft.ventes), departs: open(draft.departs) }, updated_by: actorEmail };
      const updated_at = await saveSavedPlan(untyped(), payload);
      setSaved({ ...payload, updated_at });
      setDirty(false);
      setMessage(`Business plan ${year} enregistré.`);
    } catch (e) {
      setError(isMissingRelationError(e) ? "La table business_plans n’existe pas encore — appliquez la migration." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function resetToData() {
    const fresh = agg && {
      hyp: Object.fromEntries(HYPOTHESIS_KEYS.map((k) => [k, str(agg.seeds[k] ?? DEFAULT_HYPOTHESES[k])])) as Record<HypothesisKey, string>,
      ventes: Array.from({ length: 12 }, () => str(agg.avgVentes)),
      departs: agg.plannedDeparts.map(str),
    };
    if (fresh) {
      setDraft(fresh);
      setDirty(true);
    }
  }

  const loading = !plan || !draft || !agg || !base;
  /** Hypotheses that differ from a measured value. */
  const overrides =
    agg && draft
      ? HYPOTHESIS_KEYS.filter((k) => agg.seeds[k] !== undefined && num(draft.hyp[k]) !== agg.seeds[k] && !(k === "consDebut" && openFrom > 0)).length
      : 0;
  const rows = plan ? planRows(plan) : [];
  const actualCount = Math.min(openFrom, 12);
  const status =
    actualCount === 0 ? "Prévisionnel" : actualCount === 12 ? "Réel" : `Réel → ${MONTH_NAMES[actualCount - 1].toLowerCase()} · prévisionnel ensuite`;
  const maxCa = plan ? Math.max(1, ...plan.series.ca) : 1;
  /** Salaried employments that can be listed as structure staff. */
  const staffChoices = useMemo(() => {
    if (!base) return [];
    const names = new Map((base.people ?? []).map((p) => [p.id, p.full_name]));
    return base.employees
      .filter((e) => e.contract_type !== "Freelance")
      .map((e) => ({
        id: e.id,
        name: names.get(e.person_id) || e.role || "Sans nom",
        hired: e.start_date,
        exit: e.end_date ?? e.planned_exit_date,
        detail: [e.role, e.status === "ended" ? `sorti le ${e.end_date?.split("-").reverse().join("/")}` : e.status].filter(Boolean).join(" · "),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [base]);

  return (
    <div className="bp">
      <Notice error>{error}</Notice>
      <Notice>{message}</Notice>
      {tableMissing && (
        <Notice error>La table business_plans n’existe pas encore : les hypothèses ne peuvent pas être enregistrées.</Notice>
      )}

      <div className="bp-toolbar">
        <div className="bp-year" role="group" aria-label="Année">
          <button type="button" className="bp-icon" onClick={() => changeYear(year - 1)} aria-label="Année précédente">
            <ChevronLeft size={16} />
          </button>
          <span className="bp-year-label">{year}</span>
          <button type="button" className="bp-icon" onClick={() => changeYear(year + 1)} aria-label="Année suivante">
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="bp-meta">{status} · montants en € HT</span>
        <label className="bp-scenario">
          <span>Charges salariales</span>
          <select
            className="qs-input"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as PlanScenario)}
            disabled={!base}
            title="Coût employeur = salaire brut × multiplicateur (réglages globaux → Unit economics)"
          >
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {base ? ` (${multLabel(base.multipliers[s.id])})` : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="bp-spacer" />
        <div className="bp-actions">
        <span className="bp-meta">
          {dirty
            ? "Modifications non enregistrées"
            : saved?.updated_at
              ? `Enregistré le ${new Date(saved.updated_at).toLocaleDateString("fr-FR")}`
              : "Valeurs issues des données"}
        </span>
        <button type="button" className="btn secondary small" onClick={resetToData} disabled={loading}>
          <RotateCcw size={14} /> Réinitialiser
        </button>
        <button type="button" className="btn small" data-save-shortcut onClick={save} disabled={loading || busy || !dirty || tableMissing}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        </div>
      </div>

      {loading ? (
        <p className="bp-meta">Chargement des données…</p>
      ) : (
        <>
          {!base.salariesVisible && (
            <Notice error>Les salaires ne sont pas visibles avec votre rôle : les coûts salariés réels sont à zéro.</Notice>
          )}

          <section aria-label="Indicateurs clés" className="bp-kpis">
            <Kpi
              label="Chiffre d’affaires"
              value={kEur(plan.totals.ca)}
              hint={`${kEur(plan.totals.ca / 12)} / mois en moyenne`}
              formula={[
                "Somme des 12 mois.",
                "Réel : factures finalisées ou payées, par mois de prestation.",
                "Prévisionnel : consultants × jours facturables × TJM (salariés × taux d’occupation).",
              ]}
            />
            <Kpi
              label="Gross margin (marge brute)"
              value={kEur(plan.totals.mb)}
              hint={`${pct(plan.totals.mbPct)} du CA`}
              formula={[
                "= CA − coûts de production − charges variables",
                `= ${kEur(plan.totals.ca)} − ${kEur(sumOf(plan.series.prod))} − ${kEur(sumOf(plan.series.varr))}`,
                "Ce que rapportent les missions une fois payés ceux qui les réalisent.",
              ]}
            />
            <Kpi
              label="EBITDA (EBE)"
              value={kEur(plan.totals.eb)}
              hint={`${pct(plan.totals.ebPct)} du CA`}
              formula={[
                "= Marge brute − charges fixes",
                `= ${kEur(plan.totals.mb)} − ${kEur(sumOf(plan.series.fix))}`,
                "Excédent brut d’exploitation : avant amortissements, intérêts et IS.",
              ]}
            />
            <Kpi
              label="EBIT (résultat d’exploitation)"
              value={kEur(plan.totals.ex)}
              hint={`${pct(plan.totals.exPct)} du CA`}
              formula={[
                "= EBITDA − dotations aux amortissements et provisions",
                `= ${kEur(plan.totals.eb)} − ${kEur(sumOf(plan.series.da))}`,
                "Résultat de l’activité courante, avant intérêts et IS.",
              ]}
            />
            <Kpi
              label="Résultat net estimé"
              value={kEur(plan.totals.rn)}
              hint={`résultat d’exploitation ${kEur(plan.totals.ex)} − IS ${kEur(plan.totals.is)}`}
              accent
              formula={[
                "= Résultat d’exploitation − IS",
                `Résultat d’exploitation = EBE − dotations = ${kEur(plan.totals.eb)} − ${kEur(sumOf(plan.series.da))} = ${kEur(plan.totals.ex)}`,
                `IS = ${fmt(H!.tauxIS)} % du résultat d’exploitation s’il est positif = ${kEur(plan.totals.is)}`,
              ]}
            />
            <Kpi
              label="Consultants fin d’année"
              value={fmt(plan.totals.consFin)}
              hint={`${fmt(plan.totals.ventes)} ventes · ${fmt(plan.totals.departs)} départs`}
              formula={[
                "Consultants staffés en décembre.",
                "Réel : personnes avec une mission sur le mois. Prévisionnel : mois précédent + ventes − départs.",
              ]}
            />
            <Kpi
              label="Trésorerie fin d’année"
              value={kEur(plan.totals.treso)}
              hint={`point bas : ${kEur(plan.totals.tresoMin)}`}
              formula={[
                "= trésorerie au 1er janvier + encaissements − coûts de production − charges variables − charges fixes",
                `= ${kEur(H!.tresoDebut)} + ${kEur(sumOf(plan.series.enc))} − ${kEur(sumOf(plan.series.prod))} − ${kEur(sumOf(plan.series.varr))} − ${kEur(sumOf(plan.series.fix))}`,
                "Les dotations aux amortissements ne sortent pas de trésorerie.",
              ]}
            />
          </section>

          <div className="bp-tabs" role="tablist" aria-label="Vues du business plan">
            {([["plan", "Plan"], ["hyp", "Hypothèses"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`bp-tab-${id}`}
                aria-selected={view === id}
                aria-controls={`bp-panel-${id}`}
                className={`bp-tab${view === id ? " is-on" : ""}`}
                onClick={() => setView(id)}
              >
                {label}
                {id === "hyp" && overrides > 0 && (
                  <span className="bp-tab-count" title="Hypothèses différentes de la valeur mesurée">{overrides} écart{overrides > 1 ? "s" : ""} au réel</span>
                )}
              </button>
            ))}
          </div>

          {view === "hyp" && (
          <section aria-labelledby="bp-hyp" className="bp-section" role="tabpanel" id="bp-panel-hyp">
            <div className="bp-heading">
              <h2 id="bp-hyp">Hypothèses</h2>
              <p>Pré-remplies depuis les données réelles quand elles existent (« réel »), sinon valeurs indicatives. Elles pilotent les mois prévisionnels.</p>
            </div>
            <div className="bp-groups">
              {GROUPS.map((g) => (
                <fieldset key={g.title} className="bp-card bp-group">
                  <legend>{g.title}</legend>
                  {g.fields.map((f) => {
                    const seed = agg.seeds[f.key];
                    const replaced = f.key === "consDebut" && openFrom > 0;
                    return (
                      <div key={f.key} className="bp-field">
                        <label htmlFor={`bp-${f.key}`}>
                          {f.label} <span className="bp-unit">({f.unit})</span>
                          {replaced ? (
                            <span className="bp-seed">remplacé par le réel</span>
                          ) : seed !== undefined && num(draft.hyp[f.key]) !== seed ? (
                            <button type="button" className="bp-seed is-action" onClick={() => setHyp(f.key, str(seed))}>
                              réel : {fmt(seed)}
                            </button>
                          ) : seed !== undefined ? (
                            <span className="bp-seed">réel</span>
                          ) : null}
                        </label>
                        <input
                          className="bp-hin"
                          id={`bp-${f.key}`}
                          type="number"
                          inputMode="decimal"
                          step={f.step ?? 1}
                          value={draft.hyp[f.key]}
                          disabled={replaced}
                          onChange={(e) => setHyp(f.key, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </section>
          )}

          {view === "plan" && (
          <div className="bp-panel" role="tabpanel" id="bp-panel-plan" aria-labelledby="bp-tab-plan">
          <section aria-labelledby="bp-pl" className="bp-section">
            <div className="bp-heading is-row">
              <div>
                <h2 id="bp-pl">Compte de résultat mensuel</h2>
                <p>Les mois « Réel » sont calculés depuis la facturation, le staffing, les CRA, les salaires et les transactions Qonto. Saisissez les ventes et départs des mois prévisionnels.</p>
              </div>
              <div className="bp-bank-col">
              <div className="bp-bank">
                <span className="bp-meta" role="status" title={!syncing && !bankNote && bankStatus?.state.lastError ? bankStatus.state.lastError : undefined}>
                  {syncing
                    ? "Synchronisation…"
                    : bankNote
                      ? bankNote
                      : bankStatus?.state.lastRunAt
                        ? `${bankStatus.state.lastError ? "Dernière synchro Qonto en erreur" : `Synchronisé ${ago(bankStatus.state.lastRunAt, Date.now())}`}${bankStatus.reviewCount > 0 ? ` · ${bankStatus.reviewCount} à vérifier` : ""}${unclassifiedTotal > 0 ? ` · ${unclassifiedTotal} non classée${unclassifiedTotal > 1 ? "s" : ""}` : ""}`
                        : bankStatus
                          ? "Jamais synchronisé"
                          : ""}
                  {bankStatus && !bankStatus.state.backfillDone && !bankNote && <span className="bp-tag">Rattrapage en cours</span>}
                </span>
                <button type="button" className="btn secondary small" onClick={() => void syncQonto()} disabled={syncing}>
                  <RefreshCw size={14} className={syncing ? "bp-spin" : undefined} /> Actualiser Qonto
                </button>
              </div>
              <span className="bp-meta">Faites défiler horizontalement →</span>
              </div>
            </div>
            <div className="bp-card bp-scroll">
              <div className="bp-grid">
                <div className="bp-row k-head">
                  <div className="bp-cell lab">{year}</div>
                  {MONTH_NAMES.map((name, m) => (
                    <div key={name} className={`bp-cell${plan.actual[m] ? " is-actual" : ""}`}>
                      {name}
                      <br />
                      <span className="bp-q">{plan.actual[m] ? <span className="bp-chip">Réel</span> : `T${Math.floor(m / 3) + 1}`}</span>
                    </div>
                  ))}
                  <div className="bp-cell tot">Total</div>
                </div>
                <div className="bp-row k-section"><div className="bp-cell lab">Activité</div></div>
                <div className="bp-row k-line">
                  <div className="bp-cell lab">Jours ouvrés facturables</div>
                  {MONTH_NAMES.map((name, m) => (
                    <div key={name} className={`bp-cell${plan.actual[m] ? " is-actual" : ""}`}>{fmt(H!.jours)}</div>
                  ))}
                  <div className="bp-cell tot">{fmt(H!.jours * 12)}</div>
                </div>
                {(["ventes", "departs"] as const).map((which) => (
                  <div key={which} className="bp-row k-input">
                    <div className="bp-cell lab bp-strong">{which === "ventes" ? "Nb de ventes" : "Nb de départs"}</div>
                    {MONTH_NAMES.map((name, m) =>
                      plan.actual[m] ? (
                        <div key={name} className="bp-cell is-actual">{fmt(plan.series[which][m])}</div>
                      ) : (
                        <div key={name} className="bp-cell">
                          <input
                            className="bp-tin"
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`${which === "ventes" ? "Ventes" : "Départs"} ${name}`}
                            value={draft[which][m]}
                            onChange={(e) => setMonth(which, m, e.target.value)}
                          />
                        </div>
                      ),
                    )}
                    <div className="bp-cell tot">{fmt(which === "ventes" ? plan.totals.ventes : plan.totals.departs)}</div>
                  </div>
                ))}
                {rows.map((r) => (
                  <div key={r.label} className={`bp-row k-${r.kind}${r.key ? " is-drill" : ""}`}>
                    {r.key ? (
                      <button
                        type="button"
                        className="bp-cell lab bp-drill"
                        onClick={() => setDetail({ kind: r.key!, month: Math.max(0, Math.min(11, actualCount > 0 ? actualCount - 1 : 0)) })}
                        title={
                          r.key === "ca" || r.key === "enc" ? "Voir le détail des factures"
                            : r.key === "tva" ? "Voir le détail de la TVA"
                            : isFixedKey(r.key) ? "Voir le détail des transactions"
                              : "Voir le détail par personne"
                        }
                      >
                        {r.label} <span className="bp-drill-hint" aria-hidden="true">›</span>
                      </button>
                    ) : (
                      <div className="bp-cell lab">{r.label}</div>
                    )}
                    {r.values.map((v, m) => {
                      const toReview = r.key && isFixedKey(r.key)
                        ? (bank.lines[m] ?? []).filter((t) => t.needs_review && t.line === r.key).length
                        : 0;
                      const pending = r.key && isFixedKey(r.key) ? bank.unclassifiedCount[m] : 0;
                      const hint = [
                        toReview ? `${toReview} transaction${toReview > 1 ? "s" : ""} à vérifier` : "",
                        pending ? `${pending} transaction${pending > 1 ? "s" : ""} non classée${pending > 1 ? "s" : ""}` : "",
                      ].filter(Boolean).join(" · ");
                      return r.key ? (
                        <button
                          key={m}
                          type="button"
                          className={`bp-cell bp-drill${plan.actual[m] ? " is-actual" : ""}`}
                          onClick={() => setDetail({ kind: r.key!, month: m })}
                          aria-label={`${r.label} — détail ${MONTH_NAMES[m]}${hint ? ` · ${hint}` : ""}`}
                          title={hint || undefined}
                        >
                          {toReview > 0 && <span className="bp-dot" aria-hidden="true" />}
                          {pending > 0 && <span className="bp-dot is-pending" aria-hidden="true" />}
                          {fmt(v)}
                        </button>
                      ) : (
                        <div key={m} className={`bp-cell${plan.actual[m] ? " is-actual" : ""}`}>{r.kind === "pct" ? pct(v) : fmt(v)}</div>
                      );
                    })}
                    {r.kind !== "section" && (
                      <div className="bp-cell tot">{r.total === null ? "" : r.kind === "pct" ? pct(r.total) : fmt(r.total)}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section aria-labelledby="bp-chart" className="bp-section">
            <div className="bp-heading is-row">
              <h2 id="bp-chart">CA et EBITDA (EBE) par mois</h2>
              <div className="bp-legend">
                <span><i className="bp-swatch is-ca" aria-hidden="true" />Chiffre d’affaires</span>
                <span><i className="bp-swatch is-eb" aria-hidden="true" />EBITDA (EBE)</span>
                {actualCount > 0 && actualCount < 12 && <span><i className="bp-swatch is-forecast" aria-hidden="true" />Prévisionnel</span>}
              </div>
            </div>
            <div className="bp-card bp-chart-card">
              <div role="img" aria-label="Histogramme mensuel du chiffre d’affaires et de l’EBITDA" className="bp-chart">
                {MONTH_NAMES.map((name, m) => (
                  <div key={name} className={`bp-bar-col${actualCount > 0 && !plan.actual[m] ? " is-forecast" : ""}`}>
                    <div className="bp-bar-value">{kEur(plan.series.ca[m])}</div>
                    <div className="bp-bars">
                      <div className="bp-bar is-ca" style={{ height: Math.round((plan.series.ca[m] / maxCa) * 200) }} />
                      <div className="bp-bar is-eb" style={{ height: Math.round((Math.max(0, plan.series.eb[m]) / maxCa) * 200) }} />
                    </div>
                    <div className="bp-bar-label">{name}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {detail && (
            <DetailPanel
              kind={detail.kind}
              year={year}
              month={detail.month}
              onMonth={(m) => setDetail({ ...detail, month: m })}
              onClose={() => setDetail(null)}
              plan={plan}
              agg={agg}
              hypotheses={H!}
              multiplier={multiplier}
              structure={{ employees: staffChoices, entries: base.structureStaff, onSave: saveStructure }}
              bank={{ lines: bank.lines, unclassified: bank.unclassified, fixed: bank.fixed, onClassify: classifyBank }}
              vat={vat}
            />
          )}

          <footer className="bp-footer">
            Mois réels : CA = factures finalisées ou payées par mois de prestation · encaissements = factures payées par date de paiement ·
            consultants = personnes avec une mission confirmée, active ou terminée sur le mois · ventes = missions démarrant dans le mois ·
            freelances = jours CRA × taux journalier · salaires = salaire mensuel brut × multiplicateur de charges (scénario {SCENARIOS.find((s) => s.id === scenario)!.label.toLowerCase()} : {multLabel(multiplier)}, × 1,4 pour les stagiaires) · inter-contrat =
            salariés sans mission sur le mois · départs = sorties d’employés. Salaires structure : personnes listées en structure, sur leur période
            (par défaut de l’embauche à la sortie ; prévisionnel : dernier salaire connu), hors jours ouvrés en mission —
            comptés en salaires consultants, au prorata de l’allocation. Charges fixes (hors salaires structure) : transactions Qonto HT classées, mois clôturés ; hypothèses sinon. Autres charges variables : hypothèses. TVA (trésorerie seulement) : mois clôturés couverts par Qonto = TVA des factures payées − TVA des dépenses − paiements DGFIP ; sinon 20 % des encaissements − 20 % des freelances et charges fixes hors salaires, solde reversé le mois suivant.
            Prévisionnel : un consultant vendu est facturé dès son mois de vente · IS simplifié sur le résultat d’exploitation annuel positif (EBE − dotations) ·
            encaissements décalés du délai client, les coûts sont payés le mois même.
          </footer>
          </div>
          )}
        </>
      )}
    </div>
  );
}

const sumOf = (a: number[]) => a.reduce((t, v) => t + v, 0);

function Kpi({ label, value, hint, accent, formula }: { label: string; value: string; hint: string; accent?: boolean; formula?: string[] }) {
  const tipId = useId();
  // Cards near the right edge open their tooltip leftwards so it stays on screen.
  const [flip, setFlip] = useState(false);
  const place = (el: HTMLElement) => setFlip(el.getBoundingClientRect().left + 420 > window.innerWidth - 16);
  return (
    <div
      className={`bp-kpi${accent ? " is-accent" : ""}${formula ? " has-tip" : ""}${flip ? " tip-left" : ""}`}
      tabIndex={formula ? 0 : undefined}
      aria-describedby={formula ? tipId : undefined}
      onMouseEnter={formula ? (e) => place(e.currentTarget) : undefined}
      onFocus={formula ? (e) => place(e.currentTarget) : undefined}
    >
      <div className="bp-kpi-label">{label}</div>
      <div className="bp-kpi-value">{value}</div>
      <div className="bp-kpi-hint">{hint}</div>
      {formula && (
        <div role="tooltip" id={tipId} className="bp-tip">
          {formula.map((f, i) => <div key={i}>{f}</div>)}
        </div>
      )}
    </div>
  );
}
