import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@clerk/react';
import { Check, CheckCircle2, ChevronRight, Circle, Eye, Lock, Plus, Sparkles, AlertCircle, Search } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field as UiField,
  FieldDescription,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  NativeSelect,
  NativeSelectOption,
  Stat,
  StatLabel,
  StatSource,
  StatValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@quicksort-sas/ui';
import { cn } from 'cn';
import type { Application, ApplicationStage, Assignment, Employee, JourneyTask, Person, Requirement, StaffingProject, SuggestionKind, Workspace } from './domain';
import { loadRequirements } from './data';
import { useYearAvailability } from './availability';
import { fmtDays } from '../cra/balances';
import { assistancePayloadSchema, assistanceSourceSchema, generateSuggestion, type AssistanceRequest } from './assist';
import { z } from 'zod';
import { storedPricingLines } from '../sales/pricing-lines';
import { DateField } from '../DateField';
import { CraScreen } from '../cra/CraScreen';
import { countryName, countryOptions, needsResidencePermit } from './countries';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { MatriculeEdit, PersonPayslips } from '../payslips/PersonPayslips';
import { PersonSignatures } from '../signatures/PersonSignatures';
import { CandidateApplication } from './CandidateApplication';
// PersonPayslips does not import its own stylesheet; it is loaded here.
import { Action, Empty, Field, Form, SearchField, Section, SkillListField, Tag, checked, date, initials, label, nullable, number, text, today, useRetryCommand, type RunCommand } from './ui';
export const stages: ApplicationStage[] = ['application', 'screening', 'hr_interview', 'technical_interview', 'client_presentation', 'decision', 'offer', 'contract'];
export const personName = (workspace: Workspace, id: string) => workspace.people.find(person => person.id === id)?.full_name ?? 'Unknown person';
export const available = (workspace: Workspace, employee: Employee, day: string) => {
  if (day < employee.start_date || employee.end_date && day > employee.end_date || employee.planned_exit_date && day > employee.planned_exit_date) return 0;
  return Math.max(0, 100 - workspace.assignments.filter(assignment => assignment.employee_id === employee.id && ['reserved', 'confirmed', 'active', 'completed'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day)).reduce((sum, assignment) => sum + assignment.allocation_pct, 0));
};
const options = (values: string[]) => values.map(value => ({
  value,
  label: label(value)
}));
/** Company/freelance-only document types, hidden from salaried employees' filings. */
const COMPANY_DOC_TYPES = ['KBIS', 'URSSAF_VIGILANCE', 'RC_PRO', 'FREELANCE_CONTRACT'];
/** Compact daily-rate suffix for pricing-line labels, e.g. "700 EUR/j". */
const lineRateLabel = (tjm: number, currency: string) => `${Number.isInteger(tjm) ? tjm : tjm.toFixed(2)} ${currency}/j`;
export type RecordContext = {
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
  reload: () => Promise<void>;
  actorEmail: string;
  openProject?: (projectId: string) => void;
};
export type PersonTab = 'profile' | 'applications' | 'employment' | 'projects' | 'cra' | 'history';

/* ---------- Small local building blocks ---------- */

/** Quiet secondary copy under a control or list. */
const QUIET = 'm-0 text-[13px] leading-relaxed text-muted-foreground';
/** Inline error under a control. */
function ErrorText({ children, errorRef }: { children: ReactNode; errorRef?: React.Ref<HTMLParagraphElement> }) {
  return <p ref={errorRef} tabIndex={errorRef ? -1 : undefined} role="alert" className="m-0 text-[13px] text-destructive outline-none">{children}</p>;
}
/** Card title carrying the outline semantics of the old <h2>. */
function CardHeading({ children, level = 2, className }: { children: ReactNode; level?: 2 | 3; className?: string }) {
  return <CardTitle role="heading" aria-level={level} className={className}>{children}</CardTitle>;
}
/** Native disclosure (keeps its form state while closed), restyled. */
function Disclosure({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return <details className={cn('group/disclosure rounded-lg border border-border', className)}>
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-90" aria-hidden="true" />
      {summary}
    </summary>
    <div className="border-t border-border p-4">
      {children}
    </div>
  </details>;
}
/** A labelled checkbox that submits "on" like a native one (read with `checked`). */
function CheckField({ name, defaultChecked, children, className }: { name: string; defaultChecked?: boolean; children: ReactNode; className?: string }) {
  return <label className={cn('flex cursor-pointer items-center gap-2.5 text-sm', className)}>
    <Checkbox name={name} value="on" defaultChecked={defaultChecked} />
    {children}
  </label>;
}
/** Definition-list fact: mono label over its value. */
function Fact({ term, children, mono = false }: { term: string; children: ReactNode; mono?: boolean }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <dt className="label-mono">{term}</dt>
    <dd className={cn('m-0 text-sm', mono && 'num')}>{children}</dd>
  </div>;
}
/** Status dot list row used by the task, salary, review and exit lists. */
const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-2 py-3';
const ROW_MAIN = 'flex min-w-0 flex-1 basis-48 flex-col gap-0.5';
const ROW_TITLE = 'text-sm font-medium';
const ROW_META = 'text-[13px] text-muted-foreground';
/** Inline form opened under a list row. */
const ROW_FORM = 'basis-full rounded-lg border border-border bg-muted/30 p-4';
/** Choice tile (project, pricing line, commitment, reason). */
const CHOICE = 'flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 text-left transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:ring-1 aria-pressed:ring-foreground disabled:cursor-not-allowed disabled:opacity-50';
/** Small pill choice (date shortcuts, reasons). */
const CHIP = 'inline-flex h-7 cursor-pointer items-center rounded-full border border-border bg-background px-3 text-xs transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background disabled:cursor-not-allowed disabled:opacity-40';

// Number of monthly CRA reports with at least one stored entry, across every
// employment period of a person. One CRA = one month, so months dedupe.
function useCraMonthCount(employees: Employee[]) {
  const ids = employees.map(employee => employee.id).join(',');
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    const list = ids ? ids.split(',') : [];
    if (!list.length) return;
    void (async () => {
      try {
        const found = await db().from('cra_entries').select('month').in('employee_id', list);
        if (found.error) throw found.error;
        if (cancelled) return;
        setCount(new Set((found.data ?? []).map(row => row.month)).size);
      } catch {
        /* Missing CRA history stays hidden rather than blocking the record. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);
  return count;
}
export function PersonWorkspace({
  person,
  context,
  tab,
  onNavigate,
  initialApplication,
  initialEmployment
}: {
  person: Person;
  context: RecordContext;
  tab: PersonTab;
  onNavigate: (tab: PersonTab) => void;
  initialApplication?: string | null;
  initialEmployment?: string | null;
}) {
  const applications = context.workspace.applications.filter(application => application.person_id === person.id);
  const employees = context.workspace.employees.filter(employee => employee.person_id === person.id);
  const isEmployee = employees.length > 0;
  const assignments = context.workspace.assignments.filter(assignment => employees.some(employee => employee.id === assignment.employee_id));
  const craCount = useCraMonthCount(employees);
  const tabs = [{
    key: 'profile',
    title: 'Profile'
  },
  // Employees with no application on file don't need an empty Applications tab.
  ...(!isEmployee || applications.length > 0 ? [{
    key: 'applications',
    title: 'Applications',
    count: applications.length
  }] : []), ...(isEmployee ? [{
    key: 'employment',
    title: 'Employment',
    count: employees.length
  }, {
    key: 'projects',
    title: 'Projects',
    count: assignments.length
  }, {
    key: 'cra',
    title: 'CRA',
    count: craCount ?? 0
  }] : []), {
    key: 'history',
    title: 'Activity'
  }];
  const activeTab = tabs.some(item => item.key === tab) ? tab : 'profile';
  return <div className="@container flex min-w-0 flex-col gap-6">
    <Tabs value={activeTab} onValueChange={value => onNavigate(value as PersonTab)} className="w-full min-w-0">
      <TabsList variant="line" aria-label="Person record" className="h-10 w-full justify-start gap-5 overflow-x-auto border-b border-border">
        {tabs.map(item => <TabsTrigger key={item.key} value={item.key} className="flex-none gap-1.5 group-data-horizontal/tabs:after:bottom-0">
          {item.title}
          {'count' in item && <span className="num text-xs text-muted-foreground">
            {item.count}
          </span>}
        </TabsTrigger>)}
      </TabsList>
    </Tabs>
    <div className="flex min-w-0 flex-col gap-6" role="tabpanel" aria-label={tabs.find(item => item.key === activeTab)?.title}>
      {activeTab === 'profile' && <Profile person={person} context={context} onNavigate={onNavigate} craCount={craCount ?? 0} />}
      {activeTab === 'applications' && <Applications person={person} context={context} initialId={initialApplication} />}
      {activeTab === 'employment' && <Employments person={person} context={context} initialId={initialEmployment} />}
      {activeTab === 'projects' && <Assignments person={person} context={context} />}
      {activeTab === 'cra' && <PersonCra person={person} context={context} />}
      {activeTab === 'history' && <History person={person} context={context} />}
    </div>
  </div>;
}
function ProfileCard({ id, title, description, children, className }: { id?: string; title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return <Card id={id} className={cn('scroll-mt-20', className)}>
    <CardHeader>
      <CardHeading>{title}</CardHeading>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      {children}
    </CardContent>
  </Card>;
}
function Profile({
  person,
  onNavigate,
  craCount,
  context: {
    workspace,
    run,
    busy,
    actorEmail,
    reload
  }
}: {
  person: Person;
  context: RecordContext;
  onNavigate: (tab: PersonTab) => void;
  craCount: number;
}) {
  const account = workspace.accounts.find(item => item.person_id === person.id);
  const applications = workspace.applications.filter(application => application.person_id === person.id);
  const employees = workspace.employees.filter(employee => employee.person_id === person.id);
  const assignments = workspace.assignments.filter(assignment => employees.some(employee => employee.id === assignment.employee_id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldsKey, setFieldsKey] = useState(0);
  const retry = useRetryCommand();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await run(retry.prepare({
        kind: 'update_person',
        person_id: person.id,
        expected_version: person.version,
        full_name: text(data, 'full_name'),
        email: text(data, 'email'),
        phone: text(data, 'phone'),
        headline: text(data, 'headline'),
        location: text(data, 'location'),
        linkedin_url: text(data, 'linkedin_url'),
        skills: text(data, 'skills'),
        languages: text(data, 'languages'),
        degrees: text(data, 'degrees'),
        certifications: text(data, 'certifications'),
        notes: text(data, 'notes'),
        owner_email: text(data, 'owner_email'),
        contact_allowed: checked(data, 'contact_allowed')
      // No workspace banner: the save bar confirms the save where it happened.
      }), '');
      retry.complete();
      setMessage('Profile updated.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  const glance = [...(employees.length ? [{
    n: employees.length,
    label: 'Employment',
    tab: 'employment'
  }, {
    n: craCount,
    label: 'CRA',
    tab: 'cra'
  }] : []), {
    n: assignments.length,
    label: 'Projects',
    tab: 'projects'
  }, ...(!employees.length || applications.length ? [{
    n: applications.length,
    label: 'Applications',
    tab: 'applications'
  }] : [])];
  const skillCount = listed(person.skills).length;
  // Profile completeness: the fields a client CV draws on, plus the portal
  // link. Each unfilled one is a gap the sidebar can jump you to.
  const checks = [{
    label: 'Professional headline',
    filled: Boolean(person.headline.trim()),
    anchor: 'hr-profile-identity',
    action: 'Add'
  }, {
    label: 'Phone',
    filled: Boolean(person.phone.trim()),
    anchor: 'hr-profile-identity',
    action: 'Add'
  }, {
    label: 'Location',
    filled: Boolean(person.location.trim()),
    anchor: 'hr-profile-identity',
    action: 'Add'
  }, {
    label: 'Skills',
    filled: skillCount > 0,
    anchor: 'hr-profile-skills',
    action: 'Add'
  }, {
    label: 'Languages',
    filled: listed(person.languages).length > 0,
    anchor: 'hr-profile-credentials',
    action: 'Add'
  }, {
    label: 'Education',
    filled: listed(person.degrees).length > 0,
    anchor: 'hr-profile-credentials',
    action: 'Add'
  }, {
    label: 'Certifications',
    filled: listed(person.certifications).length > 0,
    anchor: 'hr-profile-credentials',
    action: 'Add'
  }, {
    label: 'Portal account',
    filled: Boolean(account),
    anchor: 'hr-profile-portal',
    action: 'Invite'
  }];
  const missing = checks.filter(check => !check.filled);
  const segments = 12;
  const litSegments = Math.round((checks.length - missing.length) / checks.length * segments);
  const live = employees.find(employee => employee.status === 'active') ?? employees[0];
  const facts = [{
    label: 'Matricule',
    value: live?.matricule ?? '—',
    mono: true
  }, {
    label: 'Role',
    value: live?.role || (applications.length ? 'Candidate' : 'Talent pool')
  }, {
    label: 'State',
    value: live ? label(live.status) : applications.length ? 'In pipeline' : 'Not engaged'
  }, {
    label: 'Source',
    value: person.source ? label(person.source) : 'Not recorded'
  }];
  return <div className="grid min-w-0 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
    <form className="flex min-w-0 flex-col gap-6" onSubmit={event => void onSubmit(event)}>
      <ProfileCard id="hr-profile-identity" key={`identity-${fieldsKey}`} title="Identity and contact" description="How this person appears across Quicksort, and where notifications go">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
          <Field name="full_name" label="Full name" value={person.full_name} required />
          <Field name="headline" label="Professional headline" value={person.headline} />
          <Field name="email" label="Work email" type="email" value={person.email} />
          <Field name="phone" label="Phone" type="tel" value={person.phone} />
          <Field name="location" label="Location" value={person.location} />
          <Field name="linkedin_url" label="LinkedIn profile" type="url" value={person.linkedin_url} />
          <UiField className="min-w-0 gap-1.5">
            <FieldLabel htmlFor={`owner-${person.id}`}>Record owner</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <span className="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold text-foreground" aria-hidden="true">{initials(person.owner_email || actorEmail)}</span>
              </InputGroupAddon>
              <InputGroupInput id={`owner-${person.id}`} name="owner_email" type="email" defaultValue={person.owner_email || actorEmail} />
            </InputGroup>
          </UiField>
        </div>
      </ProfileCard>
      <ProfileCard id="hr-profile-skills" key={`skills-${fieldsKey}`} title={<>Skills{skillCount > 0 && <span className="num font-normal text-muted-foreground"> · {skillCount}</span>}</>} description="Matched against project staffing requests">
        <SkillListField name="skills" label="Add a skill" hideLabel value={person.skills} placeholder="Type a skill, then press Enter" />
      </ProfileCard>
      <ProfileCard id="hr-profile-credentials" key={`credentials-${fieldsKey}`} title="Credentials" description="Shown on client CVs. Highest qualifications first.">
        <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
          {[{
            title: 'Languages',
            hint: 'Spoken and written level, as presented to clients',
            name: 'languages',
            field: 'Add a language',
            value: person.languages,
            placeholder: 'e.g. French, native'
          }, {
            title: 'Education',
            hint: 'Degree, school and year',
            name: 'degrees',
            field: 'Add a degree',
            value: person.degrees,
            placeholder: 'e.g. Master MIAGE, Dauphine'
          }, {
            title: 'Certifications',
            hint: 'Accreditations with year obtained',
            name: 'certifications',
            field: 'Add a certification',
            value: person.certifications,
            placeholder: 'e.g. PSM I, 2023'
          }].map(item => <div key={item.name} className="flex min-w-0 flex-col gap-1.5">
            <h3 className="m-0 text-sm font-medium">{item.title}</h3>
            <p className={cn(QUIET, 'mb-1 text-xs')}>{item.hint}</p>
            <div className="mt-auto [&_[data-slot=field-description]]:hidden">
              <SkillListField name={item.name} label={item.field} hideLabel value={item.value} placeholder={item.placeholder} />
            </div>
          </div>)}
        </div>
      </ProfileCard>
      <ProfileCard key={`notes-${fieldsKey}`} title="Internal notes" description="Visible to Quicksort staff only. Never exported.">
        <dl className="m-0 grid gap-x-6 gap-y-4 rounded-lg border border-border bg-muted/30 p-4 [grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))]">
          {facts.map(fact => <Fact key={fact.label} term={fact.label} mono={fact.mono}>{fact.value}</Fact>)}
        </dl>
        <div className="grid">
          <Field name="notes" label="Notes" type="textarea" value={person.notes} hint="Context for staffing: preferences, constraints, feedback from clients" />
        </div>
        <CheckField name="contact_allowed" defaultChecked={person.contact_allowed}>Contact permitted for future opportunities</CheckField>
      </ProfileCard>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <span className={cn(QUIET, 'min-w-0 flex-1 basis-48')} role="status">{message || 'Edits are kept as a draft until you save'}</span>
        <Button type="button" variant="outline" disabled={busy || saving} onClick={() => {
          setFieldsKey(key => key + 1);
          setError('');
          setMessage('');
        }}>
          Discard
        </Button>
        <Button type="submit" disabled={busy || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
    <aside className="flex min-w-0 flex-col gap-6">
      <Card size="sm">
        <CardHeader>
          <CardHeading>Profile completeness</CardHeading>
          <CardAction>
            <Badge variant={missing.length ? 'outline' : 'success'}>{missing.length ? `${missing.length} ${missing.length === 1 ? 'gap' : 'gaps'}` : 'Complete'}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-12 gap-[3px]" aria-hidden="true">
            {Array.from({ length: segments }, (_, index) => <span key={index} className={cn('h-1.5 rounded-[2px]', index < litSegments ? 'bg-foreground' : 'bg-foreground/15')} />)}
          </div>
          <p className={QUIET}>{missing.length ? 'Filling these makes the profile ready to send as a client CV.' : 'Everything a client CV draws on is on file.'}</p>
          {missing.length > 0 && <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {missing.map(gap => <li className="flex items-center justify-between gap-2 py-1.5 text-sm" key={gap.label}>
              <span>{gap.label}</span>
              <Button type="button" variant="ghost" size="xs" onClick={() => focusSection(gap.anchor)}>{gap.action}</Button>
            </li>)}
          </ul>}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardHeading>At a glance</CardHeading>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {glance.map(item => <button type="button" key={item.label} className={cn('flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', item.n === 0 && 'text-muted-foreground')} onClick={() => onNavigate(item.tab as PersonTab)}>
              <strong className="num text-xl font-normal">{item.n}</strong>
              <span className="text-xs text-muted-foreground">{item.label}</span>
            </button>)}
          </div>
        </CardContent>
      </Card>
      {employees.length > 0 && <Card size="sm">
        <CardHeader>
          <CardHeading>Employment</CardHeading>
          <CardAction>
            <Button type="button" variant="ghost" size="xs" onClick={() => onNavigate('employment')}>History</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col divide-y divide-border">
            {employees.map(employee => <dl className="m-0 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 py-3 text-sm first:pt-0 last:pb-0" key={employee.id}>
              <dt className="text-muted-foreground">Matricule</dt><dd className="num m-0">{employee.matricule}</dd>
              <dt className="text-muted-foreground">Role</dt><dd className="m-0">{employee.role}</dd>
              <dt className="text-muted-foreground">Entry date</dt><dd className="m-0">{date(employee.start_date)}</dd>
              <dt className="text-muted-foreground">Status</dt><dd className="m-0">{label(employee.status)}{employee.end_date ? ` · to ${date(employee.end_date)}` : ''}</dd>
            </dl>)}
          </div>
        </CardContent>
      </Card>}
      <Card size="sm" id="hr-profile-portal" className="scroll-mt-20">
        <CardHeader>
          <CardHeading>Portal account</CardHeading>
          <CardAction>
            <Badge variant={account ? 'success' : 'outline'}>{account ? 'Linked' : 'Not linked'}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {account ? <div className="flex flex-col gap-1 text-sm">
            <p className="m-0">Profile ID <strong className="num font-medium break-all">{account.profile_id}</strong></p>
            <p className={QUIET}>Linked {date(account.linked_at)}</p>
          </div> : <>
            <p className={QUIET}>Linking an account gives {person.full_name.split(' ')[0] || 'this person'} access to their offers, documents and CRA tasks.</p>
            <CreatePortalAccount person={person} role={employees.length ? 'employee' : 'candidate'} onCreated={reload} />
            <p className={cn(QUIET, 'border-t border-border pt-4')}>Or link a sign-in they already made:</p>
            <AccountLinker person={person} workspace={workspace} run={run} busy={busy} />
          </>}
        </CardContent>
      </Card>
      <AiPanel person={person} workspace={workspace} run={run} reload={reload} kind="alumni_reconnect" />
    </aside>
  </div>;
}
/** Comma/newline-separated profile list fields, as the chip editors store them. */
const listed = (raw: string) => raw.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
/** Jump to a profile section from the completeness sidebar and focus its first input. */
const focusSection = (id: string) => {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  section.querySelector<HTMLElement>('input:not([type="hidden"]), textarea')?.focus({ preventScroll: true });
};
/** Creates the sign-in for this person from their record (email and name) and links it (api/accounts.ts). */
function CreatePortalAccount({ person, role, onCreated }: { person: Person; role: 'employee' | 'candidate'; onCreated: () => unknown }) {
  const { session } = useSession();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const email = (person.email ?? '').trim();
  async function create() {
    setSaving(true);
    setError('');
    try {
      const token = await session?.getToken({ template: 'supabase' });
      if (!token) throw new Error('Sign in again to create accounts.');
      const response = await fetch('/api/accounts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id, role }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not create the account.');
      await onCreated();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <div className="flex flex-col items-start gap-2">
    {email
      ? <p className={QUIET}>Creates a sign-in for <strong className="font-medium text-foreground">{email}</strong> as {role === 'employee' ? 'an employee' : 'a candidate'}, named as on this record, and links it.</p>
      : <p className={QUIET}>Add a work email to this profile to create their portal account.</p>}
    <Button type="button" size="sm" disabled={!email || saving} onClick={() => void create()}>
      {saving ? 'Creating…' : 'Create portal account →'}
    </Button>
    {error && <ErrorText>{error}</ErrorText>}
  </div>;
}
function AccountLinker({ person, workspace, run, busy }: {
  person: Person; workspace: Workspace; run: RunCommand; busy: boolean;
}) {
  const [profiles, setProfiles] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await db().from('profiles').select('id,full_name,email').order('full_name');
        if (result.error) throw result.error;
        const parsed = z.array(z.object({ id: z.string().uuid(), full_name: z.string(), email: z.string() })).parse(result.data);
        if (!cancelled) setProfiles(parsed);
      } catch (failure) { if (!cancelled) setLoadError(errorMessage(failure)); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, []);
  const availableProfiles = profiles.filter((profile) => !workspace.accounts.some((account) => account.profile_id === profile.id && account.person_id !== person.id) && `${profile.full_name} ${profile.email}`.toLowerCase().includes(query.toLowerCase()));
  const matches = availableProfiles.slice(0, 4);
  async function link() {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    try {
      await run({
        kind: 'link_account',
        person_id: person.id,
        profile_id: selected
      }, 'Portal account linked.');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <div className="flex flex-col items-stretch gap-3">
    {loading && <p role="status" className={QUIET}>Loading portal accounts…</p>}
    {loadError && <ErrorText>{loadError}</ErrorText>}
    {!loading && !loadError && <>
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput type="search" aria-label="Find this person's account" placeholder="Search by name or email" value={query} onChange={event => {
          setQuery(event.target.value);
          setSelected('');
        }} />
      </InputGroup>
      {matches.length ? <div className="flex flex-col gap-1.5">
        {matches.map(profile => <button type="button" key={profile.id} className={cn(CHOICE, 'gap-2.5 px-2.5 py-2')} aria-pressed={selected === profile.id} onClick={() => setSelected(profile.id)}>
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold" aria-hidden="true">{initials(profile.full_name || profile.email)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <strong className="truncate text-[13px] font-medium">{profile.full_name || 'Unnamed account'}</strong>
            <small className="truncate text-xs text-muted-foreground">{profile.email}</small>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{selected === profile.id ? 'Selected' : 'Select'}</span>
        </button>)}
      </div> : <p className={QUIET}>No available account matches. The person must sign in to create a portal account first.</p>}
      <p className={cn(QUIET, 'text-xs')}>Linking grants this account access to the person's applications, offers and employment tasks.</p>
      <Button type="button" size="sm" variant="outline" className="self-start" disabled={!selected || busy || saving} onClick={() => void link()}>
        {saving ? 'Linking…' : 'Link account →'}
      </Button>
    </>}
    {error && <ErrorText>{error}</ErrorText>}
  </div>;
}

function Applications({
  person,
  context,
  initialId
}: {
  person: Person;
  context: RecordContext;
  initialId?: string | null;
}) {
  return <CandidateApplication person={person} context={context} initialId={initialId} records={application => <ApplicationDetail key={application.id} application={application} person={person} context={context} />} />;
}
export function Readiness({
  applicationId,
  stage,
  onLoaded
}: {
  applicationId: string;
  stage: string;
  onLoaded?: (ready: boolean) => void;
}) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void loadRequirements(applicationId, stage).then(items => {
      if (!cancelled) {
        setRequirements(items);
        onLoaded?.(items.every(item => item.done));
      }
    }).catch(failure => {
      if (!cancelled) {
        setError(errorMessage(failure));
        onLoaded?.(false);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId, stage, onLoaded]);
  if (loading) return <p role="status" className={QUIET}>Checking prerequisites…</p>;
  if (error) return <ErrorText>
    {error}
  </ErrorText>;
  if (!requirements.length) return <p className={QUIET}>No additional prerequisites for this stage.</p>;
  return <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
    {requirements.map(requirement => <li key={requirement.key} className="flex items-start gap-2.5 text-sm">
      {requirement.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="flex flex-col">
        {requirement.label}
        <small className="text-xs text-muted-foreground">
          {requirement.done ? ' Evidence recorded' : ' Evidence required'}
        </small>
      </span>
    </li>)}
  </ul>;
}
/** Read-only hire prerequisite for users who can't send contracts: is the contract signed in Youtrust? */
function ContractSigned({ applicationId }: { applicationId: string }) {
  const [signed, setSigned] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadRequirements(applicationId, 'hire').then(items => {
      if (!cancelled) setSigned(items.find(item => item.key === 'signatures')?.done ?? false);
    }).catch(failure => {
      if (!cancelled) setError(errorMessage(failure));
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (signed === null) return <p role="status" className={QUIET}>Checking the signature…</p>;
  return <p className="m-0 flex items-center gap-2.5 text-sm">
    {signed ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    <span>{signed ? 'Signed in Youtrust' : 'Not signed yet. An admin sends the contract from this page.'}</span>
  </p>;
}
/** One record (interview, offer) inside an application section. */
function RecordCard({ title, meta, badges, children }: { title: ReactNode; meta?: ReactNode; badges?: ReactNode; children?: ReactNode }) {
  return <Card size="sm">
    <CardHeader>
      <CardHeading level={3} className="flex min-w-0 items-center gap-2">{title}</CardHeading>
      {meta && <CardDescription>{meta}</CardDescription>}
      {badges && <CardAction className="flex flex-wrap justify-end gap-1.5">{badges}</CardAction>}
    </CardHeader>
    {children && <CardContent className="flex flex-col gap-4 text-sm">{children}</CardContent>}
  </Card>;
}
function ApplicationDetail({
  application,
  person,
  context
}: {
  application: Application;
  person: Person;
  context: RecordContext;
}) {
  const {
    workspace,
    run,
    busy,
    reload
  } = context;
  const opportunity = workspace.opportunities.find(item => item.id === application.opportunity_id);
  const interviews = workspace.interviews.filter(interview => interview.application_id === application.id);
  const offers = workspace.offers.filter(offer => offer.application_id === application.id);
  return <>
    <Section title="Interviews" detail="Scheduling records the interview. Calendar invitations are sent manually.">
      {!interviews.length && <Empty>No interview has been scheduled for this application.</Empty>}
      {interviews.map(interview => <RecordCard key={interview.id} title={`${label(interview.kind)} interview`} meta={`${new Date(interview.scheduled_at).toLocaleString()} · ${interview.panel}`} badges={<Tag>
          {label(interview.status)}
        </Tag>}>
        <p className="m-0">{interview.location || 'Location not set'} · Invitation {label(interview.invitation_status)}</p>
        {interview.notes && <p className="m-0 text-muted-foreground">
          {interview.notes}
        </p>}
        {interview.status === 'scheduled' && <Disclosure summary="Record interview outcome">
          <div className="flex flex-col gap-6">
            <Form run={run} busy={busy} button="Complete interview" success="Interview and reviewed scorecard recorded." submit={data => ({
              kind: 'complete_interview',
              interview_id: interview.id,
              expected_version: interview.version,
              notes: text(data, 'notes'),
              scorecard: ['Technical skills', 'Communication', 'Motivation'].map((competency, index) => ({
                competency,
                rating: number(data, `rating_${index}`),
                evidence: text(data, `evidence_${index}`)
              }))
            })}>
              {['Technical skills', 'Communication', 'Motivation'].map((competency, index) => <div className="col-span-full grid gap-4 @md:grid-cols-[10rem_minmax(0,1fr)]" key={competency}>
                <Field name={`rating_${index}`} label={`${competency} rating (1-5)`} type="number" min={1} max={5} required />
                <Field name={`evidence_${index}`} label={`${competency} evidence`} required />
              </div>)}
              <Field name="notes" label="Interviewer notes" type="textarea" required />
            </Form>
            <div className="border-t border-border pt-6">
              <Form run={run} busy={busy} button="Cancel interview" success="Interview cancelled." submit={data => ({
                kind: 'cancel_interview',
                interview_id: interview.id,
                expected_version: interview.version,
                rationale: text(data, 'rationale')
              })}>
                <Field name="rationale" label="Cancellation reason" required />
              </Form>
            </div>
          </div>
        </Disclosure>}
      </RecordCard>)}
      {application.status === 'active' && <Disclosure summary="Schedule an interview">
        <Form run={run} busy={busy} button="Schedule interview" success="Interview recorded. Send the calendar invitation manually." submit={data => ({
          kind: 'schedule_interview',
          application_id: application.id,
          interview_kind: text(data, 'interview_kind'),
          scheduled_at: new Date(text(data, 'scheduled_at')).toISOString(),
          panel: text(data, 'panel'),
          location: text(data, 'location')
        })}>
          <Field name="interview_kind" label="Interview type" options={options(['hr', 'technical', 'client'])} required />
          <Field name="scheduled_at" label="Date and time" type="datetime-local" required />
          <Field name="panel" label="Interview panel" required hint="Names or email addresses of the interviewers." />
          <Field name="location" label="Meeting link or location" />
        </Form>
      </Disclosure>}
      <AiPanel person={person} workspace={workspace} run={run} reload={reload} application={application} kind="interview_prep" />
    </Section>
    <Section title="Employment offers" detail="Compensation and margin use deterministic calculations. Approvals use your actual permissions.">
      {offers.map(offer => <RecordCard key={offer.id} title={offer.title} badges={<Tag tone={offer.status === 'accepted' ? 'good' : ''}>
          {label(offer.status)}
        </Tag>}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-4">
          <Stat size="sm"><StatValue className="group-data-[size=sm]/stat:text-xl">€{offer.salary_monthly.toLocaleString()}</StatValue><StatLabel>Monthly salary</StatLabel></Stat>
          <Stat size="sm"><StatValue className="group-data-[size=sm]/stat:text-xl">€{offer.cjm}</StatValue><StatLabel>Daily cost</StatLabel></Stat>
          <Stat size="sm"><StatValue className="group-data-[size=sm]/stat:text-xl">€{offer.target_tjm}</StatValue><StatLabel>Target daily rate</StatLabel></Stat>
          <Stat size="sm"><StatValue className="group-data-[size=sm]/stat:text-xl">{offer.margin_pct.toFixed(1)}%</StatValue><StatLabel>Gross margin</StatLabel></Stat>
        </div>
        <p className={QUIET}>{offer.contract_type} · Valid until {date(offer.valid_until)} · Delivery {label(offer.delivery_status)}</p>
        {['pending_approval', 'pending_direction'].includes(offer.status) && (offer.status !== 'pending_direction' || workspace.capabilities.approve_direction) && <Form run={run} busy={busy} button={offer.status === 'pending_direction' ? 'Record direction approval' : 'Approve offer'} success="Offer approval recorded." submit={data => ({
          kind: 'approve_offer',
          offer_id: offer.id,
          expected_version: offer.version,
          note: text(data, 'note')
        })}>
          <Field name="note" label="Approval rationale" required />
        </Form>}
        {offer.status === 'pending_direction' && !workspace.capabilities.approve_direction && <p className={QUIET}>Awaiting direction approval from an administrator.</p>}
        {offer.status === 'approved' && <Action run={run} disabled={busy} input={{
          kind: 'share_offer',
          offer_id: offer.id,
          expected_version: offer.version
        }} success="Offer published in the linked person's portal. External notification remains manual.">Share in portal</Action>}
        {offer.status === 'shared' && <Form run={run} busy={busy} button="Record candidate response" success="Candidate response recorded." submit={data => ({
          kind: 'respond_offer',
          offer_id: offer.id,
          expected_version: offer.version,
          response: text(data, 'response'),
          rationale: text(data, 'rationale')
        })}>
          <Field name="response" label="Candidate response" options={options(['accepted', 'declined'])} required />
          <Field name="rationale" label="Response evidence" type="textarea" required hint="Record when and how the candidate responded." />
        </Form>}
      </RecordCard>)}
      {!offers.length && <Empty>No employment offer yet.</Empty>}
      {application.status === 'active' && application.stage !== 'decision' && <p className={QUIET}>Complete the interview evidence and move to Decision before drafting an employment offer.</p>}
      {application.status === 'active' && application.stage === 'decision' && <Disclosure summary="Draft an employment offer">
        <Form run={run} busy={busy} button="Create offer draft" success="Offer drafted for approval." submit={data => ({
          kind: 'create_offer',
          application_id: application.id,
          title: text(data, 'title'),
          contract_type: text(data, 'contract_type'),
          salary_monthly: number(data, 'salary_monthly'),
          cjm: number(data, 'cjm'),
          target_tjm: number(data, 'target_tjm'),
          valid_until: nullable(data, 'valid_until')
        })}>
          <Field name="title" label="Offer title" value={opportunity?.title ?? ''} required />
          <Field name="contract_type" label="Contract type" value="CDI" options={options(['CDI', 'CDD', 'Freelance', 'Internship', 'Apprenticeship'])} required />
          <Field name="salary_monthly" label="Monthly salary (€)" type="number" min={0} step="0.01" required />
          <Field name="cjm" label="Fully loaded daily cost (€)" type="number" min={1} step="0.01" required />
          <Field name="target_tjm" label="Target daily rate (€)" type="number" min={1} step="0.01" value={opportunity?.target_tjm} required />
          <Field name="valid_until" label="Valid until" type="date" />
        </Form>
      </Disclosure>}
    </Section>
    <Section title="Contract signature" detail="The hiring contract for this application. Once signed in Youtrust, the person can be hired.">
      {workspace.capabilities.admin
        ? <PersonSignatures personId={person.id} person={{ name: person.full_name, email: person.email }} applicationId={application.id} />
        : <ContractSigned key={`signed-${workspace.events.length}`} applicationId={application.id} />}
    </Section>
    {application.status === 'active' && <Section title="Hire and start preboarding" detail="The person keeps all prior applications and employment periods.">
      <div className="grid items-start gap-4 @3xl:grid-cols-[16rem_minmax(0,1fr)]">
        <Card size="sm">
          <CardHeader>
            <CardHeading level={3}>Prerequisites</CardHeading>
          </CardHeader>
          <CardContent>
            <Readiness key={`hire-${workspace.events.length}`} applicationId={application.id} stage="hire" />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent>
            <Form run={run} busy={busy} button="Confirm hire" success="Hire recorded and preboarding plan created." submit={data => ({
              kind: 'hire',
              application_id: application.id,
              expected_version: application.version,
              start_date: text(data, 'start_date'),
              role: text(data, 'role'),
              manager_email: text(data, 'manager_email'),
              parrain: text(data, 'parrain'),
              probation_end: nullable(data, 'probation_end')
            })}>
              <Field name="role" label="Employment role" value={opportunity?.title ?? person.headline} required />
              <Field name="start_date" label="Start date" type="date" required />
              <Field name="manager_email" label="Manager email" type="email" />
              <Field name="parrain" label="Buddy" />
              <Field name="probation_end" label="Probation end date" type="date" />
            </Form>
          </CardContent>
        </Card>
      </div>
    </Section>}
  </>;
}
function Employments({
  person,
  context,
  initialId
}: {
  person: Person;
  context: RecordContext;
  initialId?: string | null;
}) {
  const employees = context.workspace.employees.filter(employee => employee.person_id === person.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const [selected, setSelected] = useState(initialId ?? employees[0]?.id ?? '');
  const current = employees.find(employee => employee.id === selected) ?? employees[0];
  if (!current) return <>
    <Empty>No employment period yet. Complete hiring from an application to begin preboarding, or engage the person directly.</Empty>
    <EngageDirectly person={person} context={context} />
  </>;
  return <>
    <EmploymentDetail key={current.id} person={person} employee={current} periods={employees} onSelectPeriod={setSelected} context={context} />
    {employees.every(employee => employee.status === 'ended') && <EngageDirectly person={person} context={context} />}
  </>;
}
/** Direct engagement — record an employment period without the application
    pipeline, e.g. engaging a talent-pool freelancer straight onto a project.
    Gated to recruiters; the rationale lands in the audit log. */
function EngageDirectly({
  person,
  context
}: {
  person: Person;
  context: RecordContext;
}) {
  const {
    workspace,
    run,
    busy
  } = context;
  if (!workspace.capabilities.recruit) return null;
  return <Disclosure summary="Engage directly (no application)">
    <div className="flex flex-col gap-4">
      <p className={QUIET}>For people hired outside the pipeline (freelancers, direct contracts). Skips offers and contracts. An optional rationale is recorded as audit evidence.</p>
      <Form run={run} busy={busy} button="Record engagement" success="Engagement recorded. The person can be staffed on projects right away." submit={data => {
        const contractType = text(data, 'contract_type');
        const dailyRateText = text(data, 'daily_rate');
        return {
          kind: 'engage_person' as const,
          person_id: person.id,
          role: text(data, 'role'),
          contract_type: contractType,
          start_date: text(data, 'start_date'),
          manager_email: text(data, 'manager_email'),
          rationale: text(data, 'rationale'),
          ...(contractType === 'Freelance' && dailyRateText ? { daily_rate: Number(dailyRateText) } : {})
        };
      }}>
        <Field name="role" label="Engagement role" value={person.headline} required />
        <Field name="contract_type" label="Contract type" value="Freelance" options={options(['Freelance', 'CDI', 'CDD', 'Internship', 'Apprenticeship'])} required />
        <Field name="daily_rate" label="Daily rate (TJM, €/day)" type="number" min={0} step="0.01" hint="Freelance only: recorded as the first daily-rate entry in the compensation history." />
        <Field name="start_date" label="Start date" type="date" value={today()} required />
        <Field name="manager_email" label="Manager email" type="email" />
        <Field name="rationale" label="Engagement rationale" type="textarea" hint="Optional. Why this person is engaged without the application pipeline." />
      </Form>
    </div>
  </Disclosure>;
}
/** One Employment-tab section: a card whose header carries the section title,
   its one-line rationale and any side controls (period picker, notes). */
function EmpSection({
  title,
  detail,
  rail,
  children
}: {
  title: string;
  detail?: string;
  rail?: ReactNode;
  children: ReactNode;
}) {
  return <Card>
    <CardHeader>
      <CardHeading>{title}</CardHeading>
      {detail && <CardDescription className="max-w-prose">{detail}</CardDescription>}
      {rail && <CardAction className="max-w-[16rem]">{rail}</CardAction>}
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">{children}</CardContent>
  </Card>;
}
/** Compact journey-task composer — one row (title, phase, due date,
   Add) instead of the full field grid. The owner defaults to the signed-in
   recruiter and new tasks are required, matching journey enforcement. */
function TaskComposer({
  employee,
  context
}: {
  employee: Employee;
  context: RecordContext;
}) {
  const {
    run,
    busy,
    actorEmail
  } = context;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const retry = useRetryCommand();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = text(data, 'title');
    if (!title || saving) return;
    setSaving(true);
    setError('');
    try {
      await run(retry.prepare({
        kind: 'save_task',
        employee_id: employee.id,
        title,
        phase: text(data, 'phase') as JourneyTask['phase'],
        assignee: actorEmail,
        due_date: nullable(data, 'due_date'),
        required: true
      }), 'Journey task added.');
      retry.complete();
      form.reset();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <div className="flex flex-col gap-1.5">
    <form className="flex flex-wrap items-center gap-2" onSubmit={event => void onSubmit(event)}>
      <Input name="title" placeholder="Add a task…" aria-label="New task" required maxLength={300} className="min-w-48 flex-[1_1_14rem]" />
      <NativeSelect name="phase" defaultValue="onboarding" aria-label="Phase">
        {(['preboarding', 'onboarding', 'probation'] as const).map(phase => <NativeSelectOption key={phase} value={phase}>
          {label(phase)}
        </NativeSelectOption>)}
      </NativeSelect>
      <Input name="due_date" type="date" aria-label="Due date" className="w-auto" />
      <Button type="submit" disabled={busy || saving}>
        {saving ? 'Adding…' : 'Add'}
      </Button>
    </form>
    <p className={cn(QUIET, 'text-xs')}>Owner: {actorEmail} · Required</p>
    {error && <ErrorText>
      {error}
    </ErrorText>}
  </div>;
}
/** Round completion check at the start of a task row. */
function TaskCheck({ done, ...props }: { done: boolean } & React.ComponentProps<'button'>) {
  return <button type="button" className={cn('grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-full border p-0 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default', done ? 'border-foreground bg-foreground text-background' : 'border-input text-transparent enabled:hover:border-foreground enabled:hover:text-foreground')} {...props}>
    <Check className="size-3" aria-hidden="true" />
  </button>;
}
/** Empty line inside an Employment section, with an optional action. */
function EmpEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
    <span>{children}</span>
    {action}
  </div>;
}
export function EmploymentDetail({
  person,
  employee,
  periods,
  onSelectPeriod,
  context
}: {
  person: Person;
  employee: Employee;
  periods?: Employee[];
  onSelectPeriod?: (id: string) => void;
  context: RecordContext;
}) {
  const {
    workspace,
    run,
    busy,
    reload
  } = context;
  const tasks = workspace.tasks.filter(task => task.employee_id === employee.id);
  const freelance = employee.contract_type === 'Freelance';
  const salaries = workspace.salaries.filter(entry => entry.employee_id === employee.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const reviews = workspace.reviews.filter(review => review.employee_id === employee.id);
  const exit = workspace.exits.find(record => record.employee_id === employee.id);
  const ended = employee.status === 'ended';
  const canEdit = !ended && workspace.capabilities.recruit;
  const [editingPeople, setEditingPeople] = useState(false);
  const [editingContract, setEditingContract] = useState(false);
  const [editingNationality, setEditingNationality] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState('');
  const [editingTaskId, setEditingTaskId] = useState('');
  const [recordingReviewId, setRecordingReviewId] = useState('');
  const [addingSalary, setAddingSalary] = useState(false);
  const [editingSalaryId, setEditingSalaryId] = useState('');
  const [schedulingReview, setSchedulingReview] = useState(false);
  const [startingExit, setStartingExit] = useState(false);
  const [cancellingHire, setCancellingHire] = useState(false);
  const completeCount = tasks.filter(task => task.completed_at).length;
  const periodRail = periods && onSelectPeriod ? <UiField className="gap-1">
    <FieldLabel htmlFor={`period-${employee.id}`} className="text-xs font-normal text-muted-foreground">Period</FieldLabel>
    <NativeSelect id={`period-${employee.id}`} size="sm" value={employee.id} onChange={event => onSelectPeriod(event.target.value)} aria-label="Employment period">
      {periods.map(period => <NativeSelectOption value={period.id} key={period.id}>
        {date(period.start_date)} to {period.end_date ? date(period.end_date) : 'present'}
      </NativeSelectOption>)}
    </NativeSelect>
  </UiField> : undefined;
  const change = (onClick: () => void) => canEdit && <Button type="button" variant="ghost" size="xs" onClick={onClick}>
    Change
  </Button>;
  const assign = (onClick: () => void, caption: string) => <Button type="button" variant="outline" size="xs" onClick={onClick}>
    <Plus data-icon="inline-start" aria-hidden="true" />
    {caption}
  </Button>;
  const managerBuddy = (value: string, emptyLabel: string) => value ? <span className="inline-flex flex-wrap items-center gap-1.5">
      {value}
      {change(() => setEditingPeople(open => !open))}
    </span> : canEdit ? assign(() => setEditingPeople(open => !open), emptyLabel) : 'Not set';
  return <>
    <EmpSection title="Employment" rail={periodRail}>
      <dl className="m-0 grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        <Fact term="Status">
          <Tag tone={ended ? 'quiet' : 'good'}>
            {label(employee.status)}
          </Tag>
        </Fact>
        <Fact term="Matricule" mono>{workspace.capabilities.recruit ? <MatriculeEdit key={employee.id + employee.matricule} employeeId={employee.id} current={employee.matricule} onSaved={reload} /> : employee.matricule}</Fact>
        <Fact term="Contract">{employee.contract_type ? <span className="inline-flex flex-wrap items-center gap-1.5">
            {label(employee.contract_type)}
            {change(() => setEditingContract(open => !open))}
          </span> : canEdit ? assign(() => setEditingContract(open => !open), 'Set contract') : 'Not recorded'}</Fact>
        <Fact term="Nationality">{employee.nationality ? <span className="inline-flex flex-wrap items-center gap-1.5">
            {countryName(employee.nationality)}
            {needsResidencePermit(employee.nationality) && <Tag>Titre de séjour required</Tag>}
            {change(() => setEditingNationality(open => !open))}
          </span> : canEdit ? assign(() => setEditingNationality(open => !open), 'Set nationality') : 'Not recorded'}</Fact>
        <Fact term="Entry date">{date(employee.start_date)}</Fact>
        <Fact term="Onboarding">{employee.onboarding_completed_at ? `Completed ${date(employee.onboarding_completed_at)}` : employee.status === 'preboarding' ? 'Not started' : 'In progress'}</Fact>
        <Fact term="Probation">{employee.probation_end ? `${label(employee.probation_status)} · ${date(employee.probation_end)}` : label(employee.probation_status)}</Fact>
        <Fact term="Manager">{managerBuddy(employee.manager_email, 'Assign manager')}</Fact>
        <Fact term="Buddy">{managerBuddy(employee.parrain, 'Assign buddy')}</Fact>
      </dl>
      {!ended && <div className="flex flex-wrap items-start gap-2 border-t border-border pt-4">
        {employee.status === 'preboarding' && <Action run={run} disabled={busy} input={{
          kind: 'start_onboarding',
          employee_id: employee.id,
          expected_version: employee.version
        }} success="Onboarding started.">Start onboarding</Action>}
        {employee.status !== 'preboarding' && !employee.onboarding_completed_at && <Action run={run} disabled={busy} input={{
          kind: 'complete_onboarding',
          employee_id: employee.id,
          expected_version: employee.version
        }} success="Onboarding completed. Probation remains a separate decision.">Complete onboarding</Action>}
        {employee.status === 'preboarding' && <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setCancellingHire(open => !open)}>
          Cancel hire (candidate renounced)
        </Button>}
      </div>}
      {editingPeople && canEdit && <div className={ROW_FORM}><Form run={run} busy={busy} button="Save manager and buddy" success="Manager and buddy updated." submit={data => ({
        kind: 'update_employment',
        employee_id: employee.id,
        expected_version: employee.version,
        manager_email: text(data, 'manager_email'),
        parrain: text(data, 'parrain')
      })}>
        <Field name="manager_email" label="Manager email" type="email" value={employee.manager_email} />
        <Field name="parrain" label="Buddy" value={employee.parrain} />
      </Form></div>}
      {editingContract && canEdit && <div className={ROW_FORM}><Form run={run} busy={busy} button="Save contract" success="Contract type updated." submit={data => ({
        kind: 'update_employment',
        employee_id: employee.id,
        expected_version: employee.version,
        contract_type: text(data, 'contract_type')
      })}>
        <Field name="contract_type" label="Contract type" value={employee.contract_type || 'CDI'} options={options(['CDI', 'CDD', 'Freelance', 'Internship', 'Apprenticeship'])} required />
      </Form></div>}
      {editingNationality && canEdit && <div className={ROW_FORM}><Form run={run} busy={busy} button="Save nationality" success="Nationality updated." submit={data => ({
        kind: 'update_employment',
        employee_id: employee.id,
        expected_version: employee.version,
        nationality: text(data, 'nationality')
      })}>
        <SearchField name="nationality" label="Nationality" value={employee.nationality} options={countryOptions} placeholder="Search a country…" hint="Outside the EU, EEA and Switzerland, a titre de séjour becomes a required document." />
      </Form></div>}
      {cancellingHire && employee.status === 'preboarding' && <div className={ROW_FORM}><Form run={run} busy={busy} title="Cancel hire" button="Cancel hire" success="Hire cancelled. Employment closed, application withdrawn and commitments released." submit={data => ({
        kind: 'cancel_hire',
        employee_id: employee.id,
        expected_version: employee.version,
        rationale: text(data, 'rationale')
      })}>
        <Field name="rationale" label="Renunciation rationale" type="textarea" required />
      </Form></div>}
    </EmpSection>
    {workspace.capabilities.recruit && <EmpSection title="Documents" detail={ended
      ? 'Documents kept from this employment. Nothing is required any more.'
      : `Required for ${employee.contract_type ? label(employee.contract_type) : 'this employment'}${needsResidencePermit(employee.nationality) ? ' and a non-EU nationality' : ''}. Identity and social-security files are stored in the HR-only Drive folder.`}>
      {!ended && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" aria-hidden="true" /> Visible to the employee, HR and admins</span>
        <span className="inline-flex items-center gap-1.5"><Eye className="size-3.5" aria-hidden="true" /> Every view and download is logged</span>
      </div>}
      <DocumentsPanel
        owner={{ kind: 'person', id: employee.person_id }}
        title=""
        requirements={ended ? [] : [employee.contract_type, ...(needsResidencePermit(employee.nationality) ? ['non_eu'] : [])].filter(Boolean)}
        excludeTypeCodes={[...(freelance ? [] : COMPANY_DOC_TYPES), 'PAYSLIP']}
        hideFiledTypeCodes={['PAYSLIP']}
      />
    </EmpSection>}
    {workspace.capabilities.admin && <EmpSection title="Contracts & signatures" detail="Contracts sent for e-signature through Youtrust. Signed copies are filed in Documents.">
      <PersonSignatures personId={employee.person_id} person={{ name: person.full_name, email: person.email }} />
    </EmpSection>}
    {workspace.capabilities.recruit && !freelance && <EmpSection title="Payslips" detail="Silae payslips filed for this person, newest first.">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3.5">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-medium">Visible to the employee, HR and admins</strong>
          <span className="text-[13px] text-muted-foreground">Every view and download is logged against your name.</span>
        </div>
      </div>
      <PersonPayslips personId={employee.person_id} personName={person.full_name} onChanged={reload} />
    </EmpSection>}
    <EmpSection title={freelance ? 'Daily rate (TJM)' : 'Salary'} detail={freelance ? 'Dated daily-rate history. A new entry closes the previous one the day before it starts; freelance engagements and hires seed the first entry.' : 'Dated monthly salary history. A new entry closes the previous one the day before it starts; hiring seeds the first entry from the accepted offer.'}>
      {!salaries.length && <EmpEmpty>{freelance ? 'No daily rate recorded' : 'No salary recorded'}</EmpEmpty>}
      {!!salaries.length && <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {salaries.map(entry => {
          const editing = editingSalaryId === entry.id;
          return <li key={entry.id} className={ROW}>
            <div className={ROW_MAIN}>
              <span className={cn(ROW_TITLE, 'num')}>
                €{(entry.rate_kind === 'daily' ? entry.daily_rate : entry.salary_monthly)?.toLocaleString()} / {entry.rate_kind === 'daily' ? 'day' : 'month'}
              </span>
              <span className={ROW_META}>
                {date(entry.start_date)} to {entry.end_date ? date(entry.end_date) : 'ongoing'}
                {entry.rationale ? ` · ${entry.rationale}` : ''}
              </span>
            </div>
            {!entry.end_date && <Tag tone="good">Current</Tag>}
            {canEdit && <Button type="button" variant="ghost" size="xs" onClick={() => {
              setEditingSalaryId(editing ? '' : entry.id);
              setAddingSalary(false);
            }}>
              {editing ? 'Close' : 'Edit'}
            </Button>}
            {editing && canEdit && <div className={ROW_FORM}>
              <Form run={run} busy={busy} button="Save entry" success="Entry updated." submit={data => ({
                kind: 'save_salary',
                employee_id: employee.id,
                salary_id: entry.id,
                expected_version: entry.version,
                rate_kind: entry.rate_kind,
                salary_monthly: entry.rate_kind === 'daily' ? undefined : number(data, 'salary_monthly'),
                daily_rate: entry.rate_kind === 'daily' ? number(data, 'daily_rate') : undefined,
                start_date: text(data, 'start_date'),
                end_date: nullable(data, 'end_date'),
                rationale: text(data, 'rationale')
              })}>
                <Field name={entry.rate_kind === 'daily' ? 'daily_rate' : 'salary_monthly'} label={entry.rate_kind === 'daily' ? 'Daily rate (TJM, €)' : 'Monthly salary (€)'} type="number" min={0} step="0.01" value={(entry.rate_kind === 'daily' ? entry.daily_rate : entry.salary_monthly) ?? undefined} required />
                <Field name="start_date" label="Effective from" type="date" value={entry.start_date} required />
                <Field name="end_date" label="Effective until (empty = ongoing)" type="date" value={entry.end_date} />
                <Field name="rationale" label="Change rationale" type="textarea" required />
              </Form>
            </div>}
          </li>;
        })}
      </ul>}
      {canEdit && !addingSalary && <div>{assign(() => {
        setAddingSalary(true);
        setEditingSalaryId('');
      }, freelance ? 'Record rate change' : 'Record salary change')}</div>}
      {canEdit && addingSalary && <div className={ROW_FORM}><Form run={run} busy={busy} button="Record change" success="Change recorded." submit={data => ({
        kind: 'save_salary',
        employee_id: employee.id,
        rate_kind: freelance ? 'daily' : 'monthly',
        salary_monthly: freelance ? undefined : number(data, 'salary_monthly'),
        daily_rate: freelance ? number(data, 'daily_rate') : undefined,
        start_date: text(data, 'start_date'),
        rationale: text(data, 'rationale')
      })}>
        <Field name={freelance ? 'daily_rate' : 'salary_monthly'} label={freelance ? 'Daily rate (TJM, €)' : 'Monthly salary (€)'} type="number" min={0} step="0.01" required />
        <Field name="start_date" label="Effective from" type="date" value={today()} required />
        <Field name="rationale" label="Rationale" type="textarea" hint="Raise, correction, indexation. Recorded as audit evidence." />
      </Form></div>}
    </EmpSection>
    <EmpSection title="Journey checklist" detail={tasks.length ? `${completeCount} of ${tasks.length} complete. Required tasks are enforced when the journey closes.` : 'Required tasks are enforced when the journey closes.'}>
      {!tasks.length && <EmpEmpty>No tasks yet</EmpEmpty>}
      {!!tasks.length && <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {tasks.map(task => {
          const overdue = !task.completed_at && !!task.due_date && task.due_date < today();
          const completing = completingTaskId === task.id;
          const editing = editingTaskId === task.id;
          return <li key={task.id} className={ROW}>
            <TaskCheck done={!!task.completed_at} aria-label={task.completed_at ? `${task.title}, completed` : `Complete ${task.title}`} aria-expanded={completing} disabled={ended || !!task.completed_at} onClick={() => {
              setCompletingTaskId(completing ? '' : task.id);
              setEditingTaskId('');
            }} />
            <div className={ROW_MAIN}>
              <span className={cn(ROW_TITLE, task.completed_at && 'text-muted-foreground line-through decoration-foreground/30')}>
                {task.title}
              </span>
              <span className={ROW_META}>
                {label(task.phase)} · {task.assignee || 'Unassigned'} · {task.due_date ? `Due ${date(task.due_date)}` : 'No due date'}
                {task.dependency_id && ` · After ${tasks.find(item => item.id === task.dependency_id)?.title ?? 'another task'}`}
              </span>
              {task.evidence && <span className={ROW_META}>
                {task.evidence}
              </span>}
            </div>
            <span className="flex flex-wrap items-center gap-1.5">
              {task.required && <Tag>Required</Tag>}
              <Tag tone={task.completed_at ? 'good' : overdue ? 'urgent' : 'quiet'}>
                {task.completed_at ? 'Complete' : overdue ? 'Overdue' : 'Open'}
              </Tag>
            </span>
            {!task.completed_at && canEdit && <Button type="button" variant="ghost" size="xs" onClick={() => {
              setEditingTaskId(editing ? '' : task.id);
              setCompletingTaskId('');
            }}>
              {editing ? 'Close' : 'Edit'}
            </Button>}
            {completing && canEdit && <div className={ROW_FORM}>
              <Form run={run} busy={busy} button="Complete task" success="Task evidence recorded." submit={data => ({
                kind: 'complete_task',
                task_id: task.id,
                expected_version: task.version,
                evidence: text(data, 'evidence')
              })}>
                <Field name="evidence" label="Completion evidence" value={task.evidence} required />
              </Form>
            </div>}
            {editing && canEdit && <div className={ROW_FORM}>
              <Form run={run} busy={busy} button="Save task changes" success="Task ownership and schedule updated." submit={data => ({
                kind: 'save_task',
                employee_id: employee.id,
                task_id: task.id,
                expected_version: task.version,
                title: text(data, 'title'),
                phase: text(data, 'phase'),
                assignee: text(data, 'assignee'),
                due_date: nullable(data, 'due_date'),
                dependency_id: nullable(data, 'dependency_id'),
                required: checked(data, 'required'),
                evidence: text(data, 'evidence')
              })}>
                <Field name="title" label="Task title" value={task.title} required />
                <Field name="phase" label="Phase" value={task.phase} options={options(['preboarding', 'onboarding', 'probation'])} required />
                <Field name="assignee" label="Task owner" value={task.assignee} required />
                <Field name="due_date" label="Due date" type="date" value={task.due_date} />
                <Field name="dependency_id" label="Depends on task" value={task.dependency_id} options={tasks.filter(item => item.id !== task.id).map(item => ({
                  value: item.id,
                  label: item.title
                }))} />
                <CheckField name="required" defaultChecked={task.required} className="self-end pb-2">
                  Required before completion
                </CheckField>
                <Field name="evidence" label="Progress evidence" type="textarea" value={task.evidence} />
              </Form>
            </div>}
          </li>;
        })}
      </ul>}
      {canEdit && <TaskComposer employee={employee} context={context} />}
      {canEdit && <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="onboarding_plan" bare cta="Draft plan with AI" />}
    </EmpSection>
    <EmpSection title="Reviews" detail="A held review records the outcome. Onboarding alone doesn't confirm probation.">
      {!reviews.length && <EmpEmpty action={!ended && <Button type="button" variant="outline" size="sm" onClick={() => setSchedulingReview(open => !open)}>
          Schedule review
        </Button>}>No reviews scheduled</EmpEmpty>}
      {!!reviews.length && <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {reviews.map(review => {
          const recording = recordingReviewId === review.id;
          return <li key={review.id} className={ROW}>
            <div className={ROW_MAIN}>
              <span className={ROW_TITLE}>
                {label(review.kind)} review
              </span>
              <span className={ROW_META}>
                {review.status === 'held' && review.held_at ? `Held ${date(review.held_at)}` : `Due ${date(review.due_date)}`}
              </span>
              {review.status === 'held' && <span className={ROW_META}>
                {label(review.outcome)} · {review.rationale}
              </span>}
            </div>
            <Tag tone={review.status === 'held' ? 'good' : 'quiet'}>
              {label(review.status)}
            </Tag>
            {!ended && review.status !== 'held' && <Button type="button" variant="ghost" size="xs" onClick={() => setRecordingReviewId(recording ? '' : review.id)}>
              {recording ? 'Close' : 'Record outcome'}
            </Button>}
            {recording && review.status !== 'held' && !ended && <div className={ROW_FORM}>
              <Form run={run} busy={busy} button="Record held review" success="Review decision recorded." submit={data => ({
                kind: 'record_review',
                review_id: review.id,
                expected_version: review.version,
                outcome: text(data, 'outcome'),
                rationale: text(data, 'rationale'),
                probation_end: nullable(data, 'probation_end')
              })}>
                <Field name="outcome" label="Outcome" options={options(review.kind === 'probation' ? ['confirmed', 'extended', 'ended'] : ['met_expectations', 'exceeded_expectations', 'development_needed'])} required />
                <Field name="probation_end" label="New probation end, when extended" type="date" />
                <Field name="rationale" label="Decision and evidence" type="textarea" required />
              </Form>
            </div>}
          </li>;
        })}
      </ul>}
      {!!reviews.length && !ended && <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setSchedulingReview(open => !open)}>
          Schedule review
        </Button>
      </div>}
      {schedulingReview && !ended && <div className={ROW_FORM}><Form run={run} busy={busy} button="Schedule review" success="Review scheduled." submit={data => ({
        kind: 'schedule_review',
        employee_id: employee.id,
        review_kind: text(data, 'review_kind'),
        due_date: text(data, 'due_date')
      })}>
        <Field name="review_kind" label="Review type" value="probation" options={options(['probation', 'annual'])} required />
        <Field name="due_date" label="Due date" type="date" value={employee.probation_end} required />
      </Form></div>}
    </EmpSection>
    <EmpSection title={exit ? 'Departure and handover' : 'Offboarding'} detail="Closes assignments and keeps the employment period on record.">
      {!exit && <>
        <EmpEmpty action={!ended && <Button type="button" variant="ghost" size="sm" onClick={() => setStartingExit(open => !open)}>
            Start exit workflow →
          </Button>}>No exit in progress</EmpEmpty>
        {startingExit && !ended && <div className={ROW_FORM}><Form run={run} busy={busy} button="Open offboarding" success="Offboarding opened and employment state updated." submit={data => ({
          kind: 'open_exit',
          employee_id: employee.id,
          expected_version: employee.version,
          exit_kind: text(data, 'exit_kind'),
          exit_date: text(data, 'exit_date'),
          notice_end: nullable(data, 'notice_end'),
          rationale: text(data, 'rationale')
        })}>
          <Field name="exit_kind" label="Exit type" options={options(['resignation', 'rupture_conventionnelle', 'dismissal', 'probation_end', 'cdd_end', 'internship_end'])} required />
          <Field name="exit_date" label="Exit date" type="date" required />
          <Field name="notice_end" label="Notice end" type="date" />
          <Field name="rationale" label="Reason" type="textarea" required />
        </Form></div>}
      </>}
      {exit && <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 text-sm">
          <span>
            {label(exit.kind)} · {date(exit.exit_date)}
          </span>
          <Tag tone={exit.status === 'completed' ? 'good' : 'quiet'}>
            {label(exit.status)}
          </Tag>
        </div>
        {exit.status === 'completed' && <>
          <p className="m-0 text-sm whitespace-pre-wrap">
            {exit.handover_plan}
          </p>
          <p className={QUIET}>
            Rehire {exit.rehire_eligible === null ? 'not assessed' : exit.rehire_eligible ? 'eligible' : 'ineligible'} · {exit.rehire_rationale}
          </p>
        </>}
        {exit.status === 'open' && <>
          <Form key={`exit-${exit.id}`} run={run} busy={busy} title="Exit details" button="Save exit details" success="Exit details saved." submit={data => ({
            kind: 'save_exit',
            exit_id: exit.id,
            expected_version: exit.version,
            handover_plan: text(data, 'handover_plan'),
            successor: text(data, 'successor'),
            exit_interview: text(data, 'exit_interview'),
            rehire_eligible: text(data, 'rehire_eligible') === '' ? null : text(data, 'rehire_eligible') === 'yes',
            rehire_rationale: text(data, 'rehire_rationale')
          })}>
            <Field name="handover_plan" label="Handover plan" type="textarea" value={exit.handover_plan} required />
            <Field name="successor" label="Handover recipient" value={exit.successor} />
            <Field name="exit_interview" label="Exit interview notes" type="textarea" value={exit.exit_interview} />
            <Field name="rehire_eligible" label="Rehire decision" value={exit.rehire_eligible === null ? '' : exit.rehire_eligible ? 'yes' : 'no'} options={[{
              value: 'yes',
              label: 'Eligible'
            }, {
              value: 'no',
              label: 'Ineligible'
            }]} />
            <Field name="rehire_rationale" label="Rehire rationale" type="textarea" value={exit.rehire_rationale} />
          </Form>
          <ul className="m-0 flex list-none flex-col divide-y divide-border border-t border-border p-0">
            {workspace.exitItems.filter(item => item.offboarding_id === exit.id).map(item => <li className={ROW} key={item.id}>
              {/* Status mark only: completing goes through the form below. */}
              <span className={cn('grid size-[22px] shrink-0 place-items-center rounded-full border', item.completed_at ? 'border-foreground bg-foreground text-background' : 'border-input text-transparent')} role="img" aria-label={item.completed_at ? `${item.title}, completed` : `${item.title}, open`}>
                <Check className="size-3" aria-hidden="true" />
              </span>
              <div className={ROW_MAIN}>
                <span className={cn(ROW_TITLE, item.completed_at && 'text-muted-foreground line-through decoration-foreground/30')}>
                  {item.title}
                </span>
              </div>
              <Tag tone={item.completed_at ? 'good' : 'quiet'}>
                {item.completed_at ? 'Complete' : item.required ? 'Required' : 'Optional'}
              </Tag>
              {!item.completed_at && <div className={ROW_FORM}>
                <Form run={run} busy={busy} button="Complete exit task" success="Exit task completed." submit={() => ({
                  kind: 'complete_exit_item',
                  item_id: item.id,
                  expected_version: item.version
                })}>
                  <p className={cn(QUIET, 'col-span-full')}>Mark this task as done when completed.</p>
                </Form>
              </div>}
            </li>)}
          </ul>
          <Disclosure summary="Add an exit task">
            <Form run={run} busy={busy} button="Add exit task" success="Exit task added." submit={data => ({
              kind: 'save_exit_item',
              exit_id: exit.id,
              title: text(data, 'title'),
              required: checked(data, 'required')
            })}>
              <Field name="title" label="Task" required />
              <CheckField name="required" defaultChecked className="self-end pb-2">
                Required before closing exit
              </CheckField>
            </Form>
          </Disclosure>
          <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="handover" bare cta="Draft handover" />
          <p className={QUIET}>
            Complete required tasks, record a handover and a rehire decision before closing. Existing assignments will end at the exit date.
          </p>
          <div>
            <Action run={run} disabled={busy} input={{
              kind: 'complete_exit',
              exit_id: exit.id,
              expected_version: exit.version
            }} success="Exit completed. Assignments ended and the person remains in Alumni.">Complete exit</Action>
          </div>
        </>}
      </>}
    </EmpSection>
  </>;
}
/* Working days (Mon–Fri) inside a range, as ISO strings. Bounded so a
   malformed range can never spin the staffing panel. */
const workingDaysBetween = (from: string, to: string) => {
  const days: string[] = [];
  if (!from || !to || from > to) return days;
  const cursor = new Date(`${from}T12:00:00`);
  const last = new Date(`${to}T12:00:00`);
  for (let guard = 0; guard < 1500 && cursor <= last; guard += 1) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};
/* Group working days by calendar month, preserving order. */
/* Last calendar day of a `YYYY-MM` month, as an ISO date. */
const monthEnd = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month, 0, 12).toISOString().slice(0, 10);
};
const monthsOf = (days: string[]) => {
  const buckets: { key: string; label: string; days: string[] }[] = [];
  for (const iso of days) {
    const key = iso.slice(0, 7);
    const bucket = buckets[buckets.length - 1];
    if (bucket && bucket.key === key) bucket.days.push(iso);
    else buckets.push({ key, label: new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short' }), days: [iso] });
  }
  return buckets;
};
const nextMonday = (from: string) => {
  const cursor = new Date(`${from}T12:00:00`);
  cursor.setDate(cursor.getDate() + ((8 - cursor.getDay()) % 7 || 7));
  return cursor.toISOString().slice(0, 10);
};
const amount = (value: number, currency: string) => new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: currency || 'EUR',
  maximumFractionDigits: 0
}).format(value || 0);
/** Half-day precision reads better than a bare integer for 60% of 21 days. */
const halfDays = (value: number) => {
  const rounded = Math.round(value * 2) / 2;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
};
const ALLOCATION_PRESETS = [20, 40, 50, 60, 80, 100];
const COMMITMENTS: { value: string; hint: string }[] = [
  { value: 'proposed', hint: 'Pencilled in. Does not consume capacity.' },
  { value: 'reserved', hint: 'Held for this project. Consumes capacity.' },
  { value: 'confirmed', hint: 'Signed off with the client. Consumes capacity.' },
  { value: 'active', hint: 'Already running. Cannot start in the future.' }
];
/** The draft an open panel is previewing, so the page metrics can show it. */
export type AssignDraft = { allocation: number; counts: boolean; start: string; end: string | null };
function BuilderStep({
  index,
  title,
  note,
  children
}: {
  index: number;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return <section className="flex min-w-0 flex-col gap-3 border-b border-border pb-6 last:border-b-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-input text-xs text-muted-foreground" aria-hidden="true">{index}</span>
      <h4 className="m-0 text-sm font-medium">{title}</h4>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
    {children}
  </section>;
}
/**
 * Staffing composer (reference: “Assign to project — employee”, Main.dc.html).
 *
 * Five numbered steps — project, pricing line, allocation, period,
 * commitment — and a preview that prices the draft and plots
 * the monthly load it would add, with the submit button as its last line. Every
 * rule the database enforces (project window, employment window, capacity) is
 * mirrored here so the panel refuses what `hr_command` would reject.
 */
export function AssignForm({
  employee,
  workspace,
  run,
  busy,
  onDraft
}: {
  employee: Employee;
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
  onDraft?: (draft: AssignDraft | null) => void;
}) {
  const projects = workspace.projects.filter(project => !['closed', 'cancelled', 'completed'].includes(project.status));
  const day = today();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const project = projects.find(item => item.id === projectId);
  // Régie projects staff people on a named TJM profile (pricing line), not
  // on the project as a whole — offer the contract's lines as targets.
  const profiles = project?.pricing_model === 'regie'
    ? storedPricingLines(project.tjm_profiles).filter(line => line.tjm > 0)
    : [];
  const [lineName, setLineName] = useState('');
  const line = profiles.find(item => item.name === lineName) ?? profiles[0];
  const [allocation, setAllocation] = useState(100);
  const [status, setStatus] = useState('confirmed');
  const [query, setQuery] = useState('');
  // hr_command rejects dates outside the project window ('Assignment dates
  // must fit the project window.'); mirror the rule in the pickers so only
  // valid days can be chosen, and re-check on submit as a last line of defence.
  const windowStart = project?.start_date ?? null;
  const windowEnd = project?.end_date ?? null;
  const bounds = [employee.start_date, windowStart].filter((value): value is string => !!value).sort();
  const startMin = bounds[bounds.length - 1];
  const firstDay = () => {
    let candidate = employee.start_date > day ? employee.start_date : day;
    if (windowStart && candidate < windowStart) candidate = windowStart;
    if (windowEnd && candidate > windowEnd) candidate = windowEnd;
    return candidate;
  };
  const [start, setStart] = useState(firstDay);
  const [end, setEnd] = useState(windowEnd ?? '');
  // An end date is mandatory whenever the project has one, so open-ended is
  // only offered on projects without a delivery end.
  const [openRequested, setOpenRequested] = useState(!windowEnd);
  const openEnded = openRequested && !windowEnd;
  const endDay = openEnded ? '' : end;
  const pickProject = (next: StaffingProject) => {
    setProjectId(next.id);
    setLineName('');
    setStart(current => {
      let candidate = current;
      if (next.start_date && candidate < next.start_date) candidate = next.start_date;
      if (next.end_date && candidate > next.end_date) candidate = next.end_date;
      return candidate;
    });
    setEnd(next.end_date ?? '');
    setOpenRequested(!next.end_date);
  };
  const matches = projects.filter(item => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const client = workspace.clients.find(entry => entry.id === item.client_id)?.name ?? '';
    return `${item.title} ${client}`.toLowerCase().includes(needle);
  });
  const windowHint = [windowStart ? date(windowStart) : null, windowEnd ? date(windowEnd) : null].filter(Boolean).join(' → ');
  const outsideWindow = !!project && (
    (!!windowStart && start < windowStart)
    || (!!windowEnd && (!endDay || endDay > windowEnd))
    || (!!endDay && start > endDay)
  );
  const outsideEmployment = start < employee.start_date
    || (!!employee.planned_exit_date && (!endDay || endDay > employee.planned_exit_date));
  const counts = status !== 'proposed';
  // Preview arithmetic: working days in the period, the share of them this
  // allocation buys, and what that bills at the line's daily rate.
  const periodDays = outsideWindow ? [] : workingDaysBetween(start, endDay);
  const workDays = periodDays.length;
  const staffedDays = workDays * allocation / 100;
  const rate = line?.tjm ?? 0;
  const months = monthsOf(periodDays);
  const load = months.slice(0, 7).map(month => {
    const booked = month.days.reduce((sum, iso) => sum + (100 - available(workspace, employee, iso)), 0) / month.days.length;
    // A partial month buys fewer days, so scale the draft by the share of
    // that month's working days the period actually covers.
    const draft = counts ? allocation * month.days.length / Math.max(1, workingDaysBetween(`${month.key}-01`, monthEnd(month.key)).length) : 0;
    return { ...month, booked: Math.round(booked), draft: Math.round(draft) };
  });
  const clash = counts && periodDays.some(iso => available(workspace, employee, iso) < allocation);
  const invalid = !project || (profiles.length > 0 && !line) || !start || outsideWindow || outsideEmployment;
  const report = onDraft;
  useEffect(() => {
    if (!report) return;
    report({ allocation, counts, start, end: endDay || null });
    return () => report(null);
  }, [report, allocation, counts, start, endDay]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const retry = useRetryCommand();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (outsideWindow) throw new Error('Assignment dates must fit the project window.');
      if (outsideEmployment) throw new Error('Assignment dates must fit employment dates.');
      await run(retry.prepare({
        kind: 'assign_project',
        employee_id: employee.id,
        project_id: project.id,
        // The pricing line names the role; without one the employment role does.
        position: line?.name || employee.role,
        pricing_line: line?.name ?? '',
        allocation_pct: allocation,
        start_date: start,
        end_date: endDay || null,
        status
      }), 'Dated assignment recorded. Capacity was checked before saving.');
      retry.complete();
      setMessage('Dated assignment recorded. Capacity was checked before saving.');
    } catch (failure) {
      setError(errorMessage(failure));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setSaving(false);
    }
  }
  const quiet = 'text-xs text-muted-foreground';
  return <form className="@container grid min-w-0" onSubmit={event => void onSubmit(event)}>
    <div className="grid min-w-0 items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="flex min-w-0 flex-col gap-6">
      <BuilderStep index={1} title="Project">
        {projects.length > 4 && <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a project or client…" aria-label="Search projects" />
        </InputGroup>}
        <div className="flex max-h-[19rem] flex-col gap-2 overflow-y-auto p-px">
          {matches.map(item => {
            const client = workspace.clients.find(entry => entry.id === item.client_id)?.name;
            const elapsed = item.start_date && item.end_date && item.end_date > item.start_date
              ? Math.max(0, Math.min(100, Math.round(100 * (new Date(`${day}T12:00:00`).getTime() - new Date(`${item.start_date}T12:00:00`).getTime()) / (new Date(`${item.end_date}T12:00:00`).getTime() - new Date(`${item.start_date}T12:00:00`).getTime()))))
              : null;
            const left = item.end_date ? workingDaysBetween(day > (item.start_date ?? day) ? day : item.start_date ?? day, item.end_date).length : null;
            const pressed = item.id === projectId;
            return <button type="button" key={item.id} className={CHOICE} aria-pressed={pressed} onClick={() => pickProject(item)}>
              <span className={cn('relative size-[18px] shrink-0 rounded-full border-[1.5px]', pressed ? 'border-foreground after:absolute after:inset-[3px] after:rounded-full after:bg-foreground' : 'border-input')} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{item.title}</span>
                  {client && <Badge variant="outline">{client}</Badge>}
                  <span className={quiet}>{label(item.pricing_model)} · {item.currency}</span>
                </span>
                <span className="flex min-w-0 items-center gap-3">
                  <span className={cn(quiet, 'shrink-0')}>{[item.start_date ? date(item.start_date) : null, item.end_date ? date(item.end_date) : 'open-ended'].filter(Boolean).join(' → ')}</span>
                  {elapsed !== null && <span className="h-1 max-w-56 flex-1 overflow-hidden rounded-full bg-foreground/15" aria-hidden="true"><span className="block h-full rounded-full bg-foreground/40" style={{ width: `${elapsed}%` }} /></span>}
                </span>
              </span>
              {left !== null && <span className="flex shrink-0 flex-col items-end">
                <strong className="num text-base font-normal">{left}</strong>
                <span className={cn(quiet, 'whitespace-nowrap')}>working days left</span>
              </span>}
            </button>;
          })}
          {!matches.length && <p className={QUIET}>{projects.length ? `No open project matches "${query.trim()}".` : 'No open project to staff on yet.'}</p>}
        </div>
      </BuilderStep>
      {profiles.length > 0 && <BuilderStep index={2} title="Pricing line" note="The TJM profile this person is billed on">
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
          {profiles.map(item => {
            const staffed = workspace.assignments.filter(assignment => assignment.project_id === projectId && assignment.pricing_line === item.name && !['completed', 'cancelled'].includes(assignment.status)).length;
            return <button type="button" key={item.name} className={CHOICE} aria-pressed={item.name === line?.name} onClick={() => setLineName(item.name)}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-sm font-medium">{item.name}</strong>
                <span className={quiet}>{staffed ? `${staffed} already staffed` : 'Nobody staffed yet'}</span>
              </span>
              <span className="num shrink-0 text-sm">{lineRateLabel(item.tjm, project?.currency ?? 'EUR')}</span>
            </button>;
          })}
        </div>
      </BuilderStep>}
      <BuilderStep index={profiles.length > 0 ? 3 : 2} title="Allocation">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup variant="outline" aria-label="Allocation presets" value={[String(allocation)]} onValueChange={values => {
            const next = Number(values[0]);
            if (next) setAllocation(next);
          }} className="flex-wrap">
            {ALLOCATION_PRESETS.map(preset => <ToggleGroupItem key={preset} value={String(preset)} className="num">
              {preset}%
            </ToggleGroupItem>)}
          </ToggleGroup>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Custom
            <InputGroup className="w-24">
              <InputGroupInput type="number" min={1} max={100} step={1} value={allocation} aria-label="Allocation (%)" className="num" onChange={event => setAllocation(Math.max(1, Math.min(100, Number(event.target.value) || 0)))} />
              <InputGroupAddon align="inline-end">%</InputGroupAddon>
            </InputGroup>
          </label>
        </div>
        <p className={QUIET}>
          {allocation === 100 ? 'Full time on this project. No capacity left for another.' : `${allocation}% of the week here, ${100 - allocation}% free for other projects.`}
        </p>
      </BuilderStep>
      <BuilderStep index={profiles.length > 0 ? 4 : 3} title="Period" note={windowHint ? `Project window: ${windowHint}` : 'This project has no delivery dates yet.'}>
        <div className="grid gap-4 @xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs text-muted-foreground">Starts</span>
            <DateField name="start_date" value={start} min={startMin} max={windowEnd ?? undefined} onChange={setStart} aria-label="Starts" required />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={CHIP} onClick={() => setStart(day)}>Today</button>
              <button type="button" className={CHIP} onClick={() => setStart(nextMonday(day))}>Next Monday</button>
              {windowStart && <button type="button" className={CHIP} onClick={() => setStart(windowStart)}>Project start</button>}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs text-muted-foreground">Ends</span>
            <DateField name="end_date" value={endDay} min={start} max={windowEnd ?? undefined} onChange={value => { setEnd(value); setOpenRequested(false); }} aria-label="Ends, if known" />
            <div className="flex flex-wrap gap-1.5">
              {windowEnd && <button type="button" className={CHIP} aria-pressed={end === windowEnd} onClick={() => { setEnd(windowEnd); setOpenRequested(false); }}>Project end</button>}
              <button type="button" className={CHIP} aria-pressed={openEnded} disabled={!!windowEnd} title={windowEnd ? 'The project ends on a fixed date, so the assignment needs one too.' : undefined} onClick={() => { setOpenRequested(current => !current); setEnd(''); }}>Open-ended</button>
            </div>
          </div>
        </div>
        {outsideWindow && <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>These dates fall outside the project window{windowHint ? ` (${windowHint})` : ''}. Move them inside, or extend the contract first.</AlertDescription>
        </Alert>}
        {!outsideWindow && outsideEmployment && <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>These dates fall outside this employment period ({date(employee.start_date)} → {employee.planned_exit_date ? date(employee.planned_exit_date) : 'open-ended'}).</AlertDescription>
        </Alert>}
        {!outsideWindow && !outsideEmployment && <p className={QUIET}>
          {openEnded ? 'Open-ended. Capacity counts it until someone ends it.' : `${workDays} working days in this period.`}
        </p>}
      </BuilderStep>
      <BuilderStep index={profiles.length > 0 ? 5 : 4} title="Commitment">
        <div className="grid gap-2 @xl:grid-cols-2">
          {COMMITMENTS.map(item => <button type="button" key={item.value} className={cn(CHOICE, 'flex-col items-start gap-0.5')} aria-pressed={status === item.value} onClick={() => setStatus(item.value)}>
            <strong className="text-sm font-medium">{label(item.value)}</strong>
            <span className={quiet}>{item.hint}</span>
          </button>)}
        </div>
      </BuilderStep>
    </div>
    <aside className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-muted/30 p-4 @4xl:sticky @4xl:top-20" aria-label="Assignment preview">
      <div className="flex flex-col gap-1">
        <span className="label-mono">Preview</span>
        <strong className="text-sm font-medium">{personName(workspace, employee.person_id)} → {project?.title ?? 'no project'}</strong>
        <span className={quiet}>{[line?.name, rate ? lineRateLabel(rate, project?.currency ?? 'EUR') : null, label(status)].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background p-3">
          <span className={quiet}>Staffed days</span>
          <strong className="num text-xl font-normal">{openEnded || !workDays ? '—' : halfDays(staffedDays)}</strong>
          <span className={quiet}>{openEnded ? 'No end date yet' : `${allocation}% × ${workDays} working days`}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background p-3">
          <span className={quiet}>Billable value</span>
          <strong className="num text-xl font-normal break-words">{rate && !openEnded && workDays ? amount(staffedDays * rate, project?.currency ?? 'EUR') : '—'}</strong>
          <span className={quiet}>{rate ? 'If every day lands in the CRA' : 'No daily rate on this line'}</span>
        </div>
      </div>
      {load.length > 0 && <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">Load per month</span>
          <span className="text-muted-foreground">{months.length > load.length ? `First ${load.length} of ${months.length} months` : `${months.length} ${months.length === 1 ? 'month' : 'months'}`}</span>
        </div>
        <div className="relative flex h-24 items-end gap-1.5 border-t border-dashed border-input pt-2 pl-8" aria-hidden="true">
          <span className="num absolute top-0.5 left-0 text-[10px] leading-none text-muted-foreground">100%</span>
          {load.map(month => {
            const total = Math.min(100, month.booked + month.draft);
            return <span className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" key={month.key}>
              <span className="flex w-full max-w-10 flex-col justify-start overflow-hidden rounded-t-md rounded-b-[2px] bg-foreground/20" style={{ height: `${Math.max(2, total)}%` }}>
                <span className="block w-full rounded-t-md bg-pivot" style={{ height: `${total ? Math.round(100 * Math.min(month.draft, total) / total) : 0}%` }} />
              </span>
              <span className="text-[11px] text-muted-foreground">{month.label}</span>
            </span>;
          })}
        </div>
        <span className={quiet}>
          {clash ? 'Some days are already booked. The save will be refused above 100%.' : counts ? 'Shaded is already booked, bright is this draft.' : 'Proposed work is not counted against capacity.'}
        </span>
      </div>}
      {error && <ErrorText errorRef={errorRef}>{error}</ErrorText>}
      {message && <p role="status" className={QUIET}>{message}</p>}
      <div className="flex flex-col gap-1.5">
        <Button type="submit" className="w-full" disabled={busy || saving || invalid}>
          {saving ? 'Saving…' : 'Create assignment'}
        </Button>
        <span className={cn(quiet, 'text-center')}>
          {invalid ? 'Pick a project and a period inside its window.' : `It shows on the CRA from ${date(start)}.`}
        </span>
      </div>
    </aside>
    </div>
  </form>;
}
function Assignments({
  person,
  context: {
    workspace,
    run,
    busy,
    reload,
    openProject
  }
}: {
  person: Person;
  context: RecordContext;
}) {
  const periods = workspace.employees.filter(employee => employee.person_id === person.id);
  const live = periods.filter(employee => employee.status !== 'ended');
  // Offboarding closes the door to new project work (mirrors hr_command).
  const assignable = live.filter(employee => employee.status === 'preboarding' || employee.status === 'active');
  const day = today();
  const assignments = workspace.assignments
    .filter(assignment => periods.some(employee => employee.id === assignment.employee_id))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const open = assignments.filter(assignment => !['completed', 'cancelled'].includes(assignment.status));
  const history = assignments.filter(assignment => ['completed', 'cancelled'].includes(assignment.status));
  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');
  const [assignOpen, setAssignOpen] = useState(false);
  // The open panel reports its draft so the capacity meter can show where
  // this assignment would land before it is saved.
  const [draft, setDraft] = useState<AssignDraft | null>(null);
  const filtered = history.filter(assignment => filter === 'all' || (filter === 'cancelled') === (assignment.status === 'cancelled'));
  const bookedToday = open
    .filter(assignment => assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))
    .reduce((sum, assignment) => sum + assignment.allocation_pct, 0);
  const availableToday = Math.max(0, 100 - bookedToday);
  const draftToday = draft && draft.counts && draft.start <= day && (!draft.end || draft.end >= day) ? draft.allocation : 0;
  const bookedPreview = Math.min(100, bookedToday + draftToday);
  const projectCount = new Set(assignments.map(assignment => assignment.project_id)).size;
  const daysOnProjects = assignments.reduce((sum, assignment) => sum + spanDays(assignment, day), 0);
  const nextAvailability = live
    .map(employee => nextFree(workspace, employee, day))
    .filter(slot => slot !== null)
    .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
  const availability = useYearAvailability(live, assignments);
  const filters: { key: 'all' | 'completed' | 'cancelled'; label: string; count: number }[] = [{
    key: 'all',
    label: 'All',
    count: history.length
  }, {
    key: 'completed',
    label: 'Completed',
    count: history.filter(assignment => assignment.status === 'completed').length
  }, {
    key: 'cancelled',
    label: 'Cancelled',
    count: history.filter(assignment => assignment.status === 'cancelled').length
  }];
  const projectTitle = (id: string) => workspace.projects.find(project => project.id === id)?.title ?? 'Project';
  return <>
    <Card role="region" aria-label="Staffing overview">
      <CardContent>
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 @lg:grid-cols-2 @4xl:grid-cols-[1.4fr_1fr_1fr_1.4fr]">
          <Stat size="sm" className="min-w-0">
            <StatLabel>Booked today</StatLabel>
            <StatValue className="flex flex-wrap items-baseline gap-x-2">
              <span>{bookedToday}%</span>
              {!!draftToday && <span className="text-sm text-muted-foreground">→ {bookedPreview}% with this draft</span>}
            </StatValue>
            <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/15" aria-hidden="true">
              {!!draftToday && <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/35" style={{
                width: `${bookedPreview}%`
              }} />}
              <span className="absolute inset-y-0 left-0 rounded-full bg-foreground" style={{
                width: `${Math.min(100, bookedToday)}%`
              }} />
            </div>
            <StatSource>{availableToday}% available</StatSource>
          </Stat>
          <Stat size="sm" className="min-w-0">
            <StatLabel>Next availability</StatLabel>
            <StatValue>{nextAvailability ? date(nextAvailability.day) : '—'}</StatValue>
            <StatSource>{nextAvailability?.after ? `After ${nextAvailability.after}` : nextAvailability ? 'Open capacity' : live.length ? 'Fully booked' : 'Not employed'}</StatSource>
          </Stat>
          <Stat size="sm" className="min-w-0">
            <StatLabel>Days on projects</StatLabel>
            <StatValue>{daysOnProjects}</StatValue>
            <StatSource>Across {projectCount} {projectCount === 1 ? 'project' : 'projects'}</StatSource>
          </Stat>
          <Stat size="sm" className="min-w-0">
            <StatLabel>Available this year</StatLabel>
            <StatValue>{availability.ready ? fmtDays(availability.availableDays) : '…'}</StatValue>
            <StatSource>
              {availability.error ? `CRA unavailable: ${availability.error}` : availability.ready ? `${fmtDays(availability.openDays)} open days − ${fmtDays(availability.projectDays)} project − ${fmtDays(availability.paidLeaveDays)} CP − ${fmtDays(availability.rttDays)} RTT · usable for internal` : 'Reading the CRA…'}
            </StatSource>
          </Stat>
        </div>
      </CardContent>
    </Card>
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 font-heading text-lg leading-tight font-medium tracking-[-0.02em]">Active assignments</h2>
        {!!assignable.length && !assignOpen && <Button type="button" aria-expanded={assignOpen} onClick={() => setAssignOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" /> Assign to project
        </Button>}
      </div>
      {assignOpen && assignable.map(employee => <Card key={employee.id}>
        <CardHeader>
          <CardHeading level={3}>New assignment · {employee.role}</CardHeading>
          <CardDescription>Staff {person.full_name.split(' ')[0]} on a project's pricing line. Dates must fit the project window.</CardDescription>
          <CardAction>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAssignOpen(false); setDraft(null); }}>Cancel</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <AssignForm employee={employee} workspace={workspace} run={run} busy={busy} onDraft={setDraft} />
        </CardContent>
      </Card>)}
      {open.map(assignment => <AssignmentCard key={assignment.id} assignment={assignment} workspace={workspace} run={run} busy={busy} openProject={openProject} />)}
      {!open.length && <Empty>No active assignment. Use "Assign to project" above to commit this person to a project.</Empty>}
    </section>
    <Section title="Past assignments" detail="Ended and cancelled periods, including repeats.">
      {!!history.length && <ToggleGroup aria-label="Filter history" className="self-start" value={[filter]} onValueChange={values => {
      if (values[0]) setFilter(values[0] as typeof filter);
    }}>
      {filters.map(item => <ToggleGroupItem key={item.key} value={item.key} size="sm" className="gap-1.5">
        {item.label}
        {' '}
        <span className="num text-xs text-muted-foreground">{item.count}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>}
      {!!filtered.length && <Card size="sm" className="py-0">
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {filtered.map(assignment => <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3" key={assignment.id}>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="m-0 text-sm font-medium">
                {openProject ? <button type="button" className="cursor-pointer text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => openProject(assignment.project_id)} title="Open project in Sales">{projectTitle(assignment.project_id)}</button> : projectTitle(assignment.project_id)}
              </h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                {assignment.pricing_line
                  ? <Badge variant="outline">{assignment.pricing_line}</Badge>
                  : <span>{assignment.position}</span>}
                <span>{assignment.allocation_pct}% allocation</span>
                <span>{date(assignment.start_date)} → {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{durationLabel(assignment, day)}</span>
              <Tag tone={assignment.status === 'cancelled' ? 'quiet' : ''}>
                {label(assignment.status)}
              </Tag>
            </div>
          </li>)}
        </ul>
      </Card>}
      {!filtered.length && <Empty>{history.length ? 'Nothing matches this filter.' : 'None yet. Assignments move here once they end or are cancelled.'}</Empty>}
    </Section>
    {!!live.length && <AiPanel person={person} employee={live[0]} workspace={workspace} run={run} reload={reload} kind="staffing_match" />}
  </>;
}
const spanDays = (assignment: Assignment, day: string) => Math.max(0, Math.round((new Date(`${assignment.end_date ?? day}T12:00:00`).getTime() - new Date(`${assignment.start_date}T12:00:00`).getTime()) / 86400000));
/* Earliest day the employee has any capacity again, and the project that
   still blocks that day (mirrors the availability rule used for staffing). */
const nextFree = (workspace: Workspace, employee: Employee, from: string) => {
  const activeOn = (day: string) => workspace.assignments.filter(assignment => assignment.employee_id === employee.id && ['reserved', 'confirmed', 'active', 'completed'].includes(assignment.status) && assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day));
  for (let offset = 0; offset < 1095; offset += 1) {
    const day = new Date(new Date(`${from}T12:00:00`).getTime() + offset * 86400000).toISOString().slice(0, 10);
    if (day < employee.start_date) continue;
    if (employee.end_date && day > employee.end_date) break;
    if (employee.planned_exit_date && day > employee.planned_exit_date) break;
    const blocking = activeOn(day);
    if (blocking.reduce((sum, assignment) => sum + assignment.allocation_pct, 0) < 100) {
      const last = blocking.sort((a, b) => (b.end_date ?? '9999').localeCompare(a.end_date ?? '9999'))[0];
      return {
        day,
        after: last ? workspace.projects.find(project => project.id === last.project_id)?.title : undefined
      };
    }
  }
  return null;
};
const durationLabel = (assignment: Assignment, day: string) => {
  const days = spanDays(assignment, day);
  if (assignment.status === 'cancelled') return 'Never started';
  return days >= 45 ? `${Math.round(days / 30.4 * 10) / 10} months` : `${days} days`;
};
function AssignmentCard({
  assignment,
  workspace,
  run,
  busy,
  openProject
}: {
  assignment: Assignment;
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
  openProject?: (projectId: string) => void;
}) {
  const day = today();
  const project = workspace.projects.find(item => item.id === assignment.project_id);
  const employee = workspace.employees.find(item => item.id === assignment.employee_id);
  // During offboarding the assignment is already capped at the exit date; it
  // can still be ended earlier, but no longer edited.
  const exitDate = employee && employee.status !== 'preboarding' && employee.status !== 'active' ? employee.planned_exit_date ?? employee.end_date : null;
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const overdue = !!assignment.end_date && assignment.end_date < day && !['completed', 'cancelled'].includes(assignment.status);
  const overdueDays = overdue ? Math.max(1, Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${assignment.end_date}T12:00:00`).getTime()) / 86400000)) : 0;
  const startTime = new Date(`${assignment.start_date}T12:00:00`).getTime();
  const todayTime = new Date(`${day}T12:00:00`).getTime();
  const endTime = assignment.end_date ? new Date(`${assignment.end_date}T12:00:00`).getTime() : null;
  const started = assignment.start_date <= day;
  const dayMs = 86400000;
  const plannedDays = endTime !== null ? Math.max(1, Math.round((endTime - startTime) / dayMs)) : 0;
  const elapsedDays = Math.max(0, Math.round((todayTime - startTime) / dayMs));
  const limePct = endTime === null ? 0 : overdue
    ? Math.max(0, Math.min(100, Math.round(100 * plannedDays / Math.max(1, elapsedDays))))
    : Math.max(0, Math.min(100, Math.round(100 * Math.min(elapsedDays, plannedDays) / plannedDays)));
  return <Card size="sm">
    <CardHeader>
      <CardHeading level={3} className="flex min-w-0 flex-wrap items-center gap-2">
        {project && openProject ? <button type="button" className="cursor-pointer text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => openProject(project.id)} title="Open project in Sales">{project.title}</button> : project?.title ?? 'Project'}
        <Badge variant="secondary">{label(assignment.status)}</Badge>
        {overdue && <Badge variant="destructive">End overdue</Badge>}
      </CardHeading>
      <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {assignment.pricing_line
          ? <Badge variant="outline">{assignment.pricing_line}</Badge>
          : <span>{assignment.position}</span>}
        <span aria-hidden="true">·</span>
        <span>{assignment.allocation_pct}%</span>
        <span aria-hidden="true">·</span>
        <span>{date(assignment.start_date)} → {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</span>
      </CardDescription>
      <div className="flex flex-wrap gap-2 pt-1">
        {!exitDate && <Button type="button" variant="outline" size="sm" aria-expanded={editing} onClick={() => { setEditing(current => !current); setClosing(false); }}>
          {editing ? 'Close' : 'Edit…'}
        </Button>}
        <Button type="button" variant="outline" size="sm" aria-expanded={closing} onClick={() => { setClosing(current => !current); setEditing(false); }}>
          {closing ? 'Close' : 'End or cancel…'}
        </Button>
      </div>
    </CardHeader>
    {(endTime !== null || overdue || exitDate || editing || closing) && <CardContent className="flex flex-col gap-4">
      {endTime !== null && <div className="flex flex-col gap-2">
        <div className="relative h-1.5 rounded-full bg-foreground/15" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/35" style={{ width: `${limePct}%` }} />
          <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-[1px] bg-foreground" style={{ left: `${limePct}%` }} />
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{started ? `Started ${date(assignment.start_date)}` : `Starts ${date(assignment.start_date)}`}</span>
          <span className={cn('text-foreground', overdue && 'text-destructive')}>{overdue ? 'Planned end passed' : `${limePct}% elapsed`}</span>
          <span>{assignment.end_date ? `Planned end ${date(assignment.end_date)}` : 'Open-ended'}</span>
        </div>
      </div>}
      {overdue && <Alert variant="warning">
        <AlertCircle aria-hidden="true" />
        <AlertDescription>Planned end passed <strong>{overdueDays} days ago</strong> and no ending has been recorded. End the assignment below or agree a new end date with the client.</AlertDescription>
      </Alert>}
      {exitDate && <Alert variant="warning">
        <AlertCircle aria-hidden="true" />
        <AlertDescription>Offboarding in progress: this assignment ends with the employment on <strong>{date(exitDate)}</strong>.</AlertDescription>
      </Alert>}
      {editing && <AssignmentEdit assignment={assignment} workspace={workspace} day={day} run={run} busy={busy} onClose={() => setEditing(false)} />}
      {closing && <AssignmentClose assignment={assignment} day={day} run={run} busy={busy} onClose={() => setClosing(false)} />}
    </CardContent>}
  </Card>;
}
/** Panel body shared by the edit and close forms under an assignment card. */
function PanelShell({ title, aside, summary, error, children, actions }: { title: string; aside?: ReactNode; summary: ReactNode; error: string; children: ReactNode; actions: ReactNode }) {
  return <div className="@container flex flex-col gap-4 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="m-0 text-sm font-medium">{title}</h4>
      {aside}
    </div>
    {children}
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
      <span className="mr-auto min-w-0 basis-56 text-[13px] text-muted-foreground">{summary}</span>
      {actions}
    </div>
    {error && <ErrorText>{error}</ErrorText>}
  </div>;
}
function AssignmentEdit({
  assignment,
  workspace,
  day,
  run,
  busy,
  onClose
}: {
  assignment: Assignment;
  workspace: Workspace;
  day: string;
  run: RunCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const employee = workspace.employees.find(item => item.id === assignment.employee_id);
  const project = workspace.projects.find(item => item.id === assignment.project_id);
  const profiles = project?.pricing_model === 'regie'
    ? storedPricingLines(project.tjm_profiles).filter(line => line.tjm > 0)
    : [];
  const [pricingLine, setPricingLine] = useState(assignment.pricing_line);
  const [allocation, setAllocation] = useState(String(assignment.allocation_pct));
  const [status, setStatus] = useState<'proposed' | 'reserved' | 'confirmed' | 'active'>(assignment.status as 'proposed' | 'reserved' | 'confirmed' | 'active');
  const [startDate, setStartDate] = useState(assignment.start_date);
  const [endDate, setEndDate] = useState(assignment.end_date ?? '');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Mirror the hr_command rules so invalid saves never leave the panel.
  const cannotPropose = assignment.status !== 'proposed' && assignment.start_date <= day;
  const bounds = [employee?.start_date, project?.start_date].filter((value): value is string => !!value).sort();
  const startMin = bounds.length ? bounds[bounds.length - 1] : undefined;
  const windowEnd = project?.end_date ?? null;
  const plannedExit = employee?.planned_exit_date ?? null;
  const endMax = [windowEnd, plannedExit].filter((value): value is string => !!value).sort()[0] ?? undefined;
  const allocationNum = Number(allocation);
  const allocationValid = Number.isInteger(allocationNum) && allocationNum >= 1 && allocationNum <= 100;
  const startValid = !!startDate && (!startMin || startDate >= startMin);
  const endRequired = !!windowEnd;
  const endValid = endRequired
    ? !!endDate && endDate >= startDate && (!!endMax && endDate <= endMax)
    : !endDate || (endDate >= startDate && (!endMax || endDate <= endMax));
  const activeFuture = status === 'active' && startDate > day;
  const changed = pricingLine !== assignment.pricing_line
    || allocationNum !== assignment.allocation_pct
    || status !== assignment.status
    || startDate !== assignment.start_date
    || (endDate || null) !== (assignment.end_date ?? null);
  const ready = !!rationale.trim() && allocationValid && startValid && endValid && !activeFuture && changed;
  const summary = activeFuture
    ? 'Active assignments cannot start in the future.'
    : !changed
      ? 'Adjust a field to save.'
      : !rationale.trim()
        ? 'A change rationale is required.'
        : !startValid || !endValid
          ? 'Dates must fit the project window and employment period.'
          : `Saves ${assignment.position || 'role'} · ${allocationNum}% · ${label(status)} · ${date(startDate)} → ${endDate ? date(endDate) : 'open-ended'}`;
  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await run({
        kind: 'update_assignment',
        assignment_id: assignment.id,
        expected_version: assignment.version,
        position: assignment.position,
        pricing_line: pricingLine,
        allocation_pct: allocationNum,
        start_date: startDate,
        end_date: endDate || null,
        status,
        rationale: rationale.trim()
      }, 'Assignment updated with history preserved.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  const id = (field: string) => `edit-${assignment.id}-${field}`;
  return <PanelShell title="Edit this assignment" aside={project && <small className="text-xs text-muted-foreground">{project.title}{windowEnd ? ` · ends ${date(windowEnd)}` : ''}</small>} summary={summary} error={error} actions={<>
    <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Discard</Button>
    <Button type="button" disabled={!ready || busy || saving} onClick={() => void submit()}>
      {saving ? 'Saving…' : 'Save changes'}
    </Button>
  </>}>
    <div className="grid gap-4 @lg:grid-cols-2">
      {profiles.length > 0 && <UiField className="gap-1.5">
        <FieldLabel htmlFor={id('line')}>Pricing line</FieldLabel>
        <NativeSelect id={id('line')} className="w-full" value={pricingLine} onChange={event => setPricingLine(event.target.value)}>
          <NativeSelectOption value="">Whole project</NativeSelectOption>
          {assignment.pricing_line && !profiles.some(line => line.name === assignment.pricing_line) && <NativeSelectOption value={assignment.pricing_line}>{assignment.pricing_line} (removed line)</NativeSelectOption>}
          {profiles.map(line => <NativeSelectOption key={line.name} value={line.name}>{`${line.name} · ${lineRateLabel(line.tjm, project?.currency ?? 'EUR')}`}</NativeSelectOption>)}
        </NativeSelect>
        <FieldDescription className="text-xs">The TJM profile this assignment bills against.</FieldDescription>
      </UiField>}
      <UiField className="gap-1.5">
        <FieldLabel htmlFor={id('allocation')}>Allocation (%)</FieldLabel>
        <Input id={id('allocation')} type="number" min={1} max={100} value={allocation} onChange={event => setAllocation(event.target.value)} />
      </UiField>
      <UiField className="gap-1.5">
        <FieldLabel htmlFor={id('status')}>Commitment</FieldLabel>
        <NativeSelect id={id('status')} className="w-full" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          {(['proposed', 'reserved', 'confirmed', 'active'] as const).filter(item => !(cannotPropose && item === 'proposed')).map(item => <NativeSelectOption key={item} value={item}>{label(item)}</NativeSelectOption>)}
        </NativeSelect>
        {cannotPropose && <FieldDescription className="text-xs">Started commitments cannot return to proposed.</FieldDescription>}
      </UiField>
      <UiField className="gap-1.5">
        <FieldLabel>Starts</FieldLabel>
        <DateField value={startDate} min={startMin} max={endMax} onChange={setStartDate} aria-label="Starts" required />
        {startMin && <FieldDescription className="text-xs">No earlier than {date(startMin)}.</FieldDescription>}
      </UiField>
      <UiField className="gap-1.5">
        <FieldLabel>Ends{endRequired ? '' : ', if known'}</FieldLabel>
        <DateField value={endDate} min={startDate} max={endMax} onChange={setEndDate} aria-label="Ends" required={endRequired} />
        {windowEnd
          ? <FieldDescription className="text-xs">The project ends {date(windowEnd)}; an end date is required.</FieldDescription>
          : <FieldDescription className="text-xs">Leave empty for open-ended. Capacity is still checked against overlapping commitments.</FieldDescription>}
      </UiField>
      <UiField className="gap-1.5 @lg:col-span-2">
        <FieldLabel htmlFor={id('rationale')}>Change rationale</FieldLabel>
        <Textarea id={id('rationale')} className="min-h-16" placeholder="Why is this changing?" maxLength={5000} value={rationale} onChange={event => setRationale(event.target.value)} />
      </UiField>
    </div>
  </PanelShell>;
}
const ASSIGN_REASONS = ['Mission completed', 'Ended early by client', 'Consultant left', 'Replaced', 'Other'];
function AssignmentClose({
  assignment,
  day,
  run,
  busy,
  onClose
}: {
  assignment: Assignment;
  day: string;
  run: RunCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const cancellable = assignment.status === 'proposed' || assignment.start_date > day;
  const [mode, setMode] = useState<'end' | 'cancel'>(cancellable ? 'cancel' : 'end');
  const [when, setWhen] = useState<'planned' | 'today' | 'custom'>(assignment.end_date ? 'planned' : 'today');
  const [customDate, setCustomDate] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isEnd = mode === 'end';
  // The recorded end must sit inside the assignment window and never in the
  // future; a passed planned end further caps it (mirrors the hr_command rule).
  const lastAllowedDay = assignment.end_date && assignment.end_date < day ? assignment.end_date : day;
  const endDate = when === 'custom' ? customDate : when === 'planned' ? assignment.end_date ?? '' : day;
  const dateValid = !!endDate && endDate >= assignment.start_date && endDate <= lastAllowedDay;
  const ready = !!reason && (isEnd ? dateValid : cancellable);
  const summary = !isEnd
    ? cancellable
      ? reason ? `Cancels the ${date(assignment.start_date)} start · ${reason}` : 'Pick a reason to continue'
      : 'Not available for started assignments'
    : reason ? `Ends ${date(endDate)} · ${reason}` : 'Pick a reason to continue';
  const reasonField = <div className="flex min-w-0 flex-col gap-2">
    <span className="text-sm font-medium" id={`reason-${assignment.id}`}>Reason</span>
    <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`reason-${assignment.id}`}>
      {ASSIGN_REASONS.map(item => <button key={item} type="button" className={CHIP} aria-pressed={reason === item} onClick={() => setReason(item)}>
        {item}
      </button>)}
    </div>
    <Textarea className="min-h-16" aria-label="Note" placeholder="Add a note (optional)" maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
  </div>;
  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await run({
        kind: 'end_assignment',
        assignment_id: assignment.id,
        expected_version: assignment.version,
        end_date: isEnd ? endDate : assignment.end_date ?? assignment.start_date,
        rationale: note.trim() ? `${reason}: ${note.trim()}` : reason,
        cancel: !isEnd
      }, isEnd ? 'Assignment ended with history preserved.' : 'Assignment cancelled with history preserved.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  const whenChoice = 'flex cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-pressed:border-foreground aria-pressed:ring-1 aria-pressed:ring-foreground';
  return <PanelShell title="Close this assignment" aside={<ToggleGroup aria-label="Close mode" value={[mode]} onValueChange={values => {
    if (values[0]) setMode(values[0] as 'end' | 'cancel');
  }}>
      <ToggleGroupItem value="end" size="sm">End</ToggleGroupItem>
      <ToggleGroupItem value="cancel" size="sm">Cancel</ToggleGroupItem>
    </ToggleGroup>} summary={summary} error={error} actions={<>
    <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Discard</Button>
    <Button type="button" variant={isEnd ? 'default' : 'destructive'} disabled={!ready || busy || saving} onClick={() => void submit()}>
      {saving ? 'Saving…' : isEnd ? 'End assignment' : 'Cancel assignment'}
    </Button>
  </>}>
    {isEnd && <div className="grid gap-5 @lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-sm font-medium">Actual end date</span>
        <div className="flex flex-wrap gap-2">
          {assignment.end_date && <button type="button" className={whenChoice} aria-pressed={when === 'planned'} onClick={() => { setWhen('planned'); setCustomDate(''); }}>
            <strong className="text-sm font-medium">{date(assignment.end_date)}</strong>
            <small className="text-xs text-muted-foreground">Planned end</small>
          </button>}
          <button type="button" className={whenChoice} aria-pressed={when === 'today'} onClick={() => { setWhen('today'); setCustomDate(''); }}>
            <strong className="text-sm font-medium">{date(day)}</strong>
            <small className="text-xs text-muted-foreground">Today</small>
          </button>
        </div>
        <DateField value={customDate} min={assignment.start_date} max={lastAllowedDay} placeholder="Custom date" aria-label="Custom end date" onChange={value => { setWhen(value ? 'custom' : 'today'); setCustomDate(value); }} />
      </div>
      {reasonField}
    </div>}
    {!isEnd && cancellable && reasonField}
    {!isEnd && !cancellable && <p className={QUIET}>
      Cancelling removes an assignment that never started. This one started on {date(assignment.start_date)}, so it can only be ended.
    </p>}
  </PanelShell>;
}
function PersonCra({
  person,
  context
}: {
  person: Person;
  context: RecordContext;
}) {
  const employees = context.workspace.employees.filter(employee => employee.person_id === person.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const preferred = employees.find(employee => employee.status !== 'ended') ?? employees[0];
  const [selected, setSelected] = useState(preferred?.id ?? '');
  const current = employees.find(employee => employee.id === selected) ?? preferred;
  if (!current) return <Empty>No employment period yet. The monthly CRA starts with an employment record.</Empty>;
  return <>
    {employees.length > 1 && <UiField className="max-w-xl gap-1.5">
      <FieldLabel htmlFor={`cra-period-${person.id}`}>Employment period</FieldLabel>
      <NativeSelect id={`cra-period-${person.id}`} className="w-full" value={current.id} onChange={event => setSelected(event.target.value)}>
        {employees.map(employee => <NativeSelectOption value={employee.id} key={employee.id}>{employee.role} · {date(employee.start_date)}{employee.end_date && ` to ${date(employee.end_date)}`} · {label(employee.status)}</NativeSelectOption>)}
      </NativeSelect>
    </UiField>}
    <CraScreen audience="admin" draftOwner={context.actorEmail} fixedEmployeeId={current.id} basePath={`/hr/people/${person.id}/cra`} />
  </>;
}
function History({
  person,
  context: {
    workspace,
    run,
    busy
  }
}: {
  person: Person;
  context: RecordContext;
}) {
  const events = workspace.events.filter(event => event.person_id === person.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <>
    <Card>
      <CardContent>
        <Form run={run} busy={busy} title="Add an activity note" button="Add note" success="Activity recorded. Recruitment stage aging is unchanged." reset submit={data => ({
          kind: 'add_note',
          person_id: person.id,
          rationale: text(data, 'rationale')
        })}>
          <Field name="rationale" label="Note" type="textarea" required />
        </Form>
      </CardContent>
    </Card>
    <Section title="Complete lifecycle timeline">
      {events.length ? <ol className="m-0 flex list-none flex-col p-0">
        {events.map(event => <li key={event.id} className="relative flex flex-col gap-1 border-l border-border pb-6 pl-5 last:pb-0 before:absolute before:top-1.5 before:-left-[5px] before:size-2.5 before:rounded-full before:border before:border-foreground before:bg-background">
          <strong className="text-sm font-medium">
            {label(event.kind)}
            {event.next_state && ` · ${label(event.next_state)}`}
          </strong>
          <small className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()} · {event.actor_email}{event.application_id ? ' · Application' : event.employee_id ? ' · Employment' : ''}</small>
          {event.rationale && <p className="m-0 text-sm whitespace-pre-wrap">
            {event.rationale}
          </p>}
        </li>)}
      </ol> : <Empty>No activity yet.</Empty>}
    </Section>
  </>;
}
const aiTitles: Record<SuggestionKind, string> = {
  interview_prep: 'Prepare an interview',
  profile_summary: 'Summarize the profile',
  onboarding_plan: 'Draft an onboarding plan',
  staffing_match: 'Explore project fit',
  handover: 'Draft a handover',
  alumni_reconnect: 'Draft an alumni reconnection',
  job_description: 'Draft a job description'
};
export function AiPanel({
  person,
  application,
  employee,
  workspace,
  run,
  reload,
  kind,
  bare = false,
  cta
}: {
  person: Person;
  application?: Application;
  employee?: Employee;
  workspace: Workspace;
  run: RunCommand;
  reload: () => Promise<void>;
  kind: AssistanceRequest['kind'];
  /** Borderless variant for the Employment sections. */
  bare?: boolean;
  /** Button label in bare mode. */
  cta?: string;
}) {
  const {
    session
  } = useSession();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const suggestions = workspace.suggestions.filter(suggestion => suggestion.kind === kind && suggestion.person_id === person.id && (!application || suggestion.application_id === application.id) && (!employee || suggestion.employee_id === employee.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const token = await session?.getToken({
        template: 'supabase'
      });
      if (!token) throw new Error('Sign in again to generate a suggestion.');
      await generateSuggestion({
        token,
        person_id: person.id,
        kind,
        ...(application ? {
          application_id: application.id
        } : {}),
        ...(employee ? {
          employee_id: employee.id
        } : {})
      });
      await reload();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setGenerating(false);
    }
  }
  const head = <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
      <h3 className="m-0 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {aiTitles[kind]}
      </h3>
      {!bare && <p className={cn(QUIET, 'text-xs')}>AI uses this record's permitted evidence. Review the sources and edit the draft before applying it.</p>}
    </div>
    <Button type="button" variant={bare ? 'ghost' : 'outline'} size="sm" disabled={generating} onClick={() => void generate()}>
      {generating ? 'Preparing draft…' : cta ?? 'Generate draft'}
    </Button>
  </div>;
  const body = <>
    {error && <ErrorText>
      {error}
    </ErrorText>}
    {suggestions.slice(0, 3).map(suggestion => {
      const parsed = assistancePayloadSchema.safeParse(suggestion.payload);
      const sources = z.array(assistanceSourceSchema).safeParse(suggestion.sources);
      if (!parsed.success) return <p role="alert" className="m-0 text-[13px] text-destructive" key={suggestion.id}>This suggestion has an unsupported format and cannot be applied.</p>;
      const payload = parsed.data;
      const targetVersion = person.version;
      const stale = suggestion.status === 'stale' || suggestion.input_version !== targetVersion || !sources.success || sources.data.some(source => {
        const records = source.type === 'person' ? workspace.people : source.type === 'application' ? workspace.applications : source.type === 'employee' ? workspace.employees : source.type === 'opportunity' ? workspace.opportunities : source.type === 'task' ? workspace.tasks : source.type === 'assignment' ? workspace.assignments : source.type === 'project' ? workspace.projects : [];
        const record = records.find(item => item.id === source.id);
        return !record || record.version !== source.version;
      });
      return <div key={suggestion.id} className="flex flex-col gap-3 border-t border-border pt-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tag tone={stale ? 'urgent' : suggestion.status === 'accepted' ? 'good' : 'quiet'}>
            {stale ? 'Source changed. Generate a fresh draft.' : label(suggestion.status)}
          </Tag>
          <small className="text-xs text-muted-foreground">{suggestion.model} · {date(suggestion.created_at)}</small>
        </div>
        <p className="m-0">
          {payload.summary}
        </p>
        <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-5">
          {payload.items.map((item, index) => <li key={index} className="pl-1">
            <strong className="font-medium">
              {item.title}
            </strong>
            <p className="m-0 mt-0.5">
              {item.detail}
            </p>
            <span className="text-xs text-muted-foreground">
              {item.source_ids.map(id => sourceDescription(workspace, id)).join(' · ') || 'No specific source cited'}
            </span>
          </li>)}
        </ol>
        {sources.success && <div className="text-xs text-muted-foreground">Sources: {sources.data.map(source => `${sourceDescription(workspace, source.id)} (version ${source.version})`).join(' · ')}</div>}
        {suggestion.status === 'draft' && <div className="flex flex-wrap items-start gap-2">
          <Action run={run} disabled={stale} input={{
            kind: 'review_suggestion',
            suggestion_id: suggestion.id,
            status: 'accepted'
          }} success="Suggestion reviewed. No employment or hiring decision was changed.">Accept as reviewed draft</Action>
          <Action run={run} input={{
            kind: 'review_suggestion',
            suggestion_id: suggestion.id,
            status: 'dismissed'
          }} success="Suggestion dismissed.">Dismiss</Action>
        </div>}
        {kind === 'onboarding_plan' && suggestion.status === 'accepted' && !stale && employee && <Disclosure summary="Review and add an individual task">
          <Form run={run} button="Add reviewed task" success="Reviewed task added to the plan." submit={data => ({
            kind: 'save_task',
            employee_id: employee.id,
            title: text(data, 'title'),
            phase: text(data, 'phase'),
            assignee: text(data, 'assignee'),
            due_date: nullable(data, 'due_date'),
            required: checked(data, 'required'),
            evidence: ''
          })}>
            <Field name="title" label="Task title" options={payload.items.map(item => ({
              value: item.title,
              label: item.title
            }))} required />
            <Field name="phase" label="Phase" options={options(['preboarding', 'onboarding', 'probation'])} value="onboarding" required />
            <Field name="assignee" label="Owner email" type="email" required />
            <Field name="due_date" label="Due date" type="date" required />
            <CheckField name="required" className="self-end pb-2">Required before completion</CheckField>
          </Form>
        </Disclosure>}
        {kind === 'handover' && suggestion.status === 'accepted' && !stale && employee && <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground"><AlertCircle className="size-3.5" aria-hidden="true" /> Copy and edit the draft in Exit details. Saving it is a separate action.</p>}
      </div>;
    })}
    {!suggestions.length && <p className={cn(QUIET, 'text-xs')}>No draft generated for this context yet.</p>}
  </>;
  if (bare) return <section className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
    {head}
    {body}
  </section>;
  return <Card size="sm" className="border-dashed">
    <CardContent className="flex flex-col gap-3">
      {head}
      {body}
    </CardContent>
  </Card>;
}
function sourceDescription(workspace: Workspace, id: string) {
  const person = workspace.people.find(item => item.id === id);
  if (person) return person.full_name;
  const employee = workspace.employees.find(item => item.id === id);
  if (employee) return `${employee.role} employment`;
  const application = workspace.applications.find(item => item.id === id);
  if (application) return workspace.opportunities.find(item => item.id === application.opportunity_id)?.title ?? 'Application';
  const project = workspace.projects.find(item => item.id === id);
  if (project) return project.title;
  const interview = workspace.interviews.find(item => item.id === id);
  if (interview) return `${label(interview.kind)} interview`;
  const task = workspace.tasks.find(item => item.id === id);
  if (task) return task.title;
  const exit = workspace.exits.find(item => item.id === id);
  if (exit) return `Exit ${date(exit.exit_date)}`;
  const assignment = workspace.assignments.find(item => item.id === id);
  if (assignment) return `${workspace.projects.find(item => item.id === assignment.project_id)?.title ?? 'Project'} assignment`;
  return `Record ${id.slice(0, 8)}`;
}
