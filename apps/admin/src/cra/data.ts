import { db } from '@quicksort/hr-db';
import { z } from 'zod';
import { contextSchema, monthSchema, snapshotSchema, entrySchema, type Entry } from './domain';

export async function loadContext() {
  const result = await db().rpc('cra_context');
  if (result.error) throw result.error;
  return contextSchema.parse(result.data);
}
export async function loadMonth(employeeId: string, month: string) {
  const result = await db().rpc('cra_month_snapshot', { target_employee: z.uuid().parse(employeeId), target_month: `${monthSchema.parse(month)}-01` });
  if (result.error) throw result.error;
  return snapshotSchema.parse(result.data);
}
export async function saveMonth({ employeeId, month, version, entries }: { employeeId: string; month: string; version: number; entries: Entry[] }) {
  const result = await db().rpc('cra_save_month', {
    target_employee: z.uuid().parse(employeeId), target_month: `${monthSchema.parse(month)}-01`,
    expected_version: z.number().int().nonnegative().parse(version), entries: entrySchema.array().parse(entries),
  });
  if (result.error) throw result.error;
  return snapshotSchema.parse(result.data);
}
