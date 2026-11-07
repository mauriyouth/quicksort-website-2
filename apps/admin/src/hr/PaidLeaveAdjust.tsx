import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '@quicksort/hr-db';
import { Dialog } from './ui';
import { checkpointBalance, deletePayslipCheckpoint, loadPayslipCheckpoint, savePayslipCheckpoint, type PayslipCheckpoint } from '../cra/balances';

type Values = { period: string; n1_acquired: string; n1_taken: string; n_acquired: string; n_taken: string };
const EMPTY: Values = { period: '', n1_acquired: '', n1_taken: '', n_acquired: '', n_taken: '' };
const FIELDS: { key: Exclude<keyof Values, 'period'>; label: string }[] = [
  { key: 'n1_acquired', label: 'Congés N-1 · Acquis' },
  { key: 'n1_taken', label: 'Congés N-1 · Pris' },
  { key: 'n_acquired', label: 'Congés N · Acquis' },
  { key: 'n_taken', label: 'Congés N · Pris' },
];
const days = (value: string) => Number(value.replace(',', '.')) || 0;
const fromCheckpoint = (checkpoint: PayslipCheckpoint): Values => ({
  period: checkpoint.period.slice(0, 7),
  n1_acquired: String(checkpoint.n1_acquired),
  n1_taken: String(checkpoint.n1_taken),
  n_acquired: String(checkpoint.n_acquired),
  n_taken: String(checkpoint.n_taken),
});

/**
 * Paid leave (CP) adjustment: HR copies the "Congés N-1 / Congés N" box of
 * the latest payslip. The CP balance then starts from those figures; later
 * months accrue at the configured rate and later CRA paid leave is deducted.
 */
export function PaidLeaveAdjust({ employeeId, personName, close, saved }: {
  employeeId: string;
  personName: string;
  close: () => void;
  saved: () => void;
}) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [existing, setExisting] = useState<PayslipCheckpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadPayslipCheckpoint(employeeId)
      .then(checkpoint => {
        if (cancelled) return;
        setExisting(checkpoint);
        if (checkpoint) setValues(fromCheckpoint(checkpoint));
      })
      .catch((failure: unknown) => { if (!cancelled) setError(errorMessage(failure)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId]);

  const solde = checkpointBalance({
    n1_acquired: days(values.n1_acquired), n1_taken: days(values.n1_taken),
    n_acquired: days(values.n_acquired), n_taken: days(values.n_taken),
  });

  async function act(work: () => Promise<void>) {
    setSaving(true);
    setError('');
    try {
      await work();
      saved();
      close();
    } catch (failure) {
      setError(errorMessage(failure));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void act(() => savePayslipCheckpoint({
      employee_id: employeeId,
      period: `${values.period}-01`,
      n1_acquired: days(values.n1_acquired), n1_taken: days(values.n1_taken),
      n_acquired: days(values.n_acquired), n_taken: days(values.n_taken),
    }));
  }

  return <Dialog title={`Adjust paid leave — ${personName}`} close={close}>
    <form className="hr-form" onSubmit={submit}>
      <p className="hr-source-list">
        Copy the paid leave box (Congés N-1 / Congés N) from the latest payslip. The CP balance starts from it, then adds accrual for the months after it and subtracts paid leave booked in the CRA after that month.
      </p>
      <div className="hr-fields">
        <label className="hr-field hr-wide">
          <span>Payslip month<span aria-hidden="true"> *</span></span>
          <input type="month" name="period" required disabled={loading} value={values.period} onChange={event => setValues({ ...values, period: event.target.value })} />
        </label>
        {FIELDS.map(field => <label key={field.key} className="hr-field">
          <span>{field.label}</span>
          <input type="number" name={field.key} min={0} step={0.01} inputMode="decimal" disabled={loading} value={values[field.key]} placeholder="0" onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
        </label>)}
      </div>
      <p className="hr-source-list" role="status">CP left on that payslip: <strong>{solde.toFixed(2)} days</strong></p>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="hr-error">{error}</p>}
      <div className="hr-form-actions">
        {existing && <button className="btn secondary" type="button" disabled={saving} onClick={() => void act(() => deletePayslipCheckpoint(employeeId))}>Remove adjustment</button>}
        <button className="btn" type="submit" disabled={loading || saving || !values.period}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </Dialog>;
}
