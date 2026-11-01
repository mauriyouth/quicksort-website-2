import { useMemo, useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { Notice } from "@quicksort/hr-ui";
import { errorMessage } from "@quicksort/hr-db";
import { readPayslipDrop, payslipTitle } from "./read.browser";
import { matchPayslips, preferredEmployment, type FiledPayslip, type MatchEmployee, type ReviewRow, type ReviewStatus } from "./match";
import { filedConflict, fileReviewRow, loadMatchContext, replacedMatricule } from "./client";
import "../documents/documents.css";
import "../hr/workspace.css";
import "./payslips.css";

/**
 * HR → Payslips: drop a Silae zip (or PDFs), review who each payslip matches,
 * then file them one by one into the employees' Documents. Weak matches are
 * never filed until HR confirms them.
 */
type Item = { row: ReviewRow; personId: string | null; confirmed: boolean; overwrite: boolean; state: "idle" | "filing" | "done" | "error"; error: string };

const CHIP: Record<ReviewStatus, { label: string; tone: string }> = {
  matched: { label: "Matched", tone: "good" },
  changed: { label: "Changed", tone: "good" },
  confirm: { label: "Confirm", tone: "" },
  unknown: { label: "Unknown", tone: "" },
  "already-filed": { label: "Already filed", tone: "quiet" },
  duplicate: { label: "Duplicate", tone: "quiet" },
  unreadable: { label: "Unreadable", tone: "urgent" },
};
const NEEDS_CONFIRMATION = (s: ReviewStatus) => s === "confirm" || s === "unknown";
const FILEABLE = (s: ReviewStatus) => s === "matched" || s === "changed" || NEEDS_CONFIRMATION(s);

const periodLabel = (row: ReviewRow) => ("error" in row.file ? "—" : payslipTitle(row.file.period, row.file.index).replace(/^Bulletin de paie /, ""));

export function PayslipImport() {
  const [items, setItems] = useState<Item[]>([]);
  const [employees, setEmployees] = useState<MatchEmployee[]>([]);
  const [filed, setFiled] = useState<FiledPayslip[]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const people = useMemo(() => {
    const byPerson = new Map<string, string>();
    for (const e of employees) byPerson.set(e.person_id, e.full_name);
    return [...byPerson].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees]);

  const employmentOf = (item: Item) =>
    !item.personId ? null
      : item.personId === item.row.personId ? employees.find((e) => e.id === item.row.employeeIdForMatricule) ?? null
      : preferredEmployment(item.personId, employees);
  // Weak rows are re-checked against what is filed for the person HR picked; matched/changed rows keep the matcher's verdict.
  const conflictOf = (item: Item) =>
    NEEDS_CONFIRMATION(item.row.status) && item.personId && !("error" in item.row.file) ? filedConflict(item.row.file, item.personId, filed) : null;
  const supersedesOf = (item: Item) => (NEEDS_CONFIRMATION(item.row.status) ? conflictOf(item)?.supersedes ?? null : item.row.supersedes);
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  const replacement = (item: Item) => ("error" in item.row.file ? null : replacedMatricule(item.row.file.matricule, employmentOf(item)));
  const ready = (item: Item) =>
    item.state !== "done" && FILEABLE(item.row.status) && !conflictOf(item)?.identical && (!NEEDS_CONFIRMATION(item.row.status) || (!!item.personId && item.confirmed)) && (!replacement(item) || item.overwrite);
  const queue = items.filter(ready);
  const busy = reading || progress !== null;

  const patch = (index: number, change: Partial<Item>) => setItems((current) => current.map((item, i) => (i === index ? { ...item, ...change } : item)));

  async function read(list: File[]) {
    if (!list.length || busy) return;
    setError(""); setReading(true); setItems([]);
    try {
      const files = await Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const parsed = await readPayslipDrop(files);
      const context = await loadMatchContext();
      setEmployees(context.employees);
      setFiled(context.filed);
      setItems(matchPayslips(parsed, context.employees, context.filed).map((row) => ({ row, personId: row.personId, confirmed: false, overwrite: false, state: "idle", error: "" })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    void read([...event.dataTransfer.files]);
  }

  async function fileAll() {
    const indexes = items.flatMap((item, i) => (ready(item) ? [i] : []));
    setProgress({ done: 0, total: indexes.length });
    let done = 0;
    for (const i of indexes) {
      const item = items[i];
      patch(i, { state: "filing", error: "" });
      try {
        const employment = employmentOf(item);
        const row = { ...item.row, supersedes: supersedesOf(item) };
        await fileReviewRow(row, { personId: item.personId!, employeeIdForMatricule: employment?.id ?? null, overwriteConfirmed: item.overwrite }, employees);
        patch(i, { state: "done" });
      } catch (e) {
        patch(i, { state: "error", error: errorMessage(e) });
      }
      setProgress({ done: ++done, total: indexes.length });
    }
    setProgress(null);
  }

  return (
    <div className="docs-page payslips-page">
      <header className="docs-head">
        <h1>Payslips</h1>
        <p className="projects-lede">Drop the Silae export. Each payslip is matched to its employee, then filed in their Documents.</p>
      </header>
      <Notice error>{error}</Notice>

      <div
        className={`payslips-drop${dragging ? " on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={20} aria-hidden="true" />
        <p>{reading ? "Reading payslips…" : "Drop a zip or PDF payslips here"}</p>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => input.current?.click()}>Choose files</button>
        <input ref={input} type="file" multiple accept=".zip,.pdf,application/pdf,application/zip" aria-label="Payslip files" hidden
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; void read(list); }} />
      </div>

      {items.length > 0 && (
        <section className="payslips-review" aria-label="Review">
          <div className="hr-table-wrap">
            <table className="hr-table payslips-table">
              <thead>
                <tr><th>File</th><th>Name as printed</th><th>Employee</th><th>Period</th><th>Status</th></tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const { row } = item;
                  const chip = CHIP[row.status];
                  const replaced = replacement(item);
                  const matricule = "error" in row.file ? "" : row.file.matricule;
                  return (
                    <tr key={i}>
                      <td className="payslips-file" title={row.file.fileName}>{row.file.fileName}</td>
                      <td>{row.printedName || "—"}</td>
                      <td className="payslips-employee">
                        {NEEDS_CONFIRMATION(row.status) && item.state !== "done" ? (
                          <>
                            <select aria-label={`Employee for ${row.file.fileName}`} value={item.personId ?? ""} disabled={busy}
                              onChange={(e) => patch(i, { personId: e.target.value || null, confirmed: false, overwrite: false })}>
                              <option value="">Choose an employee…</option>
                              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <label className="hr-checkbox">
                              <input type="checkbox" checked={item.confirmed} disabled={busy || !item.personId} aria-label={`Confirm ${row.file.fileName}`}
                                onChange={(e) => patch(i, { confirmed: e.target.checked })} />
                              Confirm
                            </label>
                          </>
                        ) : (
                          personName(item.personId)
                        )}
                        {conflictOf(item)?.identical && item.state !== "done" && <small>Already filed for {personName(item.personId)}</small>}
                        {supersedesOf(item) && NEEDS_CONFIRMATION(row.status) && item.state !== "done" && <small>Replaces the payslip already filed for {personName(item.personId)}</small>}
                        {row.warning && <small>{row.warning}</small>}
                        {replaced && item.state !== "done" && (
                          <label className="hr-checkbox">
                            <input type="checkbox" checked={item.overwrite} disabled={busy} onChange={(e) => patch(i, { overwrite: e.target.checked })} />
                            Replace matricule {replaced} with {matricule}
                          </label>
                        )}
                        {"error" in row.file && <small>{row.file.error}</small>}
                        {item.error && <small role="alert" className="payslips-error">{item.error}</small>}
                      </td>
                      <td>{periodLabel(row)}</td>
                      <td>
                        <span className={`hr-tag ${item.state === "done" ? "good" : chip.tone}`}>
                          {item.state === "done" ? "Filed" : item.state === "filing" ? "Filing…" : chip.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hr-form-actions">
            {progress && <span role="status" className="payslips-progress">Filing {Math.min(progress.done + 1, progress.total)} of {progress.total}…</span>}
            <button type="button" className="btn" disabled={busy || queue.length === 0} onClick={() => void fileAll()}>
              File {queue.length} payslip{queue.length === 1 ? "" : "s"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
