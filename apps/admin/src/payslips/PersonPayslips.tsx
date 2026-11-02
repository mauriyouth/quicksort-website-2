import { useCallback, useEffect, useState, type FormEvent } from "react";
import { db, errorMessage, type DocumentRecord } from "@quicksort/hr-db";
import { downloadDocument, movePayslip, previewDocument } from "../documents/client";

type PayslipRow = Pick<DocumentRecord, "id" | "title" | "valid_from" | "file_name">;
type Candidate = { id: string; name: string };
type MatriculeReset = { employeeId: string; value: string };

const FREELANCE = "Freelance";

/** Every salaried person (non-freelance employment), by name, for the move picker. */
async function loadCandidates(): Promise<Candidate[]> {
  const { data: staff, error } = await db().from("employees").select("person_id").neq("contract_type", FREELANCE);
  if (error) throw error;
  const ids = [...new Set((staff ?? []).map((row) => row.person_id as string))];
  const out: Candidate[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: nameError } = await db().from("hr_people").select("id,full_name").in("id", ids.slice(i, i + 100));
    if (nameError) throw nameError;
    for (const p of data ?? []) out.push({ id: p.id, name: p.full_name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function setMatricule(employeeId: string, matricule: string) {
  const { error } = await db().rpc("set_employee_matricule", { employee_id: employeeId, matricule, request_id: crypto.randomUUID() });
  if (error) throw error;
}

/** HR-only list of a person's filed payslips, with open, download and re-filing under another person. */
export function PersonPayslips({ personId, personName, onChanged }: { personId: string; personName: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<PayslipRow[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [moving, setMoving] = useState<PayslipRow | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<MatriculeReset | null>(null);

  const load = useCallback(async () => {
    const { data, error: loadError } = await db().from("documents")
      .select("id,title,valid_from,file_name")
      .eq("type_code", "PAYSLIP").eq("person_id", personId).eq("status", "active")
      .order("valid_from", { ascending: false }).order("title", { ascending: false });
    if (loadError) throw loadError;
    setRows((data ?? []) as PayslipRow[]);
  }, [personId]);

  useEffect(() => {
    let live = true;
    setRows(null);
    setMoving(null);
    setReset(null);
    setNotice("");
    load().catch((e) => live && setError(errorMessage(e)));
    loadCandidates().then((list) => live && setCandidates(list.filter((c) => c.id !== personId)), (e) => live && setError(errorMessage(e)));
    return () => { live = false; };
  }, [load, personId]);

  async function attempt(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const targetName = candidates.find((c) => c.id === target)?.name ?? "";

  async function confirmMove() {
    if (!moving || !target) return;
    const slip = moving;
    await attempt(async () => {
      const result = await movePayslip(slip.id, target);
      setMoving(null);
      setTarget("");
      setNotice(`Moved ${slip.title} to ${targetName}.`);
      setReset(result.previousMatricule);
      await load();
    });
  }

  async function confirmReset() {
    if (!reset) return;
    await attempt(async () => {
      await setMatricule(reset.employeeId, reset.value);
      setReset(null);
      setNotice(`${personName}'s matricule reset.`);
      onChanged?.();
    });
  }

  return <div className="payslips-person">
    {rows === null && !error && <p className="hr-source-list">Loading payslips…</p>}
    {rows?.length === 0 && <p className="hr-source-list">No payslips filed yet.</p>}
    {!!rows?.length && <ul className="payslips-person-list">
      {rows.map((row) => <li key={row.id}>
        <span className="payslips-person-title">{row.title}</span>
        <span className="payslips-person-actions">
          <button type="button" className="hr-emp-mini" disabled={busy} onClick={() => attempt(() => previewDocument(row))}>Open</button>
          <button type="button" className="hr-emp-mini" disabled={busy} onClick={() => attempt(() => downloadDocument(row))}>Download</button>
          <button type="button" className="hr-emp-mini" disabled={busy} onClick={() => { setMoving(row); setTarget(""); setNotice(""); setReset(null); }}>Move to another person…</button>
        </span>
      </li>)}
    </ul>}
    {moving && <div className="payslips-person-move">
      <label className="hr-field">
        <span>Move {moving.title} to</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Move payslip to">
          <option value="">Select a person…</option>
          {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {target && <p role="status">Move {moving.title} from {personName} to {targetName}?</p>}
      <div className="hr-emp-actions">
        <button type="button" className="hr-emp-ghost" disabled={busy || !target} onClick={confirmMove}>Confirm move</button>
        <button type="button" className="hr-emp-ghost plain" disabled={busy} onClick={() => setMoving(null)}>Cancel</button>
      </div>
    </div>}
    {notice && <p role="status" className="hr-source-list">{notice}</p>}
    {reset && <div className="payslips-person-move">
      <p role="status">Reset {personName}'s matricule to {reset.value}?</p>
      <div className="hr-emp-actions">
        <button type="button" className="hr-emp-ghost" disabled={busy} onClick={confirmReset}>Reset matricule</button>
        <button type="button" className="hr-emp-ghost plain" disabled={busy} onClick={() => setReset(null)}>Keep current</button>
      </div>
    </div>}
    {error && <p role="alert" className="hr-error">{error}</p>}
  </div>;
}

/** Inline matricule editor: the RPC trims, validates and rejects a number another person already holds. */
export function MatriculeEdit({ employeeId, current, onSaved }: { employeeId: string; current: string; onSaved: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await setMatricule(employeeId, value.trim());
      setEditing(false);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) return <span className="hr-emp-value">
    {current}
    <button type="button" className="hr-emp-mini" onClick={() => { setValue(current); setError(""); setEditing(true); }}>Change</button>
  </span>;
  return <form className="payslips-matricule" onSubmit={save}>
    <label className="hr-field">
      <span>Matricule</span>
      <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={20} required />
      <small>Silae employee number for salaried staff</small>
    </label>
    <div className="hr-emp-actions">
      <button type="submit" className="hr-emp-ghost" disabled={saving}>Save matricule</button>
      <button type="button" className="hr-emp-ghost plain" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
    </div>
    {error && <p role="alert" className="hr-error">{error}</p>}
  </form>;
}
