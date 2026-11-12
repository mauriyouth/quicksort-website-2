import { useCallback, useEffect, useState } from 'react';
import { db, isMissingRelationError } from '@quicksort/hr-db';

/**
 * Unit-economics settings and the salary-to-CJM conversion. The CJM
 * (coût journalier moyen — fully loaded daily cost) of an offer is
 * CJM = gross monthly salary × multiplier ÷ working days per month. The
 * multiplier lives in hr_economics_settings, edited on the Global settings
 * screen, mirroring the leave_accrual_settings pattern; the 21.7 divisor is
 * the §1 intercontrat convention from apps/prd-hr.md. A missing table or row
 * degrades to DEFAULT_CJM_MULTIPLIER so offer drafting keeps working while
 * the migration is pending. For freelancers the salary side is a daily rate
 * already, so their CJM is the daily_rate itself — no conversion.
 */

export const CJM_DAYS_PER_MONTH = 21.7;
export const DEFAULT_CJM_MULTIPLIER = 2;

/** Pure. Fully loaded daily cost from a gross monthly salary. */
export function computeCjm(salaryMonthly: number, multiplier: number): number {
  return Math.round((salaryMonthly * multiplier / CJM_DAYS_PER_MONTH) * 100) / 100;
}

export async function loadCjmMultiplier(): Promise<{ multiplier: number; missing: boolean }> {
  try {
    const result = await db().from('hr_economics_settings').select('cjm_multiplier').limit(1);
    if (result.error) {
      if (isMissingRelationError(result.error)) return { multiplier: DEFAULT_CJM_MULTIPLIER, missing: true };
      throw result.error;
    }
    const row = (result.data ?? [])[0];
    return { multiplier: row?.cjm_multiplier ?? DEFAULT_CJM_MULTIPLIER, missing: !row };
  } catch (error) {
    if (isMissingRelationError(error)) return { multiplier: DEFAULT_CJM_MULTIPLIER, missing: true };
    throw error;
  }
}

export async function saveCjmMultiplier(multiplier: number): Promise<void> {
  const result = await db().from('hr_economics_settings').upsert({ id: true, cjm_multiplier: multiplier });
  if (result.error) throw result.error;
}

/** Business plan employer-cost multipliers (gross salary → loaded cost), per scenario. */
export type PlanScenario = 'optimistic' | 'pessimistic';
export type PlanMultipliers = Record<PlanScenario, number>;
export const DEFAULT_PLAN_MULTIPLIERS: PlanMultipliers = { optimistic: 1.4, pessimistic: 2 };

type EconomicsRow = { cjm_multiplier?: number | string | null; bp_multiplier_optimistic?: number | string | null; bp_multiplier_pessimistic?: number | string | null };
const positive = (v: unknown, fallback: number) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Loads both scenario multipliers; a missing table, row or column degrades to the defaults. */
export async function loadPlanMultipliers(): Promise<{ multipliers: PlanMultipliers; missing: boolean }> {
  const fallback = { multipliers: { ...DEFAULT_PLAN_MULTIPLIERS }, missing: true };
  try {
    const result = await db().from('hr_economics_settings').select('bp_multiplier_optimistic, bp_multiplier_pessimistic').limit(1);
    if (result.error) return fallback;
    const row = ((result.data ?? []) as EconomicsRow[])[0];
    if (!row) return fallback;
    return {
      multipliers: {
        optimistic: positive(row.bp_multiplier_optimistic, DEFAULT_PLAN_MULTIPLIERS.optimistic),
        pessimistic: positive(row.bp_multiplier_pessimistic, DEFAULT_PLAN_MULTIPLIERS.pessimistic),
      },
      missing: false,
    };
  } catch {
    return fallback;
  }
}

/** Global settings → Unit economics: the CJM multiplier and both plan scenarios. */
export function useEconomicsSettings() {
  const [values, setValues] = useState({ cjm: DEFAULT_CJM_MULTIPLIER, ...DEFAULT_PLAN_MULTIPLIERS });
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCjmMultiplier(), loadPlanMultipliers()])
      .then(([cjm, plan]) => {
        if (cancelled) return;
        setValues({ cjm: Number(cjm.multiplier), ...plan.multipliers });
        setMissing(cjm.missing || plan.missing);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, []);
  const save = useCallback(async (key: 'cjm' | PlanScenario, next: number) => {
    const patch =
      key === 'cjm' ? { cjm_multiplier: next }
      : key === 'optimistic' ? { bp_multiplier_optimistic: next }
      : { bp_multiplier_pessimistic: next };
    setSaving(true);
    setError('');
    try {
      const result = await db().from('hr_economics_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true).select('id');
      if (result.error) throw result.error;
      if (!result.data?.length) throw new Error('hr_economics_settings has no row. Apply the migrations.');
      setValues((v) => ({ ...v, [key]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, []);
  return { values, missing, saving, error, save };
}

export function useCjmMultiplier(): { multiplier: number; missing: boolean; saving: boolean; save: (multiplier: number) => Promise<void> } {
  const [multiplier, setMultiplier] = useState(DEFAULT_CJM_MULTIPLIER);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadCjmMultiplier()
      .then((loaded) => {
        if (cancelled) return;
        setMultiplier(loaded.multiplier);
        setMissing(loaded.missing);
      })
      .catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, []);
  const save = useCallback(async (next: number) => {
    setSaving(true);
    try {
      await saveCjmMultiplier(next);
      setMultiplier(next);
      setMissing(false);
    } finally {
      setSaving(false);
    }
  }, []);
  return { multiplier, missing, saving, save };
}
