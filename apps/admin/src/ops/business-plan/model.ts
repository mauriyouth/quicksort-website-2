/**
 * Business plan model — pure, framework-free (unit-tested from
 * tests/business-plan-model.test.mjs).
 *
 * Port of the "Business plan 2027" design mockup's monthly consulting P&L:
 * sales → staffed consultants → revenue → gross margin → EBITDA → cash.
 * Each month is either ACTUAL (closed: figures measured from invoices,
 * staffing, CRA and salaries — see actuals.ts) or FORECAST (projected from
 * the hypotheses, starting from the last known headcount). Structure
 * salaries come from the named structure staff (every month). The five
 * fixed-charge lines of a closed month come from the classified Qonto debits
 * (`MonthInput.fixed`); every other charge, and fixed charges on forecast
 * months, come from the hypotheses: there is no ledger to read them from.
 */

import { workingCalendar, type WorkingCalendar } from "./calendar.ts";

export type Hypotheses = {
  tjm: number;
  /** TACI of salaried consultants: billed days / working days (leave included), yearly %. */
  taci: number;
  /** Paid leave per salaried employee, days per year. */
  congesAn: number;
  /** RTT per salaried employee, days per year. */
  rttAn: number;
  /** Share of freelancers among staffed consultants, %. */
  pctFree: number;
  /** Freelance daily buy rate, €. */
  coutFree: number;
  /** Gross monthly salary of a salaried consultant, € (employer charges come from the social-charge hypotheses). */
  salaire: number;
  /** Factoring commission on revenue, %. */
  commFactor: number;
  primeIC: number;
  primeChasseur: number;
  fLoyer: number;
  fOutils: number;
  fMarketing: number;
  fHonoraires: number;
  /** Travel: trains, flights, hotels, taxis, fuel, tolls, parking. */
  fDeplacements: number;
  fDivers: number;
  /** Monthly depreciation, amortisation and provisions (non-cash), €. */
  fAmort: number;
  tresoDebut: number;
  /** Client payment delay, days. */
  dso: number;
  /** Corporate tax rate, %. */
  tauxIS: number;
  /** Employer URSSAF + pension contributions, % of gross salary. */
  tauxCharges: number;
  /** Employer health insurance (mutuelle), € per salaried employee per month. */
  mutuelle: number;
  /** Employer share of meal vouchers, € per salaried employee per month. */
  ticketsResto: number;
  /** Occupational health service, € per salaried employee per year. */
  medecine: number;
};

export type HypothesisKey = keyof Hypotheses;

/** The mockup's indicative starting values. */
export const DEFAULT_HYPOTHESES: Hypotheses = {
  tjm: 650, taci: 75, congesAn: 25, rttAn: 10, pctFree: 40,
  coutFree: 480, salaire: 5000,
  commFactor: 0, primeIC: 500, primeChasseur: 800,
  fLoyer: 4000, fOutils: 3000, fMarketing: 2500, fHonoraires: 1500, fDeplacements: 2000, fDivers: 1000, fAmort: 0,
  tresoDebut: 250000, dso: 60, tauxIS: 25,
  // Calibrated on the accountant's Jan–Jul 2026 statement (79 employee-months).
  tauxCharges: 30, mutuelle: 150, ticketsResto: 160, medecine: 120,
};

export const HYPOTHESIS_KEYS = Object.keys(DEFAULT_HYPOTHESES) as HypothesisKey[];

/** Known hypotheses of a saved plan; plans saved before the TACI carry their occupancy rate (`occ`) over. */
export function migrateHypotheses(saved: Record<string, unknown> | null | undefined): Partial<Hypotheses> {
  const out: Partial<Hypotheses> = {};
  if (!saved) return out;
  for (const k of HYPOTHESIS_KEYS) if (saved[k] != null) out[k] = saved[k] as number;
  if (out.taci == null && saved.occ != null) out.taci = saved.occ as number;
  return out;
}

/** Measured figures for a closed month. */
export type ActualMonth = {
  /** Consultants staffed during the month. */
  cons: number;
  /** Revenue invoiced for the month, € HT. */
  ca: number;
  /** Freelance cost (CRA days × buy rate). */
  free: number;
  /** Loaded cost of salaried consultants. */
  sal: number;
  /** Part of `sal` paid for unstaffed (inter-contract) consultants. */
  inter: number;
  /** New missions started. */
  ventes: number;
  departs: number;
  /** Cash collected (invoices paid during the month), € HT. */
  enc: number;
  /** Working days of salaried consultants (holidays excluded, prorated on their consultant share). */
  jo?: number;
  /** Days billed by salaried consultants (CRA client days). */
  jfs?: number;
  /** Days billed, salaried and freelance. */
  jf?: number;
  /** Leave days of salaried consultants (paid leave, RTT, unpaid leave). */
  abs?: number;
  /** Every salaried consultant filled the CRA for all their working days. */
  craComplete?: boolean;
};

export type MonthInput = {
  actual: ActualMonth | null;
  /** Forecast months only: sales / departures entered or seeded. */
  ventes: number;
  departs: number;
  /** Loaded structure salaries for the month (measured or projected from the named staff). */
  structure?: number;
  /** Closed months only: real fixed charges per line (€ HT, from Qonto). */
  fixed?: FixedActuals;
  /** Closed months covered by Qonto: real VAT cash flows (€). Otherwise estimated. */
  vat?: VatActual;
  /** Closed months: employer charges on salaried consultants (forecast months are computed). */
  cotConsultants?: SocialCharges;
  /** Employer charges on structure staff (measured or projected, every month). */
  cotStructure?: SocialCharges;
};

export type Series = {
  cons: number[]; ca: number[]; free: number[]; sal: number[]; inter: number[]; prod: number[];
  fac: number[]; pic: number[]; ch: number[]; varr: number[]; mb: number[]; mbp: number[];
  /** Employer social charges: on consultants (production), on structure (fixed), and by item. */
  cotc: number[]; cots: number[]; cu: number[]; cmu: number[]; ctr: number[]; cme: number[]; cot: number[];
  fs: number[]; fl: number[]; fo: number[]; fm: number[]; fh: number[]; fdp: number[]; fd: number[]; fix: number[];
  eb: number[]; ebp: number[]; da: number[]; ex: number[]; exp: number[]; enc: number[]; treso: number[];
  /** VAT cash effect: collected on collections, paid to suppliers, remitted to the state, net. */
  tvaCol: number[]; tvaDed: number[]; tvaRem: number[]; tva: number[];
  ventes: number[]; departs: number[];
  /** Days: salaried working, salaried billed, billed (all), salaried leave. */
  jo: number[]; jfs: number[]; jf: number[]; abs: number[];
  /** ESN indicators: TACI, TACE, inter-contract rate, realised daily rate, CJM, margin per billed day, structure rate, revenue per consultant. */
  taci: number[]; tace: number[]; itc: number[]; tjmR: number[]; cjm: number[]; mj: number[]; ts: number[]; cac: number[];
};

export type PlanResult = {
  series: Series;
  actual: boolean[];
  /** Working-day calendar of the year (forecast drivers). */
  calendar: WorkingCalendar;
  /** Closed months whose CRA is incomplete: their indicators are partial. */
  craIncomplete: boolean[];
  totals: {
    taci: number; tace: number; itc: number; cjm: number; tjmR: number; mj: number; ts: number; cac: number;
    ca: number; mb: number; eb: number; ex: number; is: number; rn: number;
    mbPct: number; ebPct: number; exPct: number;
    consFin: number; ventes: number; departs: number;
    treso: number; tresoMin: number;
  };
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
/** a / b, 0 when b is not positive (empty month, no revenue). */
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/**
 * `consStart`: consultants at the end of the previous year, the base of a
 * year with no closed month (ignored once a month is closed).
 */
export function computePlan(h: Hypotheses, months: MonthInput[], consStart: number, year: number): PlanResult {
  const cal = workingCalendar(year, h);
  const pf = h.pctFree / 100;
  const S: Series = {
    jo: [], jfs: [], jf: [], abs: [], taci: [], tace: [], itc: [], tjmR: [], cjm: [], mj: [], ts: [], cac: [],
    cons: [], ca: [], free: [], sal: [], inter: [], prod: [], fac: [], pic: [], ch: [], varr: [], mb: [], mbp: [],
    cotc: [], cots: [], cu: [], cmu: [], ctr: [], cme: [], cot: [],
    fs: [], fl: [], fo: [], fm: [], fh: [], fdp: [], fd: [], fix: [], eb: [], ebp: [], da: [], ex: [], exp: [], enc: [], treso: [],
    tvaCol: [], tvaDed: [], tvaRem: [], tva: [],
    ventes: [], departs: [],
  };
  let c = consStart;
  months.forEach((m, i) => {
    let ca: number, free: number, sal: number, inter: number, ventes: number, departs: number;
    let jo: number, jfs: number, jf: number, abs: number;
    let cc: SocialCharges;
    if (m.actual) {
      ({ ca, free, sal, inter, ventes, departs } = m.actual);
      ({ jo = 0, jfs = 0, jf = 0, abs = 0 } = m.actual);
      c = m.actual.cons;
      cc = m.cotConsultants ?? NO_CHARGES;
    } else {
      ventes = m.ventes;
      departs = m.departs;
      c = Math.max(0, c + ventes - departs);
      const nf = c * pf, ns = c * (1 - pf);
      const d = cal.jo[i] ?? 0, t = cal.taci[i] ?? 0;
      ca = nf * d * h.tjm + ns * d * t * h.tjm;
      free = nf * d * h.coutFree;
      sal = ns * h.salaire;
      jo = ns * d; jfs = jo * t; jf = jfs + nf * d; abs = ns * (cal.abs[i] ?? 0);
      inter = sal * (d ? Math.max(0, 1 - t - (cal.abs[i] ?? 0) / d) : 0);
      cc = { urssaf: (sal * h.tauxCharges) / 100, mutuelle: ns * h.mutuelle, tickets: ns * h.ticketsResto, medecine: (ns * h.medecine) / 12 };
    }
    const cs = m.cotStructure ?? NO_CHARGES;
    const cotc = chargesTotal(cc), cots = chargesTotal(cs);
    S.cotc.push(cotc); S.cots.push(cots);
    S.cu.push(cc.urssaf + cs.urssaf); S.cmu.push(cc.mutuelle + cs.mutuelle); S.ctr.push(cc.tickets + cs.tickets); S.cme.push(cc.medecine + cs.medecine);
    S.cot.push(cotc + cots);
    const prod = free + sal + cotc;
    const fac = (ca * h.commFactor) / 100, pic = ventes * h.primeIC, ch = ventes * h.primeChasseur;
    const varr = fac + pic + ch;
    const mb = ca - prod - varr;
    const fStructure = m.structure ?? 0;
    const fx = m.actual && m.fixed
      ? m.fixed
      : { loyer: h.fLoyer, outils: h.fOutils, marketing: h.fMarketing, honoraires: h.fHonoraires, deplacements: h.fDeplacements, divers: h.fDivers };
    const fixMonth = fStructure + cots + fx.loyer + fx.outils + fx.marketing + fx.honoraires + fx.deplacements + fx.divers;
    const eb = mb - fixMonth;
    S.cons.push(c); S.ca.push(ca); S.free.push(free); S.sal.push(sal); S.inter.push(inter); S.prod.push(prod);
    S.fac.push(fac); S.pic.push(pic); S.ch.push(ch); S.varr.push(varr); S.mb.push(mb); S.mbp.push(ca ? mb / ca : 0);
    S.fs.push(fStructure); S.fl.push(fx.loyer); S.fo.push(fx.outils); S.fm.push(fx.marketing); S.fh.push(fx.honoraires); S.fdp.push(fx.deplacements); S.fd.push(fx.divers);
    S.fix.push(fixMonth); S.eb.push(eb); S.ebp.push(ca ? eb / ca : 0);
    // Operating result: EBITDA less depreciation (non-cash, so cash is unchanged).
    const ex = eb - h.fAmort;
    S.da.push(h.fAmort); S.ex.push(ex); S.exp.push(ca ? ex / ca : 0);
    S.ventes.push(ventes); S.departs.push(departs);
    S.jo.push(jo); S.jfs.push(jfs); S.jf.push(jf); S.abs.push(abs);
    S.taci.push(ratio(jfs, jo)); S.tace.push(ratio(jfs, jo - abs)); S.itc.push(ratio(Math.max(0, jo - jfs - abs), jo));
    S.tjmR.push(ratio(ca, jf)); S.cjm.push(ratio(sal + cotc, jo)); S.mj.push(ratio(ca - prod, jf));
    S.ts.push(ratio(fixMonth, ca)); S.cac.push(ratio(ca, c));
  });
  // Cash: closed months use what was really collected; forecast months
  // collect revenue `lag` months later (the first months fall back to the
  // year's first revenue, as in the mockup).
  const lag = Math.max(0, Math.round(h.dso / 30));
  let cash = h.tresoDebut;
  months.forEach((m, i) => {
    const enc = m.actual ? m.actual.enc : i - lag >= 0 ? S.ca[i - lag] : S.ca[0] ?? 0;
    // VAT: real flows when known, else VAT_RATE on collections and on
    // VAT-bearing purchases (freelances + fixed charges other than salaries),
    // the net being remitted the following month (never a negative remittance).
    let col: number, ded: number, rem: number;
    if (m.actual && m.vat) ({ collected: col, deductible: ded, remitted: rem } = m.vat);
    else {
      col = VAT_RATE * enc;
      ded = VAT_RATE * (S.free[i] + S.fl[i] + S.fo[i] + S.fm[i] + S.fh[i] + S.fdp[i] + S.fd[i]);
      rem = Math.max(0, i > 0 ? S.tvaCol[i - 1] - S.tvaDed[i - 1] : col - ded);
    }
    const tva = col - ded - rem;
    S.tvaCol.push(col); S.tvaDed.push(ded); S.tvaRem.push(rem); S.tva.push(tva);
    cash = cash + enc - S.prod[i] - S.varr[i] - S.fix[i] + tva;
    S.enc.push(enc);
    S.treso.push(cash);
  });

  const ca = sum(S.ca), mb = sum(S.mb), eb = sum(S.eb), ex = sum(S.ex);
  // Simplified tax on the positive yearly operating result (no financial items modelled).
  const is = (Math.max(0, ex) * h.tauxIS) / 100;
  const last = months.length - 1;
  const JO = sum(S.jo), JFS = sum(S.jfs), JF = sum(S.jf), ABS = sum(S.abs);
  return {
    series: S,
    actual: months.map((m) => !!m.actual),
    calendar: cal,
    craIncomplete: months.map((m) => !!m.actual && m.actual.craComplete === false),
    totals: {
      taci: ratio(JFS, JO), tace: ratio(JFS, JO - ABS), itc: ratio(Math.max(0, JO - JFS - ABS), JO),
      cjm: ratio(sum(S.sal) + sum(S.cotc), JO),
      tjmR: ratio(ca, JF), mj: ratio(ca - sum(S.prod), JF), ts: ratio(sum(S.fix), ca), cac: ratio(ca, sum(S.cons) / (S.cons.length || 1)),
      ca, mb, eb, ex, is, rn: ex - is,
      mbPct: ca ? mb / ca : 0,
      ebPct: ca ? eb / ca : 0,
      exPct: ca ? ex / ca : 0,
      consFin: last >= 0 ? S.cons[last] : 0,
      ventes: sum(S.ventes),
      departs: sum(S.departs),
      treso: last >= 0 ? S.treso[last] : h.tresoDebut,
      tresoMin: S.treso.length ? Math.min(...S.treso) : h.tresoDebut,
    },
  };
}

export type FixedLineKey = "loyer" | "outils" | "marketing" | "honoraires" | "deplacements" | "divers";
export type FixedChargeLine = FixedLineKey | "hors_charges_fixes";
/** Real fixed charges of a month per line, € HT. */
export type FixedActuals = Record<FixedLineKey, number>;

/** Employer social charges for a month, € by item. */
export type SocialCharges = { urssaf: number; mutuelle: number; tickets: number; medecine: number };
export const NO_CHARGES: SocialCharges = { urssaf: 0, mutuelle: 0, tickets: 0, medecine: 0 };
export const chargesTotal = (c: SocialCharges) => c.urssaf + c.mutuelle + c.tickets + c.medecine;

/** Standard French VAT rate, used to estimate VAT on forecast months. */
export const VAT_RATE = 0.2;
/** Real VAT cash flows of a closed month, € (all positive amounts). */
export type VatActual = { collected: number; deductible: number; remitted: number };

/** P&L rows of the "Cotisations sociales" section, one per item. */
export type ChargeRowKey = "cu" | "cmu" | "ctr" | "cme";

export type RowKind = "line" | "sub" | "total" | "key" | "pct" | "section";
export type PlanRow = {
  /** Set on rows that open a drill-down panel. */
  key?: "ca" | "sal" | "free" | "fs" | "inter" | "enc" | "tva" | "cotc" | "cots" | ChargeRowKey | FixedLineKey;
  kind: RowKind;
  label: string;
  values: number[];
  total: number | null;
  /** ESN indicator row: partial on closed months whose CRA is incomplete. */
  indicator?: boolean;
};

/** The P&L grid rows, same labels and order as the mockup. */
export function planRows(r: PlanResult): PlanRow[] {
  const S = r.series, T = r.totals;
  const last = S.cons.length - 1;
  const line = (kind: RowKind, label: string, values: number[], total?: number): PlanRow =>
    ({ kind, label, values, total: total === undefined ? sum(values) : total });
  const sec = (label: string): PlanRow => ({ kind: "section", label, values: [], total: null });
  return [
    line("line", "Nb de consultants staffés", S.cons, S.cons[last] ?? 0),
    sec("Revenus"),
    { ...line("key", "Chiffre d’affaires", S.ca), key: "ca" },
    sec("Coûts de production"),
    { ...line("line", "Freelances", S.free), key: "free" },
    { ...line("line", "Salaires consultants (brut)", S.sal), key: "sal" },
    { ...line("sub", "— dont inter-contrats", S.inter), key: "inter" },
    { ...line("line", "Cotisations sociales consultants", S.cotc), key: "cotc" },
    line("total", "Total coûts de production", S.prod),
    sec("Charges variables"),
    line("line", "Commission factor", S.fac),
    line("line", "Primes IC", S.pic),
    line("line", "Primes chasseurs", S.ch),
    line("total", "Total charges variables", S.varr),
    line("key", "Gross margin (marge brute)", S.mb),
    line("pct", "Taux de marge brute", S.mbp, T.mbPct),
    sec("Charges fixes"),
    { ...line("line", "Salaires structure (brut)", S.fs), key: "fs" },
    { ...line("line", "Cotisations sociales structure", S.cots), key: "cots" },
    { ...line("line", "Loyer et locaux", S.fl), key: "loyer" },
    { ...line("line", "Outils, cloud et licences IA", S.fo), key: "outils" },
    { ...line("line", "Marketing et événements", S.fm), key: "marketing" },
    { ...line("line", "Honoraires (comptable, juridique)", S.fh), key: "honoraires" },
    { ...line("line", "Frais de déplacement", S.fdp), key: "deplacements" },
    { ...line("line", "Divers", S.fd), key: "divers" },
    line("total", "Total charges fixes", S.fix),
    line("key", "EBITDA (EBE)", S.eb),
    line("pct", "Taux d’EBITDA (EBE / CA)", S.ebp, T.ebPct),
    line("line", "Dotations aux amortissements et provisions", S.da),
    line("key", "EBIT (résultat d’exploitation)", S.ex),
    line("pct", "Marge d’exploitation (EBIT / CA)", S.exp, T.exPct),
    sec("Indicateurs ESN"),
    { ...line("pct", "TACI (taux d’activité congés inclus)", S.taci, T.taci), indicator: true },
    { ...line("pct", "TACE (taux d’activité congés exclus)", S.tace, T.tace), indicator: true },
    { ...line("pct", "Taux d’intercontrat", S.itc, T.itc), indicator: true },
    { ...line("line", "TJM moyen réalisé", S.tjmR, T.tjmR), indicator: true },
    { ...line("line", "CJM (coût journalier moyen)", S.cjm, T.cjm), indicator: true },
    { ...line("line", "Marge par jour facturé", S.mj, T.mj), indicator: true },
    { ...line("pct", "Taux de structure", S.ts, T.ts), indicator: true },
    { ...line("line", "CA par consultant", S.cac, T.cac), indicator: true },
    sec("Cotisations sociales"),
    { ...line("line", "URSSAF et retraite", S.cu), key: "cu" },
    { ...line("line", "Mutuelle", S.cmu), key: "cmu" },
    { ...line("line", "Tickets restaurant", S.ctr), key: "ctr" },
    { ...line("line", "Médecine du travail", S.cme), key: "cme" },
    line("total", "Total cotisations sociales", S.cot),
    sec("Trésorerie"),
    { ...line("line", "Encaissements clients", S.enc), key: "enc" },
    { ...line("line", "TVA (effet trésorerie)", S.tva), key: "tva" },
    line("total", "Trésorerie fin de mois", S.treso, S.treso[last] ?? 0),
  ];
}

/** Mention for yearly figures built on closed months whose CRA is incomplete ("" when none). */
export function craIncompleteNote(r: PlanResult): string {
  const n = r.craIncomplete.filter(Boolean).length;
  return n ? `CRA incomplet sur ${n} mois` : "";
}

/* ── Formatting (fr-FR, ported from the mockup) ─────────────────────── */

const minus = (s: string) => s.replace("-", "−");

/** Whole euros, no unit: "12 345". */
export function fmt(v: number): string {
  return minus(Math.round(v).toLocaleString("fr-FR"));
}

/** Compact euros: "123 k€" or "1,23 M€". */
export function kEur(v: number): string {
  return Math.abs(v) >= 1e6
    ? minus((v / 1e6).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " M€"
    : minus(Math.round(v / 1000).toLocaleString("fr-FR")) + " k€";
}

/** Ratio as a percentage: 0.123 → "12,3 %". */
export function pct(v: number): string {
  return (Number.isFinite(v) ? (v * 100).toFixed(1).replace(".", ",") : "0,0") + " %";
}

export const MONTH_NAMES = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Parse a stored / typed value ("12,5", 12.5, null) to a number. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const v = parseFloat(String(value ?? "").replace(",", "."));
  return Number.isNaN(v) ? fallback : v;
}

/** Index of the first open (non-closed) month of `year` relative to `today`:
 *  0 for future years, 12 for past years, the current month otherwise. */
export function firstOpenMonth(year: number, today: Date): number {
  const y = today.getFullYear();
  if (year > y) return 0;
  if (year < y) return 12;
  return today.getMonth();
}
