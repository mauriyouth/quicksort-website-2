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

export type Hypotheses = {
  /** Consultants staffed at the start of the year (forecast-only years). */
  consDebut: number;
  tjm: number;
  /** Billable working days per month. */
  jours: number;
  /** Occupancy rate of salaried consultants, %. */
  occ: number;
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
  consDebut: 18, tjm: 650, jours: 18, occ: 90, pctFree: 40,
  coutFree: 480, salaire: 5000,
  commFactor: 0, primeIC: 500, primeChasseur: 800,
  fLoyer: 4000, fOutils: 3000, fMarketing: 2500, fHonoraires: 1500, fDeplacements: 2000, fDivers: 1000, fAmort: 0,
  tresoDebut: 250000, dso: 60, tauxIS: 25,
  // Calibrated on the accountant's Jan–Jul 2026 statement (79 employee-months).
  tauxCharges: 30, mutuelle: 150, ticketsResto: 160, medecine: 120,
};

export const HYPOTHESIS_KEYS = Object.keys(DEFAULT_HYPOTHESES) as HypothesisKey[];

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
  fac: number[]; ic: number[]; ch: number[]; varr: number[]; mb: number[]; mbp: number[];
  /** Employer social charges: on consultants (production), on structure (fixed), and by item. */
  cotc: number[]; cots: number[]; cu: number[]; cmu: number[]; ctr: number[]; cme: number[]; cot: number[];
  fs: number[]; fl: number[]; fo: number[]; fm: number[]; fh: number[]; fdp: number[]; fd: number[]; fix: number[];
  eb: number[]; ebp: number[]; da: number[]; ex: number[]; exp: number[]; enc: number[]; treso: number[];
  /** VAT cash effect: collected on collections, paid to suppliers, remitted to the state, net. */
  tvaCol: number[]; tvaDed: number[]; tvaRem: number[]; tva: number[];
  ventes: number[]; departs: number[];
};

export type PlanResult = {
  series: Series;
  actual: boolean[];
  totals: {
    ca: number; mb: number; eb: number; ex: number; is: number; rn: number;
    mbPct: number; ebPct: number; exPct: number;
    consFin: number; ventes: number; departs: number;
    treso: number; tresoMin: number;
  };
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function computePlan(h: Hypotheses, months: MonthInput[]): PlanResult {
  const occ = h.occ / 100;
  const pf = h.pctFree / 100;
  const S: Series = {
    cons: [], ca: [], free: [], sal: [], inter: [], prod: [], fac: [], ic: [], ch: [], varr: [], mb: [], mbp: [],
    cotc: [], cots: [], cu: [], cmu: [], ctr: [], cme: [], cot: [],
    fs: [], fl: [], fo: [], fm: [], fh: [], fdp: [], fd: [], fix: [], eb: [], ebp: [], da: [], ex: [], exp: [], enc: [], treso: [],
    tvaCol: [], tvaDed: [], tvaRem: [], tva: [],
    ventes: [], departs: [],
  };
  let c = h.consDebut;
  for (const m of months) {
    let ca: number, free: number, sal: number, inter: number, ventes: number, departs: number;
    let cc: SocialCharges;
    if (m.actual) {
      ({ ca, free, sal, inter, ventes, departs } = m.actual);
      c = m.actual.cons;
      cc = m.cotConsultants ?? NO_CHARGES;
    } else {
      ventes = m.ventes;
      departs = m.departs;
      c = Math.max(0, c + ventes - departs);
      const nf = c * pf, ns = c * (1 - pf);
      ca = nf * h.jours * h.tjm + ns * h.jours * occ * h.tjm;
      free = nf * h.jours * h.coutFree;
      sal = ns * h.salaire;
      inter = sal * (1 - occ);
      cc = { urssaf: (sal * h.tauxCharges) / 100, mutuelle: ns * h.mutuelle, tickets: ns * h.ticketsResto, medecine: (ns * h.medecine) / 12 };
    }
    const cs = m.cotStructure ?? NO_CHARGES;
    const cotc = chargesTotal(cc), cots = chargesTotal(cs);
    S.cotc.push(cotc); S.cots.push(cots);
    S.cu.push(cc.urssaf + cs.urssaf); S.cmu.push(cc.mutuelle + cs.mutuelle); S.ctr.push(cc.tickets + cs.tickets); S.cme.push(cc.medecine + cs.medecine);
    S.cot.push(cotc + cots);
    const prod = free + sal + cotc;
    const fac = (ca * h.commFactor) / 100, ic = ventes * h.primeIC, ch = ventes * h.primeChasseur;
    const varr = fac + ic + ch;
    const mb = ca - prod - varr;
    const fStructure = m.structure ?? 0;
    const fx = m.actual && m.fixed
      ? m.fixed
      : { loyer: h.fLoyer, outils: h.fOutils, marketing: h.fMarketing, honoraires: h.fHonoraires, deplacements: h.fDeplacements, divers: h.fDivers };
    const fixMonth = fStructure + cots + fx.loyer + fx.outils + fx.marketing + fx.honoraires + fx.deplacements + fx.divers;
    const eb = mb - fixMonth;
    S.cons.push(c); S.ca.push(ca); S.free.push(free); S.sal.push(sal); S.inter.push(inter); S.prod.push(prod);
    S.fac.push(fac); S.ic.push(ic); S.ch.push(ch); S.varr.push(varr); S.mb.push(mb); S.mbp.push(ca ? mb / ca : 0);
    S.fs.push(fStructure); S.fl.push(fx.loyer); S.fo.push(fx.outils); S.fm.push(fx.marketing); S.fh.push(fx.honoraires); S.fdp.push(fx.deplacements); S.fd.push(fx.divers);
    S.fix.push(fixMonth); S.eb.push(eb); S.ebp.push(ca ? eb / ca : 0);
    // Operating result: EBITDA less depreciation (non-cash, so cash is unchanged).
    const ex = eb - h.fAmort;
    S.da.push(h.fAmort); S.ex.push(ex); S.exp.push(ca ? ex / ca : 0);
    S.ventes.push(ventes); S.departs.push(departs);
  }
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
  return {
    series: S,
    actual: months.map((m) => !!m.actual),
    totals: {
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

export type RowKind = "line" | "sub" | "total" | "key" | "pct" | "section";
export type PlanRow = {
  /** Set on rows that open a drill-down panel. */
  key?: "ca" | "sal" | "free" | "fs" | "inter" | "enc" | "tva" | "cotc" | "cots" | FixedLineKey;
  kind: RowKind;
  label: string;
  values: number[];
  total: number | null;
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
    line("line", "Primes IC", S.ic),
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
    sec("Cotisations sociales"),
    line("line", "URSSAF et retraite", S.cu),
    line("line", "Mutuelle", S.cmu),
    line("line", "Tickets restaurant", S.ctr),
    line("line", "Médecine du travail", S.cme),
    line("total", "Total cotisations sociales", S.cot),
    sec("Trésorerie"),
    { ...line("line", "Encaissements clients", S.enc), key: "enc" },
    { ...line("line", "TVA (effet trésorerie)", S.tva), key: "tva" },
    line("total", "Trésorerie fin de mois", S.treso, S.treso[last] ?? 0),
  ];
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
