import { z } from 'zod';

export const statusLabels = {
  rtt: 'RTT',
  unpaid_leave: 'Congés sans solde',
  paid_leave: 'Congés Payés',
  internal: 'Internal',
  client_project: 'Client Project',
};
export const partSchema = z.enum(['full', 'am', 'pm']);
export type Part = z.infer<typeof partSchema>;
const dateSchema = z.iso.date();
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const entrySchema = z.discriminatedUnion('status', [
  z.object({ day: dateSchema, part: partSchema, status: z.enum(['rtt', 'unpaid_leave', 'paid_leave', 'internal']), project_id: z.null() }),
  z.object({ day: dateSchema, part: partSchema, status: z.literal('client_project'), project_id: z.uuid() }),
]);
export const contextSchema = z.object({
  employees: z.array(z.object({ id: z.uuid(), full_name: z.string(), role: z.string(), start_date: dateSchema, end_date: dateSchema.nullable() })),
  assignments: z.array(z.object({ id: z.uuid(), employee_id: z.uuid(), project_id: z.uuid(), title: z.string(), client_name: z.string(), start_date: dateSchema, end_date: dateSchema.nullable(), status: z.string() })),
});
// Snapshots written before half-day support have no `part` — treat those
// entries as full days so old months keep loading until the migration runs.
const storedEntrySchema = z.preprocess(value => typeof value === 'object' && value !== null && !('part' in value) ? { part: 'full', ...value } : value, entrySchema);
export const snapshotSchema = z.object({ version: z.number().int().nonnegative(), entries: z.array(storedEntrySchema), updated_at: z.string().nullable(), updated_by: z.string().nullable() });
export type Entry = z.infer<typeof entrySchema>;
export type Context = z.infer<typeof contextSchema>;
export type Employee = Context['employees'][number];
export type Assignment = Context['assignments'][number];
export type Snapshot = z.infer<typeof snapshotSchema>;

export function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
export function shiftMonth(month: string, delta: number) {
  const parsed = monthSchema.parse(month);
  const date = new Date(Number(parsed.slice(0, 4)), Number(parsed.slice(5)) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function listMonths(from: string, to: string) {
  const months: string[] = [];
  let cursor = monthSchema.parse(from);
  const end = monthSchema.parse(to);
  while (cursor <= end) {
    months.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return months;
}
// Easter Sunday via the Meeus algorithm — drives the three movable French
// public holidays (Easter Monday, Ascension, Whit Monday).
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(year, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function shiftDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
// National French public holidays (jours fériés), keyed by ISO date with the
// French name. Alsace-Moselle extras (Good Friday, Saint-Étienne) are not
// included.
export function frenchHolidays(year: number) {
  const easter = easterSunday(year);
  return {
    [`${year}-01-01`]: "Jour de l'An",
    [isoDate(shiftDays(easter, 1))]: 'Lundi de Pâques',
    [`${year}-05-01`]: 'Fête du travail',
    [`${year}-05-08`]: 'Victoire 1945',
    [isoDate(shiftDays(easter, 39))]: 'Ascension',
    [isoDate(shiftDays(easter, 50))]: 'Lundi de Pentecôte',
    [`${year}-07-14`]: 'Fête nationale',
    [`${year}-08-15`]: 'Assomption',
    [`${year}-11-01`]: 'Toussaint',
    [`${year}-11-11`]: 'Armistice 1918',
    [`${year}-12-25`]: 'Noël',
  } as Record<string, string>;
}
export function monthDays(month: string) {
  const parsed = monthSchema.parse(month);
  const year = Number(parsed.slice(0, 4));
  const holidays = frenchHolidays(year);
  const days = new Date(year, Number(parsed.slice(5)), 0).getDate();
  return Array.from({ length: days }, (_, index) => {
    const day = `${parsed}-${String(index + 1).padStart(2, '0')}`;
    const date = new Date(`${day}T12:00:00`);
    return { day, label: date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), weekend: [0, 6].includes(date.getDay()), holiday: holidays[day] ?? null };
  });
}
export function withinEmployment(employee: Employee, day: string) {
  return day >= employee.start_date && (!employee.end_date || day <= employee.end_date);
}
export function assignedProjects(assignments: Assignment[], employeeId: string, day: string) {
  return assignments.filter(assignment => assignment.employee_id === employeeId
    && ['confirmed', 'active', 'completed'].includes(assignment.status)
    && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))
    .filter((assignment, index, all) => all.findIndex(item => item.project_id === assignment.project_id) === index);
}
// A cell value: empty string means unfilled; 'project:<id>' is a client project.
export type ActivityValue = '' | 'rtt' | 'unpaid_leave' | 'paid_leave' | 'internal' | `project:${string}`;
export function entryValue(entry: Entry | undefined): ActivityValue {
  return !entry ? '' : entry.status === 'client_project' ? `project:${entry.project_id}` : entry.status;
}
export function entryFromValue(day: string, part: Part, value: string): Entry | undefined {
  if (!value) return undefined;
  return entrySchema.parse(value.startsWith('project:')
    ? { day, part, status: 'client_project', project_id: value.slice(8) }
    : { day, part, status: value, project_id: null });
}
// Both halves of a day as cell values. A 'full' entry covers AM and PM;
// halves only cover their own part, leaving the other half empty.
export function dayHalves(entries: Entry[], day: string): { am: ActivityValue; pm: ActivityValue } {
  const am = entryValue(entries.find(entry => entry.day === day && entry.part !== 'pm'));
  const pm = entryValue(entries.find(entry => entry.day === day && entry.part !== 'am'));
  return { am, pm };
}
export function sortEntries(entries: Entry[]) {
  return [...entries].sort((a, b) => a.day.localeCompare(b.day) || a.part.localeCompare(b.part));
}
// Paint one or both halves of a day. When both halves end up equal they are
// stored as a single full-day entry; 'full' selection paints both halves.
export function setDayPart(entries: Entry[], day: string, part: Part, value: ActivityValue): Entry[] {
  const halves = dayHalves(entries, day);
  if (part !== 'pm') halves.am = value;
  if (part !== 'am') halves.pm = value;
  const rest = entries.filter(entry => entry.day !== day);
  if (halves.am && halves.am === halves.pm) {
    const entry = entryFromValue(day, 'full', halves.am);
    return entry ? sortEntries([...rest, entry]) : rest;
  }
  const next = [...rest];
  if (halves.am) { const entry = entryFromValue(day, 'am', halves.am); if (entry) next.push(entry); }
  if (halves.pm) { const entry = entryFromValue(day, 'pm', halves.pm); if (entry) next.push(entry); }
  return sortEntries(next);
}
export function fillWeekdays({ month, employee, assignments, entries, value }: { month: string; employee: Employee; assignments: Assignment[]; entries: Entry[]; value: string }) {
  const next = [...entries];
  for (const { day, weekend, holiday } of monthDays(month)) {
    if (weekend || holiday || !withinEmployment(employee, day) || next.some(entry => entry.day === day)) continue;
    const entry = entryFromValue(day, 'full', value);
    if (!entry || (entry.status === 'client_project' && !assignedProjects(assignments, employee.id, day).some(project => project.project_id === entry.project_id))) continue;
    next.push(entry);
  }
  return sortEntries(next);
}
