/**
 * Working-day calendar of the business plan (pure, unit-tested from
 * tests/business-plan-model.test.mjs).
 *
 * Working days are Monday–Friday less French public holidays. The TACI
 * hypothesis (billed days / working days, leave included in the
 * denominator) is modulated month by month by planned leave, so that August
 * bills less while the yearly TACI stays the one entered.
 */
import { frenchHolidays } from "../../cra/domain.ts";
import type { Hypotheses } from "./model.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const holidayCache = new Map<number, Record<string, string>>();
function isHoliday(day: string): boolean {
  const y = Number(day.slice(0, 4));
  let h = holidayCache.get(y);
  if (!h) holidayCache.set(y, (h = frenchHolidays(y)));
  return !!h[day];
}

/** Monday–Friday days of [start, end] (ISO, inclusive) that are not French public holidays. */
export function workingDaysBetween(start: string, end: string): number {
  if (!ISO_DAY.test(start || "") || !ISO_DAY.test(end || "")) return 0;
  const to = new Date(`${end}T12:00:00`);
  let n = 0;
  for (const d = new Date(`${start}T12:00:00`); d <= to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    if (!isHoliday(iso(d))) n++;
  }
  return n;
}

/** Working days of each month of `year`. */
export function monthWorkingDays(year: number): number[] {
  return Array.from({ length: 12 }, (_, m) =>
    workingDaysBetween(`${year}-${pad(m + 1)}-01`, `${year}-${pad(m + 1)}-${pad(new Date(year, m + 1, 0).getDate())}`),
  );
}

export type WorkingCalendar = {
  /** Working days of each month. */
  jo: number[];
  /** Planned leave days per salaried employee, each month. */
  abs: number[];
  /** Billed days / working days of a salaried employee, each month (0–1). */
  taci: number[];
  /** Billed days / (working days − leave), each month (0–1, capped at 1). */
  tace: number[];
  /** Highest reachable yearly TACI: Σ (jo − abs) / Σ jo. */
  taciMax: number;
};

/** Share of paid leave taken in August; the rest and RTT spread on the other months. */
const AUGUST_LEAVE = 0.5;

export function workingCalendar(year: number, h: Pick<Hypotheses, "taci" | "congesAn" | "rttAn">): WorkingCalendar {
  const jo = monthWorkingDays(year);
  const otherDays = jo.reduce((s, d, m) => (m === 7 ? s : s + d), 0);
  const spread = (1 - AUGUST_LEAVE) * h.congesAn + h.rttAn;
  const abs = jo.map((d, m) => (m === 7 ? AUGUST_LEAVE * h.congesAn : otherDays ? (spread * d) / otherDays : 0));
  const total = jo.reduce((a, b) => a + b, 0);
  const present = jo.reduce((s, d, m) => s + Math.max(0, d - abs[m]), 0);
  const taciMax = total ? present / total : 0;
  // A flat TACE spreads the yearly TACI on the days of presence of each month.
  const t = taciMax ? Math.min(1, Math.max(0, h.taci / 100) / taciMax) : 0;
  const tace = jo.map(() => t);
  const taci = jo.map((d, m) => (d ? (t * Math.max(0, d - abs[m])) / d : 0));
  return { jo, abs, taci, tace, taciMax };
}
