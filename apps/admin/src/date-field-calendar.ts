/**
 * Calendar math behind DateField. Dates are local calendar days; every
 * comparison goes through atNoon so the time of day (midnight cells vs noon
 * bounds) never shifts a day in or out of the allowed range.
 */

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const atNoon = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);

/** Monday-first calendar cells for the visible month, 6 weeks padded, at noon. */
export function buildCells(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0 … Sun=6
  return Array.from(
    { length: 42 },
    (_, i) => new Date(view.getFullYear(), view.getMonth(), 1 - lead + i, 12),
  );
}

/** True when the day falls before `min` or after `max` (both inclusive bounds). */
export function isOutOfRange(day: Date, min: Date | null, max: Date | null): boolean {
  const d = atNoon(day);
  return (min !== null && d < atNoon(min)) || (max !== null && d > atNoon(max));
}
