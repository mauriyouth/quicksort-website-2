import { useCallback, useEffect, useState } from 'react';
import { db, errorMessage, isMissingRelationError } from '@quicksort/hr-db';
import { z } from 'zod';

/**
 * Leave balances and accrual rates. Balances are derived server-side by the
 * employee_leave_balances RPC (accrual per calendar month from the
 * employment start date — CP and RTT once each month is over —
 * minus weighted CRA consumption); this module is the
 * only TS surface for them. Rates live in leave_accrual_settings, edited on
 * the Global settings screen, mirroring the admin_statuses pattern.
 */

export const LEAVE_KINDS = ['cp', 'rtt'] as const;
export type LeaveKind = (typeof LEAVE_KINDS)[number];

export const leaveBalanceSchema = z.object({
  employee_id: z.uuid(),
  kind: z.enum(LEAVE_KINDS),
  accrued: z.number().nonnegative(),
  consumed: z.number().nonnegative(),
  available: z.number(),
});
export type LeaveBalance = z.infer<typeof leaveBalanceSchema>;

export const leaveRateSchema = z.object({
  kind: z.enum(LEAVE_KINDS),
  rate: z.number().positive(),
  updated_at: z.string(),
});
export type LeaveRate = z.infer<typeof leaveRateSchema>;

/** Mirrored migration seeds — degrade-to-defaults while the migration is
 *  pending or the table is empty (same contract as DEFAULT_STATUSES). */
export const DEFAULT_LEAVE_RATES: Record<LeaveKind, number> = { cp: 2.08, rtt: 0.8 };

export async function loadLeaveBalances(employeeIds: string[]): Promise<LeaveBalance[]> {
  const result = await db().rpc('employee_leave_balances');
  if (result.error) throw result.error;
  const all = z.array(leaveBalanceSchema).parse(result.data ?? []);
  const wanted = new Set(employeeIds);
  return all.filter((balance) => wanted.has(balance.employee_id));
}

/** Pure. A missing row means "no accrual window yet", which is 0, not an error. */
export function balanceFor(balances: LeaveBalance[], employeeId: string, kind: LeaveKind): number {
  return balances.find((balance) => balance.employee_id === employeeId && balance.kind === kind)?.available ?? 0;
}

async function fetchLeaveRates(): Promise<{ rates: LeaveRate[]; missing: boolean }> {
  try {
    const result = await db().from('leave_accrual_settings').select('*');
    if (result.error) {
      if (isMissingRelationError(result.error)) return { rates: defaultLeaveRates(), missing: true };
      throw result.error;
    }
    const rows = z.array(leaveRateSchema).parse(result.data ?? []);
    // Degrade on an empty table (e.g. migration pending) and cover partially
    // seeded tables so both kinds always carry a value.
    return { rates: rows.length ? completeRates(rows) : defaultLeaveRates(), missing: !rows.length };
  } catch (error) {
    if (isMissingRelationError(error)) return { rates: defaultLeaveRates(), missing: true };
    throw error;
  }
}

function defaultLeaveRates(): LeaveRate[] {
  return LEAVE_KINDS.map((kind) => ({ kind, rate: DEFAULT_LEAVE_RATES[kind], updated_at: '' }));
}

function completeRates(rows: LeaveRate[]): LeaveRate[] {
  return LEAVE_KINDS.map((kind) => rows.find((row) => row.kind === kind) ?? { kind, rate: DEFAULT_LEAVE_RATES[kind], updated_at: '' });
}

export async function loadLeaveRates(): Promise<LeaveRate[]> {
  return (await fetchLeaveRates()).rates;
}

export async function saveLeaveRate(kind: LeaveKind, rate: number): Promise<void> {
  const result = await db().from('leave_accrual_settings').upsert({ kind, rate });
  if (result.error) throw result.error;
}

/**
 * Paid leave (CP) payslip checkpoint: the "Congés N-1 / Congés N" box of one
 * payslip. The CP balance starts from it and only adds accrual for later
 * months and CRA paid leave dated after the payslip month. RTT has none.
 */
export const payslipCheckpointSchema = z.object({
  employee_id: z.uuid(),
  period: z.string(),
  n1_acquired: z.coerce.number().nonnegative(),
  n1_taken: z.coerce.number().nonnegative(),
  n_acquired: z.coerce.number().nonnegative(),
  n_taken: z.coerce.number().nonnegative(),
  updated_at: z.string(),
});
export type PayslipCheckpoint = z.infer<typeof payslipCheckpointSchema>;
export type PayslipCheckpointInput = Omit<PayslipCheckpoint, 'updated_at'>;

/** Pure. The CP days left on the payslip itself. */
export function checkpointBalance(checkpoint: Pick<PayslipCheckpoint, 'n1_acquired' | 'n1_taken' | 'n_acquired' | 'n_taken'>): number {
  return Math.round((checkpoint.n1_acquired - checkpoint.n1_taken + checkpoint.n_acquired - checkpoint.n_taken) * 100) / 100;
}

export async function loadPayslipCheckpoint(employeeId: string): Promise<PayslipCheckpoint | null> {
  const result = await db().from('leave_payslip_checkpoints').select('*').eq('employee_id', employeeId).maybeSingle();
  if (result.error) {
    if (isMissingRelationError(result.error)) return null;
    throw result.error;
  }
  return result.data ? payslipCheckpointSchema.parse(result.data) : null;
}

export async function savePayslipCheckpoint(input: PayslipCheckpointInput): Promise<void> {
  const result = await db().from('leave_payslip_checkpoints').upsert({ ...input, updated_at: new Date().toISOString() });
  if (result.error) throw result.error;
}

export async function deletePayslipCheckpoint(employeeId: string): Promise<void> {
  const result = await db().from('leave_payslip_checkpoints').delete().eq('employee_id', employeeId);
  if (result.error) throw result.error;
}

export function fmtDays(amount: number): string {
  return amount % 1 ? amount.toFixed(1) : String(amount);
}

export function useLeaveBalances(employeeIds: string[]): { balances: LeaveBalance[]; error: string; reload: () => void } {
  const [state, setState] = useState<{ balances: LeaveBalance[]; error: string }>({ balances: [], error: '' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const key = employeeIds.join(',');
  useEffect(() => {
    let cancelled = false;
    // A failure must be visible, not silent: an unapplied migration makes
    // the RPC disappear and a quiet [] reads as "zero days left".
    if (!key) { setState({ balances: [], error: '' }); return; }
    loadLeaveBalances(key.split(','))
      .then((rows) => { if (!cancelled) setState({ balances: rows, error: '' }); })
      .catch((error: unknown) => { if (!cancelled) setState({ balances: [], error: errorMessage(error) }); });
    return () => { cancelled = true; };
  }, [key, nonce]);
  return { ...state, reload };
}

export function useLeaveRates(): { rates: LeaveRate[]; missing: boolean; saving: boolean; save: (kind: LeaveKind, rate: number) => Promise<void> } {
  const [rates, setRates] = useState<LeaveRate[]>(defaultLeaveRates);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLeaveRates()
      .then(({ rates: rows, missing: tableMissing }) => {
        if (cancelled) return;
        setRates(rows);
        setMissing(tableMissing);
      })
      .catch(() => { if (!cancelled) { setRates(defaultLeaveRates); setMissing(true); } });
    return () => { cancelled = true; };
  }, []);
  const save = useCallback(async (kind: LeaveKind, rate: number) => {
    setSaving(true);
    try {
      await saveLeaveRate(kind, rate);
      setRates((previous) => completeRates(previous.map((row) => (row.kind === kind ? { ...row, rate } : row))));
      setMissing(false);
    } finally {
      setSaving(false);
    }
  }, []);
  return { rates, missing, saving, save };
}
