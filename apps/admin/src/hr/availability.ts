import { useEffect, useState } from 'react';
import { z } from 'zod';
import { db, errorMessage } from '@quicksort/hr-db';
import { frenchHolidays } from '../cra/domain';
import type { Assignment, Employee } from './domain';

/**
 * Year availability per employee: the open (Mon–Fri, non-holiday) days of the
 * current calendar year that fall inside an employment period, minus project
 * days, paid leave (CP) and RTT booked in the CRA. What remains is usable for
 * internal work.
 *
 * Project time has two sources, kept disjoint by month:
 *  - months with CRA entries consume exactly what the CRA records;
 *  - months without one (typically the future) consume the allocation of
 *    reserved/confirmed/active assignments covering each open day.
 * Half-day entries weigh 0.5. Internal and unpaid-leave days do not reduce
 * the figure — internal days are what the balance is spent on.
 */

export type YearAvailability = {
  openDays: number;
  /** Client-project days: CRA-recorded + planned from assignments. */
  projectDays: number;
  /** Subset of projectDays estimated from assignments in unreported months. */
  plannedProjectDays: number;
  paidLeaveDays: number;
  rttDays: number;
  availableDays: number;
};

const BOOKING_STATUSES = ['reserved', 'confirmed', 'active', 'completed'];

function employedOn(employees: Employee[], day: string) {
  return employees.some(employee => day >= employee.start_date
    && !(employee.end_date && day > employee.end_date)
    && !(employee.planned_exit_date && day > employee.planned_exit_date));
}

function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const craDaySchema = z.object({
  employee_id: z.string().uuid(),
  month: z.string(),
  day: z.string(),
  // Rows written before half-day support have no `part`: a full day.
  part: z.enum(['full', 'am', 'pm']).nullish().transform(part => part ?? 'full'),
  status: z.string()
});

const PAGE = 1000;

/** This year's CRA days for the given employees, paged past PostgREST's row cap. */
async function loadYearEntries(employeeIds: string[]): Promise<CraDay[]> {
  const year = new Date().getFullYear();
  const rows: CraDay[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await db().from('cra_entries')
      .select('employee_id,month,day,part,status')
      .in('employee_id', employeeIds)
      .gte('day', `${year}-01-01`)
      .lte('day', `${year}-12-31`)
      .order('employee_id').order('day').order('part')
      .range(from, from + PAGE - 1);
    if (result.error) throw result.error;
    const page = z.array(craDaySchema).parse(result.data ?? []);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export type CraDay = z.infer<typeof craDaySchema>;

export function yearAvailability({ employees, assignments, entries }: {
  employees: Employee[];
  assignments: Assignment[];
  /** Per-day CRA rows (public.cra_entries) of these employees. */
  entries: CraDay[];
}): YearAvailability {
  const year = new Date().getFullYear();
  const holidays = frenchHolidays(year);
  const reportedMonths = new Set(entries.map(row => `${row.employee_id}:${row.month.slice(0, 7)}`));
  let projectDays = 0;
  let paidLeaveDays = 0;
  let rttDays = 0;
  for (const entry of entries) {
    if (!entry.day.startsWith(`${year}-`)) continue;
    const weight = entry.part === 'full' ? 1 : 0.5;
    if (entry.status === 'client_project') projectDays += weight;
    else if (entry.status === 'paid_leave') paidLeaveDays += weight;
    else if (entry.status === 'rtt') rttDays += weight;
  }
  const employeeIds = new Set(employees.map(employee => employee.id));
  const relevant = assignments.filter(assignment => employeeIds.has(assignment.employee_id) && BOOKING_STATUSES.includes(assignment.status));
  let openDays = 0;
  let plannedProjectDays = 0;
  for (const cursor = new Date(year, 0, 1); cursor.getFullYear() === year; cursor.setDate(cursor.getDate() + 1)) {
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    const day = isoDay(cursor);
    if (holidays[day] || !employedOn(employees, day)) continue;
    openDays += 1;
    if (employees.some(employee => reportedMonths.has(`${employee.id}:${day.slice(0, 7)}`))) continue;
    const booked = relevant
      .filter(assignment => assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))
      .reduce((sum, assignment) => sum + assignment.allocation_pct, 0);
    plannedProjectDays += Math.min(1, booked / 100);
  }
  projectDays += plannedProjectDays;
  return {
    openDays,
    projectDays,
    plannedProjectDays,
    paidLeaveDays,
    rttDays,
    availableDays: Math.max(0, openDays - projectDays - paidLeaveDays - rttDays)
  };
}

export function useYearAvailability(employees: Employee[], assignments: Assignment[]): YearAvailability & { ready: boolean; error: string } {
  const idsKey = employees.map(employee => employee.id).sort().join(',');
  const [state, setState] = useState<{ entries: CraDay[]; error: string; loaded: boolean }>({ entries: [], error: '', loaded: false });
  useEffect(() => {
    let cancelled = false;
    if (!idsKey) {
      setState({ entries: [], error: '', loaded: true });
      return;
    }
    loadYearEntries(idsKey.split(','))
      .then(entries => {
        if (!cancelled) setState({ entries, error: '', loaded: true });
      })
      .catch((failure: unknown) => {
        // Visible, not silent: a missing RPC/table must not read as "fully available".
        if (!cancelled) setState({ entries: [], error: errorMessage(failure), loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);
  return {
    ...yearAvailability({ employees, assignments, entries: state.entries }),
    ready: state.loaded,
    error: state.error
  };
}
