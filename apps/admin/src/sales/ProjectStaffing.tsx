import { useMemo, useState } from "react";
import { Pencil, Search, UserPlus, X } from "lucide-react";
import {
  errorMessage,
  executeCommand,
  type Assignment,
} from "../hr/data";
import { DateField } from "../DateField";
import { money } from "./data";
import { cappedBillableDays } from "./billable-cap";
import { lineDays, openDaysBetween, type PricingLine } from "./pricing-lines";
import "./project-staffing.css";

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

  async function unassign(a: Assignment) {
    if (saving) return;
    const name = personNameByEmployee.get(a.employee_id) || "This person";
    const started = a.start_date <= today;
    if (
      !confirm(
        started
          ? `End ${name}'s assignment on “${line.name}” as of today?`
          : `Release ${name}'s ${a.status === "proposed" ? "proposal" : "reservation"} on “${line.name}”?`,
      )
    )
      return;
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

  return (
    <div className="pjs">
      <div className="pjs-head">
        <div className="pjs-head-left">
          <span className="pjs-title">Staffing</span>
          <span
            className="pjs-bar"
            role="progressbar"
            aria-label={`${line.name || "Profile"} staffed days`}
            aria-valuenow={staffing.coverPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${staffing.coverPct}%` }} />
          </span>
          <span className="pjs-cover">
            {fmtDays(Math.min(staffing.staffedDays, staffing.days))} of{" "}
            {fmtDays(staffing.days)} days staffed · {staffing.coverPct}%
          </span>
          {staffing.capped && (
            <span
              className="pjs-tag soft"
              title="Billable days are limited by the line's yearly cap"
            >
              Capped
            </span>
          )}
        </div>
        <button
          type="button"
          className={`pjs-toggle${open ? " on" : ""}`}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setError("");
          }}
        >
          <UserPlus size={15} aria-hidden="true" />
          {open ? "Close" : "Assign people"}
        </button>
      </div>

      {error && (
        <p className="pjs-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="pjs-notice" role="status">
          {notice}
        </p>
      )}

      {staffing.staff.length > 0 && (
        <ul className="pjs-list">
          {staffing.staff.map((a) => {
            const name = personNameByEmployee.get(a.employee_id) || "Person";
            const days =
              staffing.start && staffing.end
                ? assignmentLineDays(a, staffing.start, staffing.end)
                : 0;
            return (
              <li className="pjs-item" key={a.id}>
                <div className="pjs-row">
                  <span className="pjs-ava" aria-hidden="true">
                    {initialsOf(name)}
                  </span>
                  <span className="pjs-name">{name}</span>
                  <span className="pjs-meta">{a.allocation_pct}%</span>
                  <span className="pjs-meta">
                    {shortDate(a.start_date)} →{" "}
                    {a.end_date ? shortDate(a.end_date) : "open"}
                  </span>
                  <span className="pjs-meta">{fmtDays(Math.round(days * 10) / 10)} days</span>
                  <span
                    className={`pjs-tag${a.status === "reserved" || a.status === "proposed" ? " soft" : ""}`}
                  >
                    {STATUS_LABEL[a.status] || a.status}
                  </span>
                  {isOpenAssignment(a) && (
                  <span className="pjs-row-actions">
                    <button
                      type="button"
                      className="pjs-edit"
                      aria-label={`Edit ${name}'s assignment`}
                      aria-expanded={editId === a.id}
                      title="Edit allocation, commitment or dates"
                      disabled={saving}
                      onClick={() => setEditId(editId === a.id ? "" : a.id)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="pjs-remove"
                      aria-label={`Unassign ${name}`}
                      title={
                        a.start_date <= today
                          ? "End the assignment"
                          : "Release the reservation"
                      }
                      disabled={saving}
                      onClick={() => void unassign(a)}
                    >
                      <X size={14} />
                    </button>
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
        <p className="pjs-empty">
          Nobody is staffed on this line yet — its days won't appear on
          anyone's CRA.
        </p>
      )}

      {open && (
        <div className="pjs-panel">
          <div className="pjs-field">
            <span className="pjs-label">Who</span>
            <span className="pjs-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="text"
                aria-label="Search people"
                placeholder="Search people…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
            <div className="pjs-people">
              {candidates.length === 0 && (
                <p className="pjs-empty">No one matches this search.</p>
              )}
              {candidates.map((p) => {
                const selected = p.employeeId === employeeId;
                return (
                  <button
                    key={p.employeeId}
                    type="button"
                    aria-pressed={selected}
                    className={`pjs-person${selected ? " on" : ""}`}
                    onClick={() => {
                      setEmployeeId(p.employeeId);
                      setEngageId("");
                    }}
                  >
                    <span className="pjs-ava" aria-hidden="true">
                      {initialsOf(p.name)}
                    </span>
                    <span className="pjs-person-text">
                      <span className="pjs-name">{p.name}</span>
                      <span className="pjs-person-sub">
                        {p.onLine
                          ? "Already on this line"
                          : p.free <= 0
                            ? "Fully booked"
                            : `${p.free}% free`}
                      </span>
                    </span>
                    <span className="pjs-free" aria-hidden="true">
                      <span style={{ width: `${p.free}%` }} />
                    </span>
                  </button>
                );
              })}
              {canEngage && talentMatches.length > 0 && (
                <>
                  <p className="pjs-pool-label">
                    Talent pool — engage without an application
                  </p>
                  {talentMatches.map((tp) => {
                    const selected = tp.personId === engageId;
                    return (
                      <button
                        key={tp.personId}
                        type="button"
                        aria-pressed={selected}
                        className={`pjs-person${selected ? " on" : ""}`}
                        onClick={() => {
                          setEngageId(tp.personId);
                          setEmployeeId("");
                        }}
                      >
                        <span className="pjs-ava" aria-hidden="true">
                          {initialsOf(tp.name)}
                        </span>
                        <span className="pjs-person-text">
                          <span className="pjs-name">{tp.name}</span>
                          <span className="pjs-person-sub">
                            Not employed yet — engagement is created with this
                            assignment
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <div className="pjs-grid">
            <div className="pjs-field">
              <span className="pjs-label" id={`pjs-alloc-${line.name}`}>
                Allocation
              </span>
              <div
                className="pj-seg"
                role="group"
                aria-labelledby={`pjs-alloc-${line.name}`}
              >
                {ALLOC_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={alloc === v}
                    className={alloc === v ? "on" : ""}
                    onClick={() => setAlloc(v)}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            </div>
            <div className="pjs-field">
              <span className="pjs-label" id={`pjs-commit-${line.name}`}>
                Commitment
              </span>
              <div
                className="pj-seg"
                role="group"
                aria-labelledby={`pjs-commit-${line.name}`}
              >
                <button
                  type="button"
                  aria-pressed={commit === "confirmed"}
                  className={commit === "confirmed" ? "on" : ""}
                  onClick={() => setCommit("confirmed")}
                >
                  Confirmed
                </button>
                <button
                  type="button"
                  aria-pressed={commit === "reserved"}
                  className={commit === "reserved" ? "on" : ""}
                  onClick={() => setCommit("reserved")}
                >
                  Tentative
                </button>
              </div>
            </div>
          </div>

          <div className="pjs-dates">
            <label className="pjs-field">
              <span className="pjs-label">From</span>
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
            <label className="pjs-field">
              <span className="pjs-label">To</span>
              <DateField
                aria-label="Assignment end"
                value={dEnd}
                min={dStart || staffing.start}
                max={staffing.end}
                onChange={(v) => setDEnd(v)}
              />
            </label>
            <div className="pjs-quick">
              <button
                type="button"
                className="pjs-chip-btn"
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
              </button>
              <button
                type="button"
                className="pjs-chip-btn"
                onClick={() => {
                  setDStart(staffing.start);
                  setDEnd(staffing.end);
                }}
              >
                Whole line
              </button>
            </div>
          </div>

          {pickedPool && (
            <div className="pjs-grid pjs-engage">
              <label className="pjs-field">
                <span className="pjs-label">Engagement role</span>
                <input
                  type="text"
                  value={engageRole}
                  onChange={(e) => setEngageRole(e.target.value)}
                  placeholder={line.name || "Role"}
                />
              </label>
              <label className="pjs-field">
                <span className="pjs-label">Contract</span>
                <select
                  value={engageContract}
                  onChange={(e) => setEngageContract(e.target.value)}
                >
                  {["Freelance", "CDI", "CDD", "Internship", "Apprenticeship"].map(
                    (c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
          )}

          {dOutside && (
            <p className="pjs-alert" role="alert">
              Dates must sit inside this line's billing period (
              {shortDate(staffing.start)} → {shortDate(staffing.end)}).
            </p>
          )}

          <div className="pjs-foot">
            <span className="pjs-summary">{draftSummary}</span>
            <span className="pjs-actions">
              <button
                type="button"
                className="pjs-cancel"
                onClick={() => {
                  setOpen(false);
                  setError("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pjs-assign"
                disabled={!canAssign || saving}
                onClick={() => void assign()}
              >
                {saving
                  ? "Saving…"
                  : pickedPool
                    ? `Engage & staff ${pickedPool.name.split(" ")[0]}`
                    : `Assign ${picked ? picked.name.split(" ")[0] : "…"}`}
              </button>
            </span>
          </div>
        </div>
      )}
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
    <div className="pjs-panel pjs-edit-form" data-save-scope>
      <div className="pjs-grid">
        <div className="pjs-field">
          <span className="pjs-label" id={`pjs-edit-alloc-${assignment.id}`}>
            Allocation
          </span>
          <div
            className="pj-seg"
            role="group"
            aria-labelledby={`pjs-edit-alloc-${assignment.id}`}
          >
            {allocOptions.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={alloc === v}
                className={alloc === v ? "on" : ""}
                onClick={() => setAlloc(v)}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>
        <div className="pjs-field">
          <span className="pjs-label" id={`pjs-edit-commit-${assignment.id}`}>
            Commitment
          </span>
          <div
            className="pj-seg"
            role="group"
            aria-labelledby={`pjs-edit-commit-${assignment.id}`}
          >
            {COMMIT_STATUSES.map((s) => {
              const disabled =
                (cannotPropose && s === "proposed") ||
                (s === "active" && dStart > today);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={commit === s}
                  className={commit === s ? "on" : ""}
                  disabled={disabled}
                  title={
                    cannotPropose && s === "proposed"
                      ? "A started commitment cannot return to proposed"
                      : s === "active" && dStart > today
                        ? "Active assignments cannot start in the future"
                        : undefined
                  }
                  onClick={() => setCommit(s)}
                >
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="pjs-dates">
        <label className="pjs-field">
          <span className="pjs-label">From</span>
          <DateField
            aria-label="Assignment start"
            value={dStart}
            min={[windowStart, employmentStart].filter(Boolean).sort().pop()}
            max={windowEnd}
            onChange={(v) => setDStart(v)}
          />
        </label>
        <label className="pjs-field">
          <span className="pjs-label">To</span>
          <DateField
            aria-label="Assignment end"
            value={dEnd}
            min={dStart || windowStart}
            max={windowEnd}
            onChange={(v) => setDEnd(v)}
          />
        </label>
      </div>

      <label className="pjs-field">
        <span className="pjs-label">Change rationale</span>
        <textarea
          className="pjs-rationale"
          rows={2}
          maxLength={5000}
          placeholder="Why is this changing?"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>

      {error && (
        <p className="pjs-alert" role="alert">
          {error}
        </p>
      )}

      <div className="pjs-foot">
        <span className="pjs-summary">{summary}</span>
        <span className="pjs-actions">
          <button
            type="button"
            className="pjs-cancel"
            disabled={saving}
            onClick={onClose}
          >
            Discard
          </button>
          <button
            type="button"
            className="pjs-assign"
            disabled={!canSave || saving}
            data-save-shortcut
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </span>
      </div>
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
    <section className="pj-card pj-team">
      <div className="pj-card-head">
        <h2 className="pj-card-title">Team on this contract</h2>
        <span className="pj-team-count">
          {team.length} {team.length === 1 ? "person" : "people"}
        </span>
      </div>
      {team.length === 0 ? (
        <p className="pjs-empty">
          No one staffed yet. Use “Assign people” on a pricing line — they'll
          get the project on their CRA from their start date.
        </p>
      ) : (
        <ul className="pjs-list">
          {team.map((t, i) => (
            <li className="pjs-row" key={`${t.employeeId}-${t.line}-${i}`}>
              <span className="pjs-ava" aria-hidden="true">
                {initialsOf(t.name)}
              </span>
              <span className="pjs-person-text">
                <span className="pjs-name">{t.name}</span>
                <span className="pjs-person-sub">
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
      <div className="pj-team-foot">
        <span>Unstaffed days</span>
        <strong>{fmtDays(Math.round(unstaffedDays * 10) / 10)}</strong>
      </div>
    </section>
  );
}
