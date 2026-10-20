import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Save, Search } from 'lucide-react';
import { Empty, Notice } from '@quicksort/hr-ui';
import { errorMessage } from '@quicksort/hr-db';
import { z } from 'zod';
import { loadContext, loadMonth, saveMonth } from './data';
import { assignedProjects, currentMonth, dayHalves, entrySchema, entryValue, listMonths, setDayPart, shiftMonth, monthDays, monthSchema, sortEntries, statusLabels, withinEmployment, type ActivityValue, type Assignment, type Context, type Employee, type Entry, type Part, type Snapshot } from './domain';
import './cra.css';

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

// Display helpers — short mono codes for the calendar cells and brush labels.
function activityClass(value: ActivityValue): 'client' | 'internal' | 'cp' | 'rtt' | 'css' | 'empty' {
  if (value === 'internal') return 'internal';
  if (value === 'paid_leave') return 'cp';
  if (value === 'rtt') return 'rtt';
  if (value === 'unpaid_leave') return 'css';
  if (value.startsWith('project:')) return 'client';
  return 'empty';
}
// Short cell label: the client name for projects, the leave name otherwise
// (the design shows “BNP”, “Congés payés”, … next to a marker dot).
function activityLabel(value: ActivityValue, projects: Assignment[]): string {
  if (!value) return '';
  if (value === 'internal') return statusLabels.internal;
  if (value === 'paid_leave') return statusLabels.paid_leave;
  if (value === 'rtt') return statusLabels.rtt;
  if (value === 'unpaid_leave') return statusLabels.unpaid_leave;
  const project = projects.find(item => `project:${item.project_id}` === value);
  return project?.client_name || statusLabels.client_project;
}
function activityName(value: ActivityValue, projects: Assignment[]): string {
  if (!value) return 'not filled';
  if (value === 'internal') return 'Internal';
  if (value === 'paid_leave') return statusLabels.paid_leave;
  if (value === 'rtt') return 'RTT';
  if (value === 'unpaid_leave') return statusLabels.unpaid_leave;
  const project = projects.find(item => `project:${item.project_id}` === value);
  return project ? `Client Project ${project.title} (${project.client_name})` : 'Client Project';
}
function fmtDays(amount: number) {
  return amount % 1 ? amount.toFixed(1) : String(amount);
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
  useEffect(() => {
    if (!syncUrl) return;
    const sync = () => {
      const fromLink = readSharedId();
      if (fromLink) setEmployeeId(previous => context?.employees.some(employee => employee.id === fromLink) ? fromLink : previous);
      const fromUrl = pathMonth ? readPathMonth() : readQueryMonth();
      if (linkBase) { if (fromUrl) setMonthState(fromUrl); }
      else setMonthState(fromUrl || currentMonth());
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [syncUrl, pathMonth, linkBase, context]);
  function selectEmployee(id: string) {
    setEmployeeId(id);
    // Keep the URL shareable: picking someone turns the address bar into
    // the link HR can send to open this exact CRA month.
    if (manageUrl && readSharedId() !== id) window.history.pushState(null, '', shareLink(id, month));
  }
  // Reflect the resolved employee and the viewed month in the address bar
  // (replace: no extra history entry) so copying the URL always yields a
  // working shared link; legacy ?month= deep links fold into the path here.
  useEffect(() => {
    if (!syncUrl || !context || !employeeId) return;
    const target = shareLink(fixedEmployeeId || employeeId, month);
    if (window.location.pathname + window.location.search !== target) window.history.replaceState(null, '', target);
  }, [syncUrl, pathMonth, linkBase, basePath, context, employeeId, fixedEmployeeId, month]);
  function changeMonth(next: string) {
    setMonthState(next);
    if (!syncUrl) return;
    // One history entry per month: the address bar always holds a shareable
    // link and the back button steps through the visited months.
    const target = shareLink(fixedEmployeeId || employeeId, next);
    if (window.location.pathname + window.location.search !== target) window.history.pushState(null, '', target);
  }
  const employee = context?.employees.find(item => item.id === (fixedEmployeeId || employeeId));
  const monthChoices = useMemo(() => {
    const earliest = context?.employees.reduce<string | undefined>((min, item) => !min || item.start_date < min ? item.start_date : min, undefined);
    return listMonths(earliest ? earliest.slice(0, 7) : shiftMonth(currentMonth(), -11), shiftMonth(currentMonth(), 3));
  }, [context]);
  return <section className="cra-screen">
    {error && <><Notice error>{error}</Notice><button className="btn secondary" onClick={() => setRetry(value => value + 1)}>Retry loading CRA</button></>}
    {!context && !error && <p className="muted" role="status">Loading CRA…</p>}
    {context && !context.employees.length && <Empty title="No employee record linked">{audience === 'admin' ? 'Create an employment record in HR before filling a CRA.' : 'Ask HR to link your account to your employee record.'}</Empty>}
    {context && employee && <>
      {!fixedEmployeeId && <div className="cra-filters panel">
        <div className="cra-field"><label className="qs-label" htmlFor="cra-employee">Employee</label><EmployeePicker employees={context.employees} selectedId={employeeId} onSelect={selectEmployee} /></div>
      </div>}      <MonthEditor key={`${employeeId}:${month}`} employee={employee} month={month} months={monthChoices} onMonth={changeMonth} assignments={context.assignments} draftOwner={draftOwner} />
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

  return <div className="cra-employee-picker" ref={rootRef}>
    <Search className="cra-employee-picker-icon" size={16} aria-hidden="true" />
    <input
      id="cra-employee"
      className="qs-input"
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
    {open && <ul className="cra-employee-picker-list" id="cra-employee-options" role="listbox" aria-label="Employees">
      {results.length ? results.map((employee, index) => <li key={employee.id}>
        <button id={`cra-employee-option-${employee.id}`} type="button" role="option" aria-selected={employee.id === selectedId} className={index === highlight ? 'on' : ''} onPointerMove={() => setHighlight(index)} onClick={() => choose(employee.id)}>
          <span>{employee.full_name}</span><small>{employee.role || 'Employee'} · Started {employee.start_date}</small>
        </button>
      </li>) : <li className="cra-employee-picker-empty" role="status">No employees match “{query}”.</li>}
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

function MonthEditor({ employee, month, months, onMonth, assignments, draftOwner }: { employee: Employee; month: string; months: string[]; onMonth: (month: string) => void; assignments: Assignment[]; draftOwner: string }) {
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
  const dragRef = useRef<{ add: boolean } | null>(null);
  const anchorRef = useRef<string | null>(null);
  const draftKey = `quicksort:cra:${draftOwner}:${employee.id}:${month}`;
  const days = monthDays(month);
  const dayInfo = useMemo(() => new Map(days.map(day => [day.day, day])), [days]);
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
      setMessage('CRA saved.');
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
    { value: 'internal', label: statusLabels.internal, sub: 'Non-billable', cls: 'internal' },
    { value: 'paid_leave', label: statusLabels.paid_leave, sub: 'Paid leave', cls: 'cp' },
    { value: 'rtt', label: statusLabels.rtt, sub: 'Reduced working time', cls: 'rtt' },
    { value: 'unpaid_leave', label: statusLabels.unpaid_leave, sub: 'Unpaid leave', cls: 'css' },
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
    .map(([status, amount]) => `${status === 'client_project' ? statusLabels.client_project : statusLabels[status as keyof typeof statusLabels]} ${fmtDays(amount)}`)
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
  return <>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
    {!snapshot && !error && <p role="status" className="muted">Loading {monthLabel}…</p>}
    {!snapshot && error && <button className="btn secondary" onClick={discard}>Retry loading month</button>}
    {snapshot && <>
      <section className="cra-months" aria-label="Months">
        <button className="cra-month-nav" type="button" aria-label="Earlier months" disabled={windowStart <= 0 || busy} onClick={() => setWindowStart(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <div className="cra-months-track">
          {months.slice(windowStart, windowStart + MONTH_WINDOW).map((choice, index) => {
            const active = choice === month;
            const date = new Date(`${choice}-01T12:00:00`);
            const showYear = index === 0 || choice.endsWith('-01');
            const tally = active ? { filled, workdays: workdays.length } : monthTallies[choice];
            const status = !tally || tally.filled === 0 ? '—' : tally.filled >= tally.workdays ? 'Complete' : `${fmtDays(tally.filled)} / ${tally.workdays}`;
            return <button key={choice} type="button" className={`cra-month${active ? ' cra-month--on' : ''}`} aria-pressed={active} aria-label={`${date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}${status !== '—' ? `, ${status}` : ''}`} onClick={() => onMonth(choice)}>
              <span className="cra-month-label">{date.toLocaleDateString('en-GB', { month: 'short' })}{showYear ? ` ${choice.slice(0, 4)}` : ''}</span>
              <span className="cra-month-status">{status}</span>
            </button>;
          })}
        </div>
        <button className="cra-month-nav" type="button" aria-label="Later months" disabled={windowStart + MONTH_WINDOW >= months.length || busy} onClick={() => setWindowStart(value => value + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </section>

      <section className="cra-toolbar" aria-label="CRA toolbar">
        <div className="cra-toolbar-title">
          <p className="cra-toolbar-meta">{workdays.length} working days{holidayCount ? ` · ${holidayCount} public ${holidayCount === 1 ? 'holiday' : 'holidays'}` : ''}{defaultProject ? ` · Default ${defaultProject.client_name} — ${defaultProject.title}` : ''}</p>
        </div>
        <div className="cra-toolbar-actions">
          <span className="cra-save-state" role="status">{statusLabel}</span>
          {dirty && <button className="btn secondary" type="button" disabled={busy} onClick={discard}><RefreshCw size={16} aria-hidden="true" />Discard</button>}
          {defaultProject && remaining > 0 && <button className="btn secondary" type="button" disabled={busy} onClick={fillDefault}>Fill {fmtDays(remaining)} empty</button>}
          <button className="btn" type="button" disabled={busy || !dirty} onClick={() => void save()}><Save size={16} aria-hidden="true" />{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </section>

      <section className="cra-summary" aria-label="Month summary">
        <div className="cra-summary-row">
          <div className="cra-summary-total">
            <span className="cra-summary-filled">{fmtDays(filled)}</span>
            <span className="muted"> / {workdays.length} days filled{remaining ? '' : ' · Complete'}</span>
          </div>
          <div className="muted cra-breakdown">{breakdown || 'Nothing filled yet'}</div>
        </div>
        <div role="progressbar" aria-label="Days filled" aria-valuemin={0} aria-valuemax={workdays.length} aria-valuenow={filled} className="cra-progress">
          <div className="cra-progress-fill" style={{ width: `${workdays.length ? Math.round((filled / workdays.length) * 100) : 0}%` }} />
        </div>
      </section>

      <div className="cra-cal-layout">
        <section className="cra-cal" aria-label="Calendar" style={{ ['--cra-cols' as string]: columns }}>
          <div className="cra-cal-head">
            <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div>
            {weekends && <><div>Sat</div><div>Sun</div></>}
          </div>
          <div className="cra-cal-grid" onMouseLeave={() => { dragRef.current = null; }} onMouseUp={() => { dragRef.current = null; }}>
            {cells.map(cell => {
              if (cell.out) {
                return <button key={cell.iso} type="button" className="cra-cell cra-cell--out" disabled aria-label={`Activity for ${cell.iso}: outside this month`}><span className="cra-cell-num">{cell.num}</span></button>;
              }
              if (cell.holiday) {
                return <button key={cell.iso} type="button" className="cra-cell cra-cell--holiday" disabled aria-label={`Activity for ${cell.iso}: public holiday`} title={cell.holiday}><span className="cra-cell-num">{cell.num}</span><span className="cra-cell-note">{cell.holiday}</span></button>;
              }
              const halves = dayHalves(entries, cell.iso);
              const whole = halves.am === halves.pm;
              const has = !!(halves.am || halves.pm);
              const aria = `Activity for ${cell.iso}: ${whole ? `${activityName(halves.am, employeeProjects)}, full day` : `morning ${activityName(halves.am, employeeProjects)}, afternoon ${activityName(halves.pm, employeeProjects)}`}`;
              const lines: { key: string; tag: string; text: string; cls: string }[] = [];
              if (whole) {
                if (halves.am) lines.push({ key: 'day', tag: '', text: activityLabel(halves.am, employeeProjects), cls: activityClass(halves.am) });
              } else {
                if (halves.am) lines.push({ key: 'am', tag: 'AM', text: activityLabel(halves.am, employeeProjects), cls: activityClass(halves.am) });
                if (halves.pm) lines.push({ key: 'pm', tag: 'PM', text: activityLabel(halves.pm, employeeProjects), cls: activityClass(halves.pm) });
              }
              return <button key={cell.iso} type="button"
                className={`cra-cell${has ? ' cra-cell--fill' : ' cra-cell--empty'}${cell.weekend ? ' cra-cell--weekend' : ''}${cell.locked ? ' cra-cell--off' : ''}${selectedSet.has(cell.iso) ? ' cra-cell--sel' : ''}`}
                disabled={cell.locked || busy}
                aria-pressed={selectedSet.has(cell.iso)}
                aria-label={aria}
                title={!withinEmployment(employee, cell.iso) ? 'Outside employment period' : undefined}
                onMouseDown={event => pressDay(cell.iso, event)}
                onMouseEnter={() => dragDay(cell.iso)}
                onClick={event => { if (event.detail === 0) keyToggle(cell.iso); }}>
                <span className="cra-cell-num">{cell.num}</span>
                {lines.length > 0 && <span className="cra-cell-lines">
                  {lines.map(line => <span key={line.key} className="cra-line">
                    <span aria-hidden="true" className={`cra-dot cra-dot--${line.cls}`} />
                    <span className="cra-line-text">{line.tag ? `${line.tag} · ${line.text}` : line.text}</span>
                  </span>)}
                </span>}
              </button>;
            })}
          </div>
          {invalidDays.length > 0 && <p className="cra-invalid-note">{invalidDays.length} {invalidDays.length === 1 ? 'entry' : 'entries'} use a project that is no longer assigned ({invalidDays.map(entry => entry.day).join(', ')}). Choose a current assignment or another activity before saving.</p>}
        </section>

        <aside className="cra-side" aria-label="Apply to selected days">
          <div className="cra-side-head">
            <span className="cra-side-title">{selected.length ? `${selected.length} ${unit}${selected.length === 1 ? '' : 's'} selected` : 'Select days to fill'}</span>
            {selected.length
              ? <button className="cra-link" type="button" onClick={() => { setSelected([]); anchorRef.current = null; }}>Clear</button>
              : <button className="cra-link" type="button" onClick={selectEmpty}>Select empty</button>}
          </div>
          <div className="cra-seg-group" role="radiogroup" aria-label="Duration">
            {DURATIONS.map(item => <button key={item.id} type="button" role="radio" aria-checked={duration === item.id} className={`cra-seg${duration === item.id ? ' cra-seg-on' : ''}`} onClick={() => setDuration(item.id)}>{item.name}</button>)}
          </div>
          <div className={selected.length ? 'cra-types' : 'cra-types cra-types--dim'}>
            {[...projectBrushes, ...plainBrushes].map(brush => <button key={brush.value} type="button" className="cra-type" disabled={!selected.length || busy} onClick={() => applyBrush(brush.value, brush.label)}>
              <span aria-hidden="true" className={`cra-dot cra-dot--${brush.cls}`} />
              <span className="cra-type-text">
                <span className="cra-type-label">{brush.label}</span>
                <span className="cra-type-sub">{brush.sub}</span>
              </span>
              <span className="cra-type-count">{valueCounts.get(brush.value) ? `${fmtDays(valueCounts.get(brush.value)!)} d` : ''}</span>
            </button>)}
            <button type="button" className="cra-clear-entries" disabled={!selected.length || busy} onClick={() => applyBrush('', 'Clear entries')}>Clear entries</button>
          </div>
          <div className="cra-seg-group" role="group" aria-label="Days shown">
            <button type="button" aria-pressed={!weekends} className={`cra-seg${!weekends ? ' cra-seg-on' : ''}`} onClick={() => setWeekends(false)}>Mon–Fri</button>
            <button type="button" aria-pressed={weekends} className={`cra-seg${weekends ? ' cra-seg-on' : ''}`} onClick={() => setWeekends(true)}>Mon–Sun</button>
          </div>
        </aside>
      </div>
    </>}
  </>;
}
