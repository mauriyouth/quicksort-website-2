import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Clock3, Plus, RefreshCw, Search, Users, X, ArrowUpRight, MapPin } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import { executeCommand, loadWorkspace } from './data';
import type { Employee, Opportunity, Person, Workspace } from './domain';
import { AssignForm, PersonWorkspace, available, personName, stages, type PersonTab, type RecordContext } from './PersonWorkspace';
import { Action, Dialog, Empty, Field, Form, PersonLink, SearchMultiField, Section, Tag, checked, date, initials, label, nullable, text, today, type RunCommand } from './ui';
import type { Application, ApplicationStage } from './domain';
import { DateField } from '../DateField';
import { Intake } from './Intake';
import { CraScreen } from '../cra/CraScreen';
import { loadMonth } from '../cra/data';
import { monthDays } from '../cra/domain';
import './workspace.css';
export type HrView = 'overview' | 'recruiting' | 'people' | 'journeys';
const viewCopy: Record<HrView, {
  title: string;
  description: string;
}> = {
  overview: {
    title: 'The next move, clearly.',
    description: 'Recruitment decisions, new arrivals and departures in one working queue.'
  },
  recruiting: {
    title: 'Build your next team.',
    description: 'Connect hiring needs, applications, interviews and employment offers.'
  },
  people: {
    title: 'One person. Every chapter.',
    description: 'Candidates, colleagues and alumni — with staffing capacity and monthly CRA in the same place.'
  },
  journeys: {
    title: 'Make every handoff count.',
    description: 'Preboarding, onboarding, probation and offboarding with owners and evidence.'
  }
};
type OpenPerson = (personId: string, applicationId?: string, employeeId?: string) => void;
type PageContext = RecordContext & {
  open: OpenPerson;
};
const getParam = (key: string) => new URLSearchParams(window.location.search).get(key) ?? '';
// Person records route as paths, not query params: /hr/people/<personId> with
// the record tab as the next segment. Tab keys map to URL segments (the
// internal "history" tab lives at .../activity).
const TAB_SEGMENTS: Record<PersonTab, string> = {
  profile: '',
  applications: 'applications',
  employment: 'employments',
  projects: 'projects',
  cra: 'cra',
  history: 'activity'
};
const SEGMENT_TABS: Record<string, PersonTab> = {
  applications: 'applications',
  employments: 'employment',
  projects: 'projects',
  cra: 'cra',
  activity: 'history'
};
const personRoute = (): { personId: string; tab: PersonTab } => {
  // The CRA tab pins the viewed month as extra segments:
  // /hr/people/<id>/cra/2026/10 (the CRA screen owns them; the record
  // router keeps resolving the tab and ignores the tail).
  const match = window.location.pathname.match(/^\/hr\/people\/([^/]+?)(?:\/([^/]+?)(?:\/(\d{4})\/(0[1-9]|1[0-2]))?)?\/?$/);
  if (!match) return { personId: '', tab: 'profile' };
  return { personId: match[1], tab: SEGMENT_TABS[match[2] ?? ''] ?? 'profile' };
};
// The People list keeps its filters (?q=, ?group=) in the URL; carry them
// through person navigation so closing a record returns to the same list.
const listFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const kept = new URLSearchParams();
  for (const key of ['q', 'group']) if (params.get(key)) kept.set(key, params.get(key) ?? '');
  return kept;
};
const personUrl = (id: string, tab: PersonTab, params = new URLSearchParams()) => {
  const segment = TAB_SEGMENTS[tab];
  const url = new URL(`/hr/people/${id}${segment ? `/${segment}` : ''}`, window.location.origin);
  url.search = params.toString();
  return url;
};
export function HrWorkspace({
  view,
  actorEmail,
  role,
  openProject
}: {
  view: HrView;
  actorEmail: string;
  role: string;
  openProject?: (projectId: string) => void;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [intake, setIntake] = useState(false);
  const [myCra, setMyCra] = useState(false);
  const [personId, setPersonId] = useState(() => personRoute().personId);
  const [personTab, setPersonTab] = useState<PersonTab>(() => personRoute().tab);
  const [applicationId, setApplicationId] = useState(() => getParam('application'));
  const [employeeId, setEmployeeId] = useState(() => getParam('employment'));
  const reload = useCallback(async () => {
    const data = await loadWorkspace();
    setWorkspace(data);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadWorkspace().then(data => {
      if (!cancelled) setWorkspace(data);
    }).catch(failure => {
      if (!cancelled) setError(errorMessage(failure));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view]);
  useEffect(() => {
    // Legacy ?person= deep links (bookmarks, shared links) become paths.
    const legacy = getParam('person');
    if (!legacy) return;
    const application = getParam('application');
    const employment = getParam('employment');
    const tab: PersonTab = application ? 'applications' : employment ? 'employment' : 'profile';
    const params = listFilters();
    if (application) params.set('application', application);
    if (employment) params.set('employment', employment);
    window.history.replaceState(null, '', personUrl(legacy, tab, params));
    setPersonId(legacy);
    setPersonTab(tab);
    setApplicationId(application);
    setEmployeeId(employment);
  }, []);
  useEffect(() => {
    const sync = () => {
      const route = personRoute();
      setPersonId(route.personId);
      setPersonTab(route.tab);
      setApplicationId(getParam('application'));
      setEmployeeId(getParam('employment'));
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const open: OpenPerson = (id, application, employee) => {
    const tab: PersonTab = application ? 'applications' : employee ? 'employment' : 'profile';
    const params = listFilters();
    if (application) params.set('application', application);
    if (employee) params.set('employment', employee);
    window.history.pushState(null, '', personUrl(id, tab, params));
    setPersonId(id);
    setPersonTab(tab);
    setApplicationId(application ?? '');
    setEmployeeId(employee ?? '');
  };
  const navigatePersonTab = (tab: PersonTab) => {
    if (!personId) return;
    window.history.pushState(null, '', personUrl(personId, tab, listFilters()));
    setPersonTab(tab);
    setApplicationId('');
    setEmployeeId('');
  };
  const run: RunCommand = async (input, success = 'Saved.') => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await executeCommand(input);
    } catch (failure) {
      setBusy(false);
      setError(errorMessage(failure));
      void reload().catch(() => {});
      throw failure;
    }
    setMessage(success);
    try {
      await reload();
    } catch (failure) {
      setError(`The action was saved, but refreshing failed. ${errorMessage(failure)}`);
    } finally {
      setBusy(false);
    }
  };
  const selectedPerson = workspace?.people.find(person => person.id === personId);
  const selectedEmployees = workspace && selectedPerson ? workspace.employees.filter(employee => employee.person_id === selectedPerson.id) : [];
  const selectedLive = selectedEmployees.find(employee => employee.status !== 'ended');
  const selectedAlumni = !selectedLive && selectedEmployees.length > 0;
  const selectedApplicationCount = workspace && selectedPerson ? workspace.applications.filter(application => application.person_id === selectedPerson.id).length : 0;
  const canRecruit = !!workspace?.capabilities.recruit;
  const canStaff = !!workspace?.capabilities.staff;
  const context = workspace ? {
    workspace,
    run,
    busy,
    reload,
    actorEmail,
    open,
    openProject
  } : null;
  return <div className="hr-workspace" aria-busy={loading}>
    {!(selectedPerson && canRecruit) && <div className="hr-workspace-head">
      <div>
        <div className="hr-eyebrow">People operations · {label(view)}</div>
        <h1>
          {viewCopy[view].title}
        </h1>
        <p>
          {viewCopy[view].description}
        </p>
      </div>
      <div className="hr-inline">
        <button className="btn secondary" disabled={loading || busy} onClick={() => {
          setLoading(true);
          setError('');
          void reload().catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false));
        }}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
        {canRecruit && <button className="btn" onClick={() => setIntake(true)}><Plus size={16} aria-hidden="true" /> Add person</button>}
        {!canRecruit && view === 'people' && <button className="btn secondary" onClick={() => setMyCra(true)}><CalendarDays size={15} aria-hidden="true" /> My CRA</button>}
      </div>
    </div>}
    {error && <p className="hr-error" role="alert">
      {error}
    </p>}
    {message && <div className="hr-success" role="status">
      {message}
    </div>}
    {loading && !workspace ? <Empty>
      <span role="status">Loading the HR workspace…</span>
    </Empty> : context && (canRecruit || canStaff) ? <>
      {view === 'overview' && !selectedPerson && <Overview context={context} />}
      {view === 'recruiting' && !selectedPerson && <Recruiting context={context} />}
      {view === 'people' && !selectedPerson && <People context={context} />}
      {view === 'journeys' && !selectedPerson && <Journeys context={context} />}
      {intake && canRecruit && <Dialog title="Add a person" close={() => setIntake(false)}>
        <Intake actorEmail={actorEmail} run={run} busy={busy} onAdded={() => setIntake(false)} />
      </Dialog>}
      {myCra && <Dialog title="My CRA" close={() => setMyCra(false)}>
        <CraScreen audience="employee" draftOwner={actorEmail} />
      </Dialog>}
      {selectedPerson && canRecruit && <PersonPage person={selectedPerson} context={context} live={selectedLive} alumni={selectedAlumni} applicationCount={selectedApplicationCount} tab={personTab} onNavigate={navigatePersonTab} initialApplication={applicationId} initialEmployment={employeeId} />}
    </> : !loading && !error && <Empty>This workspace is available to HR and authorized staffing managers.</Empty>}
  </div>;
}
function useLastCra(employees: Employee[]) {
  const ids = employees.map(employee => employee.id).join(',');
  const [last, setLast] = useState<{ month: string; filled: number; workdays: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLast(null);
    const list = ids ? ids.split(',') : [];
    if (!list.length) return;
    void (async () => {
      try {
        // The latest month with at least one stored entry, across every
        // employment period of this person.
        const found = await db().from('cra_entries').select('employee_id,month').in('employee_id', list).order('month', {
          ascending: false
        }).limit(1);
        if (found.error) throw found.error;
        const row = found.data?.[0];
        if (!row) return;
        const month = row.month.slice(0, 7);
        const snapshot = await loadMonth(row.employee_id, month);
        if (cancelled) return;
        // Same tally rule as the CRA month pills: full day = 1, half = 0.5,
        // weekends and public holidays never count towards the month total.
        const days = monthDays(month);
        let filled = 0;
        for (const entry of snapshot.entries) {
          const info = days.find(day => day.day === entry.day);
          if (!info || info.weekend || info.holiday) continue;
          filled += entry.part === 'full' ? 1 : 0.5;
        }
        const workdays = days.filter(day => !day.weekend && !day.holiday).length;
        setLast({
          month,
          filled,
          workdays
        });
      } catch {
        /* Unknown months stay neutral. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);
  return last;
}
function PersonPage({
  person,
  context,
  live,
  alumni,
  applicationCount,
  tab,
  onNavigate,
  initialApplication,
  initialEmployment
}: {
  person: Person;
  context: PageContext;
  live?: Employee;
  alumni: boolean;
  applicationCount: number;
  tab: PersonTab;
  onNavigate: (tab: PersonTab) => void;
  initialApplication?: string | null;
  initialEmployment?: string | null;
}) {
  const status = live ? label(live.status) : alumni ? 'Alumni' : applicationCount ? 'Candidate' : 'Talent pool';
  const availability = live ? available(context.workspace, live, today()) : null;
  const employees = context.workspace.employees.filter(employee => employee.person_id === person.id);
  const lastCra = useLastCra(employees);
  const day = today();
  // The staffing commitment that currently books this person, highest
  // allocation first — shown as “Client — Project”, like the CRA default.
  const currentAssignment = context.workspace.assignments.filter(assignment => employees.some(employee => employee.id === assignment.employee_id) && ['reserved', 'confirmed', 'active'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day)).sort((a, b) => b.allocation_pct - a.allocation_pct)[0];
  const assignmentProject = currentAssignment ? context.workspace.projects.find(project => project.id === currentAssignment.project_id) : undefined;
  const assignmentClient = assignmentProject?.client_id ? context.workspace.clients.find(client => client.id === assignmentProject.client_id) : undefined;
  const defaultAssignment = assignmentProject ? `${assignmentClient ? `${assignmentClient.name} — ` : ''}${assignmentProject.title}` : 'None';
  const craTally = lastCra && lastCra.filled > 0 && lastCra.workdays > 0 && lastCra.filled < lastCra.workdays ? `${lastCra.filled % 1 ? lastCra.filled.toFixed(1) : lastCra.filled} / ${lastCra.workdays} days` : '';
  const craLabel = !lastCra ? '—' : `${new Date(`${lastCra.month}-01T12:00:00`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric'
  })}${craTally ? ` · ${craTally}` : lastCra.filled > 0 && lastCra.workdays > 0 ? ' · Complete' : ''}`;
  return <div className="hr-person-page">
    <header className="hr-person-hero">
      <div className="hr-person-sheet">
        {/* Person header: breadcrumb and title merged, name shown once */}
        <section className="hr-person-head">
          <div className="hr-person-lead">
            <span className="hr-person-avatar" aria-hidden="true">{initials(person.full_name)}</span>
            <div className="hr-person-id">
              <h1>{person.full_name}</h1>
              <div className="hr-person-meta">
                {person.headline && <span>{person.headline}</span>}
                <span className="hr-person-status">
                  <span className="hr-person-dot" aria-hidden="true" />
                  {status}
                </span>
                {availability !== null && <span>{availability}% available today</span>}
                {person.location && <span className="hr-person-place"><MapPin size={14} aria-hidden="true" />{person.location}</span>}
              </div>
            </div>
          </div>
          <dl className="hr-person-stats">
            <div>
              <dt>Default assignment</dt>
              <dd>{defaultAssignment}</dd>
            </div>
            <div>
              <dt>Last CRA</dt>
              <dd>{craLabel}</dd>
            </div>
          </dl>
        </section>
      </div>
    </header>
    <div className="hr-person-sheet">
      <PersonWorkspace person={person} context={context} tab={tab} onNavigate={onNavigate} initialApplication={initialApplication} initialEmployment={initialEmployment} />
    </div>
  </div>;
}
function Metric({
  value,
  title,
  urgent = false
}: {
  value: number | string;
  title: string;
  urgent?: boolean;
}) {
  return <div className={`hr-metric ${urgent ? 'is-urgent' : ''}`}>
    <strong>
      {value}
    </strong>
    <span>
      {title}
    </span>
  </div>;
}
function Overview({
  context: {
    workspace,
    open,
    actorEmail
  }
}: {
  context: PageContext;
}) {
  const day = today();
  const in30days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const active = workspace.applications.filter(application => application.status === 'active');
  const arrivals = workspace.employees.filter(employee => employee.status === 'preboarding' && employee.start_date <= in30days);
  const overdue = workspace.tasks.filter(task => !task.completed_at && task.due_date && task.due_date < day);
  const myTasks = workspace.tasks.filter(task => !task.completed_at && task.assignee.toLowerCase() === actorEmail.toLowerCase()).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const interviews = workspace.interviews.filter(interview => interview.status === 'scheduled' && interview.scheduled_at.slice(0, 10) >= day).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const offers = workspace.offers.filter(offer => ['draft', 'pending_approval', 'pending_direction'].includes(offer.status));
  const reviews = workspace.reviews.filter(review => review.status === 'scheduled').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const exits = workspace.exits.filter(exit => exit.status === 'open');
  return <>
    <div className="hr-metrics">
      <Metric value={active.length} title="Active applications" />
      <Metric value={arrivals.length} title="Arrivals in the next 30 days" />
      <Metric value={overdue.length} title="Overdue journey tasks" urgent={overdue.length > 0} />
      <Metric value={exits.length} title="Open departures" />
    </div>
    <div className="hr-two-column">
      <div>
        <Section title="Your action queue" detail="Assigned work, ordered by due date.">
          {myTasks.length ? <div className="hr-queue">
            {myTasks.slice(0, 10).map(task => {
              const employee = workspace.employees.find(item => item.id === task.employee_id);
              return <div key={task.id} className="hr-queue-row">
                <div>
                  <strong>
                    {task.title}
                  </strong>
                  <p>{employee ? personName(workspace, employee.person_id) : 'Employment'} · {label(task.phase)} · Due {date(task.due_date)}</p>
                </div>
                {employee && <button className="btn secondary" onClick={() => open(employee.person_id, undefined, employee.id)}>Open plan</button>}
              </div>;
            })}
          </div> : <Empty><CheckMessage />No pending tasks assigned to you.</Empty>}
        </Section>
        <div style={{
          marginTop: 24
        }}>
          <Section title="Offer approvals" detail="Review compensation and the commercial justification before approval.">
            {offers.length ? <div className="hr-queue">
              {offers.slice(0, 6).map(offer => {
                const application = workspace.applications.find(item => item.id === offer.application_id);
                return <div key={offer.id} className="hr-queue-row">
                  <div>
                    <strong>
                      {offer.title}
                    </strong>
                    <p>{application ? personName(workspace, application.person_id) : 'Application'} · {offer.margin_pct.toFixed(1)}% margin · {label(offer.status)}</p>
                  </div>
                  {application && <button className="btn secondary" onClick={() => open(application.person_id, application.id)}>Review</button>}
                </div>;
              })}
            </div> : <Empty>No offers waiting for approval.</Empty>}
          </Section>
        </div>
      </div>
      <div>
        <Section title="Upcoming interviews" detail="Send calendar invitations manually after scheduling.">
          {interviews.length ? <div className="hr-queue">
            {interviews.slice(0, 5).map(interview => {
              const application = workspace.applications.find(item => item.id === interview.application_id);
              return <div key={interview.id} className="hr-queue-row">
                <div>
                  <strong>
                    {application ? personName(workspace, application.person_id) : 'Application'}
                  </strong>
                  <p><CalendarDays size={12} aria-hidden="true" /> {label(interview.kind)} · {new Date(interview.scheduled_at).toLocaleString()}</p>
                </div>
                {application && <button className="btn secondary" onClick={() => open(application.person_id, application.id)}>Open</button>}
              </div>;
            })}
          </div> : <Empty>No upcoming interviews.</Empty>}
        </Section>
        <div style={{
          marginTop: 24
        }}>
          <Section title="Probation and review decisions">
            {reviews.length ? <div className="hr-queue">
              {reviews.slice(0, 5).map(review => {
                const employee = workspace.employees.find(item => item.id === review.employee_id);
                return <div key={review.id} className="hr-queue-row">
                  <div>
                    <strong>
                      {employee ? personName(workspace, employee.person_id) : 'Employment'}
                    </strong>
                    <p>{label(review.kind)} · Due {date(review.due_date)}</p>
                  </div>
                  {employee && <button className="btn secondary" onClick={() => open(employee.person_id, undefined, employee.id)}>Review</button>}
                </div>;
              })}
            </div> : <Empty>No pending review decisions.</Empty>}
          </Section>
        </div>
      </div>
    </div>
  </>;
}
function CheckMessage() {
  return <Users size={20} aria-hidden="true" style={{
    display: 'block',
    margin: '0 auto 10px'
  }} />;
}
function SearchField({
  value,
  change,
  placeholder = 'Search people, skills or roles'
}: {
  value: string;
  change: (value: string) => void;
  placeholder?: string;
}) {
  return <label className="hr-search">
    <Search size={16} aria-hidden="true" />
    <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => change(event.target.value)} />
  </label>;
}
function People({
  context
}: {
  context: PageContext;
}) {
  const {
    workspace,
    open,
    run,
    busy
  } = context;
  const canRecruit = workspace.capabilities.recruit;
  const canStaff = workspace.capabilities.staff;
  const [query, setQuery] = useState(() => getParam('q'));
  const [filter, setFilter] = useState(() => getParam('group') || (canRecruit ? 'all' : 'employees'));
  const [day, setDay] = useState(today());
  const [capacityFilter, setCapacityFilter] = useState('all');
  const [assigning, setAssigning] = useState('');
  const activeOn = (employee: Employee) => employee.status !== 'ended' && employee.start_date <= day && (!employee.end_date || employee.end_date >= day) && (!employee.planned_exit_date || employee.planned_exit_date >= day);
  const employeeOnDate = (person: Person) => workspace.employees.find(employee => employee.person_id === person.id && activeOn(employee));
  const stateOf = (person: Person) => {
    const periods = workspace.employees.filter(employee => employee.person_id === person.id);
    return periods.some(employee => employee.status !== 'ended') ? 'employees' : periods.length ? 'alumni' : workspace.applications.some(application => application.person_id === person.id && application.status === 'active') ? 'candidates' : 'talent';
  };
  const groups = [{
    value: 'all',
    label: 'Everyone'
  }, {
    value: 'candidates',
    label: 'Candidates'
  }, {
    value: 'employees',
    label: 'Employees'
  }, {
    value: 'alumni',
    label: 'Alumni'
  }, {
    value: 'talent',
    label: 'Talent pool'
  }];
  const commits = workspace.assignments.filter(assignment => ['reserved', 'confirmed', 'active', 'completed'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day));
  const employeesOnDate = workspace.employees.filter(activeOn);
  const rolloffs = workspace.assignments.filter(assignment => !['completed', 'cancelled'].includes(assignment.status) && assignment.end_date && assignment.end_date >= day && assignment.end_date <= new Date(new Date(`${day}T12:00:00`).getTime() + 30 * 86400000).toISOString().slice(0, 10));
  const currentCapacity = employeesOnDate.reduce((sum, employee) => sum + available(workspace, employee, day), 0);
  const people = workspace.people.filter(person => {
    if (filter !== 'all' && stateOf(person) !== filter) return false;
    const employee = employeeOnDate(person);
    if (capacityFilter === 'available' && (!employee || available(workspace, employee, day) <= 0)) return false;
    return `${person.full_name} ${person.email} ${person.skills} ${person.headline} ${person.location}`.toLowerCase().includes(query.toLowerCase());
  });
  const update = (key: string, value: string) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);else url.searchParams.delete(key);
    window.history.replaceState(null, '', url);
  };
  const assigningEmployee = workspace.employees.find(employee => employee.id === assigning);
  return <>
    <div className="hr-metrics">
      <Metric value={employeesOnDate.length} title="Employed consultants on selected date" />
      <Metric value={(currentCapacity / 100).toFixed(1)} title="Available full-time capacity" />
      <Metric value={commits.length} title="Committed project periods" />
      <Metric value={rolloffs.length} title="Missions ending in the next 30 days" />
    </div>
    <div className="hr-toolbar">
      <SearchField value={query} change={value => {
        setQuery(value);
        update('q', value);
      }} />
      <div className="hr-inline">
        <label className="hr-field">
          <span>Availability date</span>
          <DateField value={day} onChange={setDay} required />
        </label>
        <label className="hr-field">
          <span>Capacity</span>
          <select value={capacityFilter} onChange={event => setCapacityFilter(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="available">Available capacity</option>
          </select>
        </label>
      </div>
    </div>
    <div className="hr-tabs" role="tablist" aria-label="People relationship">
      {groups.map(group => <button role="tab" aria-selected={filter === group.value} key={group.value} onClick={() => {
        setFilter(group.value);
        update('group', group.value);
      }}>
        {group.label}
        <span>
          {workspace.people.filter(person => group.value === 'all' || stateOf(person) === group.value).length}
        </span>
      </button>)}
    </div>
    {people.length ? <div className="hr-table-wrap">
      <table className="hr-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Relationship</th>
            <th>Available on {date(day)}</th>
            <th>Commitments</th>
            <th>Skills</th>
            <th>Owner</th>
            {!canRecruit && <th>Staffing</th>}
          </tr>
        </thead>
        <tbody>
          {people.map(person => {
            const employee = employeeOnDate(person);
            const capacity = employee ? available(workspace, employee, day) : null;
            const periods = employee ? commits.filter(assignment => assignment.employee_id === employee.id) : [];
            return <tr key={person.id}>
              <td>
                {canRecruit ? <PersonLink name={person.full_name} detail={person.headline || person.email} open={() => open(person.id)} /> : <>
                  <strong>
                    {person.full_name}
                  </strong>
                  <small>
                    {person.headline || person.email}
                  </small>
                </>}
              </td>
              <td>
                <Tag tone={employee ? 'good' : 'quiet'}>
                  {label(stateOf(person))}
                </Tag>
                {employee && <small>{employee.planned_exit_date ? `Planned exit ${date(employee.planned_exit_date)}` : `Since ${date(employee.start_date)}`}</small>}
              </td>
              <td>
                {capacity === null ? '—' : <>{capacity}%<div className="hr-capacity-track" aria-hidden="true">
                    <span style={{
                      width: `${capacity}%`
                    }} />
                  </div></>}
              </td>
              <td>
                {employee ? periods.length ? periods.map(assignment => <div key={assignment.id}>{workspace.projects.find(project => project.id === assignment.project_id)?.title ?? 'Project'} · {assignment.allocation_pct}%<small>{label(assignment.status)} · Ends {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</small></div>) : 'No committed project' : '—'}
              </td>
              <td style={{
                maxWidth: 230,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }} title={person.skills || undefined}>
                {person.skills || 'Not recorded'}
              </td>
              <td>
                {person.owner_email || 'Unassigned'}
              </td>
              {!canRecruit && <td>
                {employee && canStaff ? <button className="btn secondary" onClick={() => setAssigning(employee.id)}>Assign project</button> : ''}
              </td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <Empty>No people match these filters. Add a person or adjust the search.</Empty>}
    {!!rolloffs.length && <Section title="Upcoming mission endings" detail="Plan the next assignment before the current commitment ends.">
      <div className="hr-queue">
        {rolloffs.map(assignment => {
          const employee = workspace.employees.find(item => item.id === assignment.employee_id);
          return <div className="hr-queue-row" key={assignment.id}>
            <div>
              <strong>
                {employee ? personName(workspace, employee.person_id) : 'Consultant'}
              </strong>
              <p>{workspace.projects.find(project => project.id === assignment.project_id)?.title} · {assignment.allocation_pct}% · Ends {date(assignment.end_date)}</p>
            </div>
            {employee && <button className="btn secondary" onClick={() => setAssigning(employee.id)}>Plan next</button>}
          </div>;
        })}
      </div>
    </Section>}
    {assigningEmployee && <AssignmentDialog employee={assigningEmployee} workspace={workspace} run={run} busy={busy} day={day} close={() => setAssigning('')} />}
  </>;
}
function Recruiting({
  context
}: {
  context: PageContext;
}) {
  const {
    workspace,
    open
  } = context;
  const [tab, setTab] = useState(() => getParam('recruiting') || 'board');
  const [query, setQuery] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [quickView, setQuickView] = useState<{
    applicationId: string;
    targetStage?: ApplicationStage;
  } | null>(null);
  const [overStage, setOverStage] = useState<ApplicationStage | ''>('');
  const [dragId, setDragId] = useState('');
  const applications = workspace.applications.filter(application => application.status === 'active' && (!opportunityId || application.opportunity_id === opportunityId) && `${personName(workspace, application.person_id)} ${workspace.people.find(person => person.id === application.person_id)?.skills ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const quickApplication = quickView ? workspace.applications.find(application => application.id === quickView.applicationId && application.status === 'active') ?? null : null;
  return <>
    <div className="hr-tabs" role="tablist" aria-label="Recruiting views">
      {[{
        value: 'board',
        title: 'Applications',
        count: workspace.applications.filter(item => item.status === 'active').length
      }, {
        value: 'needs',
        title: 'Hiring needs',
        count: workspace.opportunities.length
      }, {
        value: 'interviews',
        title: 'Interviews',
        count: workspace.interviews.filter(item => item.status === 'scheduled').length
      }, {
        value: 'offers',
        title: 'Offers',
        count: workspace.offers.length
      }].map(item => <button key={item.value} role="tab" aria-selected={tab === item.value} onClick={() => {
        setTab(item.value);
        const url = new URL(window.location.href);
        url.searchParams.set('recruiting', item.value);
        window.history.replaceState(null, '', url);
      }}>
        {item.title}
        <span>
          {item.count}
        </span>
      </button>)}
    </div>
    {tab === 'board' && <>
      <div className="hr-toolbar">
        <SearchField value={query} change={setQuery} placeholder="Search applications by person or skill" />
        <label className="hr-field">
          <span className="sr-only">Hiring need</span>
          <select value={opportunityId} onChange={event => setOpportunityId(event.target.value)}>
            <option value="">All hiring needs</option>
            {workspace.opportunities.map(opportunity => <option key={opportunity.id} value={opportunity.id}>
              {opportunity.title}
            </option>)}
          </select>
        </label>
      </div>
      <div className="hr-board" aria-label="Recruitment stage board" data-dragging={dragId ? '' : undefined}>
        {stages.map(stage => {
          const stageApplications = applications.filter(application => application.stage === stage);
          const empty = stageApplications.length === 0;
          const slim = empty && !dragId;
          return <section key={stage} className={`hr-board-column${overStage === stage ? ' drop-target' : ''}${slim ? ' is-slim' : ''}`} onDragOver={event => {
            if (event.dataTransfer.types.includes('text/plain')) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setOverStage(stage);
            }
          }} onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverStage(current => current === stage ? '' : current);
          }} onDrop={event => {
            event.preventDefault();
            setOverStage('');
            setDragId('');
            const applicationId = event.dataTransfer.getData('text/plain');
            const application = workspace.applications.find(item => item.id === applicationId);
            if (application && application.stage !== stage) setQuickView({
              applicationId: application.id,
              targetStage: stage
            });
          }}>
            <h3>
              {label(stage)}
              <span>
                {stageApplications.length}
              </span>
            </h3>
            {stageApplications.map(application => {
              const person = workspace.people.find(item => item.id === application.person_id);
              const opportunity = workspace.opportunities.find(item => item.id === application.opportunity_id);
              const age = Math.max(0, Math.floor((Date.now() - new Date(application.stage_entered_at).getTime()) / 86400000));
              const decide = () => setQuickView({
                applicationId: application.id
              });
              return <div className="hr-card" key={application.id} tabIndex={0} data-dragging={dragId === application.id ? '' : undefined} draggable onDragStart={event => {
                event.dataTransfer.setData('text/plain', application.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragId(application.id);
              }} onDragEnd={() => {
                setDragId('');
                setOverStage('');
              }} onClick={decide} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  decide();
                }
              }}>
                <div className="hr-board-person">
                  <span className="hr-avatar">
                    {initials(person?.full_name ?? 'Unknown person')}
                  </span>
                  <span className="hr-board-identity">
                    <strong>
                      {person?.full_name ?? 'Unknown person'}
                    </strong>
                    <small>
                      {opportunity?.title ?? 'Hiring need'}
                    </small>
                  </span>
                </div>
                {person?.headline && <p className="hr-board-headline" title={person.headline}>
                  {person.headline}
                </p>}
                <div className="hr-board-foot">
                  <span className="hr-aging"><Clock3 size={12} aria-hidden="true" />{age} {age === 1 ? 'day' : 'days'} in stage · {label(application.source)}</span>
                  <button className="hr-board-decide" onClick={event => {
                    event.stopPropagation();
                    decide();
                  }}>
                    Decide →
                  </button>
                </div>
              </div>;
            })}
            {empty && <div className="hr-board-drop">
              {dragId ? overStage === stage ? 'Release to move here' : 'Drop here' : slim ? 'Empty' : 'No candidates'}
            </div>}
          </section>;
        })}
      </div>
      <p className="hr-source-list">Drag a candidate onto the next stage, or click a card for a quick decision without leaving the board. The full record stays one click away.</p>
      {quickApplication && <ApplicationQuickView key={`${quickApplication.id}-${quickApplication.stage}`} application={quickApplication} context={context} initialStage={quickView?.targetStage} close={() => setQuickView(null)} />}
    </>}
    {tab === 'needs' && <Requisitions context={context} />}
    {tab === 'interviews' && <Section title="Interview schedule" detail="Interview status and invitation status are separate facts.">
      {workspace.interviews.length ? <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Interview</th>
              <th>Scheduled</th>
              <th>Panel</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {[...workspace.interviews].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)).map(interview => {
              const application = workspace.applications.find(item => item.id === interview.application_id);
              return <tr key={interview.id}>
                <td>
                  {application && <PersonLink name={personName(workspace, application.person_id)} open={() => open(application.person_id, application.id)} />}
                </td>
                <td>
                  {label(interview.kind)}
                </td>
                <td>
                  {new Date(interview.scheduled_at).toLocaleString()}
                </td>
                <td>
                  {interview.panel}
                </td>
                <td>
                  <Tag>
                    {label(interview.status)}
                  </Tag>
                  <small>Invitation {label(interview.invitation_status)}</small>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <Empty>Open an application to schedule its first interview.</Empty>}
    </Section>}
    {tab === 'offers' && <Section title="Employment offers" detail="Open the application to draft, approve, share or record a candidate response.">
      {workspace.offers.length ? <div className="hr-table-wrap">
        <table className="hr-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Offer</th>
              <th>Salary / month</th>
              <th>Daily cost / rate</th>
              <th>Margin</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {workspace.offers.map(offer => {
              const application = workspace.applications.find(item => item.id === offer.application_id);
              return <tr key={offer.id}>
                <td>
                  {application && <PersonLink name={personName(workspace, application.person_id)} open={() => open(application.person_id, application.id)} />}
                </td>
                <td>
                  {offer.title}
                  <small>
                    {offer.contract_type}
                  </small>
                </td>
                <td>€{offer.salary_monthly.toLocaleString()}</td>
                <td>€{offer.cjm} / €{offer.target_tjm}</td>
                <td>{offer.margin_pct.toFixed(1)}%</td>
                <td>
                  <Tag tone={offer.status === 'accepted' ? 'good' : ''}>
                    {label(offer.status)}
                  </Tag>
                  <small>Delivery {label(offer.delivery_status)}</small>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <Empty>No employment offers yet.</Empty>}
    </Section>}
  </>;
}
const RATIONALE_MIN = 20;
function ApplicationQuickView({
  application,
  context,
  initialStage,
  close
}: {
  application: Application;
  context: PageContext;
  initialStage?: ApplicationStage;
  close: () => void;
}) {
  const {
    workspace,
    run,
    busy,
    open
  } = context;
  const person = workspace.people.find(item => item.id === application.person_id);
  const opportunity = workspace.opportunities.find(item => item.id === application.opportunity_id);
  const currentIndex = stages.indexOf(application.stage);
  const [target, setTarget] = useState<ApplicationStage | 'rejected'>(initialStage && initialStage !== application.stage ? initialStage : stages[Math.min(currentIndex + 1, stages.length - 1)]);
  const [closing, setClosing] = useState(false);
  const [disposition, setDisposition] = useState<'rejected' | 'withdrawn'>('withdrawn');
  const [rationale, setRationale] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [interviewKind, setInterviewKind] = useState('hr');
  const [scheduledAt, setScheduledAt] = useState('');
  const [panel, setPanel] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rejecting = target === 'rejected';
  const isClosing = closing && !rejecting;
  const rationaleLength = rationale.trim().length;
  const rationaleReady = rationaleLength >= RATIONALE_MIN;
  const scheduleReady = !!scheduledAt && !!panel.trim();
  const cannotSubmit = busy || saving || (scheduling ? !scheduleReady : !rationaleReady);
  const age = Math.max(0, Math.floor((Date.now() - new Date(application.stage_entered_at).getTime()) / 86400000));
  const summary = scheduling ? `Schedule ${label(interviewKind)} interview` : rejecting ? `${label(application.stage)} → Rejected` : isClosing ? `${label(application.stage)} → ${label(disposition)}` : `${label(application.stage)} → ${label(target)}`;
  const record = async () => {
    if (cannotSubmit) return;
    setSaving(true);
    setError('');
    try {
      if (scheduling) {
        await run({
          kind: 'schedule_interview',
          application_id: application.id,
          interview_kind: interviewKind,
          scheduled_at: new Date(scheduledAt).toISOString(),
          panel: panel.trim(),
          location: location.trim()
        }, 'Interview recorded. Send the calendar invitation manually.');
        close();
        return;
      }
      if (rejecting) {
        await run({
          kind: 'dispose_application',
          application_id: application.id,
          expected_version: application.version,
          status: 'rejected',
          reason: rationale.trim()
        }, 'Application rejected with its history preserved.');
      } else if (isClosing) {
        await run({
          kind: 'dispose_application',
          application_id: application.id,
          expected_version: application.version,
          status: disposition,
          reason: rationale.trim()
        }, 'Application closed with its history preserved.');
      } else {
        await run({
          kind: 'move_application',
          application_id: application.id,
          expected_version: application.version,
          to_stage: target,
          rationale: rationale.trim()
        }, 'Application stage updated.');
      }
      close();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  };
  return <Dialog bare className="hr-dialog-quick" title={`Stage decision — ${person?.full_name ?? 'Unknown person'}`} close={close}>
    <div className="hr-quick-head">
      <span className="hr-quick-avatar" aria-hidden="true">{initials(person?.full_name ?? '?')}</span>
      <div className="hr-quick-id">
        <div className="hr-quick-name-row">
          <h2>{person?.full_name ?? 'Unknown person'}</h2>
          <span className="hr-quick-pill">{label(application.stage)}</span>
        </div>
        {person?.headline && <p>{person.headline}</p>}
      </div>
      <button className="hr-icon-button" aria-label="Close stage decision" onClick={close}>
        <X size={20} aria-hidden="true" />
      </button>
    </div>
    <div className="hr-quick-body">
      <div className="hr-quick-summary">
        <div>
          <span>Hiring need</span>
          <strong>{opportunity?.title ?? 'Hiring need'}</strong>
        </div>
        <div>
          <span>Applied</span>
          <strong>{date(application.created_at)}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{label(application.source)}</strong>
        </div>
        <div>
          <span>In stage</span>
          <strong>{age} days</strong>
        </div>
        <button className="hr-quick-link" onClick={() => {
          close();
          open(application.person_id, application.id);
        }}>
          Full record <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="hr-quick-reject-row">
        {application.status === 'active' && <button className={`hr-quick-toggle${scheduling ? ' active' : ''}`} onClick={() => {
          if (scheduling) {
            setScheduling(false);
          } else {
            setScheduling(true);
            setClosing(false);
            setTarget(stages[Math.min(currentIndex + 1, stages.length - 1)]);
          }
        }}>
          {scheduling ? 'Cancel scheduling' : 'Schedule interview'}
        </button>}
        <button className={`hr-quick-toggle${rejecting ? ' active' : ''}`} onClick={() => {
          setScheduling(false);
          setClosing(false);
          setTarget(rejecting ? stages[Math.min(currentIndex + 1, stages.length - 1)] : 'rejected');
        }}>
          {rejecting ? 'Cancel rejection' : 'Reject candidate'}
        </button>
        <button className={`hr-quick-toggle${isClosing ? ' active' : ''}`} onClick={() => {
          setScheduling(false);
          if (isClosing) {
            setClosing(false);
          } else {
            setClosing(true);
            setTarget(stages[Math.min(currentIndex + 1, stages.length - 1)]);
          }
        }}>
          {isClosing ? 'Cancel close' : 'Close this application'}
        </button>
      </div>
      {isClosing && <label className="hr-field hr-quick-disposition">
        <span>Disposition</span>
        <select value={disposition} onChange={event => setDisposition(event.target.value as 'rejected' | 'withdrawn')}>
          <option value="withdrawn">Withdrawn</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>}
      {scheduling && <div className="hr-quick-schedule">
        <div className="hr-quick-section-head">
          <label>Interview details</label>
          <span className="hr-quick-hint">Required · the calendar invitation is still sent manually</span>
        </div>
        <div className="hr-quick-schedule-grid">
          <label className="hr-field">
            <span>Interview type</span>
            <select value={interviewKind} onChange={event => setInterviewKind(event.target.value)}>
              <option value="hr">HR</option>
              <option value="technical">Technical</option>
              <option value="client">Client</option>
            </select>
          </label>
          <label className="hr-field">
            <span>Date and time</span>
            <input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
          </label>
          <label className="hr-field hr-wide">
            <span>Interview panel</span>
            <input value={panel} onChange={event => setPanel(event.target.value)} placeholder="Names or email addresses of the interviewers" />
          </label>
          <label className="hr-field hr-wide">
            <span>Meeting link or location</span>
            <input value={location} onChange={event => setLocation(event.target.value)} placeholder="Video link or room" />
          </label>
        </div>
      </div>}
      {!scheduling && <div className="hr-quick-rationale">
        <div className="hr-quick-section-head">
          <label htmlFor="hr-quick-rationale-input">Comments</label>
          <span className="hr-quick-hint">{rationaleReady ? 'Required · ready' : `Required · ${RATIONALE_MIN - rationaleLength} more characters`}</span>
        </div>
        <textarea id="hr-quick-rationale-input" rows={5} value={rationale} onChange={event => setRationale(event.target.value)} placeholder="What did you see that supports this move? Keep it factual — it’s stored on the candidate’s record." />
      </div>}
    </div>
    <div className="hr-quick-foot">
      <span className="hr-quick-summary-text">{summary}</span>
      <button className="btn secondary" disabled={saving} onClick={close}>Cancel</button>
      <button className={`btn${rejecting || isClosing ? ' hr-quick-reject-btn' : ''}`} disabled={cannotSubmit} onClick={() => void record()}>
        {saving ? 'Recording…' : scheduling ? 'Schedule interview' : rejecting ? 'Record rejection' : isClosing ? 'Record disposition' : `Move to ${label(target)}`}
      </button>
    </div>
    {error && <p role="alert" className="hr-error hr-quick-error">{error}</p>}
  </Dialog>;
}
function RequisitionForm({
  opportunity,
  onSaved,
  context: {
    workspace,
    run,
    busy,
    actorEmail
  }
}: {
  opportunity?: Opportunity;
  onSaved?: () => void;
  context: PageContext;
}) {
  const [jobId, setJobId] = useState(opportunity?.job_id ?? '');
  const job = workspace.jobs.find(item => item.id === jobId);
  const save: RunCommand = async (input, success) => {
    await run(input, success);
    onSaved?.();
  };
  return <Form run={save} busy={busy} button={opportunity ? 'Save hiring need' : 'Create hiring need'} success={opportunity ? 'Hiring need updated.' : 'Hiring need created and approved. Applications can now be opened.'} submit={data => ({
    kind: opportunity ? 'update_requisition' : 'create_requisition',
    ...(opportunity ? {
      opportunity_id: opportunity.id,
      expected_version: opportunity.version
    } : {}),
    title: job?.title ?? text(data, 'title'),
    hiring_mode: text(data, 'hiring_mode'),
    skill_family: text(data, 'skill_family'),
    owner_email: text(data, 'owner_email'),
    job_id: nullable(data, 'job_id'),
    project_id: nullable(data, 'project_id'),
    client_ids: data.getAll('client_ids').map(String),
    justification: text(data, 'justification')
  })}>
    <label className="hr-field">
      <span>
        Linked job post
      </span>
      <select name="job_id" value={jobId} onChange={event => setJobId(event.target.value)}>
        <option value="">Not set</option>
        {workspace.jobs.map(item => <option key={item.id} value={item.id}>
          {`${item.title}${item.published ? ' · Published' : ' · Draft'}`}
        </option>)}
      </select>
      <small>
        The role title and requirements come from the linked job post.
      </small>
    </label>
    {job ? <p className="hr-source-list hr-wide">Role and requirements are taken from “{job.title}”.</p> : <Field name="title" label="Role to hire" value={opportunity?.title} required hint="Named manually until a job post is linked — the post then provides the title and requirements." />}
    <Field name="hiring_mode" label="Hiring mode" value={opportunity?.hiring_mode ?? 'sur_mission'} options={[{
      value: 'sur_mission',
      label: 'For a client mission'
    }, {
      value: 'sur_profil',
      label: 'Ahead of demand'
    }]} required />
    <Field name="skill_family" label="Skill family" value={opportunity?.skill_family} />
    <Field name="owner_email" label="Hiring owner" type="email" value={opportunity?.owner_email ?? actorEmail} required />
    <Field name="project_id" label="Staffing project" options={workspace.projects.map(project => ({
      value: project.id,
      label: project.title
    }))} value={opportunity?.project_id} />
    <SearchMultiField name="client_ids" label="Linked clients" values={opportunity?.client_ids ?? []} options={workspace.clients.map(client => ({
      value: client.id,
      label: client.name
    }))} placeholder="Search clients…" hint="Search and add one or several clients behind this hiring need." />
    <Field name="justification" label="Commercial hiring justification" type="textarea" value={opportunity?.justification} hint="For a profile hire, explain the pipeline demand and expected staffing." />
  </Form>;
}
function Requisitions({
  context
}: {
  context: PageContext;
}) {
  const {
    workspace,
    run,
    busy
  } = context;
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  return <>
    <div className="hr-toolbar">
      <span className="hr-source-list">{workspace.opportunities.length} hiring needs · linked to job posts and clients</span>
      <button className="btn" onClick={() => setCreateOpen(true)}><Plus size={16} aria-hidden="true" /> Create hiring need</button>
    </div>
    {createOpen && <Dialog title="Create a hiring need" close={() => setCreateOpen(false)}>
      <RequisitionForm context={context} onSaved={() => setCreateOpen(false)} />
    </Dialog>}
    {editing && <Dialog title={`Edit hiring need / ${editing.title}`} close={() => setEditing(null)}>
      <RequisitionForm opportunity={editing} context={context} onSaved={() => setEditing(null)} />
    </Dialog>}
    {!workspace.opportunities.length && <Empty>Hiring starts with an approved need linked to a mission or a justified profile hire.</Empty>}
    {workspace.opportunities.map(opportunity => {
      const job = workspace.jobs.find(item => item.id === opportunity.job_id);
      const clients = workspace.clients.filter(client => opportunity.client_ids.includes(client.id));
      const editable = ['draft', 'pending_approval', 'approved'].includes(opportunity.status);
      return <div className="hr-card" key={opportunity.id}>
        <div className="hr-card-head">
          <div>
            <h3>
              {opportunity.title}
            </h3>
            <small>{opportunity.hiring_mode === 'sur_mission' ? 'Client mission' : 'Ahead of demand'} · {opportunity.owner_email || 'Unassigned'} · {workspace.applications.filter(application => application.opportunity_id === opportunity.id).length} applications{job ? ` · Job post: ${job.title}${job.published ? ' (published)' : ' (draft)'}` : ''}{clients.length ? ` · ${clients.length === 1 ? 'Client' : 'Clients'}: ${clients.map(client => client.name).join(', ')}` : ''}</small>
          </div>
          <div className="hr-inline">
            {editable && <button className="btn secondary" onClick={() => setEditing(opportunity)}>Edit</button>}
            <Tag tone={['approved', 'published'].includes(opportunity.status) ? 'good' : 'quiet'}>
              {label(opportunity.status)}
            </Tag>
          </div>
        </div>
        {opportunity.client_need && <p>
          {opportunity.client_need}
        </p>}
        {opportunity.justification && <p>Hiring justification: {opportunity.justification}</p>}
        {opportunity.status === 'approved' && <details className="hr-disclosure">
          <summary>Publish the connected job post</summary>
          <Form run={run} busy={busy} button="Publish job post" success="Connected job post published and requisition updated." submit={data => ({
            kind: 'publish_requisition',
            opportunity_id: opportunity.id,
            expected_version: opportunity.version,
            job_id: text(data, 'job_id')
          })}>
            <Field name="job_id" label="Connected job post" value={opportunity.job_id} options={workspace.jobs.map(job => ({
              value: job.id,
              label: `${job.title}${job.published ? ' · Published' : ' · Draft'}`
            }))} required hint="Create a public job post in Job posts first, then connect it here." />
          </Form>
        </details>}
      </div>;
    })}
  </>;
}
function Journeys({
  context: {
    workspace,
    open
  }
}: {
  context: PageContext;
}) {
  const [tab, setTab] = useState('arrivals');
  const [query, setQuery] = useState('');
  const people = workspace.employees.filter(employee => personName(workspace, employee.person_id).toLowerCase().includes(query.toLowerCase()) && (tab === 'arrivals' ? employee.status !== 'ended' && employee.status !== 'offboarding' && !employee.onboarding_completed_at : tab === 'probation' ? employee.status !== 'ended' && employee.probation_status !== 'confirmed' : tab === 'departures' ? employee.status === 'offboarding' : employee.status === 'ended'));
  return <>
    <div className="hr-tabs" role="tablist" aria-label="Journey phases">
      {[{
        value: 'arrivals',
        title: 'Arrivals and onboarding'
      }, {
        value: 'probation',
        title: 'Probation'
      }, {
        value: 'departures',
        title: 'Departures'
      }, {
        value: 'completed',
        title: 'Closed periods'
      }].map(item => <button key={item.value} role="tab" aria-selected={tab === item.value} onClick={() => setTab(item.value)}>
        {item.title}
      </button>)}
    </div>
    <div className="hr-toolbar">
      <SearchField value={query} change={setQuery} placeholder="Search employee journeys" />
      <span className="hr-source-list">{people.length} employment periods</span>
    </div>
    {people.length ? <div className="hr-table-wrap">
      <table className="hr-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Employment</th>
            <th>Checklist</th>
            <th>Probation</th>
            <th>Next date</th>
            <th>Journey</th>
          </tr>
        </thead>
        <tbody>
          {people.map(employee => {
            const tasks = workspace.tasks.filter(task => task.employee_id === employee.id);
            const exit = workspace.exits.find(item => item.employee_id === employee.id);
            const requiredOpen = tasks.filter(task => task.required && !task.completed_at);
            return <tr key={employee.id}>
              <td>
                <PersonLink name={personName(workspace, employee.person_id)} detail={employee.role} open={() => open(employee.person_id, undefined, employee.id)} />
              </td>
              <td>
                <Tag tone={employee.status === 'ended' ? 'quiet' : 'good'}>
                  {label(employee.status)}
                </Tag>
                <small>Started {date(employee.start_date)}</small>
              </td>
              <td>{tasks.filter(task => task.completed_at).length}/{tasks.length} tasks<small>{requiredOpen.length} required remaining</small></td>
              <td>
                {label(employee.probation_status)}
                <small>
                  {date(employee.probation_end)}
                </small>
              </td>
              <td>
                {exit ? `Exit ${date(exit.exit_date)}` : employee.status === 'preboarding' ? `Arrival ${date(employee.start_date)}` : `Review ${date(workspace.reviews.find(review => review.employee_id === employee.id && review.status === 'scheduled')?.due_date)}`}
              </td>
              <td>
                <button className="btn secondary" onClick={() => open(employee.person_id, undefined, employee.id)}>Open plan</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <Empty>No journeys in this view. New hires automatically start a preboarding plan.</Empty>}
  </>;
}
function AssignmentDialog({
  employee,
  workspace,
  run,
  busy,
  day,
  close
}: {
  employee: Employee;
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
  day: string;
  close: () => void;
}) {
  return <Dialog title={`Staff ${personName(workspace, employee.person_id)}`} close={close}>
    <AssignForm employee={employee} workspace={workspace} run={run} busy={busy} />
    <Section title="Assignment history">
      {workspace.assignments.filter(assignment => assignment.employee_id === employee.id).map(assignment => <div className="hr-card" key={assignment.id}>
        <div className="hr-card-head">
          <div>
            <h3>
              {workspace.projects.find(project => project.id === assignment.project_id)?.title}
            </h3>
            <small>{date(assignment.start_date)} to {date(assignment.end_date)} · {assignment.allocation_pct}%</small>
          </div>
          <Tag>
            {label(assignment.status)}
          </Tag>
        </div>
        {!['completed', 'cancelled'].includes(assignment.status) && <Form run={run} busy={busy} button="End assignment" success="Assignment ended, preserving its history." submit={data => ({
          kind: 'end_assignment',
          assignment_id: assignment.id,
          expected_version: assignment.version,
          end_date: text(data, 'end_date'),
          rationale: text(data, 'rationale'),
          cancel: checked(data, 'cancel')
        })}>
          <Field name="end_date" label="Ends" type="date" value={day} min={assignment.start_date} required />
          <Field name="rationale" label="Reason" required />
          <label className="hr-checkbox"><input type="checkbox" name="cancel" />Cancel future or proposed period</label>
        </Form>}
      </div>)}
    </Section>
  </Dialog>;
}
