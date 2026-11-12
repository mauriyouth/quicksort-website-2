import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUpRight, Download, Ellipsis, UserRoundPen } from "lucide-react";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@quicksort-sas/ui";
import { db, errorMessage, type DocumentRecord } from "@quicksort/hr-db";
import { downloadDocument, movePayslip, previewDocument } from "../documents/client";

type PayslipRow = Pick<DocumentRecord, "id" | "title" | "valid_from" | "file_name">;
type Candidate = { id: string; name: string };
type MatriculeReset = { employeeId: string; value: string };

const FREELANCE = "Freelance";
export const SHORT_MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
export const PREFIX = "Bulletin de paie ";

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
/** Year filter (All · 2026 · 2025…) with counts, shared with the portal's MyPayslips. */
export function PayslipYearFilter({ options, active, onPick }: { options: { id: string; label: string; count: number }[]; active: string; onPick: (id: string) => void }) {
  return <div role="group" aria-label="Filter by year" className="flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
    {options.map((option) =>
      <button key={option.id} type="button" aria-pressed={active === option.id} onClick={() => onPick(option.id)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm">
        {option.label}<span className="text-xs font-normal text-muted-foreground">{option.count}</span>
      </button>)}
  </div>;
}

/** One payslip line: month badge, period, "Latest" marker and the row actions. */
export function PayslipItem({ short, label, latest, latestVariant = "secondary", children }: { short: string; label: string; latest: boolean; latestVariant?: "secondary" | "pivot"; children: ReactNode }) {
  return <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg p-3 transition-colors hover:bg-accent/60">
    <span className="grid size-12 flex-none place-items-center rounded-md border border-border bg-background text-[13px] font-medium" aria-hidden="true">{short}</span>
    <span className="flex min-w-0 flex-[1_1_10rem] flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{label}</span>
        {latest && <Badge variant={latestVariant}>Latest</Badge>}
      </span>
      <span className="text-[13px] text-muted-foreground">Bulletin de paie · PDF</span>
    </span>
    <span className="ml-auto flex flex-none items-center gap-1">{children}</span>
  </li>;
}

export const PAYSLIP_TOOLBAR = "flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4";
export const PAYSLIP_YEAR_TITLE = "m-0 px-3 pt-6 pb-2 text-[13px] font-medium tracking-[0.02em] text-muted-foreground";
export const PAYSLIP_LIST = "m-0 grid list-none p-0 pt-2";
const QUIET = "m-0 text-[13px] text-muted-foreground";
const PANEL = "flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4";

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
  const moveId = useId();

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

  return <div className="flex min-w-0 flex-col gap-2">
    {rows === null && !error && <p role="status" className={QUIET}>Loading payslips…</p>}
    {rows?.length === 0 && <p className={QUIET}>No payslips filed yet.</p>}
    {!!rows?.length && <div className={PAYSLIP_TOOLBAR}>
      <div className="flex flex-wrap items-center gap-4">
        {years.length > 1 && <PayslipYearFilter active={year} onPick={setYear}
          options={[{ id: "all", label: "All", count: rows.length }, ...years.map((y) => ({ id: y, label: y, count: rows.filter((row) => slipYear(row) === y).length }))]} />}
        <span className={QUIET}>{summary}</span>
      </div>
      <Button variant="outline" disabled={busy} onClick={() => attempt(async () => { for (const row of visible) await downloadDocument(row); })}>
        <Download data-icon="inline-start" aria-hidden="true" /> Download all
      </Button>
    </div>}
    {groups.map((group) => <div key={group.year}>
      {year === "all" && years.length > 1 && <h3 className={PAYSLIP_YEAR_TITLE}>{group.year}</h3>}
      <ul className={PAYSLIP_LIST}>
        {group.items.map((row) => <PayslipItem key={row.id} short={slipShort(row)} label={slipLabel(row)} latest={row.id === rows![0].id}>
          <Button variant="ghost" disabled={busy} onClick={() => attempt(() => previewDocument(row))}>
            Open <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon" disabled={busy} aria-label={`Download ${row.title}`} title="Download" onClick={() => attempt(() => downloadDocument(row))}>
            <Download aria-hidden="true" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`More actions for ${slipLabel(row)}`} />}>
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem disabled={busy} onClick={() => startMove(row)}>
                <UserRoundPen aria-hidden="true" /> Move to another person…
              </DropdownMenuItem>
              <p className="m-0 px-2 pt-1 pb-1.5 text-xs leading-normal text-muted-foreground">Use only if this payslip was filed to the wrong person.</p>
            </DropdownMenuContent>
          </DropdownMenu>
        </PayslipItem>)}
      </ul>
    </div>)}
    {moving && <div className={PANEL}>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={moveId}>Move {moving.title} to</FieldLabel>
        <NativeSelect id={moveId} className="w-full" value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Move payslip to">
          <NativeSelectOption value="">Select a person…</NativeSelectOption>
          {candidates.map((c) => <NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      {target && <p role="status" className="m-0 text-[13px]">Move {moving.title} from {personName} to {targetName}?</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !target} onClick={confirmMove}>Confirm move</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMoving(null)}>Cancel</Button>
      </div>
    </div>}
    {notice && <p role="status" className={QUIET}>{notice}</p>}
    {reset && <div className={PANEL}>
      <p role="status" className="m-0 text-[13px]">Reset {personName}'s matricule to {reset.value}?</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={confirmReset}>Reset matricule</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReset(null)}>Keep current</Button>
      </div>
    </div>}
    {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
  </div>;
}

/** Inline matricule editor: the RPC trims, validates and rejects a number another person already holds. */
export function MatriculeEdit({ employeeId, current, onSaved }: { employeeId: string; current: string; onSaved: () => Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useId();

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

  if (!editing) return <span className="inline-flex flex-wrap items-baseline gap-2">
    {current}
    <Button variant="link" size="sm" className="h-auto px-0 font-sans" onClick={() => { setValue(current); setError(""); setEditing(true); }}>Change</Button>
  </span>;
  return <form className="flex max-w-xs flex-col gap-2.5 font-sans" onSubmit={save}>
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>Matricule</FieldLabel>
      <Input id={id} value={value} onChange={(event) => setValue(event.target.value)} maxLength={20} required aria-describedby={`${id}-hint`} />
      <FieldDescription id={`${id}-hint`} className="text-xs">Silae employee number for salaried staff</FieldDescription>
    </Field>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={saving}>Save matricule</Button>
      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
    </div>
    {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
  </form>;
}
