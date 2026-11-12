/**
 * Business plan → Excel (.xlsx). Pure and framework-free (unit-tested from
 * tests/business-plan-model.test.mjs): builds a minimal SpreadsheetML
 * package zipped with fflate, so there is no spreadsheet dependency.
 *
 * Sheets: a yearly summary, the monthly P&L grid as shown on screen (values, not formulas:
 * the model mixes measured and projected months), and the
 * hypotheses the forecast months were computed from.
 */
import { strToU8, zipSync } from "fflate";
import { MONTH_NAMES, planRows, type Hypotheses, type HypothesisKey, type PlanResult, type RowKind } from "./model.ts";

export type ExportField = { key: HypothesisKey; label: string; unit: string };
export type ExportGroup = { title: string; fields: ExportField[] };

/* ── Styles ─────────────────────────────────────────────────────────────
 * Quicksort palette: ink header band, paper section rows, stone secondary
 * text, hairline rules instead of gridlines, and lime on one cell only (the
 * net result in the summary). Styles are declared as descriptors and
 * deduplicated into fonts / fills / borders / cellXfs when the workbook is
 * written, so there are no hand-maintained style indexes. */

const C = {
  ink: "FF141414", paper: "FFF3F0E8", card: "FFFAF8F3", stone: "FF55504A",
  line: "FFE4E1DB", line2: "FFB8B4AD", lime: "FFCCFF00",
} as const;

/* Single-section formats on purpose: a custom negative section ("-#,##0")
 * is shown with a doubled sign ("--1 382") by Apple Numbers. */
const FMT = { int: "#,##0", dec: "#,##0.0", pct: "0.0%" } as const;

type Sty = {
  b?: boolean; i?: boolean; color?: string; sz?: number; fill?: string;
  top?: string; bottom?: string; left?: string; right?: string;
  fmt?: string; h?: "left" | "center" | "right"; indent?: number;
};

const STYLES: Sty[] = [{}];
const styleIds = new Map<string, number>([["{}", 0]]);
/** Style id of a descriptor, registering it on first use. */
function sty(d: Sty): number {
  const k = JSON.stringify(d, Object.keys(d).sort());
  let id = styleIds.get(k);
  if (id === undefined) {
    id = STYLES.length;
    STYLES.push(d);
    styleIds.set(k, id);
  }
  return id;
}

function stylesXml(): string {
  const fonts: string[] = [], fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"], fmts: string[] = [];
  const idx = (list: string[], xml: string) => {
    const i = list.indexOf(xml);
    return i >= 0 ? i : list.push(xml) - 1;
  };
  const edge = (tag: string, c?: string) => (c ? `<${tag} style="thin"><color rgb="${c}"/></${tag}>` : `<${tag}/>`);
  const xfs = STYLES.map((d) => {
    const fontId = idx(fonts, `<font>${d.b ? "<b/>" : ""}${d.i ? "<i/>" : ""}<sz val="${d.sz ?? 10}"/><color rgb="${d.color ?? C.ink}"/><name val="Arial"/><family val="2"/></font>`);
    const fillId = d.fill ? idx(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${d.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const borderId = d.top || d.bottom || d.left || d.right
      ? idx(borders, `<border>${edge("left", d.left)}${edge("right", d.right)}${edge("top", d.top)}${edge("bottom", d.bottom)}<diagonal/></border>`)
      : 0;
    const numFmtId = d.fmt ? 164 + idx(fmts, d.fmt) : 0;
    const align = `<alignment vertical="center"${d.h ? ` horizontal="${d.h}"` : ""}${d.indent ? ` indent="${d.indent}"` : ""}/>`;
    return `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${fmts.length}">${fmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>
<fonts count="${fonts.length}">${fonts.join("")}</fonts>
<fills count="${fills.length}">${fills.join("")}</fills>
<borders count="${borders.length}">${borders.join("")}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

type Kind = Exclude<RowKind, "section">;

/** Header band: ink ground, paper text. */
const HEAD = {
  label: sty({ b: true, color: C.card, fill: C.ink, h: "left", indent: 1 }),
  col: sty({ b: true, color: C.card, fill: C.ink, h: "right" }),
  total: sty({ b: true, color: C.card, fill: C.ink, h: "right", left: C.stone }),
};
/** Second header row on the P&L: whether each month is measured or projected. */
const STATUS = {
  blank: sty({ fill: C.card, bottom: C.line2 }),
  actual: sty({ b: true, sz: 8, fill: C.line, h: "right", bottom: C.line2 }),
  forecast: sty({ i: true, sz: 8, color: C.stone, fill: C.card, h: "right", bottom: C.line2 }),
  total: sty({ fill: C.card, bottom: C.line2, left: C.line2 }),
};
const SECTION = sty({ b: true, sz: 9, color: C.stone, fill: C.paper, top: C.line2, bottom: C.line2, indent: 1 });
const SECTION_TOTAL = sty({ fill: C.paper, top: C.line2, bottom: C.line2, left: C.line2 });
const NOTE = sty({ i: true, sz: 9, color: C.stone });

function kindSty(kind: Kind): Sty {
  switch (kind) {
    case "key": return { b: true, fill: C.paper, top: C.stone, bottom: C.line };
    case "total": return { b: true, top: C.line2, bottom: C.line };
    case "pct":
    case "sub": return { i: true, color: C.stone, bottom: C.line };
    default: return { bottom: C.line };
  }
}
/** A row label. */
const labelSty = (kind: Kind) => sty({ ...kindSty(kind), h: "left", indent: kind === "sub" ? 3 : 1 });
/** A figure; `tot` for the right-hand total column, `pivot` for the one lime cell. */
function numSty(kind: Kind, fmt: string, tot = false, pivot = false): number {
  const k = kindSty(kind);
  if (pivot) return sty({ ...k, b: true, fmt, h: "right", fill: C.lime, top: C.ink, bottom: C.ink, left: C.ink, right: C.ink });
  if (!tot) return sty({ ...k, fmt, h: "right" });
  return sty({ ...k, b: k.b || kind !== "pct" && kind !== "sub", fmt, h: "right", fill: k.fill ?? C.card, left: C.line2 });
}

type Cell = { v: string | number | null; s?: number };
type Sheet = {
  name: string; rows: Cell[][]; widths: number[]; freeze?: { cols: number; rows: number };
  /** Row heights in points, by row index (unset rows keep the default). */
  heights?: number[]; tab?: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i: number): string {
  let n = i + 1, s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(sh: Sheet): string {
  const pr = `<sheetPr>${sh.tab ? `<tabColor rgb="${sh.tab}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>`;
  const pane = sh.freeze
    ? `<pane xSplit="${sh.freeze.cols}" ySplit="${sh.freeze.rows}" topLeftCell="${colName(sh.freeze.cols)}${sh.freeze.rows + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/>`
    : "";
  const views = `<sheetViews><sheetView showGridLines="0" zoomScale="110" zoomScaleNormal="110" workbookViewId="0">${pane}</sheetView></sheetViews>`;
  const fmt = `<sheetFormatPr defaultRowHeight="18" customHeight="1"/>`;
  const cols = `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const rows = sh.rows
    .map((row, r) => {
      const cells = row
        .map((c, ci) => {
          const ref = `${colName(ci)}${r + 1}`;
          const s = c.s ? ` s="${c.s}"` : "";
          if (c.v === null || c.v === "") return c.s ? `<c r="${ref}"${s}/>` : "";
          if (typeof c.v === "number")
            return Number.isFinite(c.v) ? `<c r="${ref}"${s}><v>${c.v}</v></c>` : `<c r="${ref}"${s}/>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        })
        .join("");
      const ht = sh.heights?.[r] ?? 18;
      return `<row r="${r + 1}" ht="${ht}" customHeight="1">${cells}</row>`;
    })
    .join("");
  const page = `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pr}${views}${fmt}${cols}<sheetData>${rows}</sheetData>${page}</worksheet>`;
}

/** Zip sheets into an .xlsx package. */
export function buildWorkbook(sheets: Sheet[]): Uint8Array {
  const ct = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${ct}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ct}"><sheets>${sheets
      .map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ct}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}<Relationship Id="rId${sheets.length + 1}" Type="${ct}/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(stylesXml()),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files);
}

/** One year of the export: its computed plan and the hypotheses behind it. */
export type ExportYear = { year: number; plan: PlanResult; h: Hypotheses };

/** The monthly P&L grid of one year, as on screen. */
function gridSheet({ year, plan }: ExportYear): Sheet {
  const months = plan.series.cons.length;
  const header: Cell[] = [{ v: `Business plan ${year} · € HT`, s: HEAD.label }];
  const status: Cell[] = [{ v: "", s: STATUS.blank }];
  for (let m = 0; m < months; m++) {
    header.push({ v: `${MONTH_NAMES[m]} ${year}`, s: HEAD.col });
    status.push(plan.actual[m] ? { v: "Réel", s: STATUS.actual } : { v: "Prévisionnel", s: STATUS.forecast });
  }
  header.push({ v: `Total ${year}`, s: HEAD.total });
  status.push({ v: "", s: STATUS.total });

  const rows: Cell[][] = [header, status];
  const heights = [26, 16];
  for (const r of planRows(plan)) {
    if (r.kind === "section") {
      rows.push([
        { v: r.label, s: SECTION },
        ...Array.from({ length: months }, () => ({ v: null, s: SECTION })),
        { v: null, s: SECTION_TOTAL },
      ]);
      heights[rows.length - 1] = 22;
      continue;
    }
    const kind = r.kind;
    const fmt = kind === "pct" ? FMT.pct : r.values === plan.series.cons ? FMT.dec : FMT.int;
    const label = r.kind === "sub" ? r.label.replace(/^—\s*/, "") : r.label;
    if (r.kind === "key") heights[rows.length] = 20;
    rows.push([
      { v: label, s: labelSty(kind) },
      ...r.values.map((v) => ({ v, s: numSty(kind, fmt) })),
      { v: r.total, s: numSty(kind, fmt, true) },
    ]);
  }
  return {
    name: `Business plan ${year}`, rows, heights, tab: C.stone,
    widths: [42, ...Array(months).fill(12.5), 14], freeze: { cols: 1, rows: 2 },
  };
}

const ratio = (a: number, b: number) => (b ? a / b : 0);
const total = (ys: ExportYear[], f: (y: ExportYear) => number) => ys.reduce((a, y) => a + f(y), 0);
const frDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

/** Yearly figures side by side, with a cumulative column when there are several years. */
function summarySheet(ys: ExportYear[], exportedAt: Date): Sheet {
  const multi = ys.length > 1;
  const span = `${ys[0].year}–${ys[ys.length - 1].year}`;
  type Line = { label: string; kind: Kind; fmt: string; get: (y: ExportYear) => number; all: () => number; pivot?: boolean };
  const T = (y: ExportYear) => y.plan.totals;
  const flow = (label: string, get: (y: ExportYear) => number, kind: Kind = "line"): Line =>
    ({ label, kind, fmt: FMT.int, get, all: () => total(ys, get) });
  const rate = (label: string, get: (y: ExportYear) => number, num: (y: ExportYear) => number): Line =>
    ({ label, kind: "pct", fmt: FMT.pct, get, all: () => ratio(total(ys, num), total(ys, (y) => T(y).ca)) });
  const last = ys[ys.length - 1];
  const actualMonths = (y: ExportYear) => y.plan.actual.filter(Boolean).length;
  const blocks: { title: string; lines: Line[] }[] = [
    {
      title: "Compte de résultat",
      lines: [
        flow("Chiffre d’affaires", (y) => T(y).ca, "key"),
        flow("Marge brute", (y) => T(y).mb),
        rate("Taux de marge brute", (y) => T(y).mbPct, (y) => T(y).mb),
        flow("EBITDA (EBE)", (y) => T(y).eb, "key"),
        rate("Taux d’EBITDA", (y) => T(y).ebPct, (y) => T(y).eb),
        flow("EBIT (résultat d’exploitation)", (y) => T(y).ex),
        rate("Marge d’exploitation", (y) => T(y).exPct, (y) => T(y).ex),
        flow("Impôt sur les sociétés", (y) => T(y).is),
        { ...flow("Résultat net", (y) => T(y).rn, "key"), pivot: true },
      ],
    },
    {
      title: "Activité",
      lines: [
        { label: "Consultants staffés en fin d’année", kind: "line", fmt: FMT.dec, get: (y) => T(y).consFin, all: () => T(last).consFin },
        { label: "Ventes (nouvelles missions)", kind: "line", fmt: FMT.dec, get: (y) => T(y).ventes, all: () => total(ys, (y) => T(y).ventes) },
        { label: "Départs", kind: "line", fmt: FMT.dec, get: (y) => T(y).departs, all: () => total(ys, (y) => T(y).departs) },
      ],
    },
    {
      title: "Trésorerie",
      lines: [
        { label: "Trésorerie fin d’année", kind: "key", fmt: FMT.int, get: (y) => T(y).treso, all: () => T(last).treso },
        { label: "Trésorerie minimale", kind: "line", fmt: FMT.int, get: (y) => T(y).tresoMin, all: () => Math.min(...ys.map((y) => T(y).tresoMin)) },
      ],
    },
    {
      title: "Données",
      lines: [{ label: "Mois réels", kind: "line", fmt: "0", get: actualMonths, all: () => total(ys, actualMonths) }],
    },
  ];
  const width = ys.length + (multi ? 1 : 0);
  const rows: Cell[][] = [[
    { v: `Synthèse ${multi ? span : ys[0].year} · € HT`, s: HEAD.label },
    ...ys.map((y) => ({ v: String(y.year), s: multi ? HEAD.col : HEAD.total })),
    ...(multi ? [{ v: `Total ${span}`, s: HEAD.total }] : []),
  ]];
  const heights = [26];
  for (const b of blocks) {
    rows.push([
      { v: b.title, s: SECTION },
      ...Array.from({ length: width }, (_, i) => ({ v: null, s: i === width - 1 ? SECTION_TOTAL : SECTION })),
    ]);
    heights[rows.length - 1] = 22;
    for (const l of b.lines) {
      if (l.kind === "key") heights[rows.length] = 20;
      // The last column (cumulative, or the only year) carries the total styling and the lime pivot.
      rows.push([
        { v: l.label, s: labelSty(l.kind) },
        ...ys.map((y, i) => {
          const isLast = !multi && i === ys.length - 1;
          return { v: l.get(y), s: numSty(l.kind, l.fmt, isLast, isLast && l.pivot) };
        }),
        ...(multi ? [{ v: l.all(), s: numSty(l.kind, l.fmt, true, l.pivot) }] : []),
      ]);
    }
  }
  rows.push([{ v: "" }], [{
    v: `Exporté le ${frDate(exportedAt)}. Mois réels : données mesurées (facturation, banque) ; autres mois : prévisionnel calculé à partir des hypothèses.`,
    s: NOTE,
  }]);
  return {
    name: "Synthèse", rows, heights, tab: C.ink,
    widths: [40, ...ys.map(() => 16), ...(multi ? [18] : [])], freeze: { cols: 1, rows: 1 },
  };
}

const HYP = {
  value: sty({ bottom: C.line, h: "right", fmt: "#,##0.##" }),
  unit: sty({ color: C.stone, bottom: C.line, h: "left", indent: 1 }),
  headUnit: sty({ b: true, color: C.card, fill: C.ink, h: "left", indent: 1 }),
};

/** Hypotheses, one value column per year. */
function hypothesesSheet(ys: ExportYear[], groups: ExportGroup[]): Sheet {
  const pad = ys.length + 1;
  const rows: Cell[][] = [[
    { v: "Hypothèse", s: HEAD.label },
    ...ys.map((y) => ({ v: ys.length > 1 ? String(y.year) : "Valeur", s: HEAD.col })),
    { v: "Unité", s: HYP.headUnit },
  ]];
  const heights = [26];
  for (const g of groups) {
    rows.push([{ v: g.title, s: SECTION }, ...Array.from({ length: pad }, () => ({ v: null, s: SECTION }))]);
    heights[rows.length - 1] = 22;
    for (const f of g.fields)
      rows.push([{ v: f.label, s: labelSty("line") }, ...ys.map((y) => ({ v: y.h[f.key], s: HYP.value })), { v: f.unit, s: HYP.unit }]);
  }
  rows.push([{ v: "" }], [{ v: "S’appliquent aux mois prévisionnels ; les mois réels viennent des données mesurées.", s: NOTE }]);
  return { name: "Hypothèses", rows, heights, tab: C.line2, widths: [46, ...ys.map(() => 14), 12], freeze: { cols: 1, rows: 1 } };
}

/** The business plan of one or several consecutive years as an .xlsx file. */
export function businessPlanXlsx(years: ExportYear[], groups: ExportGroup[], exportedAt = new Date()): Uint8Array {
  if (!years.length) throw new Error("businessPlanXlsx: no year to export");
  return buildWorkbook([summarySheet(years, exportedAt), ...years.map(gridSheet), hypothesesSheet(years, groups)]);
}
