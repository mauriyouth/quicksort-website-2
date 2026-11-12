import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { cn } from "cn";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  Checkbox,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@quicksort-sas/ui";
import { errorMessage } from "@quicksort/hr-db";
import { PageAlerts, PageHeading, linkButton } from "../ui";
import { readPayslipDrop, payslipTitle } from "./read.browser";
import { matchPayslips, preferredEmployment, type FiledPayslip, type MatchEmployee, type ReviewRow, type ReviewStatus } from "./match";
import { filedConflict, fileReviewRow, loadMatchContext, replacedMatricule } from "./client";

/**
 * HR → Payslips: drop a Silae zip (or PDFs), review who each payslip matches,
 * then file them one by one into the employees' Documents. Weak matches are
 * never filed until HR confirms them.
 */
type Item = { row: ReviewRow; personId: string | null; confirmed: boolean; overwrite: boolean; state: "idle" | "filing" | "done" | "error"; error: string };

type Tone = "success" | "warning" | "secondary" | "destructive";
const CHIP: Record<ReviewStatus, { label: string; tone: Tone }> = {
  matched: { label: "Matched", tone: "success" },
  changed: { label: "Changed", tone: "success" },
  confirm: { label: "Confirm", tone: "warning" },
  unknown: { label: "Unknown", tone: "warning" },
  "already-filed": { label: "Already filed", tone: "secondary" },
  duplicate: { label: "Duplicate", tone: "secondary" },
  unreadable: { label: "Unreadable", tone: "destructive" },
};
const NOTE = "m-0 text-xs text-muted-foreground";
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
    <div className="@container flex flex-col gap-6">
      <Link to="/hr/payslips" className={cn(linkButton({ variant: "ghost", size: "sm" }), "-ml-2 self-start")}>
        <ArrowLeft data-icon="inline-start" aria-hidden="true" /> All payslips
      </Link>
      <PageHeading title="Import payslips">
        Drop the Silae export. Each payslip is matched to its employee, then filed in their Documents.
      </PageHeading>
      <PageAlerts error={error} />

      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-center transition-colors",
          dragging && "border-foreground bg-muted",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="m-0 text-sm">{reading ? "Reading payslips…" : "Drop a zip or PDF payslips here"}</p>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept=".zip,.pdf,application/pdf,application/zip" aria-label="Payslip files" hidden
          onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; void read(list); }} />
      </div>

      {items.length > 0 && (
        <Card role="region" aria-label="Review">
          <CardContent className="px-0">
            <Table className="[&_tr>*:first-child]:pl-6 [&_tr>*:last-child]:pr-6">
              <TableHeader>
                <TableRow><TableHead>File</TableHead><TableHead>Name as printed</TableHead><TableHead>Employee</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => {
                  const { row } = item;
                  const chip = CHIP[row.status];
                  const replaced = replacement(item);
                  const matricule = "error" in row.file ? "" : row.file.matricule;
                  return (
                    <TableRow key={i} className="align-top">
                      <TableCell className="max-w-28 truncate font-mono text-xs @3xl:max-w-40" title={row.file.fileName}>{row.file.fileName}</TableCell>
                      <TableCell className="min-w-28 whitespace-normal">{row.printedName || "—"}</TableCell>
                      <TableCell className="min-w-48 whitespace-normal">
                        <div className="flex flex-col gap-1.5">
                          {NEEDS_CONFIRMATION(row.status) && item.state !== "done" ? (
                            <>
                              <NativeSelect size="sm" className="w-full" aria-label={`Employee for ${row.file.fileName}`} value={item.personId ?? ""} disabled={busy}
                                onChange={(e) => patch(i, { personId: e.target.value || null, confirmed: false, overwrite: false })}>
                                <NativeSelectOption value="">Choose an employee…</NativeSelectOption>
                                {people.map((p) => <NativeSelectOption key={p.id} value={p.id}>{p.name}</NativeSelectOption>)}
                              </NativeSelect>
                              <CheckRow id={`payslip-confirm-${i}`} checked={item.confirmed} disabled={busy || !item.personId} ariaLabel={`Confirm ${row.file.fileName}`}
                                onChange={(checked) => patch(i, { confirmed: checked })}>
                                Confirm
                              </CheckRow>
                            </>
                          ) : (
                            personName(item.personId)
                          )}
                          {conflictOf(item)?.identical && item.state !== "done" && <p className={NOTE}>Already filed for {personName(item.personId)}</p>}
                          {supersedesOf(item) && NEEDS_CONFIRMATION(row.status) && item.state !== "done" && <p className={NOTE}>Replaces the payslip already filed for {personName(item.personId)}</p>}
                          {row.warning && <p className={NOTE}>{row.warning}</p>}
                          {replaced && item.state !== "done" && (
                            <CheckRow id={`payslip-replace-${i}`} checked={item.overwrite} disabled={busy} onChange={(checked) => patch(i, { overwrite: checked })}>
                              Replace matricule {replaced} with {matricule}
                            </CheckRow>
                          )}
                          {"error" in row.file && <p className={NOTE}>{row.file.error}</p>}
                          {item.error && <p role="alert" className="m-0 text-xs text-destructive">{item.error}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="num whitespace-nowrap text-xs">{periodLabel(row)}</TableCell>
                      <TableCell>
                        <Badge variant={item.state === "done" ? "success" : chip.tone}>
                          {item.state === "done" ? "Filed" : item.state === "filing" ? "Filing…" : chip.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-end gap-3 border-t border-border py-4">
            {progress && <span role="status" className="num text-sm text-muted-foreground">Filing {Math.min(progress.done + 1, progress.total)} of {progress.total}…</span>}
            <Button type="button" disabled={busy || queue.length === 0} onClick={() => void fileAll()}>
              File {queue.length} payslip{queue.length === 1 ? "" : "s"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

/** Checkbox with its text beside it. The text is tied by aria-labelledby (or
 *  the explicit ariaLabel), not a <label>: a <label> would also name the
 *  package Checkbox's hidden native input, giving two controls one name. */
function CheckRow({ id, checked, disabled, ariaLabel, onChange, children }: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <span className="flex items-start gap-2">
      <Checkbox className="mt-0.5" checked={checked} disabled={disabled} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : `${id}-text`}
        onCheckedChange={(next) => onChange(next === true)} />
      <span id={`${id}-text`} className={cn("cursor-pointer text-sm select-none", disabled && "cursor-not-allowed opacity-50")}
        onClick={() => { if (!disabled) onChange(!checked); }}>
        {children}
      </span>
    </span>
  );
}
