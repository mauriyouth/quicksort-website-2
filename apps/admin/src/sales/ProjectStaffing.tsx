import { useId, useMemo, useState, type ReactNode } from "react";
import { Pencil, Search, UserPlus, X } from "lucide-react";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Progress,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@quicksort-sas/ui";
import {
  errorMessage,
  executeCommand,
  type Assignment,
} from "../hr/data";
import { DateField } from "../DateField";
import { money } from "./data";
import { cappedBillableDays } from "./billable-cap";
import { lineDays, openDaysBetween, type PricingLine } from "./pricing-lines";

/**
 * Staffing straight from the contract page (design "Contract — staff from
 * the pricing line"): every régie pricing line carries its own staffing —
 * who covers it, at which allocation and commitment — and new assignments
 * are created with assign_project, exactly like the HR workspace's assign
 * form. Coverage compares allocation-weighted staffed days against the
 * line's own billing window.
 */

export const STAFF_OPEN_STATUSES = [
  "proposed",
  "reserved",
  "confirmed",
  "active",
] as const;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });

const fmtDays = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** First letters of a full name — the staffing avatar initials. */
export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");
}

/** Assignment statuses that still occupy (or plan) capacity on a line. */
export function isOpenAssignment(a: Assignment) {
  return (STAFF_OPEN_STATUSES as readonly string[]).includes(a.status);
}

/** Assignments that belong on the project's staffing record: the open ones
    plus completed ones — work already delivered (e.g. by someone who has
    since left) still covers its days. Only cancelled assignments drop out. */
export function isStaffedAssignment(a: Assignment) {
  return isOpenAssignment(a) || a.status === "completed";
}

/** Allocation-weighted days one assignment covers inside a line window. */
export function assignmentLineDays(
  a: Assignment,
  lineStart: string,
  lineEnd: string,
): number {
  const from = a.start_date > lineStart ? a.start_date : lineStart;
  const to = a.end_date && a.end_date < lineEnd ? a.end_date : lineEnd;
  if (!to || to < from) return 0;
  return (openDaysBetween(from, to) * a.allocation_pct) / 100;
}

export type LineStaffing = {
  line: PricingLine;
  /** The line's billing window — the contract window capped by the line
      end date (lines always start at the contract start). */
  start: string;
  end: string;
  /** Billable days in the line window — shrunk to the line's yearly cap
      (prorated per calendar year) when it carries one. */
  days: number;
  /** True when the line carries a yearly billable cap and the window had
      more open days than the cap allows — `days` is the capped figure. */
  capped: boolean;
  /** Assignments staffed on this line — open ones and completed history. */
  staff: Assignment[];
  staffedDays: number;
  coverPct: number;
};

/** Per-line staffing view: the line window, its billable days and the
    open assignments covering them (allocation-weighted, window-clamped). */
export function lineStaffing(
  lines: PricingLine[],
  windowStart: string | null,
  windowEnd: string | null,
  assignments: Assignment[],
): LineStaffing[] {
  return lines.map((line) => {
    const start = windowStart || "";
    const end =
      windowEnd && line.end_date && line.end_date > windowEnd
        ? windowEnd
        : line.end_date || windowEnd || "";
    // Same volume rule as the contract value and its day chip: a line's
    // days are the open days up to its own end date — a line without one
    // bills 0 days, so it adds nothing to the staffed budget either.
    const rawDays = lineDays(line, windowStart, windowEnd);
    // A capped line can't bill more than its yearly allowance — coverage
    // is measured against billable days, not calendar days (a 210-day cap
    // on a 261-open-day year never shows "261 of 261 days staffed").
    const days = cappedBillableDays(
      line.max_billable_days_per_year,
      rawDays,
      start || null,
      end || null,
    );
    const staff = assignments.filter(
      (a) => a.pricing_line === line.name && isStaffedAssignment(a),
    );
    const staffed = staff.reduce(
      (sum, a) => sum + (start && end ? assignmentLineDays(a, start, end) : 0),
      0,
    );
    const staffedDays = Math.round(staffed * 10) / 10;
    return {
      line,
      start,
      end,
      days,
      capped: line.max_billable_days_per_year != null && days < rawDays,
      staff,
      staffedDays,
      coverPct:
        days > 0 ? Math.min(100, Math.round((staffedDays / days) * 100)) : 0,
    };
  });
}

/** One assignable employment period with the person's display name. */
export type StaffingPerson = {
  employeeId: string;
  name: string;
  /** Employment start — assignments cannot begin earlier. */
  startDate: string;
};

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  reserved: "Tentative",
  confirmed: "Confirmed",
  active: "Active",
  completed: "Completed",
};

/** Statuses an assignment can hold — update_assignment accepts the same set. */
type CommitStatus = "proposed" | "reserved" | "confirmed" | "active";

const COMMIT_STATUSES: CommitStatus[] = [
  "proposed",
  "reserved",
  "confirmed",
  "active",
];

const ALLOC_PRESETS = [25, 50, 60, 80, 100];

const nextDay = (iso: string) =>
  `${new Date(new Date(`${iso}T12:00:00`).getTime() + 86400000).toISOString().slice(0, 10)}`;

/**
 * The staffing block of one pricing line: a coverage bar, the people
 * already staffed (with unassign), and an "Assign people" panel that
 * drafts an assignment — person, allocation, commitment, window — and
 * saves it through hr_command's assign_project.
 */
export function LineStaffingPanel({
  projectId,
  staffing,
  people,
  talentPool,
  canEngage,
  assignmentsByEmployee,
  personNameByEmployee,
  currency,
  onChanged,
}: {
  projectId: string;
  staffing: LineStaffing;
  /** Every assignable employment (preboarding/active). */
  people: StaffingPerson[];
  /** People with no open employment — engageable directly onto this line. */
  talentPool: { personId: string; name: string }[];
  /** Only HR operators can create an engagement (the staffing-only role cannot). */
  canEngage: boolean;
  /** All open assignments per employee, every project — feeds the
      availability readout and the capacity pre-check. */
  assignmentsByEmployee: Map<string, Assignment[]>;
  /** Display name per employee id — for staff rows. */
  personNameByEmployee: Map<string, string>;
  currency: string;
  /** Called after a successful assign/unassign so the page reloads. */
  onChanged: () => void;
}) {
  const today = todayISO();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [query, setQuery] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [engageId, setEngageId] = useState("");
  const [engageRole, setEngageRole] = useState("");
  const [engageContract, setEngageContract] = useState("Freelance");
  const [alloc, setAlloc] = useState(100);
  const [commit, setCommit] = useState<"confirmed" | "reserved">("confirmed");
  const [dStart, setDStart] = useState(() =>
    staffing.start > today ? staffing.start : today > staffing.end ? staffing.end : today,
  );
  const [dEnd, setDEnd] = useState(staffing.end);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<Assignment | null>(null);
  // Line names hold spaces, which would split an aria-labelledby id list.
  const uid = useId();

  const { line } = staffing;

  /** Capacity already booked on a day across all open assignments. */
  const bookedOn = (employeeId: string, day: string) =>
    (assignmentsByEmployee.get(employeeId) || [])
      .filter(
        (a) =>
          isOpenAssignment(a) &&
          a.start_date <= day &&
          (!a.end_date || a.end_date >= day),
      )
      .reduce((sum, a) => sum + a.allocation_pct, 0);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => {
        const onLine = staffing.staff.some(
          (a) => a.employee_id === p.employeeId && isOpenAssignment(a),
        );
        const free = Math.max(0, 100 - bookedOn(p.employeeId, today));
        return { ...p, onLine, free };
      })
      .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name));
    // bookedOn closes over assignmentsByEmployee only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, query, staffing.staff, assignmentsByEmployee, today]);

  const picked = people.find((p) => p.employeeId === employeeId) || null;
  const pickedPool =
    talentPool.find((p) => p.personId === engageId) || null;
  /** Talent-pool matches ride the same search box as employed people. */
  const talentMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return talentPool.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [talentPool, query]);

  const dOutside =
    !dStart ||
    !dEnd ||
    dStart < staffing.start ||
    dStart > staffing.end ||
    dEnd < dStart ||
    dEnd > staffing.end;
  const dDays = dOutside
    ? 0
    : (openDaysBetween(dStart, dEnd) * alloc) / 100;
  // hr_command refuses anything that would pass 100% capacity on any day
  // of the window — mirror the check so the button disables early.
  const overCapacity =
    !!picked &&
    !dOutside &&
    (() => {
      let day = dStart;
      // Walk at most a year of days; the window is a contract line.
      for (let i = 0; i < 366 && day <= dEnd; i++) {
        if (bookedOn(picked.employeeId, day) + alloc > 100) return true;
        day = `${new Date(new Date(`${day}T12:00:00`).getTime() + 86400000).toISOString().slice(0, 10)}`;
      }
      return false;
    })();
  const beforeEmployment =
    !!picked && !!picked.startDate && dStart < picked.startDate;
  const engageReady = !!pickedPool && (engageRole.trim() || !!line.name);
  const canAssign =
    (!!picked || !!pickedPool) &&
    !dOutside &&
    !(overCapacity || beforeEmployment) &&
    (!pickedPool || engageReady);

  const draftSummary = dOutside
    ? `Dates must sit inside this line's billing period (${shortDate(staffing.start)} → ${shortDate(staffing.end)}).`
    : pickedPool
      ? `${pickedPool.name.split(" ")[0]} engages as ${engageContract} · ${alloc}% from ${shortDate(dStart)} to ${shortDate(dEnd)} — the employment is created with this assignment.`
      : overCapacity
      ? `${picked?.name.split(" ")[0] ?? "They"} would exceed 100% capacity on these dates.`
      : beforeEmployment
        ? `${picked?.name.split(" ")[0] ?? "They"} hasn't started their employment yet.`
        : `${picked?.name.split(" ")[0] ?? "Pick someone"} adds ${fmtDays(Math.round(dDays * 10) / 10)} staffed days · ${money(Math.round(dDays * line.tjm), currency)} at ${money(line.tjm, currency)}/day`;

  async function assign() {
    if ((!picked && !pickedPool) || !canAssign || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // Talent-pool pick: create the engagement first (starts on the
      // assignment start date), then staff it on this line.
      let employeeIdToStaff = picked?.employeeId ?? "";
      if (pickedPool) {
        const engaged = await executeCommand({
          kind: "engage_person",
          person_id: pickedPool.personId,
          role: engageRole.trim() || line.name,
          contract_type: engageContract,
          start_date: dStart,
        });
        employeeIdToStaff = engaged.employee_id ?? "";
      }
      await executeCommand({
        kind: "assign_project",
        employee_id: employeeIdToStaff,
        project_id: projectId,
        position: line.name,
        pricing_line: line.name,
        allocation_pct: alloc,
        start_date: dStart,
        end_date: dEnd,
        status: commit,
      });
      setNotice(
        `${pickedPool ? pickedPool.name : picked?.name} is staffed on “${line.name}”.`,
      );
      setOpen(false);
      setEmployeeId("");
      setEngageId("");
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  /** Unassign asks first (AlertDialog); endAssignment runs on confirm. */
  function unassign(a: Assignment) {
    if (saving) return;
    setConfirming(a);
  }

  async function endAssignment(a: Assignment) {
    if (saving) return;
    const name = personNameByEmployee.get(a.employee_id) || "This person";
    const started = a.start_date <= today;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await executeCommand({
        kind: "end_assignment",
        assignment_id: a.id,
        expected_version: a.version,
        end_date: started ? today : (a.end_date ?? a.start_date),
        rationale: "Unassigned from the contract page.",
        cancel: !started,
      });
      setNotice(
        started
          ? `${name}'s assignment ended.`
          : `${name}'s reservation released.`,
      );
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const confirmName = confirming
    ? personNameByEmployee.get(confirming.employee_id) || "This person"
    : "";
  const confirmStarted = !!confirming && confirming.start_date <= today;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold">Staffing</span>
          <Progress
            value={staffing.coverPct}
            aria-label={`${line.name || "Profile"} staffed days`}
            className="w-[140px] flex-none"
          />
          <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
            {fmtDays(Math.min(staffing.staffedDays, staffing.days))} of{" "}
            {fmtDays(staffing.days)} days staffed · {staffing.coverPct}%
          </span>
          {staffing.capped && (
            <Badge
              variant="outline"
              className="border-dashed text-muted-foreground"
              title="Billable days are limited by the line's yearly cap"
            >
              Capped
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant={open ? "default" : "outline"}
          size="sm"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setError("");
          }}
        >
          <UserPlus data-icon="inline-start" aria-hidden="true" />
          {open ? "Close" : "Assign people"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="success" role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {staffing.staff.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {staffing.staff.map((a) => {
            const name = personNameByEmployee.get(a.employee_id) || "Person";
            const days =
              staffing.start && staffing.end
                ? assignmentLineDays(a, staffing.start, staffing.end)
                : 0;
            return (
              <li className="flex min-w-0 flex-col gap-2" key={a.id}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg border border-border px-2.5 py-2">
                  <Initials name={name} />
                  <span className="min-w-0 flex-[1_1_120px] truncate text-[13px] font-medium">
                    {name}
                  </span>
                  <Meta>{a.allocation_pct}%</Meta>
                  <Meta>
                    {shortDate(a.start_date)} →{" "}
                    {a.end_date ? shortDate(a.end_date) : "open"}
                  </Meta>
                  <Meta>{fmtDays(Math.round(days * 10) / 10)} days</Meta>
                  <StatusTag status={a.status} />
                  {isOpenAssignment(a) && (
                    <span className="ml-auto inline-flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${name}'s assignment`}
                        aria-expanded={editId === a.id}
                        title="Edit allocation, commitment or dates"
                        disabled={saving}
                        onClick={() => setEditId(editId === a.id ? "" : a.id)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="hover:text-destructive"
                        aria-label={`Unassign ${name}`}
                        title={
                          a.start_date <= today
                            ? "End the assignment"
                            : "Release the reservation"
                        }
                        disabled={saving}
                        onClick={() => unassign(a)}
                      >
                        <X />
                      </Button>
                    </span>
                  )}
                </div>
                {editId === a.id && isOpenAssignment(a) && (
                  <AssignmentEditForm
                    assignment={a}
                    windowStart={staffing.start}
                    windowEnd={staffing.end}
                    employmentStart={
                      people.find((p) => p.employeeId === a.employee_id)
                        ?.startDate ?? ""
                    }
                    assignmentsByEmployee={assignmentsByEmployee}
                    onChanged={onChanged}
                    onClose={() => setEditId("")}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!open && staffing.staff.length === 0 && (
        <p className="m-0 text-[13px] text-muted-foreground">
          Nobody is staffed on this line yet — its days won't appear on
          anyone's CRA.
        </p>
      )}

      {open && (
        <div className="flex flex-col gap-3.5 rounded-lg border border-border p-3.5">
          <div className="flex min-w-0 flex-col gap-2">
            <FieldCaption>Who</FieldCaption>
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                type="text"
                aria-label="Search people"
                placeholder="Search people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {candidates.length === 0 && (
                <p className="m-0 text-[13px] text-muted-foreground">
                  No one matches this search.
                </p>
              )}
              {candidates.map((p) => {
                const selected = p.employeeId === employeeId;
                return (
                  <PersonOption
                    key={p.employeeId}
                    name={p.name}
                    selected={selected}
                    sub={
                      p.onLine
                        ? "Already on this line"
                        : p.free <= 0
                          ? "Fully booked"
                          : `${p.free}% free`
                    }
                    free={p.free}
                    onClick={() => {
                      setEmployeeId(p.employeeId);
                      setEngageId("");
                    }}
                  />
                );
              })}
              {canEngage && talentMatches.length > 0 && (
                <>
                  <p className="col-span-full m-0 mt-1.5 text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                    Talent pool — engage without an application
                  </p>
                  {talentMatches.map((tp) => {
                    const selected = tp.personId === engageId;
                    return (
                      <PersonOption
                        key={tp.personId}
                        name={tp.name}
                        selected={selected}
                        sub="Not employed yet — engagement is created with this assignment"
                        onClick={() => {
                          setEngageId(tp.personId);
                          setEmployeeId("");
                        }}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <FieldCaption id={`${uid}-alloc`}>Allocation</FieldCaption>
              <ToggleGroup
                className="w-full"
                aria-labelledby={`${uid}-alloc`}
                value={[String(alloc)]}
                onValueChange={(v) => {
                  if (v[0]) setAlloc(Number(v[0]));
                }}
              >
                {ALLOC_PRESETS.map((v) => (
                  <ToggleGroupItem key={v} value={String(v)} className="num flex-1">
                    {v}%
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <FieldCaption id={`${uid}-commit`}>Commitment</FieldCaption>
              <ToggleGroup
                className="w-full"
                aria-labelledby={`${uid}-commit`}
                value={[commit]}
                onValueChange={(v) => {
                  if (v[0] === "confirmed" || v[0] === "reserved") setCommit(v[0]);
                }}
              >
                <ToggleGroupItem value="confirmed" className="flex-1">
                  Confirmed
                </ToggleGroupItem>
                <ToggleGroupItem value="reserved" className="flex-1">
                  Tentative
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2">
              <FieldCaption>From</FieldCaption>
              <DateField
                aria-label="Assignment start"
                value={dStart}
                min={
                  [staffing.start, picked?.startDate].filter(Boolean).sort()
                    .pop() || staffing.start
                }
                max={staffing.end}
                onChange={(v) => setDStart(v)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <FieldCaption>To</FieldCaption>
              <DateField
                aria-label="Assignment end"
                value={dEnd}
                min={dStart || staffing.start}
                max={staffing.end}
                onChange={(v) => setDEnd(v)}
              />
            </label>
            <div className="col-span-full flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="rounded-full"
                onClick={() => {
                  const from =
                    today < staffing.start
                      ? staffing.start
                      : today > staffing.end
                        ? staffing.end
                        : today;
                  setDStart(from);
                  setDEnd(staffing.end);
                }}
              >
                From today
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="rounded-full"
                onClick={() => {
                  setDStart(staffing.start);
                  setDEnd(staffing.end);
                }}
              >
                Whole line
              </Button>
            </div>
          </div>

          {pickedPool && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2">
                <FieldCaption>Engagement role</FieldCaption>
                <Input
                  type="text"
                  value={engageRole}
                  onChange={(e) => setEngageRole(e.target.value)}
                  placeholder={line.name || "Role"}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <FieldCaption>Contract</FieldCaption>
                <NativeSelect
                  className="w-full"
                  value={engageContract}
                  onChange={(e) => setEngageContract(e.target.value)}
                >
                  {["Freelance", "CDI", "CDD", "Internship", "Apprenticeship"].map(
                    (c) => (
                      <NativeSelectOption key={c} value={c}>
                        {c}
                      </NativeSelectOption>
                    ),
                  )}
                </NativeSelect>
              </label>
            </div>
          )}

          {dOutside && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                Dates must sit inside this line's billing period (
                {shortDate(staffing.start)} → {shortDate(staffing.end)}).
              </AlertDescription>
            </Alert>
          )}

          <PanelFoot summary={draftSummary}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canAssign || saving}
              onClick={() => void assign()}
            >
              {saving
                ? "Saving…"
                : pickedPool
                  ? `Engage & staff ${pickedPool.name.split(" ")[0]}`
                  : `Assign ${picked ? picked.name.split(" ")[0] : "…"}`}
            </Button>
          </PanelFoot>
        </div>
      )}

      <AlertDialog
        open={!!confirming}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmStarted
                ? `End ${confirmName}'s assignment?`
                : `Release ${confirmName}'s ${confirming?.status === "proposed" ? "proposal" : "reservation"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStarted
                ? `${confirmName}'s assignment on “${line.name}” ends as of today.`
                : `${confirmName} is released from “${line.name}” before the assignment starts.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target) void endAssignment(target);
              }}
            >
              {confirmStarted ? "End assignment" : "Release"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Quiet 13px caption above a control (staffing panel fields). */
function FieldCaption({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-[13px] text-muted-foreground">
      {children}
    </span>
  );
}

/** Tabular, muted figure in a staffed row. */
function Meta({ children }: { children: ReactNode }) {
  return (
    <span className="num text-[13px] whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

/** Initials avatar for a staffed person. */
function Initials({ name }: { name: string }) {
  return (
    <Avatar aria-hidden="true">
      <AvatarFallback>{initialsOf(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Assignment status chip — dashed while it is only proposed or tentative. */
function StatusTag({ status }: { status: string }) {
  const soft = status === "reserved" || status === "proposed";
  return (
    <Badge
      variant="outline"
      className={cn(soft && "border-dashed text-muted-foreground")}
    >
      {STATUS_LABEL[status] || status}
    </Badge>
  );
}

/** A pickable person in the assign panel, with an optional free-capacity bar. */
function PersonOption({
  name,
  sub,
  free,
  selected,
  onClick,
}: {
  name: string;
  sub: string;
  free?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-transparent px-2.5 py-2 text-left transition-colors duration-150 hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:bg-muted"
      onClick={onClick}
    >
      <Initials name={name} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {free !== undefined && (
        <span
          className="h-1 w-9 flex-none overflow-hidden rounded-full bg-border"
          aria-hidden="true"
        >
          <span className="block h-full bg-primary" style={{ width: `${free}%` }} />
        </span>
      )}
    </button>
  );
}

/** Summary on the left, actions on the right, ruled off from the panel. */
function PanelFoot({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <span className="min-w-0 text-[13px] text-muted-foreground tabular-nums">{summary}</span>
      <span className="flex flex-none gap-2">{children}</span>
    </div>
  );
}

/**
 * Inline editor for one staffed row: allocation, commitment and dates,
 * saved through hr_command's update_assignment — the same command the
 * HR workspace uses, so history is preserved instead of losing the
 * assignment to a remove + re-add. The fields mirror the server's rules:
 * dates stay inside the line's billing window and the employment period,
 * capacity is re-checked across the new window (excluding this
 * assignment itself), a started commitment cannot return to proposed,
 * and an active assignment cannot start in the future. A change
 * rationale is required — the command refuses an empty one.
 */
function AssignmentEditForm({
  assignment,
  windowStart,
  windowEnd,
  employmentStart,
  assignmentsByEmployee,
  onChanged,
  onClose,
}: {
  assignment: Assignment;
  /** The line's billing window — same bounds the assign panel enforces. */
  windowStart: string;
  windowEnd: string;
  /** The person's employment start — assignments cannot begin earlier. */
  employmentStart: string;
  assignmentsByEmployee: Map<string, Assignment[]>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const today = todayISO();
  const allocOptions = ALLOC_PRESETS.includes(assignment.allocation_pct)
    ? ALLOC_PRESETS
    : [...ALLOC_PRESETS, assignment.allocation_pct].sort((a, b) => a - b);
  const [alloc, setAlloc] = useState(assignment.allocation_pct);
  const [commit, setCommit] = useState<CommitStatus>(
    (COMMIT_STATUSES as readonly string[]).includes(assignment.status)
      ? (assignment.status as CommitStatus)
      : "confirmed",
  );
  const [dStart, setDStart] = useState(assignment.start_date);
  const [dEnd, setDEnd] = useState(assignment.end_date ?? "");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /** Capacity booked on a day by other open assignments (this one out). */
  const bookedOn = (day: string) =>
    (assignmentsByEmployee.get(assignment.employee_id) || [])
      .filter(
        (a) =>
          a.id !== assignment.id &&
          isOpenAssignment(a) &&
          a.start_date <= day &&
          (!a.end_date || a.end_date >= day),
      )
      .reduce((sum, a) => sum + a.allocation_pct, 0);

  const dOutside =
    !dStart ||
    !dEnd ||
    dStart < windowStart ||
    dStart > windowEnd ||
    dEnd < dStart ||
    dEnd > windowEnd;
  // hr_command re-checks capacity on every day of the new window —
  // mirror it (skipping proposed, which the server exempts).
  const overCapacity =
    commit !== "proposed" &&
    !dOutside &&
    (() => {
      let day = dStart;
      for (let i = 0; i < 366 && day <= dEnd; i++) {
        if (bookedOn(day) + alloc > 100) return true;
        day = nextDay(day);
      }
      return false;
    })();
  const beforeEmployment = !!employmentStart && dStart < employmentStart;
  // Server rules: a started commitment cannot return to proposed, and an
  // active assignment cannot start in the future.
  const cannotPropose =
    assignment.status !== "proposed" && assignment.start_date <= today;
  const activeFuture = commit === "active" && dStart > today;
  const changed =
    alloc !== assignment.allocation_pct ||
    commit !== assignment.status ||
    dStart !== assignment.start_date ||
    (dEnd || null) !== (assignment.end_date ?? null);
  const canSave =
    changed && !!rationale.trim() && !dOutside && !overCapacity &&
    !beforeEmployment && !activeFuture && !(cannotPropose && commit === "proposed");

  const summary = activeFuture
    ? "Active assignments cannot start in the future."
    : cannotPropose && commit === "proposed"
      ? "A started commitment cannot return to proposed."
      : !changed
        ? "Adjust a field to save."
        : !rationale.trim()
          ? "A change rationale is required."
          : dOutside
            ? `Dates must sit inside this line's billing period (${shortDate(windowStart)} → ${shortDate(windowEnd)}).`
            : beforeEmployment
              ? "The start precedes this person's employment."
              : overCapacity
                ? "This would exceed 100% capacity on these dates."
                : `Saves ${alloc}% · ${STATUS_LABEL[commit]} · ${shortDate(dStart)} → ${shortDate(dEnd)}`;

  async function save() {
    if (!canSave || saving) return;
    setSaving(true);
    setError("");
    try {
      await executeCommand({
        kind: "update_assignment",
        assignment_id: assignment.id,
        expected_version: assignment.version,
        position: assignment.position,
        pricing_line: assignment.pricing_line,
        allocation_pct: alloc,
        start_date: dStart,
        end_date: dEnd || null,
        status: commit,
        rationale: rationale.trim(),
      });
      onChanged();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3.5 rounded-lg border border-dashed border-border p-3.5"
      data-save-scope
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <FieldCaption id={`pjs-edit-alloc-${assignment.id}`}>Allocation</FieldCaption>
          <ToggleGroup
            className="w-full"
            aria-labelledby={`pjs-edit-alloc-${assignment.id}`}
            value={[String(alloc)]}
            onValueChange={(v) => {
              if (v[0]) setAlloc(Number(v[0]));
            }}
          >
            {allocOptions.map((v) => (
              <ToggleGroupItem key={v} value={String(v)} className="num flex-1">
                {v}%
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldCaption id={`pjs-edit-commit-${assignment.id}`}>Commitment</FieldCaption>
          <ToggleGroup
            className="w-full"
            aria-labelledby={`pjs-edit-commit-${assignment.id}`}
            value={[commit]}
            onValueChange={(v) => {
              const next = COMMIT_STATUSES.find((s) => s === v[0]);
              if (next) setCommit(next);
            }}
          >
            {COMMIT_STATUSES.map((s) => {
              const disabled =
                (cannotPropose && s === "proposed") ||
                (s === "active" && dStart > today);
              return (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className="flex-1"
                  disabled={disabled}
                  title={
                    cannotPropose && s === "proposed"
                      ? "A started commitment cannot return to proposed"
                      : s === "active" && dStart > today
                        ? "Active assignments cannot start in the future"
                        : undefined
                  }
                >
                  {STATUS_LABEL[s]}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      </div>

      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-2">
          <FieldCaption>From</FieldCaption>
          <DateField
            aria-label="Assignment start"
            value={dStart}
            min={[windowStart, employmentStart].filter(Boolean).sort().pop()}
            max={windowEnd}
            onChange={(v) => setDStart(v)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          <FieldCaption>To</FieldCaption>
          <DateField
            aria-label="Assignment end"
            value={dEnd}
            min={dStart || windowStart}
            max={windowEnd}
            onChange={(v) => setDEnd(v)}
          />
        </label>
      </div>

      <label className="flex min-w-0 flex-col gap-2">
        <FieldCaption>Change rationale</FieldCaption>
        <Textarea
          className="min-h-16 text-sm md:text-sm"
          maxLength={5000}
          placeholder="Why is this changing?"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <PanelFoot summary={summary}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={onClose}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!canSave || saving}
          data-save-shortcut
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </PanelFoot>
    </div>
  );
}

/**
 * Sidebar card — everyone staffed on the contract, one row per open or completed
 * assignment, plus the days no one covers yet.
 */
export function ProjectTeamCard({
  team,
  unstaffedDays,
}: {
  team: {
    employeeId: string;
    name: string;
    line: string;
    alloc: number;
    period: string;
    status: string;
  }[];
  unstaffedDays: number;
}) {
  return (
    <Card size="sm" role="region" aria-label="Team on this contract">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Team on this contract
        </CardTitle>
        <CardAction className="num text-[13px] text-muted-foreground">
          {team.length} {team.length === 1 ? "person" : "people"}
        </CardAction>
      </CardHeader>
      <CardContent>
        {team.length === 0 ? (
          <p className="m-0 text-[13px] text-muted-foreground">
            No one staffed yet. Use “Assign people” on a pricing line — they'll
            get the project on their CRA from their start date.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {team.map((t, i) => (
              <li
                className="flex min-w-0 items-center gap-2.5 rounded-lg bg-muted/60 px-2.5 py-2"
                key={`${t.employeeId}-${t.line}-${i}`}
              >
                <Initials name={t.name} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[13px] font-medium">{t.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      t.line,
                      `${t.alloc}%`,
                      t.period,
                      STATUS_LABEL[t.status] || t.status,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2 text-[13px] text-muted-foreground">
        <span>Unstaffed days</span>
        <strong className="num font-medium text-foreground">
          {fmtDays(Math.round(unstaffedDays * 10) / 10)}
        </strong>
      </CardFooter>
    </Card>
  );
}
