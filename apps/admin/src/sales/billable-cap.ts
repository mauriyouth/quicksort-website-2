/**
 * Annual billable-days cap per pricing line
 * (sales_projects.tjm_profiles[].max_billable_days_per_year — same JSONB
 * line shape on sales_project_extensions; the project-level column from
 * 20261101090000 was dropped by 20261102090000_billable_cap_per_pricing_line).
 *
 * The stored figure is the full-year allowance the client contracted for
 * that line (e.g. 210 days for the "Data Engineer" profile). Each calendar
 * year the app prorates it over the line's own window: cap(year) = max ×
 * open days in (line window ∩ year) ÷ open days in year, rounded to a half
 * day so it lines up with CRA half-day entries. The line window runs from
 * the contract/extension start to the line's end date, like lineDays().
 *
 * A line without a start (contract not dated) can't be prorated — it gets
 * the full cap. Lines without the field are exempt; callers skip them.
 */

import {
  lineDays,
  openDaysBetween,
  storedPricingLines,
  type PricingLine,
} from "./pricing-lines";

/**
 * Effective billable-days cap of one calendar year for a project window.
 * `end` may be null (open-ended) — the year then runs to Dec 31. Returns 0
 * when the window doesn't intersect the year. Rounded to a half day
 * (Math.round(n·2)/2) so the cap composes with CRA half-day entries.
 */
export function proratedBillableDays(
  maxPerYear: number,
  start: string | null,
  end: string | null,
  year: number,
): number {
  if (maxPerYear <= 0) return 0;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const from = start && start > yearStart ? start : yearStart;
  const to = end && end < yearEnd ? end : yearEnd;
  if (to < from) return 0;
  // No start date → no proration basis → the full yearly allowance.
  if (!start) return Math.round(maxPerYear * 2) / 2;
  const yearDays = openDaysBetween(yearStart, yearEnd);
  if (yearDays <= 0) return 0;
  const windowDays = openDaysBetween(from, to);
  return Math.round((maxPerYear * Math.min(windowDays, yearDays) * 2) / yearDays) / 2;
}

/**
 * Effective billable days of a capped line inside its own window:
 * the window's open days shrunk to the summed per-year prorated
 * allowance (see proratedBillableDays). Uncapped lines are exempt —
 * callers pass their cap as null/undefined and get the window days back
 * unchanged. `start` may be null (undated contract) — the allowance then
 * can't be prorated and the window days stand.
 */
export function cappedBillableDays(
  maxPerYear: number | null | undefined,
  windowDays: number,
  start: string | null,
  end: string | null,
): number {
  if (!maxPerYear || !start || windowDays <= 0) return windowDays;
  const lastYear = Number((end || start).slice(0, 4));
  let allowance = 0;
  for (let year = Number(start.slice(0, 4)); year <= lastYear; year++)
    allowance += proratedBillableDays(maxPerYear, start, end, year);
  return Math.min(windowDays, Math.round(allowance * 2) / 2);
}

/**
 * Billable days of one line inside a window, shrunk to the summed per-year
 * prorated allowance when the line carries a cap — the day volume that
 * actually becomes value. Uncapped lines bill their full window.
 */
export function cappedLineDays(
  line: PricingLine,
  windowStart: string | null,
  windowEnd: string | null,
): number {
  const days = lineDays(line, windowStart, windowEnd);
  if (line.max_billable_days_per_year == null || !windowStart)
    return days;
  const end =
    windowEnd && line.end_date && line.end_date > windowEnd
      ? windowEnd
      : (line.end_date ?? null);
  return cappedBillableDays(
    line.max_billable_days_per_year,
    days,
    windowStart,
    end,
  );
}

/**
 * Contract value of a line set: Σ rate × capped line days. Unlike the
 * flat tjm × estimated_days product (a mean rate over the whole window),
 * each line bills its own rate over its own open days, with annual caps
 * biting line by line.
 */
export function linesCappedAmount(
  lines: PricingLine[],
  windowStart: string | null,
  windowEnd: string | null,
): number {
  return lines.reduce(
    (sum, l) => sum + l.tjm * cappedLineDays(l, windowStart, windowEnd),
    0,
  );
}

/**
 * Value of one extension row: the per-line capped sum over the
 * extension's own window for régie, the fixed price otherwise. The
 * stored `amount` column is a generated tjm × estimated_days product
 * (mean rate × days), so régie values are always recomputed from the
 * line set — caps included — rather than read from the column.
 */
export function extensionValue(ext: {
  pricing_model: string;
  tjm_profiles: unknown;
  start_date: string | null;
  end_date: string | null;
  amount: number | string;
}): number {
  return ext.pricing_model === "regie"
    ? linesCappedAmount(
        storedPricingLines(ext.tjm_profiles),
        ext.start_date,
        ext.end_date,
      )
    : Number(ext.amount);
}

/** Calendar year of a CRA month bucket ("YYYY-MM"). */
export function craMonthYear(month: string): number | null {
  const year = Number(String(month || "").slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : null;
}
