import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Lock, RefreshCw, Save, Search } from 'lucide-react';
import { Alert, AlertDescription, Button, Field, FieldLabel, InputGroup, InputGroupAddon, InputGroupInput } from '@quicksort-sas/ui';
import { cn } from 'cn';
import { errorMessage } from '@quicksort/hr-db';
import { z } from 'zod';
import { EmptyState, PageAlerts } from '../ui';
import { loadContext, loadMonth, saveMonth } from './data';
import { balanceFor, fmtDays, useLeaveBalances } from './balances';
import { assignedProjects, currentMonth, dayHalves, entrySchema, entryValue, listMonths, setDayPart, shiftMonth, monthDays, monthSchema, sortEntries, statusLabels, freelanceStatusLabels, isFreelance, withinEmployment, type StatusLabels, type ActivityValue, type Assignment, type Context, type Employee, type Entry, type Part, type Snapshot } from './domain';

function employeeIdFromPath() {
  // A standalone admin link pins the employee: /hr/cra/<id>[/yyyy/mm].
  const match = window.location.pathname.match(/^\/hr\/cra\/([^/]+)/);
  return match?.[1] ?? '';
}

const draftSchema = z.object({ version: z.number().int().nonnegative(), entries: entrySchema.array() });
function readDraft(key: string) {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return null;
    const parsed = draftSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
function storeDraft(key: string, value: z.infer<typeof draftSchema> | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

const DURATIONS: { id: Part; name: string; plural: string }[] = [
  { id: 'full', name: 'Full day', plural: 'full days' },
  { id: 'am', name: 'Morning', plural: 'mornings' },
  { id: 'pm', name: 'Afternoon', plural: 'afternoons' },
];

type Activity = 'client' | 'internal' | 'cp' | 'rtt' | 'css' | 'empty';
// Activity markers: client is a solid ink dot, internal a muted one, leaves
// are rings (unpaid dashed). Monochrome on purpose — the label carries the name.
const DOT: Record<Activity, string> = {
  client: 'bg-foreground',
  internal: 'bg-muted-foreground',
  cp: 'border-[1.5px] border-foreground',
  rtt: 'border-[1.5px] border-muted-foreground',
  css: 'border-[1.5px] border-dashed border-muted-foreground',
  empty: '',
};
function Dot({ kind, className }: { kind: Activity; className?: string }) {
  return <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', DOT[kind], className)} />;
}
/** Segmented control track and its items (duration radios, days-shown toggle). */
const SEG_TRACK = 'flex gap-0.5 rounded-lg bg-muted p-0.5';
const SEG_ITEM = 'h-8 min-w-0 flex-1 cursor-pointer truncate rounded-md px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm';

// Display helpers — short mono codes for the calendar cells and brush labels.
function activityClass(value: ActivityValue): Activity {
  if (value === 'internal') return 'internal';
  if (value === 'paid_leave') return 'cp';
  if (value === 'rtt') return 'rtt';
  if (value === 'unpaid_leave') return 'css';
  if (value.startsWith('project:')) return 'client';
  return 'empty';
}
// Short cell label: the client name for projects, the leave name otherwise
// (the design shows “BNP”, “Congés payés”, … next to a marker dot).
function activityLabel(value: ActivityValue, projects: Assignment[], labels: StatusLabels): string {
  if (!value) return '';
  if (value === 'internal') return labels.internal;
  if (value === 'paid_leave') return labels.paid_leave;
  if (value === 'rtt') return labels.rtt;
  if (value === 'unpaid_leave') return labels.unpaid_leave;
  const project = projects.find(item => `project:${item.project_id}` === value);
  return project?.client_name || labels.client_project;
}
function activityName(value: ActivityValue, projects: Assignment[], labels: StatusLabels): string {
  if (!value) return 'not filled';
  if (value === 'internal') return 'Internal';
  if (value === 'paid_leave') return labels.paid_leave;
  if (value === 'rtt') return labels.rtt;
  if (value === 'unpaid_leave') return labels.unpaid_leave;
  const project = projects.find(item => `project:${item.project_id}` === value);
  return project ? `Client Project ${project.title} (${project.client_name})` : 'Client Project';
}

export function CraScreen({ audience, draftOwner, linkBase, fixedEmployeeId, basePath }: { audience: 'admin' | 'employee'; draftOwner: string; linkBase?: string; fixedEmployeeId?: string; basePath?: string }) {
  // Shareable selection links: standalone screens use the /hr/cra/<id> path,
  // embedded screens (People view) keep the current page and store the id in
  // the ?cra= query parameter. A record-level embedding pins one employee and
  // leaves the address bar alone.
  const manageUrl = audience === 'admin' && !fixedEmployeeId;
  // The viewed month and year always travel in the URL so every month is its
  // own shareable page: /cra/2026/10 on the employee portal, /hr/cra/<id>/2026/10
  // on a standalone admin screen, <basePath>/2026/10 for embeds that opt in
  // (the person record's CRA tab). Query-based embeds keep ?month=YYYY-MM;
  // dialogs without a basePath leave the address bar untouched.
  const syncUrl = !!basePath || manageUrl;
  const location = useLocation();
  const navigate = useNavigate();
  const pathMonth = !!basePath || (manageUrl && !linkBase);
  const readSharedId = () => {
    if (!manageUrl) return '';
    if (linkBase) return new URLSearchParams(window.location.search).get('cra') ?? '';
    return employeeIdFromPath();
  };
  const monthPath = (value: string) => `/${value.slice(0, 4)}/${value.slice(5)}`;
  const shareLink = (id: string, value: string) => linkBase
    ? `${linkBase}&cra=${id}&month=${value}`
    : `${basePath ?? `/hr/cra/${id}`}${monthPath(value)}`;
  const readPathMonth = () => {
    if (!pathMonth) return '';
    const pattern = basePath
      ? new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(\\d{4})/(0[1-9]|1[0-2])/?$`)
      : /^\/hr\/cra\/[^/]+\/(\d{4})\/(0[1-9]|1[0-2])\/?$/;
    const match = window.location.pathname.match(pattern);
    return match ? `${match[1]}-${match[2]}` : '';
  };
  const readQueryMonth = () => {
    const value = new URLSearchParams(window.location.search).get('month');
    return value && monthSchema.safeParse(value).success ? value : '';
  };
  const [context, setContext] = useState<Context | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  // A month path (/cra/2026/10) or a legacy ?month=YYYY-MM deep link opens
  // that month directly; otherwise the page opens on the current month.
  const [month, setMonthState] = useState(() => readPathMonth() || readQueryMonth() || currentMonth());
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(''); setContext(null);
    void loadContext().then(result => {
      if (cancelled) return;
      setContext(result);
      setEmployeeId(previous => {
        // A shared link wins over any stored choice; a record embedding always
        // pins its own employee.
        if (fixedEmployeeId) return result.employees.some(employee => employee.id === fixedEmployeeId) ? fixedEmployeeId : '';
        const fromLink = manageUrl ? readSharedId() : '';
        if (fromLink && result.employees.some(employee => employee.id === fromLink)) return fromLink;
        return result.employees.some(employee => employee.id === previous) ? previous : result.employees[0]?.id || '';
      });
    }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [retry, audience]);
  // Browser back/forward (or a colleague opening a shared link) moves the URL:
  // follow it as long as the id matches a known employee record. A bare path
  // without a month means the current month.
  // Runs only when the URL actually moves (not on mount, where the initial
  // state already came from it, so a legacy ?month= link folds in intact).
  const contextRef = useRef(context);
  contextRef.current = context;
  const seenUrl = useRef(location.pathname + location.search);
  useEffect(() => {
    const url = location.pathname + location.search;
    if (seenUrl.current === url) return;
    seenUrl.current = url;
    if (!syncUrl) return;
    const fromLink = readSharedId();
    if (fromLink) setEmployeeId(previous => contextRef.current?.employees.some(employee => employee.id === fromLink) ? fromLink : previous);
    const fromUrl = pathMonth ? readPathMonth() : readQueryMonth();
    if (linkBase) { if (fromUrl) setMonthState(fromUrl); }
    else setMonthState(fromUrl || currentMonth());
  }, [location.pathname, location.search]);
  function selectEmployee(id: string) {
    setEmployeeId(id);
    // Keep the URL shareable: picking someone turns the address bar into
    // the link HR can send to open this exact CRA month.
    if (manageUrl && readSharedId() !== id) navigate(shareLink(id, month));
  }
  // Reflect the resolved employee and the viewed month in the address bar
  // (replace: no extra history entry) so copying the URL always yields a
  // working shared link; legacy ?month= deep links fold into the path here.
  useEffect(() => {
    if (!syncUrl || !context || !employeeId) return;
    const target = shareLink(fixedEmployeeId || employeeId, month);
    if (window.location.pathname + window.location.search !== target) navigate(target, { replace: true });
  }, [syncUrl, pathMonth, linkBase, basePath, context, employeeId, fixedEmployeeId, month]);
  function changeMonth(next: string) {
    setMonthState(next);
    if (!syncUrl) return;
    // One history entry per month: the address bar always holds a shareable
    // link and the back button steps through the visited months.
    const target = shareLink(fixedEmployeeId || employeeId, next);
    if (window.location.pathname + window.location.search !== target) navigate(target);
  }
  const employee = context?.employees.find(item => item.id === (fixedEmployeeId || employeeId));
  const monthChoices = useMemo(() => {
    const earliest = context?.employees.reduce<string | undefined>((min, item) => !min || item.start_date < min ? item.start_date : min, undefined);
    return listMonths(earliest ? earliest.slice(0, 7) : shiftMonth(currentMonth(), -11), shiftMonth(currentMonth(), 3));
  }, [context]);
  // Arrow keys step through months the same way the month pills do — handy
  // when reviewing a long history. Ignored while typing or holding a modifier
  // (Shift+Arrows is text selection, Ctrl/Alt+Arrows is browser tab switching).
  useEffect(() => {
    const step = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = shiftMonth(month, delta);
      if (monthChoices.includes(next)) changeMonth(next);
    };
    window.addEventListener('keydown', step);
    return () => window.removeEventListener('keydown', step);
  });
  return <section className="@container flex min-w-0 flex-col gap-6 tabular-nums">
    {error && <div className="flex flex-col items-start gap-3">
      <PageAlerts error={error} />
      <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Retry loading CRA</Button>
    </div>}
    {!context && !error && <p className="m-0 text-sm text-muted-foreground" role="status">Loading CRA…</p>}
    {context && !context.employees.length && <EmptyState title="No employee record linked">{audience === 'admin' ? 'Create an employment record in HR before filling a CRA.' : 'Ask HR to link your account to your employee record.'}</EmptyState>}
    {context && employee && <>
      {!fixedEmployeeId && <Field className="max-w-xl gap-1.5">
        <FieldLabel htmlFor="cra-employee">Employee</FieldLabel>
        <EmployeePicker employees={context.employees} selectedId={employeeId} onSelect={selectEmployee} />
      </Field>}
      <MonthEditor key={`${employeeId}:${month}`} employee={employee} month={month} months={monthChoices} onMonth={changeMonth} assignments={context.assignments} draftOwner={draftOwner} audience={audience} />
    </>}
  </section>;
}

function EmployeePicker({ employees, selectedId, onSelect }: { employees: Employee[]; selectedId: string; onSelect: (id: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selected = employees.find(employee => employee.id === selectedId);
  const results = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return employees.filter(employee => [employee.full_name, employee.role, employee.start_date].some(value => value.toLocaleLowerCase().includes(search))).slice(0, 8);
  }, [employees, query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  function choose(employeeId: string) {
    onSelect(employeeId);
    setOpen(false);
    setQuery('');
  }

  return <div className="relative min-w-0" ref={rootRef}>
    <InputGroup>
    <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
    <InputGroupInput
      id="cra-employee"
      type="search"
      role="combobox"
      aria-label="Employee"
      aria-autocomplete="list"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls="cra-employee-options"
      aria-activedescendant={open && results[highlight] ? `cra-employee-option-${results[highlight].id}` : undefined}
      autoComplete="off"
      placeholder="Search employees…"
      value={open ? query : selected ? `${selected.full_name} · ${selected.role || 'Employee'}` : ''}
      onFocus={() => { setQuery(''); setHighlight(0); setOpen(true); }}
      onChange={event => { setQuery(event.target.value); setHighlight(0); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation(); setOpen(false); setQuery('');
        } else if (event.key === 'ArrowDown' && results.length) {
          event.preventDefault(); setHighlight(index => Math.min(index + 1, results.length - 1));
        } else if (event.key === 'ArrowUp' && results.length) {
          event.preventDefault(); setHighlight(index => Math.max(index - 1, 0));
        } else if (event.key === 'Enter' && open && results[highlight]) {
          event.preventDefault(); choose(results[highlight].id);
        }
      }}
    />
    </InputGroup>
    {open && <ul className="absolute inset-x-0 top-full z-30 m-0 mt-1 max-h-[min(320px,50vh)] list-none overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg" id="cra-employee-options" role="listbox" aria-label="Employees">
      {results.length ? results.map((employee, index) => <li key={employee.id}>
        <button id={`cra-employee-option-${employee.id}`} type="button" role="option" aria-selected={employee.id === selectedId}
          className={cn('flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:font-medium', index === highlight && 'bg-accent')}
          onPointerMove={() => setHighlight(index)} onClick={() => choose(employee.id)}>
          <span>{employee.full_name}</span><small className="text-xs font-normal text-muted-foreground">{employee.role || 'Employee'} · Started {employee.start_date}</small>
        </button>
      </li>) : <li className="px-3 py-2.5 text-xs text-muted-foreground" role="status">No employees match “{query}”.</li>}
    </ul>}
  </div>;
}

const MONTH_WINDOW = 6;

type Cell = {
  iso: string;
  num: number;
  inMonth: boolean;
  weekend: boolean;
  holiday: string | null;
  locked: boolean;
  out: boolean;
};

function MonthEditor({ employee, month, months, onMonth, assignments, draftOwner, audience }: { employee: Employee; month: string; months: string[]; onMonth: (month: string) => void; assignments: Assignment[]; draftOwner: string; audience: 'admin' | 'employee' }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [duration, setDuration] = useState<Part>('full');
  const [weekends, setWeekends] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [draftStored, setDraftStored] = useState(true);
  // Same strip for HR and the employee portal: everyone sees the same
  // remaining CP/RTT days, net of everything consumed so far.
  // Freelancers accrue no CP/RTT: no balance strip, a single Absence brush.
  const freelance = isFreelance(employee);
  const labels = freelance ? freelanceStatusLabels : statusLabels;
  const { balances, error: balanceError } = useLeaveBalances([employee.id]);
  const cpLeft = balanceFor(balances, employee.id, 'cp');
  const rttLeft = balanceFor(balances, employee.id, 'rtt');
  const dragRef = useRef<{ add: boolean } | null>(null);
  const anchorRef = useRef<string | null>(null);
  const draftKey = `quicksort:cra:${draftOwner}:${employee.id}:${month}`;
  const days = monthDays(month);
  const dayInfo = useMemo(() => new Map(days.map(day => [day.day, day])), [days]);
  // A validated invoice covers this consultant-month: consultants are locked
  // out (the server enforces it too), admin/HR get a warning and keep editing.
  const invoiced = !!snapshot?.invoiced;
  const invoiceLocked = invoiced && audience === 'employee';
  const dirty = !!snapshot && JSON.stringify(entries) !== JSON.stringify(snapshot.entries);
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  // Six-month window strip (design): the viewed month sits near the middle,
  // the round buttons slide the window. Remounts on month change re-center it.
  const monthIndex = months.indexOf(month);
  const [windowStart, setWindowStart] = useState(() => Math.max(0, Math.min(monthIndex < 0 ? 0 : monthIndex - 2, Math.max(0, months.length - MONTH_WINDOW))));
  // Tallies for the other visible months, fetched on demand so every pill can
  // say “Complete” (or its partial count) — the viewed month uses live data.
  const [monthTallies, setMonthTallies] = useState<Record<string, { filled: number; workdays: number }>>({});
  useEffect(() => {
    let cancelled = false;
    for (const choice of months.slice(windowStart, windowStart + MONTH_WINDOW)) {
      if (choice === month || monthTallies[choice]) continue;
      void loadMonth(employee.id, choice).then(snapshot => {
        if (cancelled) return;
        const days = monthDays(choice);
        let filled = 0;
        for (const entry of snapshot.entries) {
          const info = days.find(day => day.day === entry.day);
          if (!info || info.weekend || info.holiday) continue;
          filled += entry.part === 'full' ? 1 : 0.5;
        }
        const workdays = days.filter(day => !day.weekend && !day.holiday).length;
        setMonthTallies(previous => previous[choice] ? previous : { ...previous, [choice]: { filled, workdays } });
      }).catch(() => { /* Unknown months stay neutral. */ });
    }
    return () => { cancelled = true; };
  }, [windowStart, months, month, employee]);

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null); setError(''); setMessage('');
    void loadMonth(employee.id, month).then(result => {
      if (cancelled) return;
      const draft = readDraft(draftKey);
      setSnapshot(result); setEntries(draft?.entries || result.entries); setVersion(draft?.version ?? result.version);
      if (draft) setMessage(draft.version === result.version ? 'Unsaved draft restored from this browser.' : 'Your draft was restored, but another person has saved this month. Discard the draft and reload before editing.');
    }).catch(error => { if (!cancelled) setError(errorMessage(error)); });
    return () => { cancelled = true; };
  }, [employee.id, month, draftKey, reload]);
  useEffect(() => {
    if (!dirty || draftStored) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, draftStored]);
  // Releasing the pointer anywhere (even outside the grid) ends a drag-select.
  useEffect(() => {
    const end = () => { dragRef.current = null; };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, []);

  function changeEntries(next: Entry[]) {
    const sorted = sortEntries(next);
    setEntries(sorted); setMessage(''); setError('');
    setDraftStored(storeDraft(draftKey, JSON.stringify(sorted) === JSON.stringify(snapshot?.entries) ? null : { version, entries: sorted }));
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await saveMonth({ employeeId: employee.id, month, version, entries });
      setSnapshot(result); setEntries(result.entries); setVersion(result.version); storeDraft(draftKey, null);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  function discard() { storeDraft(draftKey, null); setReload(value => value + 1); }

  const workdays = days.filter(day => !day.weekend && !day.holiday);
  const holidayCount = days.filter(day => day.holiday).length;
  // Grid: Monday-first weeks from the Monday on/before the 1st to the last
  // displayed weekday of the month. Weekends join the grid only when the
  // toggle is on (or when they already hold an entry, which stays editable).
  const cells = useMemo(() => {
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5)) - 1;
    const first = new Date(year, monthIndex, 1);
    const last = new Date(year, monthIndex + 1, 0);
    const mondayOffset = (first.getDay() + 6) % 7;
    const lastWeekday = (last.getDay() + 6) % 7;
    const endPadding = weekends ? 6 - lastWeekday : 4 - lastWeekday;
    const grid: Cell[] = [];
    for (let cursor = new Date(year, monthIndex, 1 - mondayOffset), end = new Date(year, monthIndex, last.getDate() + endPadding); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const info = dayInfo.get(iso);
      const weekend = !info ? [0, 6].includes(cursor.getDay()) : info.weekend;
      if (weekend && !weekends && !entries.some(entry => entry.day === iso)) continue;
      const inMonth = cursor.getMonth() === monthIndex;
      const holiday = inMonth ? info?.holiday ?? null : null;
      const out = !inMonth;
      const locked = out || !!holiday || !withinEmployment(employee, iso);
      grid.push({ iso, num: cursor.getDate(), inMonth, weekend, holiday, locked, out });
    }
    return grid;
  }, [month, weekends, entries, dayInfo, employee]);
  const selectable = useMemo(() => new Set(cells.filter(cell => !cell.locked).map(cell => cell.iso)), [cells]);
  const columns = weekends ? 7 : 5;

  function toggleDay(iso: string) {
    setSelected(previous => previous.includes(iso) ? previous.filter(day => day !== iso) : [...previous, iso]);
    anchorRef.current = iso;
  }
  function pressDay(iso: string, event: React.MouseEvent) {
    if (event.button !== 0) return;
    if (event.shiftKey && anchorRef.current) {
      const [from, to] = [anchorRef.current, iso].sort();
      const range = cells.filter(cell => !cell.locked && cell.iso >= from && cell.iso <= to).map(cell => cell.iso);
      setSelected(previous => Array.from(new Set([...previous, ...range])));
      return;
    }
    const add = !selected.includes(iso);
    setSelected(previous => add ? [...previous, iso] : previous.filter(day => day !== iso));
    anchorRef.current = iso;
    dragRef.current = { add };
  }
  function dragDay(iso: string) {
    const drag = dragRef.current;
    if (!drag) return;
    setSelected(previous => drag.add ? (previous.includes(iso) ? previous : [...previous, iso]) : previous.filter(day => day !== iso));
  }
  function keyToggle(iso: string) {
    // Keyboard activation (detail 0) — pointer presses already toggled on mouse down.
    toggleDay(iso);
  }

  // Brushes list every project the employee is assigned to (confirmed, active
  // or completed) — even outside the viewed month — so it can always be
  // picked. Applying still respects assignment dates day by day.
  const employeeProjects = assignments.filter(assignment => assignment.employee_id === employee.id && ['confirmed', 'active', 'completed'].includes(assignment.status))
    .filter((assignment, index, all) => all.findIndex(item => item.project_id === assignment.project_id) === index);
  const monthProjects = employeeProjects.filter(assignment => days.some(day => day.day >= assignment.start_date && (!assignment.end_date || day.day <= assignment.end_date)));
  const defaultProject = monthProjects.find(assignment => ['active', 'confirmed'].includes(assignment.status)) ?? monthProjects[0];
  const projectBrushes = employeeProjects.map(assignment => ({ value: `project:${assignment.project_id}` as ActivityValue, label: assignment.client_name, sub: `Client project · ${assignment.title}`, cls: 'client' }));
  const plainBrushes: { value: ActivityValue; label: string; sub: string; cls: string }[] = [
    { value: 'internal', label: labels.internal, sub: 'Non-billable', cls: 'internal' },
    ...(freelance ? [
      { value: 'unpaid_leave' as const, label: labels.unpaid_leave, sub: 'Not worked, not billed', cls: 'css' },
    ] : [
      { value: 'paid_leave' as const, label: labels.paid_leave, sub: 'Paid leave', cls: 'cp' },
      { value: 'rtt' as const, label: labels.rtt, sub: 'Reduced working time', cls: 'rtt' },
      { value: 'unpaid_leave' as const, label: labels.unpaid_leave, sub: 'Unpaid leave', cls: 'css' },
    ]),
  ];

  // Weights count a full day as 1 and a half day as 0.5. Weekends and public
  // holidays never count towards the month total.
  const partWeight = (part: Part) => part === 'full' ? 1 : 0.5;
  const valueCounts = new Map<ActivityValue, number>();
  const counts: Record<string, number> = {};
  let filled = 0;
  for (const entry of entries) {
    const info = dayInfo.get(entry.day);
    if (!info || info.weekend || info.holiday) continue;
    const weight = partWeight(entry.part);
    filled += weight;
    const key = entry.status === 'client_project' ? 'client_project' : entry.status;
    counts[key] = (counts[key] ?? 0) + weight;
    // Per-activity tally drives the counts on the apply-panel rows.
    const value = entryValue(entry);
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + weight);
  }
  const remaining = Math.max(0, workdays.length - filled);
  const breakdown = Object.entries(counts).filter(([, amount]) => amount > 0)
    .map(([status, amount]) => `${labels[status as keyof StatusLabels]} ${fmtDays(amount)}`)
    .join(' · ');
  const invalidDays = entries.filter(entry => entry.status === 'client_project' && !assignedProjects(assignments, employee.id, entry.day).some(project => project.project_id === entry.project_id));

  function applyBrush(value: ActivityValue, label: string) {
    let next = entries;
    let applied = 0;
    let skipped = 0;
    for (const iso of selected) {
      if (value.startsWith('project:') && !assignedProjects(assignments, employee.id, iso).some(project => `project:${project.project_id}` === value)) { skipped++; continue; }
      next = setDayPart(next, iso, duration, value);
      applied++;
    }
    changeEntries(next);
    setSelected([]); anchorRef.current = null;
    const plural = DURATIONS.find(item => item.id === duration)?.plural ?? 'days';
    const units = applied === 1 ? plural.replace(/s$/, '') : plural;
    setMessage(applied ? (value ? `${applied} ${units} set to ${label}${skipped ? ` · ${skipped} skipped (project not assigned on those dates)` : ''}.` : `${applied} ${units} cleared.`) : 'No days updated — the project is not assigned on the selected dates.');
  }
  function selectEmpty() {
    const empty: string[] = [];
    for (const cell of cells) {
      if (cell.locked) continue;
      const halves = dayHalves(entries, cell.iso);
      if (!(halves.am && halves.pm)) empty.push(cell.iso);
    }
    setSelected(empty);
    anchorRef.current = null;
  }
  function fillDefault() {
    if (!defaultProject) return;
    const value = `project:${defaultProject.project_id}` as ActivityValue;
    let next = entries;
    let added = 0;
    for (const { day } of workdays) {
      if (!withinEmployment(employee, day)) continue;
      const halves = dayHalves(next, day);
      if (halves.am || halves.pm) continue;
      if (!assignedProjects(assignments, employee.id, day).some(project => `project:${project.project_id}` === value)) continue;
      next = setDayPart(next, day, 'full', value);
      added++;
    }
    changeEntries(next);
    setMessage(added ? `${added} empty working days filled with ${defaultProject.client_name} · ${defaultProject.title}. Existing entries were kept.` : 'No empty working days can take this project — check assignment dates.');
  }

  const selectedSet = new Set(selected);
  const unit = duration === 'full' ? 'day' : 'half-day';
  const statusLabel = busy ? 'Saving…' : dirty ? draftStored ? 'Unsaved changes · draft kept in this browser' : 'Unsaved changes · save before leaving' : snapshot?.updated_at ? `Saved by ${snapshot.updated_by || 'your team'} on ${new Date(snapshot.updated_at).toLocaleString('en-GB')}` : 'No entries saved yet';
  // The duration radios follow the radio-group keyboard pattern: arrows move
  // the choice (and never reach the window-level month shortcut).
  function durationKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (index + delta + DURATIONS.length) % DURATIONS.length;
    setDuration(DURATIONS[nextIndex].id);
    (event.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined)?.focus();
  }
  const gridColumns = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  return <>
    <PageAlerts error={error} />
    {!snapshot && !error && <p role="status" className="m-0 text-sm text-muted-foreground">Loading {monthLabel}…</p>}
    {!snapshot && error && <Button variant="outline" className="self-start" onClick={discard}>Retry loading month</Button>}
    {snapshot && <>
      {invoiceLocked && <Alert>
        <Lock aria-hidden="true" />
        <AlertDescription>This month has been invoiced and is locked. Ask an admin to change it.</AlertDescription>
      </Alert>}
      {invoiced && !invoiceLocked && <Alert variant="warning">
        <AlertDescription>A validated invoice covers this month — changes will not update it.</AlertDescription>
      </Alert>}

      <section className="flex items-center gap-2" aria-label="Months">
        <Button variant="outline" size="icon" aria-label="Earlier months" disabled={windowStart <= 0 || busy} onClick={() => setWindowStart(value => value - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 @lg:grid-cols-6">
          {months.slice(windowStart, windowStart + MONTH_WINDOW).map((choice, index) => {
            const active = choice === month;
            const date = new Date(`${choice}-01T12:00:00`);
            const showYear = index === 0 || choice.endsWith('-01');
            const tally = active ? { filled, workdays: workdays.length } : monthTallies[choice];
            const status = !tally || tally.filled === 0 ? '—' : tally.filled >= tally.workdays ? 'Complete' : `${fmtDays(tally.filled)} / ${tally.workdays}`;
            return <button key={choice} type="button"
              className={cn('flex h-12 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @lg:h-14', active && 'bg-foreground text-background hover:bg-foreground')}
              aria-pressed={active} aria-label={`${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}${status !== '—' ? `, ${status}` : ''}`} onClick={() => onMonth(choice)}>
              <span className="max-w-full truncate">{date.toLocaleDateString('en-GB', { month: 'short' })}{showYear ? ` ${choice.slice(0, 4)}` : ''}</span>
              <span className={cn('max-w-full truncate text-xs font-normal', active ? 'text-background/65' : 'text-muted-foreground')}>{status}</span>
            </button>;
          })}
        </div>
        <Button variant="outline" size="icon" aria-label="Later months" disabled={windowStart + MONTH_WINDOW >= months.length || busy} onClick={() => setWindowStart(value => value + 1)}><ChevronRight aria-hidden="true" /></Button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3" aria-label="CRA toolbar">
        <p className="m-0 text-sm text-muted-foreground">{workdays.length} working days{holidayCount ? ` · ${holidayCount} public ${holidayCount === 1 ? 'holiday' : 'holidays'}` : ''}{defaultProject ? ` · Default ${defaultProject.client_name} — ${defaultProject.title}` : ''}</p>
        {defaultProject && remaining > 0 && !invoiceLocked && <Button variant="outline" disabled={busy} onClick={fillDefault}>Fill {fmtDays(remaining)} empty</Button>}
      </section>

      {/* Sticky save bar: Save/Discard stay reachable while scrolling the month,
          and feedback lands next to the buttons. It clears the admin top bar,
          and sits flush inside a dialog's own scroll area. */}
      <div className="sticky top-16 z-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-lg border border-border bg-background/90 px-4 py-2.5 backdrop-blur in-data-[slot=dialog-content]:top-0">
        <span className="mr-auto min-w-0 flex-[1_1_220px] text-[13px] leading-normal text-foreground [overflow-wrap:anywhere] empty:hidden" role="status">{message}</span>
        <span className="max-w-[340px] text-[13px] leading-normal text-muted-foreground [overflow-wrap:anywhere]" role="status">{statusLabel}</span>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <Button variant="outline" disabled={busy} onClick={discard}><RefreshCw data-icon="inline-start" aria-hidden="true" />Discard</Button>}
          <Button disabled={busy || !dirty || invoiceLocked} onClick={() => void save()}><Save data-icon="inline-start" aria-hidden="true" />{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-label="Month summary">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-0.5">
            <span className="text-xl leading-none font-medium">{fmtDays(filled)}</span>
            <span className="text-sm text-muted-foreground"> / {workdays.length} days filled{remaining ? '' : ' · Complete'}</span>
          </div>
          <div className="text-[13px] text-muted-foreground">
            {freelance ? breakdown : <>{balanceError ? `Solde indisponible · ${balanceError}` : `Solde CP ${fmtDays(cpLeft)} j · RTT ${fmtDays(rttLeft)} j`}{!balanceError && breakdown ? ` · ${breakdown}` : ''}</>}
          </div>
        </div>
        <div role="progressbar" aria-label="Days filled" aria-valuemin={0} aria-valuemax={workdays.length} aria-valuenow={filled} className="h-0.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-foreground transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${workdays.length ? Math.round((filled / workdays.length) * 100) : 0}%` }} />
        </div>
      </section>

      {/* Side by side once the screen itself has room (≥ 48rem); the apply
          panel stacks under the calendar on narrow screens. */}
      <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_17rem] @5xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="flex min-w-0 flex-col gap-2" aria-label="Calendar">
          <div className="grid gap-1.5 px-1 text-xs font-medium text-muted-foreground @lg:gap-2" style={gridColumns}>
            <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div>
            {weekends && <><div>Sat</div><div>Sun</div></>}
          </div>
          <div className="grid gap-1.5 @lg:gap-2" style={gridColumns} onMouseLeave={() => { dragRef.current = null; }} onMouseUp={() => { dragRef.current = null; }}>
            {cells.map(cell => {
              if (cell.out) {
                return <button key={cell.iso} type="button" className={cn(CELL, 'border-transparent')} disabled aria-label={`Activity for ${cell.iso}: outside this month`}><span className={cn(CELL_NUM, 'text-faint')}>{cell.num}</span></button>;
              }
              if (cell.holiday) {
                return <button key={cell.iso} type="button" className={cn(CELL, 'border-dashed')} disabled aria-label={`Activity for ${cell.iso}: public holiday`} title={cell.holiday}><span className={cn(CELL_NUM, 'text-faint')}>{cell.num}</span><span className="hidden truncate text-xs text-muted-foreground @lg:block">{cell.holiday}</span></button>;
              }
              const halves = dayHalves(entries, cell.iso);
              const whole = halves.am === halves.pm;
              const has = !!(halves.am || halves.pm);
              const aria = `Activity for ${cell.iso}: ${whole ? `${activityName(halves.am, employeeProjects, labels)}, full day` : `morning ${activityName(halves.am, employeeProjects, labels)}, afternoon ${activityName(halves.pm, employeeProjects, labels)}`}`;
              const lines: { key: string; tag: string; text: string; cls: Activity }[] = [];
              if (whole) {
                if (halves.am) lines.push({ key: 'day', tag: '', text: activityLabel(halves.am, employeeProjects, labels), cls: activityClass(halves.am) });
              } else {
                if (halves.am) lines.push({ key: 'am', tag: 'AM', text: activityLabel(halves.am, employeeProjects, labels), cls: activityClass(halves.am) });
                if (halves.pm) lines.push({ key: 'pm', tag: 'PM', text: activityLabel(halves.pm, employeeProjects, labels), cls: activityClass(halves.pm) });
              }
              const isSelected = selectedSet.has(cell.iso);
              return <button key={cell.iso} type="button"
                className={cn(CELL, 'cursor-pointer enabled:hover:border-foreground/40 disabled:cursor-not-allowed',
                  has ? 'border-transparent bg-card' : cell.weekend && 'border-transparent bg-muted',
                  cell.locked && 'opacity-45',
                  isSelected && 'border-foreground bg-foreground/5 ring-1 ring-foreground enabled:hover:border-foreground')}
                disabled={cell.locked || busy || invoiceLocked}
                aria-pressed={isSelected}
                aria-label={aria}
                title={!withinEmployment(employee, cell.iso) ? 'Outside employment period' : undefined}
                onMouseDown={event => pressDay(cell.iso, event)}
                onMouseEnter={() => dragDay(cell.iso)}
                onClick={event => { if (event.detail === 0) keyToggle(cell.iso); }}>
                <span className={CELL_NUM}>{cell.num}</span>
                {lines.length > 0 && <span className="flex min-w-0 flex-col gap-1">
                  {lines.map(line => <span key={line.key} className="flex min-w-0 items-center gap-2 text-xs">
                    <Dot kind={line.cls} />
                    <span className="hidden truncate @lg:block">{line.tag ? `${line.tag} · ${line.text}` : line.text}</span>
                  </span>)}
                </span>}
              </button>;
            })}
          </div>
          {invalidDays.length > 0 && <p className="m-0 mt-2 px-1 text-[13px] leading-relaxed text-destructive">{invalidDays.length} {invalidDays.length === 1 ? 'entry' : 'entries'} use a project that is no longer assigned ({invalidDays.map(entry => entry.day).join(', ')}). Choose a current assignment or another activity before saving.</p>}
        </section>

        <aside className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4" aria-label="Apply to selected days">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{selected.length ? `${selected.length} ${unit}${selected.length === 1 ? '' : 's'} selected` : 'Select days to fill'}</span>
            {selected.length
              ? <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" onClick={() => { setSelected([]); anchorRef.current = null; }}>Clear</Button>
              : <Button variant="link" size="sm" className="h-auto px-0 text-muted-foreground" onClick={selectEmpty}>Select empty</Button>}
          </div>
          <div className={SEG_TRACK} role="radiogroup" aria-label="Duration">
            {DURATIONS.map((item, index) => <button key={item.id} type="button" role="radio" aria-checked={duration === item.id} tabIndex={duration === item.id ? 0 : -1} className={SEG_ITEM} onClick={() => setDuration(item.id)} onKeyDown={event => durationKey(event, index)}>{item.name}</button>)}
          </div>
          <div className={cn('flex flex-col transition-opacity', !selected.length && 'opacity-40')}>
            {[...projectBrushes, ...plainBrushes].map(brush => <button key={brush.value} type="button" className={BRUSH} disabled={!selected.length || busy || invoiceLocked} onClick={() => applyBrush(brush.value, brush.label)}>
              <Dot kind={brush.cls as Activity} className="size-2.5" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{brush.label}</span>
                <span className="truncate text-xs text-muted-foreground">{brush.sub}</span>
              </span>
              <span className="flex-none text-xs text-muted-foreground">{valueCounts.get(brush.value) ? `${fmtDays(valueCounts.get(brush.value)!)} d` : ''}</span>
            </button>)}
            <button type="button" className={cn(BRUSH, 'min-h-11 text-[13px] text-muted-foreground enabled:hover:bg-transparent enabled:hover:text-foreground')} disabled={!selected.length || busy || invoiceLocked} onClick={() => applyBrush('', 'Clear entries')}>Clear entries</button>
          </div>
          <div className={SEG_TRACK} role="group" aria-label="Days shown">
            <button type="button" aria-pressed={!weekends} className={SEG_ITEM} onClick={() => setWeekends(false)}>Mon–Fri</button>
            <button type="button" aria-pressed={weekends} className={SEG_ITEM} onClick={() => setWeekends(true)}>Mon–Sun</button>
          </div>
        </aside>
      </div>
    </>}
  </>;
}

/** Calendar day cell: quiet surface; filled days sit on the card colour, selection outlines in ink. */
const CELL = 'flex h-20 min-w-0 flex-col justify-between rounded-md border border-border p-2 text-left select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none @lg:h-24 @lg:p-3';
const CELL_NUM = 'text-[13px] leading-none font-medium @lg:text-[15px]';
const BRUSH = 'flex min-h-12 w-full cursor-pointer items-center gap-3 border-t border-border px-1 py-2 text-left transition-colors enabled:hover:bg-accent disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
