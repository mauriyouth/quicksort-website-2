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

import { openDaysBetween } from "./pricing-lines";

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

/** Calendar year of a CRA month bucket ("YYYY-MM"). */
export function craMonthYear(month: string): number | null {
  const year = Number(String(month || "").slice(0, 4));
  return Number.isInteger(year) && year >= 1900 ? year : null;
}
