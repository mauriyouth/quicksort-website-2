import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, RefreshCw, RotateCcw } from "lucide-react";
import { DetailPanel, type DetailKind } from "./DetailPanel";
import { businessPlanXlsx, type ExportYear } from "./export-xlsx";
import { db, errorMessage, isMissingRelationError } from "@quicksort/hr-db";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  ButtonGroup,
  ButtonGroupText,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  CardHeader,
  CardTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatSource,
  StatUnit,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@quicksort-sas/ui";
import { PageAlerts } from "../../ui";
import { loadWorkspace } from "../../hr/data";
import { BankError, useBankApi, type BankStatus } from "./bank";
import {
  aggregateActuals,
  aggregateFixedCharges,
  aggregateVat,
  socialCharges,
  loadCra,
  loadExtensions,
  loadFreelancerInvoices,
  loadInvoices,
  loadSavedPlan,
  loadStructureStaff,
  saveSavedPlan,
  setStructure,
  type Aggregate,
  type BankRow,
  type CraRow,
  type FreelancerInvoiceRow,
  type PlanSources,
  type RevenueBasis,
  type SavedPlan,
  type StructureEntry,
} from "./actuals";
import {
  computePlan,
  DEFAULT_HYPOTHESES,
  firstOpenMonth,
  fmt,
  HYPOTHESIS_KEYS,
  migrateHypotheses,
  craIncompleteNote,
  kEur,
  MONTH_NAMES,
  num,
  pct,
  planRows,
  type FixedChargeLine,
  type FixedLineKey,
  type HypothesisKey,
  type Hypotheses,
  type MonthInput,
  type PlanResult,
} from "./model";

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
    { key: "tjm", label: "TJM moyen facturé", unit: "€" },
    { key: "taci", label: "TACI cible des salariés (congés inclus)", unit: "%", step: 0.5 },
    { key: "congesAn", label: "Congés payés par salarié / an", unit: "j" },
    { key: "rttAn", label: "RTT par salarié / an", unit: "j" },
    { key: "pctFree", label: "Part de freelances", unit: "%" },
  ] },
  { title: "Coûts de production", fields: [
    { key: "coutFree", label: "Coût journalier freelance", unit: "€" },
    { key: "salaire", label: "Salaire brut consultant / mois", unit: "€", step: 100 },
    { key: "commFactor", label: "Commission factor sur CA", unit: "%", step: 0.1 },
    { key: "primeIC", label: "Prime IC par vente", unit: "€", step: 50 },
    { key: "primeChasseur", label: "Prime chasseur par vente", unit: "€", step: 50 },
  ] },
  { title: "Charges fixes mensuelles", fields: [
    { key: "fPresident", label: "Salaire chargé président", unit: "€", step: 500 },
    { key: "fLoyer", label: "Loyer et locaux", unit: "€", step: 100 },
    { key: "fOutils", label: "Outils, cloud, licences IA", unit: "€", step: 100 },
    { key: "fMarketing", label: "Marketing, événements et réceptions", unit: "€", step: 100 },
    { key: "fHonoraires", label: "Honoraires", unit: "€", step: 100 },
    { key: "fDeplacements", label: "Frais de déplacement", unit: "€", step: 100 },
    { key: "fDivers", label: "Divers", unit: "€", step: 100 },
    { key: "fAmort", label: "Dotations aux amortissements et provisions", unit: "€", step: 100 },
  ] },
  { title: "Cotisations sociales", fields: [
    { key: "tauxCharges", label: "URSSAF et retraite patronales", unit: "% du brut", step: 0.5 },
    { key: "mutuelle", label: "Mutuelle par salarié / mois", unit: "€", step: 10 },
    { key: "ticketsResto", label: "Tickets restaurant par salarié / mois", unit: "€", step: 10 },
    { key: "medecine", label: "Médecine du travail par salarié / an", unit: "€", step: 10 },
  ] },
  { title: "Trésorerie et impôt", fields: [
    { key: "tresoDebut", label: "Trésorerie au 1er janvier", unit: "€", step: 1000 },
    { key: "dso", label: "Délai de paiement clients", unit: "jours", step: 30 },
    { key: "tauxIS", label: "Taux d'IS appliqué", unit: "%", step: 0.5 },
  ] },
];

type Loaded = Omit<PlanSources, "cra" | "cjmMultiplier"> & { salariesVisible: boolean };

const BASES: { id: RevenueBasis; param: string; label: string; text: string }[] = [
  { id: "period", param: "prestation", label: "Mois de prestation", text: "par mois de prestation" },
  { id: "issue", param: "emission", label: "Date d'émission", text: "par date d'émission" },
];
type Draft = { hyp: Record<HypothesisKey, string>; ventes: string[]; departs: string[] };

const untyped = () => db() as unknown as SupabaseClient;
const FIXED_KEYS: readonly string[] = ["loyer", "outils", "marketing", "honoraires", "deplacements", "divers"] satisfies FixedLineKey[];
const isFixedKey = (k: string): k is FixedLineKey => FIXED_KEYS.includes(k);
/** Background sync on page open when the last run is older than this. */
const SYNC_STALE_MS = 12 * 3600_000;
/** Follow-up runs while a partial sync still has work left. */
const MAX_SYNC_RELAUNCHES = 10;

/** "à l’instant", "12 min", "3 h", "2 j". */
function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}
const str = (v: number) => String(v);

/** One year's monthly inputs: actuals where closed, the entered sales / departures elsewhere. */
function monthInputs(
  agg: Aggregate,
  h: Hypotheses,
  ventes: (m: number) => number,
  departs: (m: number) => number,
  fixed: ReturnType<typeof aggregateFixedCharges>["fixed"],
  vat: ReturnType<typeof aggregateVat>["vat"],
): MonthInput[] {
  return agg.months.map((actual, m) => ({
    actual,
    ventes: ventes(m),
    departs: departs(m),
    structure: agg.structure[m],
    structureCp: agg.structureLines[m].reduce((t, l) => (l.contractType !== "Internship" && l.salary ? t + l.cost : t), 0),
    fixed: fixed[m] ?? undefined,
    vat: vat[m] ?? undefined,
    cotConsultants: agg.salaryLines[m] ? socialCharges(agg.salaryLines[m]!, h) : undefined,
    cotStructure: socialCharges(agg.structureLines[m], h),
  }));
}

/** A year between today's and the selected one: what its saved plan needs. */
type PrevYear = { year: number; saved: SavedPlan | null; cra: CraRow[]; freelancerInvoices: FreelancerInvoiceRow[]; bankRows: BankRow[] | null };
/** Where a year starts: consultants and cash at the end of the year before (null = cash is a hypothesis). */
type YearStart = { cons: number; treso: number | null };

/** Saved plan, CRA days and Qonto rows of a year other than the one on screen. */
async function loadYear(client: SupabaseClient, bankApi: ReturnType<typeof useBankApi>, y: number): Promise<PrevYear> {
  const [s, c, rows, fi] = await Promise.all([
    loadSavedPlan(client, y).catch(() => null),
    loadCra(client, y).catch(() => []),
    // No Qonto: that year's fixed charges and VAT stay on hypotheses.
    bankApi.transactions(y).catch(() => null),
    // No freelancer invoices table (or no access): the CRA × rate estimate stands.
    loadFreelancerInvoices(client, y).catch(() => []),
  ]);
  return { year: y, saved: s, cra: c, freelancerInvoices: fi, bankRows: rows };
}

/**
 * A year other than the one on screen, from its saved plan (real months,
 * then the saved hypotheses, sales and departures, else the data defaults),
 * starting from `cons` consultants and, when known, `treso` cash.
 */
function projectYear(
  base: Loaded,
  basis: RevenueBasis,
  today: Date,
  coverage: string | null,
  p: PrevYear,
  cons: number,
  treso: number | null,
): { plan: PlanResult; h: Hypotheses } {
  const open = firstOpenMonth(p.year, today);
  const a = aggregateActuals({ ...base, cjmMultiplier: 1, internMultiplier: 1, cra: p.cra, freelancerInvoices: p.freelancerInvoices, revenueBasis: basis }, p.year, open, today);
  const h = { ...DEFAULT_HYPOTHESES };
  const savedHyp = migrateHypotheses(p.saved?.hypotheses);
  for (const k of HYPOTHESIS_KEYS) h[k] = savedHyp[k] ?? a.seeds[k] ?? DEFAULT_HYPOTHESES[k];
  if (treso != null) h.tresoDebut = treso;
  const rowsCov = p.bankRows ? coverage : null;
  const plan = computePlan(
    h,
    monthInputs(
      a, h,
      (m) => p.saved?.monthly?.ventes?.[m] ?? a.avgVentes,
      (m) => p.saved?.monthly?.departs?.[m] ?? a.plannedDeparts[m],
      aggregateFixedCharges(p.bankRows ?? [], p.year, open, rowsCov).fixed,
      aggregateVat(base.invoices, p.bankRows ?? [], p.year, open, rowsCov).vat,
    ),
    cons,
    p.year,
  );
  return { plan, h };
}

/** Years in the multi-year Excel export: the one on screen and the ones after it. */
const EXPORT_YEARS = 3;

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
  // Revenue month: period of service (default) or issue date, also kept in the URL.
  const basis = BASES.find((b) => b.param === params.get("ca")) ?? BASES[0];
  const setBasis = (id: RevenueBasis) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "period") next.delete("ca");
        else next.set("ca", BASES.find((b) => b.id === id)!.param);
        return next;
      },
      { replace: true },
    );
  const [base, setBase] = useState<Loaded | null>(null);
  const [cra, setCra] = useState<PlanSources["cra"] | null>(null);
  const [freelancerInvoices, setFreelancerInvoices] = useState<FreelancerInvoiceRow[]>([]);
  const [saved, setSaved] = useState<SavedPlan | null>(null);
  /** Years from today's to the one before the selected year: their saved plans carry headcount and cash forward. */
  const [prev, setPrev] = useState<{ year: number; years: PrevYear[] } | null>(null);
  const prevYears = prev?.year === year ? prev.years : null;
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
      const [ws, invoices, extensions, structureStaff] = await Promise.all([
        loadWorkspace(),
        loadInvoices(client).catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
        loadExtensions(client).catch((e) => (isMissingRelationError(e) ? [] : Promise.reject(e))),
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
      const [craRows, plan, invoicesOfYear] = await Promise.all([
        loadCra(client, year).catch(() => []),
        loadSavedPlan(client, year).catch((e) => {
          if (isMissingRelationError(e)) {
            setTableMissing(true);
            return null;
          }
          throw e;
        }),
        // No freelancer invoices table (or no access): the CRA × rate estimate stands.
        loadFreelancerInvoices(client, year).catch(() => []),
      ]);
      if (cancelled) return;
      setFreelancerInvoices(invoicesOfYear);
      setCra(craRows);
      setSaved(plan);
    })().catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [year]);

  // Per-year: the years before it (from today's), reloaded after a Qonto sync without touching the draft.
  useEffect(() => {
    let cancelled = false;
    const client = untyped();
    const years = Array.from({ length: Math.max(0, year - today.getFullYear()) }, (_, i) => today.getFullYear() + i);
    Promise.all(years.map((y) => loadYear(client, bankApi, y)))
      .then((list) => !cancelled && setPrev({ year, years: list }))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [year, today, bankApi, bankVersion]);

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
  // Salaries are gross: employer charges come from the "Cotisations sociales" hypotheses.
  const multiplier = 1;
  const agg = useMemo(
    () => (base && cra ? aggregateActuals({ ...base, cjmMultiplier: 1, internMultiplier: 1, cra, freelancerInvoices, revenueBasis: basis.id }, year, openFrom, today) : null),
    [base, cra, freelancerInvoices, year, openFrom, today, basis.id],
  );

  /**
   * Where the selected year starts. A year after today's starts from the
   * previous year's December: its saved plan (real months, then the saved
   * hypotheses, sales and departures, else the data defaults) is recomputed
   * year after year from today's, whose January cash stays a hypothesis.
   * Today's year starting in January takes last December's measured headcount.
   */
  const start: YearStart | null = useMemo(() => {
    if (!base || !prevYears) return null;
    const src = (c: CraRow[]): PlanSources => ({ ...base, cjmMultiplier: 1, internMultiplier: 1, cra: c, revenueBasis: basis.id });
    const y0 = today.getFullYear();
    let cons = year <= y0 && firstOpenMonth(year, today) > 0
      ? 0
      : aggregateActuals(src([]), Math.min(year, y0) - 1, 12, today).months[11]?.cons ?? 0;
    let treso: number | null = null;
    const cov = bankStatus?.state.backfillDone ? bankStatus.state.coverageStart : null;
    for (const p of prevYears) {
      const { plan: r } = projectYear(base, basis.id, today, cov, p, cons, treso);
      cons = r.totals.consFin;
      treso = r.totals.treso;
    }
    return { cons, treso };
  }, [base, prevYears, year, today, basis.id, bankStatus]);

  /** Draft as it would be with no edits: saved values, else data seeds, else mockup defaults. */
  const initialDraft = useCallback((): Draft | null => {
    if (!agg || !cra) return null;
    const hyp = {} as Record<HypothesisKey, string>;
    const savedHyp = migrateHypotheses(saved?.hypotheses);
    for (const k of HYPOTHESIS_KEYS)
      hyp[k] = str(savedHyp[k] ?? agg.seeds[k] ?? DEFAULT_HYPOTHESES[k]);
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
    if (start?.treso != null) h.tresoDebut = start.treso;
    return h;
  }, [draft, start]);

  const plan = useMemo(() => {
    if (!agg || !draft || !H || !start) return null;
    return computePlan(
      H,
      monthInputs(agg, H, (m) => num(draft.ventes[m]), (m) => num(draft.departs[m]), bank.fixed, vat.vat),
      start.cons,
      year,
    );
  }, [agg, draft, H, bank, vat, start, year]);

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
      setError(isMissingRelationError(e) ? "La table business_plan_structure n'existe pas encore. Appliquez la migration." : errorMessage(e));
    }
  }

  /** Year waiting for confirmation while there are unsaved edits. */
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  function changeYear(next: number) {
    if (dirty) {
      setPendingYear(next);
      return;
    }
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
      setError(isMissingRelationError(e) ? "La table business_plans n'existe pas encore. Appliquez la migration." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const [exporting, setExporting] = useState(false);
  /** Downloads the plan on screen (unsaved edits included), alone or followed by the next years' saved plans. */
  async function exportExcel(count: number) {
    if (!plan || !H || !base) return;
    setExporting(true);
    setError("");
    try {
      const years: ExportYear[] = [{ year, plan, h: H }];
      const cov = bankStatus?.state.backfillDone ? bankStatus.state.coverageStart : null;
      const next = await Promise.all(Array.from({ length: count - 1 }, (_, i) => loadYear(untyped(), bankApi, year + 1 + i)));
      for (const p of next) {
        const prevEnd = years[years.length - 1].plan.totals;
        years.push({ year: p.year, ...projectYear(base, basis.id, today, cov, p, prevEnd.consFin, prevEnd.treso) });
      }
      const bytes = businessPlanXlsx(years, GROUPS);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `business-plan-${year}${count > 1 ? `-${year + count - 1}` : ""}${dirty ? "-non-enregistre" : ""}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
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

  const loading = !plan || !draft || !agg || !base || !start;
  /** Hypotheses that differ from a measured value. */
  const overrides =
    agg && draft
      ? HYPOTHESIS_KEYS.filter((k) => agg.seeds[k] !== undefined && num(draft.hyp[k]) !== agg.seeds[k]).length
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

  const qontoText = syncing
    ? "Synchronisation…"
    : bankNote
      ? bankNote
      : bankStatus?.state.lastRunAt
        ? `${bankStatus.state.lastError ? "Dernière synchro Qonto en erreur" : `Synchronisé ${ago(bankStatus.state.lastRunAt, Date.now())}`}${bankStatus.reviewCount > 0 ? ` · ${bankStatus.reviewCount} à vérifier` : ""}${unclassifiedTotal > 0 ? ` · ${unclassifiedTotal} non classée${unclassifiedTotal > 1 ? "s" : ""}` : ""}`
        : bankStatus
          ? "Jamais synchronisé"
          : "";
  const qontoWarn = !syncing && (!!bankNote || !!bankStatus?.state.lastError);

  return (
    <div className="@container flex min-w-0 flex-col gap-8 pb-16">
      {(error || message || tableMissing) && (
        <div className="flex flex-col gap-2">
          <PageAlerts error={error} message={message} />
          {tableMissing && (
            <Alert variant="destructive" role="status">
              <AlertDescription>La table business_plans n'existe pas encore : les hypothèses ne peuvent pas être enregistrées.</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ButtonGroup aria-label="Année">
              <Button variant="outline" size="icon" onClick={() => changeYear(year - 1)} aria-label="Année précédente"><ChevronLeft /></Button>
              <ButtonGroupText className="num w-20 justify-center bg-transparent text-base text-foreground">{year}</ButtonGroupText>
              <Button variant="outline" size="icon" onClick={() => changeYear(year + 1)} aria-label="Année suivante"><ChevronRight /></Button>
            </ButtonGroup>
            <span className="text-sm text-muted-foreground">{status} · montants en € HT</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={cn("text-sm", dirty ? "text-warning" : "text-muted-foreground")}>
              {dirty
                ? "Modifications non enregistrées"
                : saved?.updated_at
                  ? `Enregistré le ${new Date(saved.updated_at).toLocaleDateString("fr-FR")}`
                  : "Valeurs issues des données"}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" disabled={loading || exporting} />}>
                <Download data-icon="inline-start" /> {exporting ? "Export…" : "Exporter Excel"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => exportExcel(1)}>Année {year}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportExcel(EXPORT_YEARS)}>
                  {EXPORT_YEARS} ans ({year}–{year + EXPORT_YEARS - 1})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={resetToData} disabled={loading}>
              <RotateCcw data-icon="inline-start" /> Réinitialiser
            </Button>
            <Button data-save-shortcut onClick={save} disabled={loading || busy || !dirty || tableMissing}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor="bp-basis" className="text-sm text-muted-foreground">CA par</label>
            <NativeSelect
              id="bp-basis"
              size="sm"
              value={basis.id}
              onChange={(e) => setBasis(e.target.value as RevenueBasis)}
              title="Mois auquel une facture compte dans le CA des mois réels"
            >
              {BASES.map((b) => (
                <NativeSelectOption key={b.id} value={b.id}>{b.label}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      {loading ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">Chargement des données…</p>
      ) : (
        <>
          {!base.salariesVisible && (
            <Alert variant="warning" role="status">
              <AlertDescription>Les salaires ne sont pas visibles avec votre rôle : les coûts salariés réels sont à zéro.</AlertDescription>
            </Alert>
          )}

          <TooltipProvider delay={150}>
            <Card role="region" aria-label="Indicateurs clés">
              <CardContent className="flex flex-col gap-6">
                <StatGroup>
                  <Kpi
                    label="Chiffre d'affaires"
                    value={kEur(plan.totals.ca)}
                    hint={`${kEur(plan.totals.ca / 12)} / mois en moyenne`}
                    formula={[
                      "Somme des 12 mois.",
                      `Réel : factures finalisées ou payées, ${basis.text}.`,
                      "Prévisionnel : consultants × jours ouvrés × TJM (salariés × TACI du mois).",
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
                      "Excédent brut d'exploitation : avant amortissements, intérêts et IS.",
                    ]}
                  />
                  <Kpi
                    label="EBIT (résultat d'exploitation)"
                    value={kEur(plan.totals.ex)}
                    hint={`${pct(plan.totals.exPct)} du CA`}
                    formula={[
                      "= EBITDA − dotations aux amortissements et provisions",
                      `= ${kEur(plan.totals.eb)} − ${kEur(sumOf(plan.series.da))}`,
                      "Résultat de l'activité courante, avant intérêts et IS.",
                    ]}
                  />
                </StatGroup>
                <div className="border-t border-border" />
                <StatGroup>
                  <Kpi
                    label="Résultat net estimé"
                    value={kEur(plan.totals.rn)}
                    hint={`résultat d'exploitation ${kEur(plan.totals.ex)} − IS ${kEur(plan.totals.is)}`}
                    accent
                    formula={[
                      "= Résultat d'exploitation − IS",
                      `Résultat d'exploitation = EBE − dotations = ${kEur(plan.totals.eb)} − ${kEur(sumOf(plan.series.da))} = ${kEur(plan.totals.ex)}`,
                      `IS = ${fmt(H!.tauxIS)} % du résultat d'exploitation s'il est positif = ${kEur(plan.totals.is)}`,
                    ]}
                  />
                  <Kpi
                    label="TACI"
                    value={pct(plan.totals.taci)}
                    hint={[`TACE ${pct(plan.totals.tace)} · intercontrat ${pct(plan.totals.itc)}`, craIncompleteNote(plan)].filter(Boolean).join(" · ")}
                    formula={[
                      "TACI = jours facturés / jours ouvrés des salariés (congés inclus).",
                      "TACE = jours facturés / (jours ouvrés − congés). Intercontrat = jours ni facturés ni en congés (dont « Internal ») / jours ouvrés.",
                      "Réel : CRA. Prévisionnel : TACI cible, modulé chaque mois par les congés.",
                    ]}
                  />
                  <Kpi
                    label="CJM moyen"
                    value={`${fmt(plan.totals.cjm)} €`}
                    hint={[`marge ${fmt(plan.totals.mj)} € / jour facturé`, craIncompleteNote(plan)].filter(Boolean).join(" · ")}
                    formula={[
                      "CJM = (salaires bruts + cotisations des consultants salariés) / jours ouvrés.",
                      `Marge par jour facturé = (CA − coûts de production) / jours facturés · TJM réalisé ${fmt(plan.totals.tjmR)} €.`,
                    ]}
                  />
                  <Kpi
                    label="Consultants fin d'année"
                    value={fmt(plan.totals.consFin)}
                    hint={`${fmt(plan.totals.ventes)} ventes · ${fmt(plan.totals.departs)} départs`}
                    formula={[
                      "Consultants staffés en décembre.",
                      "Réel : personnes avec une mission sur le mois. Prévisionnel : mois précédent + ventes − départs.",
                    ]}
                  />
                  <Kpi
                    label="Trésorerie fin d'année"
                    value={kEur(plan.totals.treso)}
                    hint={`point bas : ${kEur(plan.totals.tresoMin)}`}
                    formula={[
                      "= trésorerie au 1er janvier + encaissements − coûts de production − charges variables − charges fixes",
                      `= ${kEur(H!.tresoDebut)} + ${kEur(sumOf(plan.series.enc))} − ${kEur(sumOf(plan.series.prod) - sumOf(plan.series.cpc))} − ${kEur(sumOf(plan.series.varr))} − ${kEur(sumOf(plan.series.fix) - sumOf(plan.series.cps))}`,
                      "Les dotations aux amortissements et la provision congés payés ne sortent pas de trésorerie.",
                    ]}
                  />
                </StatGroup>
              </CardContent>
            </Card>
          </TooltipProvider>

          <Tabs value={view} onValueChange={(v) => setView(v === "hyp" ? "hyp" : "plan")} className="gap-8">
            <div className="border-b border-border">
              <TabsList variant="line" aria-label="Vues du business plan" className="h-10 gap-5">
                <TabsTrigger value="plan">Plan</TabsTrigger>
                <TabsTrigger value="hyp" className="gap-1.5">
                  Hypothèses
                  {overrides > 0 && (
                    <span className="num text-xs font-normal text-muted-foreground" title="Hypothèses différentes de la valeur mesurée">
                      {overrides} écart{overrides > 1 ? "s" : ""} au réel
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="hyp">
              <section aria-labelledby="bp-hyp" className="flex flex-col gap-5">
                <SectionTitle id="bp-hyp" title="Hypothèses">
                  Pré-remplies depuis les données réelles quand elles existent (« réel »), sinon valeurs indicatives. Elles pilotent les mois prévisionnels.
                </SectionTitle>
                <div className="grid gap-4 @3xl:grid-cols-2">
                  {GROUPS.map((g, gi) => (
                    <Card key={g.title} size="sm" role="group" aria-labelledby={`bp-group-${gi}`}>
                      <CardHeader className="border-b border-border">
                        <CardTitle id={`bp-group-${gi}`}>{g.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col divide-y divide-border">
                        {gi === 0 && (
                          <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                            <div className="flex min-w-0 flex-col items-start gap-1">
                              <label htmlFor="bp-consStart" className="text-sm leading-snug">
                                Consultants au 1er janvier <span className="text-muted-foreground">(nb)</span>
                              </label>
                              <Badge variant={openFrom > 0 ? "secondary" : "outline"}>
                                {openFrom > 0 ? "remplacé par le réel" : `fin ${year - 1}${year - 1 < today.getFullYear() ? "" : " projetée"}`}
                              </Badge>
                            </div>
                            <Input
                              className="num h-9 text-right"
                              id="bp-consStart"
                              type="number"
                              value={openFrom > 0 ? str(plan.series.cons[0] ?? 0) : str(start.cons)}
                              disabled
                              readOnly
                              title={`Consultants en décembre ${year - 1} : réel, ou projeté par le plan ${year - 1} (ventes − départs)`}
                            />
                          </div>
                        )}
                        {g.fields.map((f) => {
                          const seed = agg.seeds[f.key];
                          /** Carried over from the previous year's plan, not entered. */
                          const carried = f.key === "tresoDebut" && start.treso != null;
                          return (
                            <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                              <div className="flex min-w-0 flex-col items-start gap-1">
                                <label htmlFor={`bp-${f.key}`} className="text-sm leading-snug">
                                  {f.label} <span className="text-muted-foreground">({f.unit})</span>
                                </label>
                                {f.key === "taci" && (
                                  <span className="num text-xs text-muted-foreground">
                                    TACE équivalent {pct(plan.calendar.tace[0] ?? 0)} · TACI max {pct(plan.calendar.taciMax)}
                                  </span>
                                )}
                                {carried ? (
                                  <Badge variant="outline">fin {year - 1} projetée</Badge>
                                ) : seed !== undefined && num(draft.hyp[f.key]) !== seed ? (
                                  <Button variant="outline" size="xs" className="num" onClick={() => setHyp(f.key, str(seed))} title="Revenir à la valeur mesurée">
                                    réel : {fmt(seed)}
                                  </Button>
                                ) : seed !== undefined ? (
                                  <Badge variant="outline">réel</Badge>
                                ) : null}
                              </div>
                              <Input
                                className="num h-9 text-right"
                                id={`bp-${f.key}`}
                                type="number"
                                inputMode="decimal"
                                step={f.step ?? 1}
                                value={carried ? str(Math.round(start.treso!)) : draft.hyp[f.key]}
                                disabled={carried}
                                readOnly={carried}
                                title={carried ? `Trésorerie fin décembre ${year - 1}, projetée par le plan ${year - 1}` : undefined}
                                onChange={(e) => setHyp(f.key, e.target.value)}
                              />
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="plan" className="flex min-w-0 flex-col gap-12">
              <section aria-labelledby="bp-pl" className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <SectionTitle id="bp-pl" title="Compte de résultat mensuel" />
                  <div className="ml-auto flex flex-col items-end gap-1.5">
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                      <span
                        role="status"
                        className={cn("inline-flex items-center gap-2 text-sm", qontoWarn ? "text-warning" : "text-muted-foreground")}
                        title={!syncing && !bankNote && bankStatus?.state.lastError ? bankStatus.state.lastError : undefined}
                      >
                        {qontoText}
                        {bankStatus && !bankStatus.state.backfillDone && !bankNote && <Badge variant="secondary">Rattrapage en cours</Badge>}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => void syncQonto()} disabled={syncing}>
                        <RefreshCw data-icon="inline-start" className={syncing ? "animate-spin motion-reduce:animate-none" : undefined} /> Actualiser Qonto
                      </Button>
                    </div>
                    <span className="text-xs text-muted-foreground">Faites défiler horizontalement →</span>
                  </div>
                </div>
                <Card className="py-0" data-pl-table="">
                  <Table aria-labelledby="bp-pl" className="min-w-[1356px] table-fixed">
                    <colgroup>
                      <col className="w-[240px]" />
                      {MONTH_NAMES.map((name) => <col key={name} className="w-[84px]" />)}
                      <col className="w-[112px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="bg-card hover:bg-card">
                        <th scope="col" className={cn(LAB, "num h-auto bg-card py-2.5 text-sm font-medium")}>{year}</th>
                        {MONTH_NAMES.map((name, m) => (
                          <TableHead key={name} numeric className={cn("h-auto px-2 py-2 align-bottom first:pl-2 last:pr-3", plan.actual[m] && ACTUAL)}>
                            <span className="flex flex-col items-end gap-1">
                              <span>{name}</span>
                              {plan.actual[m] ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">Réel</Badge> : <span className="text-faint">{`T${Math.floor(m / 3) + 1}`}</span>}
                            </span>
                          </TableHead>
                        ))}
                        <TableHead numeric className="h-auto border-l border-border px-3 py-2 align-bottom">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <SectionRow label="Activité" />
                      <TableRow className={ROW.line}>
                        <th scope="row" className={cn(LAB, LAB_BG.line)} title="Lundi–vendredi, hors jours fériés">Jours ouvrés</th>
                        {MONTH_NAMES.map((name, m) => (
                          <TableCell key={name} numeric className={cn(CELL, plan.actual[m] && ACTUAL)}>{fmt(plan.calendar.jo[m])}</TableCell>
                        ))}
                        <TableCell numeric className={TOT}>{fmt(sumOf(plan.calendar.jo))}</TableCell>
                      </TableRow>
                      {(["ventes", "departs"] as const).map((which) => (
                        <TableRow key={which} className={ROW.line}>
                          <th scope="row" className={cn(LAB, LAB_BG.line, "p-0 font-medium")}>
                            <button
                              type="button"
                              className={cn(DRILL, "px-3 text-left underline decoration-muted-foreground decoration-dotted underline-offset-[3px]")}
                              onClick={() => setDetail({ kind: which, month: Math.max(0, Math.min(11, actualCount > 0 ? actualCount - 1 : 0)) })}
                              title={which === "ventes" ? "Voir les missions qui démarrent" : "Voir les départs"}
                            >
                              {which === "ventes" ? "Nb de ventes" : "Nb de départs"} <span className="text-muted-foreground no-underline" aria-hidden="true">›</span>
                            </button>
                          </th>
                          {MONTH_NAMES.map((name, m) =>
                            plan.actual[m] ? (
                              <TableCell key={name} numeric className={cn("h-auto p-0 first:pl-0 last:pr-0", ACTUAL)}>
                                <button
                                  type="button"
                                  className={cn(DRILL, "num px-2 text-right")}
                                  onClick={() => setDetail({ kind: which, month: m })}
                                  aria-label={`${which === "ventes" ? "Nb de ventes" : "Nb de départs"}, détail ${name}`}
                                >
                                  {fmt(plan.series[which][m])}
                                </button>
                              </TableCell>
                            ) : (
                              <TableCell key={name} className="h-auto px-1.5 py-1.5">
                                <Input
                                  className="num h-8 px-2 text-right text-[13px] md:text-[13px]"
                                  type="number"
                                  min={0}
                                  step={1}
                                  aria-label={`${which === "ventes" ? "Ventes" : "Départs"} ${name}`}
                                  value={draft[which][m]}
                                  onChange={(e) => setMonth(which, m, e.target.value)}
                                />
                              </TableCell>
                            ),
                          )}
                          <TableCell numeric className={TOT}>{fmt(which === "ventes" ? plan.totals.ventes : plan.totals.departs)}</TableCell>
                        </TableRow>
                      ))}
                      {rows.map((r) =>
                        r.kind === "section" ? (
                          <SectionRow key={r.label} label={r.label} />
                        ) : (
                          <TableRow key={r.label} className={ROW[r.kind]}>
                            {r.key ? (
                              <th scope="row" className={cn(LAB, LAB_BG[r.kind], "p-0")}>
                                <button
                                  type="button"
                                  className={cn(DRILL, "px-3 text-left underline decoration-muted-foreground decoration-dotted underline-offset-[3px]")}
                                  onClick={() => setDetail({ kind: r.key!, month: Math.max(0, Math.min(11, actualCount > 0 ? actualCount - 1 : 0)) })}
                                  title={
                                    r.key === "ca" || r.key === "enc" ? "Voir le détail des factures"
                                      : r.key === "tva" ? "Voir le détail de la TVA"
                                      : r.key === "cotc" || r.key === "cots" ? "Voir le détail des cotisations"
                                      : r.key === "cu" || r.key === "cmu" || r.key === "ctr" || r.key === "cme" ? "Voir les paiements Qonto"
                                      : isFixedKey(r.key) ? "Voir le détail des transactions"
                                        : "Voir le détail par personne"
                                  }
                                >
                                  {r.label} <span className="text-muted-foreground no-underline" aria-hidden="true">›</span>
                                </button>
                              </th>
                            ) : (
                              <th scope="row" className={cn(LAB, LAB_BG[r.kind])}>{r.label}</th>
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
                                <TableCell key={m} numeric className={cn("h-auto p-0 first:pl-0 last:pr-0", plan.actual[m] && ACTUAL)}>
                                  <button
                                    type="button"
                                    className={cn(DRILL, "num px-2 text-right")}
                                    onClick={() => setDetail({ kind: r.key!, month: m })}
                                    aria-label={`${r.label}, détail ${MONTH_NAMES[m]}${hint ? ` · ${hint}` : ""}`}
                                    title={hint || undefined}
                                  >
                                    {toReview > 0 && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-destructive align-middle" aria-hidden="true" />}
                                    {pending > 0 && <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]" aria-hidden="true" />}
                                    {fmt(v)}
                                  </button>
                                </TableCell>
                              ) : (
                                <TableCell
                                  key={m}
                                  numeric
                                  className={cn(CELL, plan.actual[m] && ACTUAL)}
                                  title={r.indicator && plan.craIncomplete[m] ? "CRA incomplet : indicateur partiel" : undefined}
                                >
                                  {r.indicator && plan.craIncomplete[m] && <span className="mr-1 text-muted-foreground" aria-label="CRA incomplet">*</span>}
                                  {r.kind === "pct" ? pct(v) : fmt(v)}
                                </TableCell>
                              );
                            })}
                            <TableCell numeric className={TOT} title={r.indicator && craIncompleteNote(plan) ? `${craIncompleteNote(plan)} : total partiel` : undefined}>
                              {r.indicator && craIncompleteNote(plan) && <span className="mr-1 text-muted-foreground" aria-label="CRA incomplet">*</span>}
                              {r.total === null ? "" : r.kind === "pct" ? pct(r.total) : fmt(r.total)}
                            </TableCell>
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </section>

              <section aria-labelledby="bp-chart" className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <SectionTitle id="bp-chart" title="CA et EBITDA (EBE) par mois" />
                  <div className="flex flex-wrap gap-5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2"><i className="inline-block size-3 rounded-[3px] bg-(--chart-1)" aria-hidden="true" />Chiffre d'affaires</span>
                    <span className="inline-flex items-center gap-2"><i className="inline-block size-3 rounded-[3px] bg-(--chart-2)" aria-hidden="true" />EBITDA (EBE)</span>
                    {actualCount > 0 && actualCount < 12 && (
                      <span className="inline-flex items-center gap-2"><i className={cn("inline-block size-3 rounded-[3px] border border-(--chart-1)", STRIPES_SM)} aria-hidden="true" />Prévisionnel</span>
                    )}
                  </div>
                </div>
                <Card>
                  <CardContent className="overflow-x-auto">
                    <div role="img" aria-label="Histogramme mensuel du chiffre d'affaires et de l'EBITDA" className="grid min-w-[640px] grid-cols-12 items-end gap-3">
                      {MONTH_NAMES.map((name, m) => {
                        const forecast = actualCount > 0 && !plan.actual[m];
                        return (
                          <div key={name} className="flex flex-col items-center gap-2">
                            <div className="num text-[11px] whitespace-nowrap text-muted-foreground">{kEur(plan.series.ca[m])}</div>
                            <div className="flex h-[220px] w-full items-end justify-center gap-1 border-b border-(--chart-3)">
                              <div
                                className={cn("w-2/5 max-w-7 rounded-t-[4px]", forecast ? cn(STRIPES, "shadow-[inset_0_0_0_1px_var(--chart-1)]") : "bg-(--chart-1)")}
                                style={{ height: Math.round((plan.series.ca[m] / maxCa) * 200) }}
                              />
                              <div
                                className={cn("w-2/5 max-w-7 rounded-t-[4px] bg-(--chart-2)", forecast && "opacity-55")}
                                style={{ height: Math.round((Math.max(0, plan.series.eb[m]) / maxCa) * 200) }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground">{name}</div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
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

              <footer className="border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
                Mois réels : CA = factures finalisées ou payées {basis.text} · encaissements = factures payées par date de paiement ·
                consultants = personnes avec une mission confirmée, active ou terminée sur le mois · ventes = missions démarrant dans le mois ·
                freelances = jours CRA × taux journalier · salaires = salaire mensuel brut (stagiaires : gratification) · cotisations sociales = URSSAF et retraite en % du brut + mutuelle, tickets restaurant et médecine du travail par salarié, au prorata du mois (hypothèses calées sur l'arrêté comptable ; stagiaires exclus) · inter-contrat =
                salariés sans mission sur le mois · départs = sorties d'employés. Salaires structure : personnes listées en structure, sur leur période
                (par défaut de l'embauche à la sortie ; prévisionnel : dernier salaire connu), hors jours ouvrés en mission,
                comptés en salaires consultants, au prorata de l'allocation. Charges fixes (hors salaires structure) : transactions Qonto HT classées, mois clôturés ; hypothèses sinon. Autres charges variables : hypothèses. Provision congés payés (non décaissée) = (congés acquis du mois − jours de congés payés pris) × salaire brut journalier × (1 + taux URSSAF et retraite) ; jours pris : CRA des consultants sur les mois clôturés, calendrier des hypothèses sinon et pour la structure ; stagiaires exclus. TVA (trésorerie seulement) : mois clôturés couverts par Qonto = TVA des factures payées − TVA des dépenses − paiements DGFIP ; sinon 20 % des encaissements − 20 % des freelances et charges fixes hors salaires, solde reversé le mois suivant.
                Prévisionnel : un consultant vendu est facturé dès son mois de vente · IS simplifié sur le résultat d'exploitation annuel positif (EBE − dotations) ·
                encaissements décalés du délai client, les coûts sont payés le mois même.
              </footer>
            </TabsContent>
          </Tabs>
        </>
      )}

      <AlertDialog open={pendingYear !== null} onOpenChange={(open) => { if (!open) setPendingYear(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Modifications non enregistrées</AlertDialogTitle>
            <AlertDialogDescription>Changer d'année quand même ? Les modifications du business plan {year} seront perdues.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Rester sur {year}</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingYear !== null) setYear(pendingYear);
                setPendingYear(null);
              }}
            >
              Changer d'année
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const sumOf = (a: number[]) => a.reduce((t, v) => t + v, 0);

/* ── P&L table styling ──────────────────────────────────────────────── */

type RowKind = "line" | "sub" | "total" | "key" | "pct";
/** Closed ("Réel") months: a light overlay that works on every row tint. */
const ACTUAL = "bg-foreground/[0.035]";
const CELL = "h-auto px-2 py-2 first:pl-2 last:pr-2";
const TOT = "h-auto border-l border-border px-3 py-2 font-medium first:pl-3 last:pr-3";
/** Sticky first column; its background must be opaque (see LAB_BG). */
const LAB = "sticky left-0 z-10 border-r border-border px-3 py-2 text-left text-[13px] whitespace-nowrap";
const TINT = "bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]";
const ROW: Record<RowKind, string> = {
  line: "bg-card hover:bg-card",
  sub: "bg-card italic text-muted-foreground hover:bg-card",
  total: cn(TINT, "font-medium hover:bg-[color-mix(in_srgb,var(--muted)_55%,var(--card))]"),
  key: "bg-muted font-semibold hover:bg-muted [&_td]:text-[14px]",
  pct: "bg-card text-muted-foreground hover:bg-card [&_td]:text-xs",
};
const LAB_BG: Record<RowKind, string> = { line: "bg-card font-normal", sub: "bg-card font-normal", total: cn(TINT, "font-medium"), key: "bg-muted text-sm font-semibold", pct: "bg-card text-xs font-normal" };
const DRILL =
  "block w-full cursor-pointer py-2 text-[13px] text-inherit transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const STRIPES = "bg-[repeating-linear-gradient(135deg,var(--chart-1)_0_3px,transparent_3px_6px)]";
const STRIPES_SM = "bg-[repeating-linear-gradient(135deg,var(--chart-1)_0_2px,transparent_2px_4px)]";

function SectionRow({ label }: { label: string }) {
  return (
    <TableRow className="bg-secondary hover:bg-secondary">
      <th scope="rowgroup" className={cn(LAB, "label-mono bg-secondary py-2.5 text-foreground")}>{label}</th>
      <td colSpan={13} />
    </TableRow>
  );
}

function SectionTitle({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex max-w-[72ch] flex-col gap-1.5">
      <h2 id={id} className="m-0 text-2xl font-medium tracking-tight">{title}</h2>
      {children && <p className="m-0 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

/** "971 k€" → figure + unit. */
function Figure({ value }: { value: string }) {
  const m = value.match(/^(.*?\S)\s*(k€|M€|€)$/);
  return m ? <>{m[1]}<StatUnit>{m[2]}</StatUnit></> : <>{value}</>;
}

function Kpi({ label, value, hint, accent, formula }: { label: string; value: string; hint: string; accent?: boolean; formula: string[] }) {
  return (
    <Stat size="sm" pivot={accent} data-kpi="">
      <Tooltip>
        <TooltipTrigger
          render={<div tabIndex={0} />}
          className="flex cursor-help flex-col gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
        >
          <StatValue className="group-data-[size=sm]/stat:text-[24px] @5xl:group-data-[size=sm]/stat:text-[28px]"><Figure value={value} /></StatValue>
          <StatLabel>{label}</StatLabel>
          <StatSource>{hint}</StatSource>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm flex-col items-start gap-1 px-3 py-2">
          {formula.map((f, i) => <div key={i}>{f}</div>)}
        </TooltipContent>
      </Tooltip>
    </Stat>
  );
}
