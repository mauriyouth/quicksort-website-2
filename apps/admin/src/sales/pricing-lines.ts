/**
 * Contract pricing lines, shared by the initial contract (sales_projects.
 * tjm_profiles) and its extensions (sales_project_extensions.tjm_profiles).
 *
 * A line is a named daily rate — "Data Engineer" at 700 €/day — with its own
 * end date: the line's window runs from the contract/extension start up to
 * that date (capped by the overall end date), and the line value is
 * rate × open (Mon–Fri) days in the window. Extensions amend the line set:
 * new end dates, new rates, added or removed lines.
 *
 * Older rows carried an explicit day volume instead of an end date; the
 * 20261029090000_pricing_lines_backfill migration converted them, so the
 * day-count shape no longer exists in code.
 */

export type PricingLine = {
  name: string;
  tjm: number;
  /** Per-line end date (YYYY-MM-DD) — caps the line's window. */
  end_date?: string | null;
  /** Optional full-year billable-days allowance for this line (e.g. 210).
      Prorated per calendar year over the line window — see billable-cap.ts.
      Absent/null means the line is exempt from the yearly cap. */
  max_billable_days_per_year?: number | null;
};

/** Defensive parse of the JSONB column (blank names, JSON numbers). */
export function storedPricingLines(value: unknown): PricingLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (l): l is PricingLine => !!l && typeof (l as PricingLine).tjm === "number",
    )
    .map((l) => ({
      name: String(l.name || ""),
      tjm: l.tjm,
      end_date:
        typeof l.end_date === "string" && l.end_date ? l.end_date : null,
      max_billable_days_per_year:
        typeof l.max_billable_days_per_year === "number" &&
        l.max_billable_days_per_year > 0
          ? l.max_billable_days_per_year
          : null,
    }));
}

/** Open (working) days between two ISO dates, Mon–Fri, both ends included. */
export function openDaysBetween(start: string, end: string): number {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(start || "")
    ? new Date(`${start}T12:00:00`)
    : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(end || "")
    ? new Date(`${end}T12:00:00`)
    : null;
  if (
    !from ||
    !to ||
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to < from
  )
    return 0;
  let days = 0;
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

/**
 * Day volume of one line inside a window: the line's own end date caps the
 * window (so a consultant can end before the contract does). A line
 * without an end date or window start contributes 0 days.
 */
export function lineDays(
  line: PricingLine,
  windowStart: string | null,
  windowEnd: string | null,
): number {
  if (!line.end_date || !windowStart) return 0;
  const cap = windowEnd && line.end_date > windowEnd ? windowEnd : line.end_date;
  return openDaysBetween(windowStart, cap);
}

/** Total day volume across lines. */
export function linesDays(
  lines: PricingLine[],
  windowStart: string | null,
  windowEnd: string | null,
): number {
  return lines.reduce((sum, l) => sum + lineDays(l, windowStart, windowEnd), 0);
}

/** Contract value: Σ rate × line days. */
export function linesAmount(
  lines: PricingLine[],
  windowStart: string | null,
  windowEnd: string | null,
): number {
  return lines.reduce(
    (sum, l) => sum + l.tjm * lineDays(l, windowStart, windowEnd),
    0,
  );
}
