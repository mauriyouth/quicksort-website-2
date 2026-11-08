import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, Clock3, Plus, RefreshCw, Search, Users, X, ArrowUpRight, MapPin } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import { cn } from 'cn';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DialogTitle,
  Field as UiField,
  FieldLabel,
  Input,
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
  Textarea,
} from '@quicksort-sas/ui';
import { executeCommand, loadWorkspace } from './data';
import type { CommandResult, Employee, Opportunity, Person, Workspace } from './domain';
import { AssignForm, PersonWorkspace, available, personName, stages, type PersonTab, type RecordContext } from './PersonWorkspace';
import { Dialog, Empty, Field, Form, PersonLink, SearchMultiField, Section, Tag, avatarClass, checked, date, initials, label, nullable, text, today, type RunCommand } from './ui';
import { PageAlerts, PageHeading } from '../ui';
import type { Application, ApplicationStage } from './domain';
import { DateField } from '../DateField';
import { Intake } from './Intake';
import { CraScreen } from '../cra/CraScreen';
import { loadMonth } from '../cra/data';
import { balanceFor, fmtDays, useLeaveBalances } from '../cra/balances';
import { monthDays } from '../cra/domain';
import './workspace.css';
import { DocumentAlertsQueue } from '../documents/DocumentAlerts';
import { PersonPhoto } from '../documents/PersonPhoto';
import { PaidLeaveAdjust } from './PaidLeaveAdjust';
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
const personRoute = (): { personId: string; tab: PersonTab; employmentId: string } => {
  // The CRA tab pins the viewed month as extra segments:
  // /hr/people/<id>/cra/2026/10 (the CRA screen owns them; the record
  // router keeps resolving the tab and ignores the tail). The employments
  // tab pins the selected employment: /hr/people/<id>/employments/<employmentId>.
  const match = window.location.pathname.match(/^\/hr\/people\/([^/]+?)(?:\/([^/]+?)(?:\/(\d{4})\/(0[1-9]|1[0-2])|\/([^/]+?))?)?\/?$/);
  if (!match) return { personId: '', tab: 'profile', employmentId: '' };
  const tab = SEGMENT_TABS[match[2] ?? ''] ?? 'profile';
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
const personUrl = (id: string, tab: PersonTab, params = new URLSearchParams(), employmentId = '') => {
  const segment = TAB_SEGMENTS[tab];
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
    const tab: PersonTab = application ? 'applications' : employment ? 'employment' : 'profile';
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
    const tab: PersonTab = application ? 'applications' : employee ? 'employment' : 'profile';
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
    {!(selectedPerson && canRecruit) && <PageHeading eyebrow={`People operations · ${label(view)}`} title={viewCopy[view].title} action={<div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={loading || busy} onClick={() => {
          setLoading(true);
          setError('');
          void reload().catch(failure => setError(errorMessage(failure))).finally(() => setLoading(false));
        }}><RefreshCw aria-hidden="true" /> Refresh</Button>
        {canRecruit && <Button variant="pivot" onClick={() => setIntake(true)}><Plus aria-hidden="true" /> Add person</Button>}
        {!canRecruit && view === 'people' && <Button variant="outline" onClick={() => setMyCra(true)}><CalendarDays aria-hidden="true" /> My CRA</Button>}
      </div>}>
      {viewCopy[view].description}
    </PageHeading>}
    <PageAlerts error={error} message={message} />
    {loading && !workspace ? <Empty>
      <span role="status">Loading the HR workspace…</span>
    </Empty> : context && (canRecruit || canStaff) ? <>
      {view === 'overview' && !selectedPerson && <Overview context={context} />}
      {view === 'recruiting' && !selectedPerson && <Recruiting context={context} />}
      {view === 'people' && !selectedPerson && <People context={context} />}
      {view === 'journeys' && !selectedPerson && <Journeys context={context} />}
      {intake && canRecruit && <Dialog title="Add a person" close={() => setIntake(false)}>
        <Intake actorEmail={actorEmail} run={run} busy={busy} positions={context.workspace.opportunities} onAdded={warning => {
          setIntake(false);
          if (warning) setError(warning);
        }} />
      </Dialog>}
      {myCra && <Dialog title="My CRA" className="sm:max-w-5xl" close={() => setMyCra(false)}>
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
  // Remaining leave across every employment period of this person, net of
  // CRA consumption (CP and RTT accrue per calendar month from each start).
  const { balances, error: balanceError, reload: reloadBalances } = useLeaveBalances(employees.map(employee => employee.id));
  // Paid leave is adjusted on the live employment, else the latest one.
  const leaveEmployee = live && live.contract_type !== 'Freelance' ? live : [...employees].filter(employee => employee.contract_type !== 'Freelance').sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  const [adjustingLeave, setAdjustingLeave] = useState(false);
  const cpLeft = employees.reduce((sum, employee) => sum + balanceFor(balances, employee.id, 'cp'), 0);
  const rttLeft = employees.reduce((sum, employee) => sum + balanceFor(balances, employee.id, 'rtt'), 0);
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
  const stat = 'flex min-w-0 flex-col gap-1';
  return <div className="flex min-w-0 flex-col">
    <header className="mx-auto w-full max-w-[1120px] border-b border-border pb-5">
      {/* Person header: breadcrumb and title merged, name shown once */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <div className="flex min-w-0 flex-[1_1_auto] items-center gap-4">
          <PersonPhoto personId={person.id} name={person.full_name} fallback={initials(person.full_name)} className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-foreground object-cover font-heading text-lg font-medium tracking-[-0.02em] text-background" editable />
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="m-0 font-heading text-[28px] leading-none font-medium tracking-[-0.02em]">{person.full_name}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground [&>*:not(:first-child)]:before:mr-2 [&>*:not(:first-child)]:before:text-faint [&>*:not(:first-child)]:before:content-['·']">
              {person.headline && <span>{person.headline}</span>}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-foreground">
                <span className={cn('size-1.5 rounded-full', live ? 'bg-success' : 'bg-faint')} aria-hidden="true" />
                {status}
              </span>
              {availability !== null && <span>{availability}% available today</span>}
              {person.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden="true" />{person.location}</span>}
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
          <div className={stat}>
            <dt className="label-mono">CP balance</dt>
            <dd className="m-0 flex items-baseline gap-2 font-medium">
              {balanceError ? 'unavailable' : employees.length ? `${fmtDays(cpLeft)} days` : '—'}
              {leaveEmployee && <Button type="button" variant="link" size="xs" className="text-muted-foreground" onClick={() => setAdjustingLeave(true)}>Adjust</Button>}
            </dd>
          </div>
          <div className={stat}>
            <dt className="label-mono">RTT balance</dt>
            <dd className="m-0 font-medium">{balanceError ? 'unavailable' : employees.length ? `${fmtDays(rttLeft)} days` : '—'}</dd>
          </div>
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
    return param && param !== 'employees' ? param : 'all';
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
  const groupCount = (value: string) => workspace.people.filter(person => value === 'all' || stateOf(person) === value).length;
  const groups = [{
    value: 'all',
    label: 'Everyone'
  }, {
    value: 'candidates',
    label: 'Candidates'
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
  }, {
    value: 'talent',
    label: 'Talent pool'
  }].filter(group => ['all', 'candidates', 'cdi', 'freelance', 'interns', 'alternants', 'alumni', 'talent'].includes(group.value) || group.value === filter || groupCount(group.value) > 0);
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
    open
  } = context;
  const [tab, setTab] = useState(() => getParam('recruiting') || 'board');
  const navigate = useNavigate();
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
    <ViewTabs label="Recruiting views" value={tab} onChange={value => {
      setTab(value);
      navigate(withParam('recruiting', value), { replace: true });
    }} items={[{
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
    }]} />
    {tab === 'board' && <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchField value={query} change={setQuery} placeholder="Search applications by person or skill" />
        <NativeSelect aria-label="Hiring need" className="w-full sm:w-64" value={opportunityId} onChange={event => setOpportunityId(event.target.value)}>
          <NativeSelectOption value="">All hiring needs</NativeSelectOption>
          {workspace.opportunities.map(opportunity => <NativeSelectOption key={opportunity.id} value={opportunity.id}>
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
            if (application && application.stage !== stage) setQuickView({
              applicationId: application.id,
              targetStage: stage
            });
          }}>
            <h3 className="m-0 flex min-h-11 items-start justify-between gap-2 px-1 pt-1 text-[13px] leading-snug font-medium">
              {label(stage)}
              <span className="num text-xs font-normal text-muted-foreground">
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
              return <div className="flex cursor-grab flex-col gap-3 rounded-lg border border-border bg-card p-3.5 text-card-foreground transition-[border-color,opacity] duration-150 outline-none hover:border-faint focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing data-dragging:opacity-40" key={application.id} tabIndex={0} data-dragging={dragId === application.id ? '' : undefined} draggable onDragStart={event => {
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
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn(avatarClass, 'size-8')} aria-hidden="true">
                    {initials(person?.full_name ?? 'Unknown person')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">
                      {person?.full_name ?? 'Unknown person'}
                    </strong>
                    <small className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {opportunity?.title ?? 'Hiring need'}
                    </small>
                  </span>
                </div>
                {person?.headline && <p className="m-0 line-clamp-2 text-xs leading-normal text-muted-foreground" title={person.headline}>
                  {person.headline}
                </p>}
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock3 className="size-3" aria-hidden="true" />{age} {age === 1 ? 'day' : 'days'} in stage · {label(application.source)}</span>
                  <Button variant="link" size="xs" className="text-foreground" onClick={event => {
                    event.stopPropagation();
                    decide();
                  }}>
                    Decide →
                  </Button>
                </div>
              </div>;
            })}
            {empty && <div className={cn('flex min-h-14 items-center justify-center rounded-lg border border-dashed border-border px-2 py-3.5 text-center text-xs text-muted-foreground group-data-dragging/board:border-faint', slim ? 'flex-none' : 'flex-1', over && 'text-foreground')}>
              {dragId ? over ? 'Release to move here' : 'Drop here' : slim ? 'Empty' : 'No candidates'}
            </div>}
          </section>;
        })}
      </div>
      <p className="m-0 text-xs text-muted-foreground">Drag a candidate onto the next stage, or click a card for a quick decision without leaving the board. The full record stays one click away.</p>
      {quickApplication && <ApplicationQuickView key={`${quickApplication.id}-${quickApplication.stage}`} application={quickApplication} context={context} initialStage={quickView?.targetStage} close={() => setQuickView(null)} />}
    </>}
    {tab === 'needs' && <Requisitions context={context} />}
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
  const toggle = (active: boolean) => cn('h-auto px-0 text-[13px] text-muted-foreground hover:text-foreground', active && 'text-foreground decoration-foreground');
  const sectionHead = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1';
  const hint = 'text-xs text-muted-foreground';
  return <Dialog bare className="sm:max-w-[720px]" title={`Stage decision — ${person?.full_name ?? 'Unknown person'}`} close={close}>
    <div className="flex shrink-0 items-start gap-3.5 border-b border-border px-5 py-4 sm:px-6">
      <span className={cn(avatarClass, 'size-11 text-sm')} aria-hidden="true">{initials(person?.full_name ?? '?')}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="text-xl">{person?.full_name ?? 'Unknown person'}</DialogTitle>
          <Badge variant="outline">{label(application.stage)}</Badge>
        </div>
        {person?.headline && <p className="m-0 text-[13px] text-muted-foreground">{person.headline}</p>}
      </div>
      <Button variant="ghost" size="icon" aria-label="Close stage decision" onClick={close}>
        <X aria-hidden="true" />
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6 *:shrink-0">
      <div className="grid grid-cols-2 items-center gap-4 rounded-lg bg-muted p-4 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        {[['Hiring need', opportunity?.title ?? 'Hiring need'], ['Applied', date(application.created_at)], ['Source', label(application.source)], ['In stage', `${age} days`]].map(([title, value]) => <div key={title} className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{title}</span>
          <strong className="truncate text-sm font-medium">{value}</strong>
        </div>)}
        <Button variant="link" size="sm" className="col-span-2 justify-self-start sm:col-span-1" onClick={() => {
          close();
          open(application.person_id, application.id);
        }}>
          Full record <ArrowUpRight aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-2">
        {application.status === 'active' && <Button variant="link" size="sm" aria-pressed={scheduling} className={toggle(scheduling)} onClick={() => {
          if (scheduling) {
            setScheduling(false);
          } else {
            setScheduling(true);
            setClosing(false);
            setTarget(stages[Math.min(currentIndex + 1, stages.length - 1)]);
          }
        }}>
          {scheduling ? 'Cancel scheduling' : 'Schedule interview'}
        </Button>}
        <Button variant="link" size="sm" aria-pressed={rejecting} className={toggle(rejecting)} onClick={() => {
          setScheduling(false);
          setClosing(false);
          setTarget(rejecting ? stages[Math.min(currentIndex + 1, stages.length - 1)] : 'rejected');
        }}>
          {rejecting ? 'Cancel rejection' : 'Reject candidate'}
        </Button>
        <Button variant="link" size="sm" aria-pressed={isClosing} className={toggle(isClosing)} onClick={() => {
          setScheduling(false);
          if (isClosing) {
            setClosing(false);
          } else {
            setClosing(true);
            setTarget(stages[Math.min(currentIndex + 1, stages.length - 1)]);
          }
        }}>
          {isClosing ? 'Cancel close' : 'Close this application'}
        </Button>
      </div>
      {isClosing && <UiField className="gap-1.5 sm:max-w-xs">
        <FieldLabel htmlFor="hr-quick-disposition">Disposition</FieldLabel>
        <NativeSelect id="hr-quick-disposition" className="w-full" value={disposition} onChange={event => setDisposition(event.target.value as 'rejected' | 'withdrawn')}>
          <NativeSelectOption value="withdrawn">Withdrawn</NativeSelectOption>
          <NativeSelectOption value="rejected">Rejected</NativeSelectOption>
        </NativeSelect>
      </UiField>}
      {scheduling && <div className="flex flex-col gap-3">
        <div className={sectionHead}>
          <span className="text-[15px] font-medium">Interview details</span>
          <span className={hint}>Required · the calendar invitation is still sent manually</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <UiField className="gap-1.5">
            <FieldLabel htmlFor="hr-quick-kind">Interview type</FieldLabel>
            <NativeSelect id="hr-quick-kind" className="w-full" value={interviewKind} onChange={event => setInterviewKind(event.target.value)}>
              <NativeSelectOption value="hr">HR</NativeSelectOption>
              <NativeSelectOption value="technical">Technical</NativeSelectOption>
              <NativeSelectOption value="client">Client</NativeSelectOption>
            </NativeSelect>
          </UiField>
          <UiField className="gap-1.5">
            <FieldLabel htmlFor="hr-quick-when">Date and time</FieldLabel>
            <Input id="hr-quick-when" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} />
          </UiField>
          <UiField className="col-span-full gap-1.5">
            <FieldLabel htmlFor="hr-quick-panel">Interview panel</FieldLabel>
            <Input id="hr-quick-panel" value={panel} onChange={event => setPanel(event.target.value)} placeholder="Names or email addresses of the interviewers" />
          </UiField>
          <UiField className="col-span-full gap-1.5">
            <FieldLabel htmlFor="hr-quick-location">Meeting link or location</FieldLabel>
            <Input id="hr-quick-location" value={location} onChange={event => setLocation(event.target.value)} placeholder="Video link or room" />
          </UiField>
        </div>
      </div>}
      {!scheduling && <div className="flex flex-col gap-2.5">
        <div className={sectionHead}>
          <label htmlFor="hr-quick-rationale-input" className="text-[15px] font-medium">Comments</label>
          <span className={hint}>{rationaleReady ? 'Required · ready' : `Required · ${RATIONALE_MIN - rationaleLength} more characters`}</span>
        </div>
        <Textarea id="hr-quick-rationale-input" className="min-h-32 resize-y" value={rationale} onChange={event => setRationale(event.target.value)} placeholder="What did you see that supports this move? Keep it factual — it’s stored on the candidate’s record." />
      </div>}
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-5 py-3.5 sm:px-6">
      <span className="w-full text-[13px] text-muted-foreground sm:mr-auto sm:w-auto">{summary}</span>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" disabled={saving} onClick={close}>Cancel</Button>
        <Button variant={rejecting || isClosing ? 'destructive' : 'default'} disabled={cannotSubmit} onClick={() => void record()}>
          {saving ? 'Recording…' : scheduling ? 'Schedule interview' : rejecting ? 'Record rejection' : isClosing ? 'Record disposition' : `Move to ${label(target)}`}
        </Button>
      </div>
    </div>
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
    <UiField className="min-w-0 gap-1.5">
      <FieldLabel htmlFor="hr-requisition-job">
        Linked job post
      </FieldLabel>
      <NativeSelect id="hr-requisition-job" className="w-full" name="job_id" value={jobId} onChange={event => setJobId(event.target.value)} aria-describedby="hr-requisition-job-hint">
        <NativeSelectOption value="">Not set</NativeSelectOption>
        {workspace.jobs.map(item => <NativeSelectOption key={item.id} value={item.id}>
          {`${item.title}${item.published ? ' · Published' : ' · Draft'}`}
        </NativeSelectOption>)}
      </NativeSelect>
      <p id="hr-requisition-job-hint" className="m-0 text-xs text-muted-foreground">
        The role title and requirements come from the linked job post.
      </p>
    </UiField>
    {job ? <p className="col-span-full m-0 text-[13px] text-muted-foreground">Role and requirements are taken from “{job.title}”.</p> : <Field name="title" label="Role to hire" value={opportunity?.title} required hint="Named manually until a job post is linked — the post then provides the title and requirements." />}
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{workspace.opportunities.length} hiring needs · linked to job posts and clients</span>
      <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" /> Create hiring need</Button>
    </div>
    {createOpen && <Dialog title="Create a hiring need" close={() => setCreateOpen(false)}>
      <RequisitionForm context={context} onSaved={() => setCreateOpen(false)} />
    </Dialog>}
    {editing && <Dialog title={`Edit hiring need / ${editing.title}`} close={() => setEditing(null)}>
      <RequisitionForm opportunity={editing} context={context} onSaved={() => setEditing(null)} />
    </Dialog>}
    {!workspace.opportunities.length && <Empty>Hiring starts with an approved need linked to a mission or a justified profile hire.</Empty>}
    <div className="flex flex-col gap-3">
    {workspace.opportunities.map(opportunity => {
      const job = workspace.jobs.find(item => item.id === opportunity.job_id);
      const clients = workspace.clients.filter(client => opportunity.client_ids.includes(client.id));
      const editable = ['draft', 'pending_approval', 'approved'].includes(opportunity.status);
      return <Card size="sm" key={opportunity.id}>
        <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-[15px] font-medium">
              {opportunity.title}
            </h3>
            <small className="text-xs text-muted-foreground">{opportunity.hiring_mode === 'sur_mission' ? 'Client mission' : 'Ahead of demand'} · {opportunity.owner_email || 'Unassigned'} · {workspace.applications.filter(application => application.opportunity_id === opportunity.id).length} applications{job ? ` · Job post: ${job.title}${job.published ? ' (published)' : ' (draft)'}` : ''}{clients.length ? ` · ${clients.length === 1 ? 'Client' : 'Clients'}: ${clients.map(client => client.name).join(', ')}` : ''}</small>
          </div>
          <div className="flex items-center gap-2">
            {editable && <Button variant="outline" size="sm" onClick={() => setEditing(opportunity)}>Edit</Button>}
            <Tag tone={['approved', 'published'].includes(opportunity.status) ? 'good' : 'quiet'}>
              {label(opportunity.status)}
            </Tag>
          </div>
        </div>
        {opportunity.client_need && <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">
          {opportunity.client_need}
        </p>}
        {opportunity.justification && <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">Hiring justification: {opportunity.justification}</p>}
        {opportunity.status === 'approved' && <details className="group/details rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-[13px] font-medium group-open/details:mb-4">Publish the connected job post</summary>
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
        </CardContent>
      </Card>;
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
