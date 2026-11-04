import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Download, Ellipsis, UserRoundPen } from "lucide-react";
import { db, errorMessage, type DocumentRecord } from "@quicksort/hr-db";
import { downloadDocument, movePayslip, previewDocument } from "../documents/client";

type PayslipRow = Pick<DocumentRecord, "id" | "title" | "valid_from" | "file_name">;
type Candidate = { id: string; name: string };
type MatriculeReset = { employeeId: string; value: string };

const FREELANCE = "Freelance";
const SHORT_MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const PREFIX = "Bulletin de paie ";

/** "Octobre 2026" (or "Octobre 2026 (2)") from the stored title; the badge and year come from valid_from. */
const slipLabel = (row: PayslipRow) => (row.title.startsWith(PREFIX) ? row.title.slice(PREFIX.length) : row.title);
const slipYear = (row: PayslipRow) => row.valid_from?.slice(0, 4) ?? "";
const slipShort = (row: PayslipRow) => SHORT_MONTHS[Number(row.valid_from?.slice(5, 7)) - 1] ?? "—";
const periodName = (row: PayslipRow) => slipLabel(row).replace(/ \(\d+\)$/, "");

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
  const [year, setYear] = useState("all");
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.parentElement?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [menu]);

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
    setYear("all");
    setMenu(null);
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
  const years = [...new Set((rows ?? []).map(slipYear))];
  const visible = (rows ?? []).filter((row) => year === "all" || slipYear(row) === year);
  const groups = years.filter((y) => year === "all" || y === year).map((y) => ({ year: y, items: visible.filter((row) => slipYear(row) === y) }));
  const summary = year === "all"
    ? `${rows?.length ?? 0} payslip${rows?.length === 1 ? "" : "s"}${rows && rows.length > 1 ? ` · ${periodName(rows[rows.length - 1])} → ${periodName(rows[0])}` : ""}`
    : `${visible.length} payslip${visible.length === 1 ? "" : "s"} in ${year}`;

  function startMove(row: PayslipRow) {
    setMenu(null);
    setMoving(row);
    setTarget("");
    setNotice("");
    setReset(null);
  }

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
    {!!rows?.length && <div className="payslips-person-toolbar">
      <div className="payslips-person-filters">
        {years.length > 1 && <div role="group" aria-label="Filter by year" className="payslips-person-years">
          {[{ id: "all", label: "All", count: rows.length }, ...years.map((y) => ({ id: y, label: y, count: rows.filter((row) => slipYear(row) === y).length }))].map((option) =>
            <button key={option.id} type="button" aria-pressed={year === option.id} onClick={() => { setYear(option.id); setMenu(null); }}>
              {option.label}<span>{option.count}</span>
            </button>)}
        </div>}
        <span className="payslips-person-summary">{summary}</span>
      </div>
      <button type="button" className="payslips-person-all" disabled={busy} onClick={() => attempt(async () => { for (const row of visible) await downloadDocument(row); })}>
        <Download size={18} strokeWidth={1.5} aria-hidden="true" /> Download all
      </button>
    </div>}
    {groups.map((group) => <div key={group.year} className="payslips-person-group">
      {year === "all" && years.length > 1 && <h3>{group.year}</h3>}
      <ul className="payslips-person-list">
        {group.items.map((row) => <li key={row.id}>
          <span className="payslips-person-badge" aria-hidden="true">{slipShort(row)}</span>
          <span className="payslips-person-main">
            <span className="payslips-person-name">
              <span className="payslips-person-title">{slipLabel(row)}</span>
              {row.id === rows![0].id && <span className="payslips-person-latest">Latest</span>}
            </span>
            <span className="payslips-person-meta">Bulletin de paie · PDF</span>
          </span>
          <span className="payslips-person-actions">
            <button type="button" className="payslips-person-btn" disabled={busy} onClick={() => attempt(() => previewDocument(row))}>
              Open <ArrowUpRight size={16} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className="payslips-person-btn icon" disabled={busy} aria-label={`Download ${row.title}`} title="Download" onClick={() => attempt(() => downloadDocument(row))}>
              <Download size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className="payslips-person-btn icon" aria-label={`More actions for ${slipLabel(row)}`} aria-haspopup="menu" aria-expanded={menu === row.id} onClick={() => setMenu(menu === row.id ? null : row.id)}>
              <Ellipsis size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
          {menu === row.id && <div ref={menuRef} role="menu" className="payslips-person-menu">
            <button type="button" role="menuitem" disabled={busy} onClick={() => startMove(row)}>
              <UserRoundPen size={18} strokeWidth={1.5} aria-hidden="true" /> Move to another person…
            </button>
            <span>Use only if this payslip was filed to the wrong person.</span>
          </div>}
        </li>)}
      </ul>
    </div>)}
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
