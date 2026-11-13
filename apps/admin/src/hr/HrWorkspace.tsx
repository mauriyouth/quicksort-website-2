import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@clerk/react';
import { CalendarDays, Clock3, Plus, RefreshCw, Search, Users, MapPin, ArrowUpRight, ArrowLeft, BriefcaseBusiness } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import { cn } from 'cn';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Field as UiField,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatGroup,
  StatLabel,
  StatValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@quicksort-sas/ui';
import { executeCommand, loadWorkspace } from './data';
import type { CommandResult, Employee, Opportunity, Person, Workspace } from './domain';
import { AssignForm, PersonWorkspace, available, personName, stages, type PersonTab, type RecordContext } from './PersonWorkspace';
import { Dialog, Empty, Field, Form, PersonLink, SearchMultiField, Section, Tag, avatarClass, checked, date, initials, label, nullable, text, today, type RunCommand } from './ui';
import { PageAlerts, PageHeading } from '../ui';
import type { ApplicationStage } from './domain';
import { DateField } from '../DateField';
import { Intake } from './Intake';
import { CraScreen } from '../cra/CraScreen';
import { loadMonth } from '../cra/data';
import { balanceFor, fmtDays, useLeaveBalances } from '../cra/balances';
import { accruesLeave, monthDays } from '../cra/domain';
import './workspace.css';
import { DocumentAlertsQueue } from '../documents/DocumentAlerts';
import { copyCv } from './recruitmentCv';
import { PersonPhoto } from '../documents/PersonPhoto';
import { PaidLeaveAdjust } from './PaidLeaveAdjust';
import { HiringNeedPage, NEEDS_LIST, needRoute, needUrl } from './HiringNeed';
export type HrView = 'overview' | 'recruiting' | 'people' | 'journeys';
const viewTitles: Record<HrView, string> = {
  overview: 'Overview',
  recruiting: 'Recruiting',
  people: 'People',
  journeys: 'Journeys'
};
type OpenPerson = (personId: string, applicationId?: string, employeeId?: string) => void;
type PageContext = RecordContext & {
  open: OpenPerson;
};
const getParam = (key: string) => new URLSearchParams(window.location.search).get(key) ?? '';
// Person records route as paths, not query params: /hr/people/<personId> with
// the record tab as the next segment. Tab keys map to URL segments (the
// internal "history" tab lives at .../activity). A record URL without a tab
// segment opens the tab that fits the person (see defaultPersonTab).
const TAB_SEGMENTS: Record<PersonTab, string> = {
  profile: 'profile',
  applications: 'applications',
  employment: 'employments',
  projects: 'projects',
  cra: 'cra',
  history: 'activity'
};
const SEGMENT_TABS: Record<string, PersonTab> = {
  profile: 'profile',
  applications: 'applications',
  employments: 'employment',
  projects: 'projects',
  cra: 'cra',
  activity: 'history'
};
const personRoute = (): { personId: string; tab: PersonTab | null; employmentId: string } => {
  // The CRA tab pins the viewed month as extra segments:
  // /hr/people/<id>/cra/2026/10 (the CRA screen owns them; the record
  // router keeps resolving the tab and ignores the tail). The employments
  // tab pins the selected employment: /hr/people/<id>/employments/<employmentId>.
  const match = window.location.pathname.match(/^\/hr\/people\/([^/]+?)(?:\/([^/]+?)(?:\/(\d{4})\/(0[1-9]|1[0-2])|\/([^/]+?))?)?\/?$/);
  if (!match) return { personId: '', tab: null, employmentId: '' };
  const tab = match[2] ? SEGMENT_TABS[match[2]] ?? 'profile' : null;
  return { personId: match[1], tab, employmentId: tab === 'employment' ? decodeURIComponent(match[5] ?? '') : '' };
};
// The People list keeps its filters (?q=, ?group=) in the URL; carry them
// through person navigation so closing a record returns to the same list.
const listFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const kept = new URLSearchParams();
  for (const key of ['q', 'group']) if (params.get(key)) kept.set(key, params.get(key) ?? '');
  return kept;
};
const personUrl = (id: string, tab: PersonTab | null, params = new URLSearchParams(), employmentId = '') => {
  const segment = tab ? TAB_SEGMENTS[tab] : '';
  const record = tab === 'employment' && employmentId ? `/${encodeURIComponent(employmentId)}` : '';
  const url = new URL(`/hr/people/${id}${segment ? `/${segment}` : ''}${record}`, window.location.origin);
  url.search = params.toString();
  return url.pathname + url.search;
};
// Rewrite one query param on the current URL (list filters, recruiting tab).
const withParam = (key: string, value: string) => {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);else url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
};
/** The tab a record opens on when the URL names none: employment for staff, applications for candidates. */
function defaultPersonTab(workspace: Workspace, personId: string): PersonTab {
  if (workspace.employees.some(employee => employee.person_id === personId && employee.status !== 'ended')) return 'employment';
  if (workspace.applications.some(application => application.person_id === personId && application.status === 'active')) return 'applications';
  return 'profile';
}
const CONTRACT_KIND: Record<string, { title: string; group: string; list: string }> = {
  CDI: { title: 'Employee · CDI', group: 'cdi', list: 'CDI' },
  CDD: { title: 'Employee · CDD', group: 'cdd', list: 'CDD' },
  Freelance: { title: 'Freelance', group: 'freelance', list: 'Freelance' },
  Internship: { title: 'Intern', group: 'interns', list: 'Interns' },
  Apprenticeship: { title: 'Apprentice', group: 'alternants', list: 'Alternants' }
};
/**
 * What this person is to Quicksort right now, and the list they belong to:
 * staff (by contract) and alumni live under People, candidates and the
 * talent pool under Recruiting.
 */
export function personKind(workspace: Workspace, personId: string) {
  const employees = workspace.employees.filter(employee => employee.person_id === personId);
  const live = employees.find(employee => employee.status !== 'ended');
  if (live) {
    const kind = CONTRACT_KIND[live.contract_type] ?? { title: 'Employee', group: 'no_contract', list: 'No contract' };
    return { title: live.status === 'active' ? kind.title : `${kind.title} · ${label(live.status)}`, live: true, back: { href: `/hr/people?group=${kind.group}`, label: `People · ${kind.list}` } };
  }
  if (employees.length) return { title: 'Alumni', live: false, back: { href: '/hr/people?group=alumni', label: 'People · Alumni' } };
  const active = workspace.applications.filter(application => application.person_id === personId && application.status === 'active');
  if (active.length) {
    const need = active.length === 1 ? workspace.opportunities.find(opportunity => opportunity.id === active[0].opportunity_id)?.title : '';
    return { title: active.length > 1 ? `Candidate · ${active.length} applications` : need ? `Candidate · ${need}` : 'Candidate', live: false, back: { href: '/hr/recruiting', label: 'Recruiting · Applications' } };
  }
  return { title: 'Talent pool', live: false, back: { href: '/hr/recruiting?recruiting=talent', label: 'Recruiting · Talent pool' } };
}
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
  // null: the URL names no tab, so the record opens on the one that fits the person.
  const [personTab, setPersonTab] = useState<PersonTab | null>(() => personRoute().tab);
  const [applicationId, setApplicationId] = useState(() => getParam('application'));
  const [employeeId, setEmployeeId] = useState(() => personRoute().employmentId || getParam('employment'));
  const location = useLocation();
  const navigate = useNavigate();
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
    // Legacy ?person= and ?employment= deep links (bookmarks, shared links)
    // become paths.
    const legacy = getParam('person') || personRoute().personId;
    const employment = getParam('employment');
    if (!getParam('person') && !(legacy && employment)) return;
    const application = getParam('application');
    const tab: PersonTab | null = application ? 'applications' : employment ? 'employment' : null;
    const params = listFilters();
    if (application) params.set('application', application);
    navigate(personUrl(legacy, tab, params, employment), { replace: true });
  }, []);
  // The open record follows the URL: react-router owns history, so header
  // tabs, back/forward and in-page links all land here.
  useEffect(() => {
    const route = personRoute();
    setPersonId(route.personId);
    setPersonTab(route.tab);
    setApplicationId(getParam('application'));
    setEmployeeId(route.employmentId || getParam('employment'));
  }, [location.pathname, location.search]);
  const open: OpenPerson = (id, application, employee) => {
    const tab: PersonTab | null = application ? 'applications' : employee ? 'employment' : null;
    const params = listFilters();
    if (application) params.set('application', application);
    navigate(personUrl(id, tab, params, employee));
  };
  const navigatePersonTab = (tab: PersonTab) => {
    if (!personId) return;
    navigate(personUrl(personId, tab, listFilters()));
  };
  const run: RunCommand = async (input, success = 'Saved.') => {
    setBusy(true);
    setError('');
    setMessage('');
    let result: CommandResult;
    try {
      result = await executeCommand(input);
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
    return result;
  };
  const selectedPerson = workspace?.people.find(person => person.id === personId);
  const selectedEmployees = workspace && selectedPerson ? workspace.employees.filter(employee => employee.person_id === selectedPerson.id) : [];
  const selectedLive = selectedEmployees.find(employee => employee.status !== 'ended');
  const selectedAlumni = !selectedLive && selectedEmployees.length > 0;
  const selectedApplicationCount = workspace && selectedPerson ? workspace.applications.filter(application => application.person_id === selectedPerson.id).length : 0;
  const canRecruit = !!workspace?.capabilities.recruit;
  const needId = view === 'recruiting' ? needRoute(location.pathname) : '';
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
  return <div className="flex min-w-0 flex-col gap-6" aria-busy={loading}>
    {!(selectedPerson && canRecruit) && !(needId && canRecruit) && <PageHeading eyebrow="People operations" title={viewTitles[view]} action={<div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={loading || busy} onClick={() => {
          setLoading(true);
          setError('');
          void reload().catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false));
        }}><RefreshCw aria-hidden="true" /> Refresh</Button>
        {canRecruit && <Button variant="pivot" onClick={() => setIntake(true)}><Plus aria-hidden="true" /> Add person</Button>}
        {!canRecruit && view === 'people' && <Button variant="outline" onClick={() => setMyCra(true)}><CalendarDays aria-hidden="true" /> My CRA</Button>}
      </div>}>
    </PageHeading>}
    <PageAlerts error={error} message={message} />
    {loading && !workspace ? <Empty>
      <span role="status">Loading the HR workspace…</span>
    </Empty> : context && (canRecruit || canStaff) ? <>
      {view === 'overview' && !selectedPerson && <Overview context={context} />}
      {view === 'recruiting' && !selectedPerson && (needId && canRecruit ? <HiringNeedPage needId={needId} context={context} /> : <Recruiting context={context} />)}
      {view === 'people' && !selectedPerson && <People context={context} />}
      {view === 'journeys' && !selectedPerson && <Journeys context={context} />}
      {intake && canRecruit && <Dialog title="Add a person" close={() => setIntake(false)}>
        <Intake actorEmail={actorEmail} run={run} busy={busy} positions={context.workspace.opportunities.filter(opportunity => !opportunity.archived_at)} onAdded={warning => {
          setIntake(false);
          if (warning) setError(warning);
        }} />
      </Dialog>}
      {myCra && <Dialog title="My CRA" className="sm:max-w-5xl" close={() => setMyCra(false)}>
        <CraScreen audience="employee" draftOwner={actorEmail} />
      </Dialog>}
      {selectedPerson && canRecruit && <PersonPage person={selectedPerson} context={context} live={selectedLive} alumni={selectedAlumni} applicationCount={selectedApplicationCount} tab={personTab ?? defaultPersonTab(context.workspace, selectedPerson.id)} onNavigate={navigatePersonTab} initialApplication={applicationId} initialEmployment={employeeId} />}
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
  const kind = personKind(context.workspace, person.id);
  const availability = live ? available(context.workspace, live, today()) : null;
  const employees = context.workspace.employees.filter(employee => employee.person_id === person.id);
  const lastCra = useLastCra(employees);
  // Remaining leave across every employment period of this person, net of
  // CRA consumption (per calendar month from each start: CP and RTT at month end).
  const { balances, error: balanceError, reload: reloadBalances } = useLeaveBalances(employees.map(employee => employee.id));
  // Paid leave is adjusted on the live employment, else the latest one.
  const leaveEmployee = live && accruesLeave(live) ? live : [...employees].filter(accruesLeave).sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  const [adjustingLeave, setAdjustingLeave] = useState(false);
  // CP/RTT only accrue on salaried contracts; freelance and internal
  // employments have no balance.
  const leaveEmployees = employees.filter(accruesLeave);
  const cpLeft = leaveEmployees.reduce((sum, employee) => sum + balanceFor(balances, employee.id, 'cp'), 0);
  const rttLeft = leaveEmployees.reduce((sum, employee) => sum + balanceFor(balances, employee.id, 'rtt'), 0);
  const day = today();
  // The staffing commitment that currently books this person, highest
  // allocation first — shown as “Client — Project”, like the CRA default.
  const currentAssignment = context.workspace.assignments.filter(assignment => employees.some(employee => employee.id === assignment.employee_id) && ['reserved', 'confirmed', 'active'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day)).sort((a, b) => b.allocation_pct - a.allocation_pct)[0];
  const assignmentProject = currentAssignment ? context.workspace.projects.find(project => project.id === currentAssignment.project_id) : undefined;
  const assignmentClient = assignmentProject?.client_id ? context.workspace.clients.find(client => client.id === assignmentProject.client_id) : undefined;
  const defaultAssignment = assignmentProject ? `${assignmentClient ? `${assignmentClient.name} · ` : ''}${assignmentProject.title}` : 'None';
  const craTally = lastCra && lastCra.filled > 0 && lastCra.workdays > 0 && lastCra.filled < lastCra.workdays ? `${lastCra.filled % 1 ? lastCra.filled.toFixed(1) : lastCra.filled} / ${lastCra.workdays} days` : '';
  const craLabel = !lastCra ? '—' : `${new Date(`${lastCra.month}-01T12:00:00`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric'
  })}${craTally ? ` · ${craTally}` : lastCra.filled > 0 && lastCra.workdays > 0 ? ' · Complete' : ''}`;
  const stat = 'flex min-w-0 flex-col gap-1';
  return <div className="flex min-w-0 flex-col">
    <header className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 border-b border-border pb-5">
      <Link to={kind.back.href} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground no-underline hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />{kind.back.label}</Link>
      {/* Person header: breadcrumb and title merged, name shown once */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-[1_1_auto] items-center gap-4">
          <PersonPhoto personId={person.id} name={person.full_name} fallback={initials(person.full_name)} className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-foreground object-cover font-heading text-lg font-medium tracking-[-0.02em] text-background" editable />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="m-0 font-heading text-[28px] leading-none font-medium tracking-[-0.02em]">{person.full_name}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:text-faint [&>*:not(:first-child)]:before:content-['·']">
              {person.headline && <span>{person.headline}</span>}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground">
                <span className={cn('size-1.5 rounded-full', kind.live ? 'bg-success' : 'bg-faint')} aria-hidden="true" />
                {kind.title}
              </span>
              {availability !== null && <span>{availability}% available today</span>}
              {person.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{person.location}</span>}
              {person.linkedin_url && <a className="inline-flex items-center gap-1 font-medium text-foreground" href={person.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn profile<ArrowUpRight className="size-3" aria-hidden="true" /></a>}
            </div>
          </div>
        </div>
        {/* Candidates and talent pool have no employment yet: no assignment, CRA or leave to show. */}
        {employees.length > 0 && <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className={stat}>
            <dt className="label-mono">Default assignment</dt>
            <dd className="m-0 font-medium">{defaultAssignment}</dd>
          </div>
          <div className={stat}>
            <dt className="label-mono">Last CRA</dt>
            <dd className="m-0 font-medium">{craLabel}</dd>
          </div>
          {leaveEmployees.length > 0 && <div className={stat}>
            <dt className="label-mono">CP balance</dt>
            <dd className="m-0 flex items-baseline gap-2 font-medium">
              {balanceError ? 'unavailable' : `${fmtDays(cpLeft)} days`}
              {leaveEmployee && <Button type="button" variant="link" size="xs" className="text-muted-foreground" onClick={() => setAdjustingLeave(true)}>Adjust</Button>}
            </dd>
          </div>}
          {leaveEmployees.length > 0 && <div className={stat}>
            <dt className="label-mono">RTT balance</dt>
            <dd className="m-0 font-medium">{balanceError ? 'unavailable' : `${fmtDays(rttLeft)} days`}</dd>
          </div>}
        </dl>}
      </section>
    </header>
    {adjustingLeave && leaveEmployee && <PaidLeaveAdjust employeeId={leaveEmployee.id} personName={person.full_name} close={() => setAdjustingLeave(false)} saved={reloadBalances} />}
    <div className="mx-auto grid w-full max-w-[1120px] pt-4 pb-16">
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
  return <Stat size="sm">
    <StatValue className={urgent ? 'text-destructive' : undefined}>
      {value}
    </StatValue>
    <StatLabel>
      {title}
    </StatLabel>
  </Stat>;
}
/** The four-figure rail at the top of Overview and People. */
function Metrics({ children }: { children: ReactNode }) {
  return <Card size="sm">
    <CardContent>
      <StatGroup>{children}</StatGroup>
    </CardContent>
  </Card>;
}
/** A bordered list of “title · detail · action” rows (Overview queues, mission endings). */
function Queue({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{children}</div>;
}
function QueueRow({ title, detail, action }: { title: ReactNode; detail: ReactNode; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-3.5">
    <div className="flex min-w-0 flex-col gap-1">
      <strong className="text-sm font-medium">{title}</strong>
      <p className="m-0 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{detail}</p>
    </div>
    {action}
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
    <Metrics>
      <Metric value={active.length} title="Active applications" />
      <Metric value={arrivals.length} title="Arrivals in the next 30 days" />
      <Metric value={overdue.length} title="Overdue journey tasks" urgent={overdue.length > 0} />
      <Metric value={exits.length} title="Open departures" />
    </Metrics>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Section title="Your action queue" detail="Assigned work, ordered by due date.">
          {myTasks.length ? <Queue>
            {myTasks.slice(0, 10).map(task => {
              const employee = workspace.employees.find(item => item.id === task.employee_id);
              return <QueueRow key={task.id} title={task.title} detail={<>{employee ? personName(workspace, employee.person_id) : 'Employment'} · {label(task.phase)} · Due {date(task.due_date)}</>} action={employee && <Button variant="outline" size="sm" onClick={() => open(employee.person_id, undefined, employee.id)}>Open plan</Button>} />;
            })}
          </Queue> : <Empty><CheckMessage />No pending tasks assigned to you.</Empty>}
        </Section>
        <Section title="Offer approvals" detail="Review compensation and the commercial justification before approval.">
          {offers.length ? <Queue>
            {offers.slice(0, 6).map(offer => {
              const application = workspace.applications.find(item => item.id === offer.application_id);
              return <QueueRow key={offer.id} title={offer.title} detail={<>{application ? personName(workspace, application.person_id) : 'Application'} · {offer.margin_pct.toFixed(1)}% margin · {label(offer.status)}</>} action={application && <Button variant="outline" size="sm" onClick={() => open(application.person_id, application.id)}>Review</Button>} />;
            })}
          </Queue> : <Empty>No offers waiting for approval.</Empty>}
        </Section>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Section title="Upcoming interviews" detail="Send calendar invitations manually after scheduling.">
          {interviews.length ? <Queue>
            {interviews.slice(0, 5).map(interview => {
              const application = workspace.applications.find(item => item.id === interview.application_id);
              return <QueueRow key={interview.id} title={application ? personName(workspace, application.person_id) : 'Application'} detail={<><CalendarDays className="size-3" aria-hidden="true" /> {label(interview.kind)} · {new Date(interview.scheduled_at).toLocaleString()}</>} action={application && <Button variant="outline" size="sm" onClick={() => open(application.person_id, application.id)}>Open</Button>} />;
            })}
          </Queue> : <Empty>No upcoming interviews.</Empty>}
        </Section>
        <Section title="Probation and review decisions">
          {reviews.length ? <Queue>
            {reviews.slice(0, 5).map(review => {
              const employee = workspace.employees.find(item => item.id === review.employee_id);
              return <QueueRow key={review.id} title={employee ? personName(workspace, employee.person_id) : 'Employment'} detail={<>{label(review.kind)} · Due {date(review.due_date)}</>} action={employee && <Button variant="outline" size="sm" onClick={() => open(employee.person_id, undefined, employee.id)}>Review</Button>} />;
            })}
          </Queue> : <Empty>No pending review decisions.</Empty>}
        </Section>
        <Section title="Documents to renew" detail="Expired, expiring or missing employee documents.">
          <DocumentAlertsQueue onOpenPerson={personId => {
            const employee = workspace.employees.find(item => item.person_id === personId && item.status !== 'ended');
            open(personId, undefined, employee?.id);
          }} />
        </Section>
      </div>
    </div>
  </>;
}
/** Secondary line under a table cell value. */
function Detail({ children }: { children: ReactNode }) {
  return <small className="mt-1 block text-xs text-muted-foreground">{children}</small>;
}
function CheckMessage() {
  return <Users className="mx-auto mb-2.5 block size-5" aria-hidden="true" />;
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
  return <InputGroup className="w-full sm:w-72">
    <InputGroupAddon>
      <Search aria-hidden="true" />
    </InputGroupAddon>
    <InputGroupInput type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={event => change(event.target.value)} />
  </InputGroup>;
}
/** Underline tabs with an optional count; the panels render below, outside the list. */
function ViewTabs({ label: ariaLabel, value, onChange, items }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; title: string; count?: number }[];
}) {
  return <Tabs value={value} onValueChange={next => onChange(String(next))} className="min-w-0">
    <TabsList variant="line" aria-label={ariaLabel} className="h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border">
      {items.map(item => <TabsTrigger key={item.value} value={item.value} className="flex-none gap-1.5 group-data-horizontal/tabs:after:bottom-0">
        {item.title}
        {item.count !== undefined && <span className="num text-xs text-muted-foreground">{item.count}</span>}
      </TabsTrigger>)}
    </TabsList>
  </Tabs>;
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
  // Current staff are grouped by contract; 'employees' links from before the split open on Everyone.
  const [filter, setFilter] = useState(() => {
    const param = getParam('group');
    // Applicants live in the Recruitment pipeline, not the People list.
    return param && param !== 'employees' && param !== 'candidates' && param !== 'talent' ? param : 'all';
  });
  const [day, setDay] = useState(today());
  const [capacityFilter, setCapacityFilter] = useState('all');
  const [assigning, setAssigning] = useState('');
  const activeOn = (employee: Employee) => employee.status !== 'ended' && employee.start_date <= day && (!employee.end_date || employee.end_date >= day) && (!employee.planned_exit_date || employee.planned_exit_date >= day);
  const employeeOnDate = (person: Person) => workspace.employees.find(employee => employee.person_id === person.id && activeOn(employee));
  const contractGroups: Record<string, string> = { CDI: 'cdi', CDD: 'cdd', Freelance: 'freelance', Internship: 'interns', Apprenticeship: 'alternants' };
  const stateOf = (person: Person) => {
    const periods = workspace.employees.filter(employee => employee.person_id === person.id);
    const live = periods.find(employee => employee.status !== 'ended');
    if (live) return contractGroups[live.contract_type] ?? 'no_contract';
    return periods.length ? 'alumni' : workspace.applications.some(application => application.person_id === person.id && application.status === 'active') ? 'candidates' : 'talent';
  };
  // Applicants (an active application, never employed) are managed in the
  // Recruitment pipeline, so the People list leaves them out entirely.
  const listed = workspace.people.filter(person => stateOf(person) !== 'candidates');
  // “Everyone” means people under a live contract (employees and freelancers);
  // alumni keep their own tab, the talent pool isn't listed.
  const inGroup = (person: Person, value: string) => value === 'all' ? !['alumni', 'talent', 'candidates'].includes(stateOf(person)) : stateOf(person) === value;
  const groupCount = (value: string) => listed.filter(person => inGroup(person, value)).length;
  const groups = [{
    value: 'all',
    label: 'Everyone'
  }, {
    value: 'cdi',
    label: 'CDI'
  }, {
    value: 'cdd',
    label: 'CDD'
  }, {
    value: 'freelance',
    label: 'Freelancers'
  }, {
    value: 'interns',
    label: 'Interns'
  }, {
    value: 'alternants',
    label: 'Alternants'
  }, {
    value: 'no_contract',
    label: 'Contract not set'
  }, {
    value: 'alumni',
    label: 'Alumni'
  }].filter(group => ['all', 'cdi', 'freelance', 'interns', 'alternants', 'alumni'].includes(group.value) || group.value === filter || groupCount(group.value) > 0);
  const commits = workspace.assignments.filter(assignment => ['reserved', 'confirmed', 'active', 'completed'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day));
  const employeesOnDate = workspace.employees.filter(activeOn);
  const rolloffs = workspace.assignments.filter(assignment => !['completed', 'cancelled'].includes(assignment.status) && assignment.end_date && assignment.end_date >= day && assignment.end_date <= new Date(new Date(`${day}T12:00:00`).getTime() + 30 * 86400000).toISOString().slice(0, 10));
  const currentCapacity = employeesOnDate.reduce((sum, employee) => sum + available(workspace, employee, day), 0);
  const people = listed.filter(person => {
    if (!inGroup(person, filter)) return false;
    const employee = employeeOnDate(person);
    if (capacityFilter === 'available' && (!employee || available(workspace, employee, day) <= 0)) return false;
    return `${person.full_name} ${person.email} ${person.skills} ${person.headline} ${person.location}`.toLowerCase().includes(query.toLowerCase());
  });
  const navigate = useNavigate();
  const update = (key: string, value: string) => navigate(withParam(key, value), { replace: true });
  const assigningEmployee = workspace.employees.find(employee => employee.id === assigning);
  return <>
    <Metrics>
      <Metric value={employeesOnDate.length} title="Employed consultants on selected date" />
      <Metric value={(currentCapacity / 100).toFixed(1)} title="Available full-time capacity" />
      <Metric value={commits.length} title="Committed project periods" />
      <Metric value={rolloffs.length} title="Missions ending in the next 30 days" />
    </Metrics>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <SearchField value={query} change={value => {
        setQuery(value);
        update('q', value);
      }} />
      <div className="flex flex-wrap items-end gap-3">
        <UiField className="w-auto gap-1.5">
          <FieldLabel className="text-xs">Availability date</FieldLabel>
          <DateField value={day} onChange={setDay} required aria-label="Availability date" />
        </UiField>
        <UiField className="w-auto gap-1.5">
          <FieldLabel htmlFor="hr-capacity-filter" className="text-xs">Capacity</FieldLabel>
          <NativeSelect id="hr-capacity-filter" value={capacityFilter} onChange={event => setCapacityFilter(event.target.value)}>
            <NativeSelectOption value="all">Everyone</NativeSelectOption>
            <NativeSelectOption value="available">Available capacity</NativeSelectOption>
          </NativeSelect>
        </UiField>
      </div>
    </div>
    <ViewTabs label="People relationship" value={filter} onChange={value => {
      setFilter(value);
      update('group', value);
    }} items={groups.map(group => ({ value: group.value, title: group.label, count: groupCount(group.value) }))} />
    {people.length ? <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Relationship</TableHead>
            <TableHead>Available on {date(day)}</TableHead>
            <TableHead>Commitments</TableHead>
            <TableHead>Skills</TableHead>
            <TableHead>Owner</TableHead>
            {!canRecruit && <TableHead>Staffing</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map(person => {
            const employee = employeeOnDate(person);
            const capacity = employee ? available(workspace, employee, day) : null;
            const periods = employee ? commits.filter(assignment => assignment.employee_id === employee.id) : [];
            return <TableRow key={person.id}>
              <TableCell className="h-auto py-3">
                <div className="max-w-64">
                  {canRecruit ? <PersonLink personId={person.id} name={person.full_name} detail={person.headline || person.email} open={() => open(person.id)} /> : <>
                    <strong className="block truncate font-medium">
                      {person.full_name}
                    </strong>
                    <small className="mt-1 block truncate text-xs text-muted-foreground">
                      {person.headline || person.email}
                    </small>
                  </>}
                </div>
              </TableCell>
              <TableCell>
                <Tag tone={employee ? 'good' : 'quiet'}>
                  {({ cdi: 'CDI', cdd: 'CDD', freelance: 'Freelancer', interns: 'Intern', alternants: 'Alternant', no_contract: 'Contract not set' } as Record<string, string>)[stateOf(person)] ?? label(stateOf(person))}
                </Tag>
                {employee && <Detail>{employee.planned_exit_date ? `Planned exit ${date(employee.planned_exit_date)}` : `Since ${date(employee.start_date)}`}</Detail>}
              </TableCell>
              <TableCell className="num">
                {capacity === null ? '—' : <>{capacity}%<div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="block h-full rounded-full bg-foreground" style={{
                      width: `${capacity}%`
                    }} />
                  </div></>}
              </TableCell>
              <TableCell>
                {employee ? periods.length ? periods.map(assignment => <div key={assignment.id}>{workspace.projects.find(project => project.id === assignment.project_id)?.title ?? 'Project'} · {assignment.allocation_pct}%<Detail>{label(assignment.status)} · Ends {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</Detail></div>) : 'No committed project' : '—'}
              </TableCell>
              <TableCell title={person.skills || undefined}>
                <div className="max-w-[230px] truncate">{person.skills || 'Not recorded'}</div>
              </TableCell>
              <TableCell>
                {person.owner_email || 'Unassigned'}
              </TableCell>
              {!canRecruit && <TableCell>
                {employee && canStaff ? <Button variant="outline" size="sm" onClick={() => setAssigning(employee.id)}>Assign project</Button> : ''}
              </TableCell>}
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </Card> : <Empty>No people match these filters. Add a person or adjust the search.</Empty>}
    {!!rolloffs.length && <Section title="Upcoming mission endings" detail="Plan the next assignment before the current commitment ends.">
      <Queue>
        {rolloffs.map(assignment => {
          const employee = workspace.employees.find(item => item.id === assignment.employee_id);
          return <QueueRow key={assignment.id} title={employee ? personName(workspace, employee.person_id) : 'Consultant'} detail={<>{workspace.projects.find(project => project.id === assignment.project_id)?.title} · {assignment.allocation_pct}% · Ends {date(assignment.end_date)}</>} action={employee && <Button variant="outline" size="sm" onClick={() => setAssigning(employee.id)}>Plan next</Button>} />;
        })}
      </Queue>
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
    run,
    open
  } = context;
  const navigate = useNavigate();
  const location = useLocation();
  // Hiring needs have their own path (/hr/recruiting/needs); other views use ?recruiting=.
  const tab = /^\/hr\/recruiting\/needs\/?$/.test(location.pathname) ? 'needs' : new URLSearchParams(location.search).get('recruiting') || 'board';
  const [query, setQuery] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [overStage, setOverStage] = useState<ApplicationStage | ''>('');
  const [dragId, setDragId] = useState('');
  const openNeeds = workspace.opportunities.filter(opportunity => !opportunity.archived_at);
  const applications = workspace.applications.filter(application => application.status === 'active' && (!opportunityId || application.opportunity_id === opportunityId) && `${personName(workspace, application.person_id)} ${workspace.people.find(person => person.id === application.person_id)?.skills ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <ViewTabs label="Recruiting views" value={tab} onChange={value => {
      navigate(value === 'needs' ? NEEDS_LIST : value === 'board' ? '/hr/recruiting' : `/hr/recruiting?recruiting=${value}`, { replace: true });
    }} items={[{
      value: 'board',
      title: 'Applications',
      count: workspace.applications.filter(item => item.status === 'active').length
    }, {
      value: 'needs',
      title: 'Hiring needs',
      count: openNeeds.length
    }, {
      value: 'interviews',
      title: 'Interviews',
      count: workspace.interviews.filter(item => item.status === 'scheduled').length
    }, {
      value: 'offers',
      title: 'Offers',
      count: workspace.offers.length
    }, {
      value: 'talent',
      title: 'Talent pool',
      count: talentPool(workspace).length
    }]} />
    {tab === 'board' && <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField value={query} change={setQuery} placeholder="Search applications by person or skill" />
        <NativeSelect aria-label="Hiring need" className="w-full sm:w-64" value={opportunityId} onChange={event => setOpportunityId(event.target.value)}>
          <NativeSelectOption value="">All hiring needs</NativeSelectOption>
          {openNeeds.map(opportunity => <NativeSelectOption key={opportunity.id} value={opportunity.id}>
            {opportunity.title}
          </NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="group/board flex items-stretch gap-2.5 overflow-x-auto pb-3" aria-label="Recruitment stage board" data-dragging={dragId ? '' : undefined}>
        {stages.map(stage => {
          const stageApplications = applications.filter(application => application.stage === stage);
          const empty = stageApplications.length === 0;
          const slim = empty && !dragId;
          const over = overStage === stage;
          return <section key={stage} className={cn('flex min-h-[360px] flex-col gap-2.5 rounded-xl border border-border bg-muted/50 p-3 transition-[flex-basis,max-width,background-color,border-color] duration-300 ease-out motion-reduce:transition-none', slim ? 'max-w-[148px] flex-[0_0_148px]' : 'max-w-[340px] flex-[1_0_260px]', over && 'border-faint bg-accent')} onDragOver={event => {
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
            if (application && application.stage !== stage) void run({
              kind: 'move_application',
              application_id: application.id,
              expected_version: application.version,
              to_stage: stage
            }, `${personName(workspace, application.person_id)} moved to ${label(stage)}.`).catch(() => {});
          }}>
            <h3 className="m-0 flex min-h-11 items-start justify-between gap-2 px-1 pt-1 text-[13px] leading-snug font-medium">
              {label(stage)}
              <span className="num text-xs font-normal text-muted-foreground">
                {stageApplications.length}
              </span>
            </h3>
            {(opportunityId ? [{ key: opportunityId, title: '', items: stageApplications }] : [...openNeeds.map(opportunity => ({ key: opportunity.id, title: opportunity.title, items: stageApplications.filter(application => application.opportunity_id === opportunity.id) })), {
              key: '',
              title: 'Hiring need',
              items: stageApplications.filter(application => !openNeeds.some(opportunity => opportunity.id === application.opportunity_id))
            }]).filter(group => group.items.length).map(group => <div key={group.key} className="flex flex-col gap-2.5" role="group" aria-label={group.title || undefined}>
              {group.title && <h4 className="m-0 flex items-baseline justify-between gap-2 px-1 pt-1 text-xs font-medium text-muted-foreground">
                {group.key ? <button type="button" className="min-w-0 cursor-pointer truncate rounded-sm text-left underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={`Open hiring need · ${group.title}`} onClick={() => navigate(needUrl(group.key))}>{group.title}</button> : <span className="truncate">{group.title}</span>}
                <span className="num font-normal">{group.items.length}</span>
              </h4>}
              {group.items.map(application => {
              const person = workspace.people.find(item => item.id === application.person_id);
              const opportunity = workspace.opportunities.find(item => item.id === application.opportunity_id);
              const age = Math.max(0, Math.floor((Date.now() - new Date(application.stage_entered_at).getTime()) / 86400000));
              const openRecord = () => open(application.person_id, application.id);
              return <div className="flex cursor-grab flex-col gap-3 rounded-lg border border-border bg-card p-3.5 text-card-foreground transition-[border-color,opacity] duration-150 outline-none hover:border-faint focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-dragging:opacity-40" key={application.id} tabIndex={0} data-dragging={dragId === application.id ? '' : undefined} draggable onDragStart={event => {
                event.dataTransfer.setData('text/plain', application.id);
                event.dataTransfer.effectAllowed = 'move';
                setDragId(application.id);
              }} onDragEnd={() => {
                setDragId('');
                setOverStage('');
              }} onClick={openRecord} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openRecord();
                }
              }}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn(avatarClass, 'size-8')} aria-hidden="true">
                    {initials(person?.full_name ?? 'Unknown person')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">
                      {person?.full_name ?? 'Unknown person'}
                    </strong>
                    {opportunityId && <small className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {opportunity?.title ?? 'Hiring need'}
                    </small>}
                  </span>
                </div>
                {(() => {
                  // Current position from the CV (no end month), else the newest one.
                  const position = person?.experience.find(item => !item.end) ?? [...(person?.experience ?? [])].sort((a, b) => b.start.localeCompare(a.start))[0];
                  const role = position ? [position.title, position.company].filter(Boolean).join(' · ') : '';
                  return role ? <p className="m-0 flex min-w-0 items-center gap-1.5 text-xs text-foreground/80" title={role}>
                    <BriefcaseBusiness className="size-3 flex-none" aria-hidden="true" />
                    <span className="truncate">{position?.end ? `Previously ${role}` : role}</span>
                  </p> : null;
                })()}
                {person?.headline && <p className="m-0 line-clamp-2 text-xs leading-normal text-muted-foreground" title={person.headline}>
                  {person.headline}
                </p>}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock3 className="size-3" aria-hidden="true" />{age} {age === 1 ? 'day' : 'days'} in stage · {label(application.source)}</span>
                </div>
              </div>;
            })}
            </div>)}
            {empty && <div className={cn('flex min-h-14 items-center justify-center rounded-lg border border-dashed border-border px-2 py-3.5 text-center text-xs text-muted-foreground group-data-dragging/board:border-faint', slim ? 'flex-none' : 'flex-1', over && 'text-foreground')}>
              {dragId ? over ? 'Release to move here' : 'Drop here' : slim ? 'Empty' : 'No candidates'}
            </div>}
          </section>;
        })}
      </div>
      <p className="m-0 text-xs text-muted-foreground">Drag a candidate onto another stage to move them, or click a card to open the full record.</p>
    </>}
    {tab === 'needs' && <Requisitions context={context} />}
    {tab === 'talent' && <TalentPool context={context} />}
    {tab === 'interviews' && <Section title="Interview schedule" detail="Interview status and invitation status are separate facts.">
      {workspace.interviews.length ? <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Interview</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Panel</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...workspace.interviews].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)).map(interview => {
              const application = workspace.applications.find(item => item.id === interview.application_id);
              return <TableRow key={interview.id}>
                <TableCell className="h-auto py-3">
                  {application && <PersonLink name={personName(workspace, application.person_id)} open={() => open(application.person_id, application.id)} />}
                </TableCell>
                <TableCell>
                  {label(interview.kind)}
                </TableCell>
                <TableCell className="num text-[13px]">
                  {new Date(interview.scheduled_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  {interview.panel}
                </TableCell>
                <TableCell>
                  <Tag>
                    {label(interview.status)}
                  </Tag>
                  <Detail>Invitation {label(interview.invitation_status)}</Detail>
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </Card> : <Empty>Open an application to schedule its first interview.</Empty>}
    </Section>}
    {tab === 'offers' && <Section title="Employment offers" detail="Open the application to draft, approve, share or record a candidate response.">
      {workspace.offers.length ? <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Offer</TableHead>
              <TableHead data-numeric="true">Salary / month</TableHead>
              <TableHead data-numeric="true">Daily cost / rate</TableHead>
              <TableHead data-numeric="true">Margin</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.offers.map(offer => {
              const application = workspace.applications.find(item => item.id === offer.application_id);
              return <TableRow key={offer.id}>
                <TableCell className="h-auto py-3">
                  {application && <PersonLink name={personName(workspace, application.person_id)} open={() => open(application.person_id, application.id)} />}
                </TableCell>
                <TableCell>
                  {offer.title}
                  <Detail>
                    {offer.contract_type}
                  </Detail>
                </TableCell>
                <TableCell data-numeric="true">€{offer.salary_monthly.toLocaleString()}</TableCell>
                <TableCell data-numeric="true">€{offer.cjm} / €{offer.target_tjm}</TableCell>
                <TableCell data-numeric="true">{offer.margin_pct.toFixed(1)}%</TableCell>
                <TableCell>
                  <Tag tone={offer.status === 'accepted' ? 'good' : ''}>
                    {label(offer.status)}
                  </Tag>
                  <Detail>Delivery {label(offer.delivery_status)}</Detail>
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </Card> : <Empty>No employment offers yet.</Empty>}
    </Section>}
  </>;
}
/**
 * People Quicksort knows but who are neither candidates nor staff: added
 * without an application, or whose applications were all rejected or
 * withdrawn. Never employed — alumni stay under People.
 */
function talentPool(workspace: Workspace) {
  const employed = new Set(workspace.employees.map(employee => employee.person_id));
  const applying = new Set(workspace.applications.filter(application => application.status === 'active').map(application => application.person_id));
  return workspace.people.filter(person => !employed.has(person.id) && !applying.has(person.id));
}
function TalentPool({ context }: { context: PageContext }) {
  const { workspace, open } = context;
  const [query, setQuery] = useState(() => getParam('tq'));
  const [adding, setAdding] = useState<Person | null>(null);
  const navigate = useNavigate();
  const needle = query.trim().toLowerCase();
  const people = talentPool(workspace).filter(person => !needle || `${person.full_name} ${person.headline} ${person.skills} ${person.location}`.toLowerCase().includes(needle)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const lastApplication = (person: Person) => workspace.applications.filter(application => application.person_id === person.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return <Section title="Talent pool" detail="People you know who have no open application and were never employed: added without a position, or rejected or withdrawn earlier.">
    <SearchField value={query} change={value => {
      setQuery(value);
      navigate(withParam('tq', value), { replace: true });
    }} placeholder="Search by name, headline, skill or location" />
    {people.length ? <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Skills</TableHead>
            <TableHead>Last application</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map(person => {
            const last = lastApplication(person);
            const skills = person.skills.split(/[\n,]/).map(skill => skill.trim()).filter(Boolean);
            return <TableRow key={person.id}>
              <TableCell className="h-auto py-3">
                <PersonLink personId={person.id} name={person.full_name} detail={person.headline || person.location} open={() => open(person.id)} />
              </TableCell>
              <TableCell className="max-w-64 text-[13px] whitespace-normal text-muted-foreground">
                {skills.length ? `${skills.slice(0, 4).join(', ')}${skills.length > 4 ? ` +${skills.length - 4}` : ''}` : '—'}
              </TableCell>
              <TableCell className="text-[13px] whitespace-normal">
                {last ? <>
                  {workspace.opportunities.find(opportunity => opportunity.id === last.opportunity_id)?.title ?? 'Hiring need'}
                  <span className="block text-muted-foreground">{label(last.status)} at {label(last.stage)}{last.reason ? ` · ${last.reason}` : ''}</span>
                </> : <span className="text-muted-foreground">Never applied</span>}
              </TableCell>
              <TableCell className="num text-[13px] text-muted-foreground">{date(person.updated_at)}</TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" onClick={() => setAdding(person)}>Add to a hiring need</Button>
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </Card> : <Empty>{needle ? 'Nobody in the talent pool matches this search.' : 'The talent pool is empty. People added without a position, and candidates who were rejected or withdrew, appear here.'}</Empty>}
    {adding && <AddToHiringNeed person={adding} context={context} close={() => setAdding(null)} />}
  </Section>;
}
function AddToHiringNeed({ person, context, close }: { person: Person; context: PageContext; close: () => void }) {
  const { workspace, run, busy, open } = context;
  const { session } = useSession();
  // A person can't hold two active applications for the same need.
  const taken = new Set(workspace.applications.filter(application => application.person_id === person.id && application.status === 'active').map(application => application.opportunity_id));
  const needs = workspace.opportunities.filter(opportunity => ['approved', 'published'].includes(opportunity.status) && !opportunity.archived_at && !taken.has(opportunity.id));
  const [needId, setNeedId] = useState(needs[0]?.id ?? '');
  const [source, setSource] = useState('rediscovery');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState<{ applicationId: string; text: string } | null>(null);
  async function add() {
    const need = needs.find(opportunity => opportunity.id === needId);
    if (!need) return;
    setSaving(true);
    setError('');
    try {
      const result = await run({ kind: 'create_application', person_id: person.id, opportunity_id: need.id, source }, `${person.full_name} added to "${need.title}".`);
      const applicationId = result?.application_id ?? '';
      // Best-effort: copy the person's filed CV into <year>/<position> on Drive.
      const copied = await copyCv(() => session?.getToken({ template: 'supabase' }) ?? Promise.resolve(null), { personId: person.id, personName: person.full_name, position: { title: need.title, openedAt: need.created_at } });
      if (copied) setWarning({ applicationId, text: copied });
      else {
        close();
        open(person.id, applicationId || undefined);
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <Dialog title={`Add ${person.full_name} to a hiring need`} close={close}>
    <div className="flex flex-col gap-4 p-5 sm:p-6">
      {warning ? <>
        <p role="status" className="m-0 text-sm">The application was created. {warning.text}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>Close</Button>
          <Button onClick={() => {
            close();
            open(person.id, warning.applicationId || undefined);
          }}>Open the application</Button>
        </div>
      </> : needs.length ? <>
        <UiField className="gap-1.5">
          <FieldLabel htmlFor="talent-need">Hiring need</FieldLabel>
          <NativeSelect id="talent-need" className="w-full" value={needId} onChange={event => setNeedId(event.target.value)}>
            {needs.map(opportunity => <NativeSelectOption key={opportunity.id} value={opportunity.id}>{opportunity.title}</NativeSelectOption>)}
          </NativeSelect>
        </UiField>
        <UiField className="gap-1.5">
          <FieldLabel htmlFor="talent-source">Source</FieldLabel>
          <NativeSelect id="talent-source" className="w-full" value={source} onChange={event => setSource(event.target.value)}>
            {['rediscovery', 'referral', 'linkedin', 'career_site', 'job_board', 'spontaneous', 'other'].map(value => <NativeSelectOption key={value} value={value}>{label(value)}</NativeSelectOption>)}
          </NativeSelect>
        </UiField>
        {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          <Button disabled={saving || busy || !needId} onClick={() => void add()}>{saving ? 'Adding…' : 'Create application'}</Button>
        </div>
      </> : <>
        <Empty>No approved or published hiring need is open for this person. Create one under Hiring needs first.</Empty>
        <div className="flex justify-end"><Button variant="outline" onClick={close}>Close</Button></div>
      </>}
    </div>
  </Dialog>;
}
function Requisitions({
  context
}: {
  context: PageContext;
}) {
  const { workspace } = context;
  const navigate = useNavigate();
  const [archivedView, setArchivedView] = useState(false);
  const archivedCount = workspace.opportunities.filter(opportunity => opportunity.archived_at).length;
  const listed = workspace.opportunities.filter(opportunity => !!opportunity.archived_at === archivedView);
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-muted-foreground">{listed.length} {archivedView ? 'archived' : 'open'} hiring needs · linked to job posts and clients</span>
        {(archivedCount > 0 || archivedView) && <Button variant="ghost" size="sm" onClick={() => setArchivedView(value => !value)}>{archivedView ? 'Show open needs' : `Show archived (${archivedCount})`}</Button>}
      </div>
      <Button onClick={() => navigate(needUrl('new'))}><Plus aria-hidden="true" /> Create hiring need</Button>
    </div>
    {!listed.length && <Empty>{archivedView ? 'No archived hiring needs.' : 'Hiring starts with an approved need linked to a mission or a justified profile hire.'}</Empty>}
    <div className="flex flex-col gap-3">
    {listed.map(opportunity => {
      const job = workspace.jobs.find(item => item.id === opportunity.job_id);
      const clients = workspace.clients.filter(client => opportunity.client_ids.includes(client.id));
      const applications = workspace.applications.filter(application => application.opportunity_id === opportunity.id);
      const active = applications.filter(application => application.status === 'active').length;
      return <Link key={opportunity.id} to={needUrl(opportunity.id)} className="block rounded-xl text-inherit no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card size="sm" className="transition-colors hover:border-faint">
          <CardContent className="flex flex-col gap-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="m-0 text-[15px] font-medium">
                  {opportunity.title}
                </h3>
                <small className="text-xs text-muted-foreground">{opportunity.hiring_mode === 'sur_mission' ? 'Client mission' : 'Ahead of demand'} · {opportunity.owner_email || 'Unassigned'} · {active} active of {applications.length} applications{job ? ` · Job post: ${job.title}${job.published ? ' (published)' : ' (draft)'}` : ''}{clients.length ? ` · ${clients.length === 1 ? 'Client' : 'Clients'}: ${clients.map(client => client.name).join(', ')}` : ''}</small>
              </div>
              {opportunity.archived_at ? <Tag tone="quiet">Archived {date(opportunity.archived_at)}</Tag> : <Tag tone={['approved', 'published'].includes(opportunity.status) ? 'good' : 'quiet'}>
                {label(opportunity.status)}
              </Tag>}
            </div>
            {opportunity.client_need && <p className="m-0 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
              {opportunity.client_need}
            </p>}
          </CardContent>
        </Card>
      </Link>;
    })}
    </div>
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
    <ViewTabs label="Journey phases" value={tab} onChange={setTab} items={[{
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
    }]} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SearchField value={query} change={setQuery} placeholder="Search employee journeys" />
      <span className="text-[13px] text-muted-foreground">{people.length} employment periods</span>
    </div>
    {people.length ? <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead>Employment</TableHead>
            <TableHead>Checklist</TableHead>
            <TableHead>Probation</TableHead>
            <TableHead>Next date</TableHead>
            <TableHead>Journey</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map(employee => {
            const tasks = workspace.tasks.filter(task => task.employee_id === employee.id);
            const exit = workspace.exits.find(item => item.employee_id === employee.id);
            const requiredOpen = tasks.filter(task => task.required && !task.completed_at);
            return <TableRow key={employee.id}>
              <TableCell className="h-auto py-3">
                <PersonLink personId={employee.person_id} name={personName(workspace, employee.person_id)} detail={employee.role} open={() => open(employee.person_id, undefined, employee.id)} />
              </TableCell>
              <TableCell>
                <Tag tone={employee.status === 'ended' ? 'quiet' : 'good'}>
                  {label(employee.status)}
                </Tag>
                <Detail>Started {date(employee.start_date)}</Detail>
              </TableCell>
              <TableCell>{tasks.filter(task => task.completed_at).length}/{tasks.length} tasks<Detail>{requiredOpen.length} required remaining</Detail></TableCell>
              <TableCell>
                {label(employee.probation_status)}
                <Detail>
                  {date(employee.probation_end)}
                </Detail>
              </TableCell>
              <TableCell>
                {exit ? `Exit ${date(exit.exit_date)}` : employee.status === 'preboarding' ? `Arrival ${date(employee.start_date)}` : `Review ${date(workspace.reviews.find(review => review.employee_id === employee.id && review.status === 'scheduled')?.due_date)}`}
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" onClick={() => open(employee.person_id, undefined, employee.id)}>Open plan</Button>
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </Card> : <Empty>No journeys in this view. New hires automatically start a preboarding plan.</Empty>}
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
  return <Dialog title={`Staff ${personName(workspace, employee.person_id)}`} className="sm:max-w-5xl" close={close}>
    <AssignForm employee={employee} workspace={workspace} run={run} busy={busy} />
    <Section title="Assignment history">
      <div className="flex flex-col gap-3">
      {workspace.assignments.filter(assignment => assignment.employee_id === employee.id).map(assignment => <Card size="sm" key={assignment.id}>
        <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-[15px] font-medium">
              {workspace.projects.find(project => project.id === assignment.project_id)?.title}
            </h3>
            <small className="text-xs text-muted-foreground">{date(assignment.start_date)} to {date(assignment.end_date)} · {assignment.allocation_pct}%</small>
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
          <UiField orientation="horizontal" className="col-span-full gap-2">
            <Checkbox id={`hr-cancel-${assignment.id}`} name="cancel" value="on" />
            <FieldLabel htmlFor={`hr-cancel-${assignment.id}`} className="font-normal">Cancel future or proposed period</FieldLabel>
          </UiField>
        </Form>}
        </CardContent>
      </Card>)}
      </div>
    </Section>
  </Dialog>;
}
