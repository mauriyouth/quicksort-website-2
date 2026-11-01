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
