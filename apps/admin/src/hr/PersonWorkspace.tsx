import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@clerk/react';
import { Check, CheckCircle2, Circle, Plus, Sparkles, AlertCircle, FileText, Search } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import type { Application, ApplicationStage, Assignment, Employee, JourneyTask, Person, Requirement, StaffingProject, SuggestionKind, Workspace } from './domain';
import { loadRequirements } from './data';
import { useYearAvailability } from './availability';
import { fmtDays } from '../cra/balances';
import { assistancePayloadSchema, assistanceSourceSchema, generateSuggestion, type AssistanceRequest } from './assist';
import { z } from 'zod';
import { storedPricingLines } from '../sales/pricing-lines';
import { DateField } from '../DateField';
import { CraScreen } from '../cra/CraScreen';
import { Action, Empty, Field, Form, Section, SkillListField, Tag, checked, date, initials, label, nullable, number, text, today, useRetryCommand, type RunCommand } from './ui';
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
  }, {
    key: 'applications',
    title: 'Applications',
    count: applications.length
  }, ...(isEmployee ? [{
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
  return <>
    <div className="hr-tabs hr-person-tabs" role="tablist" aria-label="Person record">
      {tabs.map(item => <button key={item.key} role="tab" aria-selected={activeTab === item.key} onClick={() => onNavigate(item.key as PersonTab)}>
        {item.title}
        {'count' in item && <span>
          {item.count}
        </span>}
      </button>)}
    </div>
    <div className="hr-record-panels" role="tabpanel">
      {activeTab === 'profile' && <Profile person={person} context={context} onNavigate={onNavigate} craCount={craCount ?? 0} />}
      {activeTab === 'applications' && <Applications person={person} context={context} initialId={initialApplication} />}
      {activeTab === 'employment' && <Employments person={person} context={context} initialId={initialEmployment} />}
      {activeTab === 'projects' && <Assignments person={person} context={context} />}
      {activeTab === 'cra' && <PersonCra person={person} context={context} />}
      {activeTab === 'history' && <History person={person} context={context} />}
    </div>
  </>;
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
  }, {
    n: applications.length,
    label: 'Applications',
    tab: 'applications'
  }];
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
  return <div className="hr-two-column hr-profile-columns">
    <form className="hr-profile-form" onSubmit={event => void onSubmit(event)}>
      <section className="hr-card hr-profile-card" id="hr-profile-identity" key={`identity-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Identity and contact</h2>
          <p>How this person appears across Quicksort, and where notifications go</p>
        </div>
        <div className="hr-profile-fields">
          <Field name="full_name" label="Full name" value={person.full_name} required />
          <Field name="headline" label="Professional headline" value={person.headline} />
          <Field name="email" label="Work email" type="email" value={person.email} />
          <Field name="phone" label="Phone" type="tel" value={person.phone} />
          <Field name="location" label="Location" value={person.location} />
          <label className="hr-field hr-owner">
            <span>Record owner</span>
            <span className="hr-owner-control">
              <span className="hr-owner-avatar" aria-hidden="true">{initials(person.owner_email || actorEmail)}</span>
              <input name="owner_email" type="email" defaultValue={person.owner_email || actorEmail} />
            </span>
          </label>
        </div>
      </section>
      <section className="hr-card hr-profile-card" id="hr-profile-skills" key={`skills-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Skills{skillCount > 0 && <small> · {skillCount}</small>}</h2>
          <p>Matched against project staffing requests</p>
        </div>
        <SkillListField name="skills" label="Add a skill" hideLabel value={person.skills} placeholder="Type a skill, then press Enter" />
      </section>
      <section className="hr-card hr-profile-card" id="hr-profile-credentials" key={`credentials-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Credentials</h2>
          <p>Shown on client CVs. Highest qualifications first.</p>
        </div>
        <div className="hr-credentials">
          <div className="hr-credential">
            <h3>Languages</h3>
            <p>Spoken and written level, as presented to clients</p>
            <SkillListField name="languages" label="Add a language" hideLabel value={person.languages} placeholder="e.g. French — native" />
          </div>
          <div className="hr-credential">
            <h3>Education</h3>
            <p>Degree, school and year</p>
            <SkillListField name="degrees" label="Add a degree" hideLabel value={person.degrees} placeholder="e.g. Master MIAGE — Dauphine" />
          </div>
          <div className="hr-credential">
            <h3>Certifications</h3>
            <p>Accreditations with year obtained</p>
            <SkillListField name="certifications" label="Add a certification" hideLabel value={person.certifications} placeholder="e.g. PSM I — 2023" />
          </div>
        </div>
      </section>
      <section className="hr-card hr-profile-card" key={`notes-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Internal notes</h2>
          <p>Visible to Quicksort staff only. Never exported.</p>
        </div>
        <dl className="hr-facts">
          {facts.map(fact => <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.mono ? 'is-mono' : ''}>{fact.value}</dd>
          </div>)}
        </dl>
        <Field name="notes" label="Notes" type="textarea" value={person.notes} hint="Context for staffing: preferences, constraints, feedback from clients" />
        <label className="hr-checkbox hr-wide"><input type="checkbox" name="contact_allowed" defaultChecked={person.contact_allowed} />Contact permitted for future opportunities</label>
      </section>
      {error && <p role="alert" className="hr-error">
        {error}
      </p>}
      <div className="hr-profile-save">
        <span>{message || 'Edits are kept as a draft until you save'}</span>
        <button type="button" className="hr-person-btn" disabled={busy || saving} onClick={() => {
          setFieldsKey(key => key + 1);
          setError('');
          setMessage('');
        }}>
          Discard
        </button>
        <button type="submit" className="hr-person-btn is-primary" disabled={busy || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
    <aside className="hr-profile-aside">
      <section className="hr-card hr-profile-card hr-health">
        <div className="hr-profile-card-head hr-portal-head">
          <h2>Profile completeness</h2>
          <span className="hr-health-count">{missing.length ? `${missing.length} ${missing.length === 1 ? 'gap' : 'gaps'}` : 'Complete'}</span>
        </div>
        <div className="hr-health-bar" aria-hidden="true">
          {Array.from({ length: segments }, (_, index) => <span key={index} className={index < litSegments ? 'is-lit' : ''} />)}
        </div>
        <p className="hr-health-note">{missing.length ? 'Filling these makes the profile ready to send as a client CV.' : 'Everything a client CV draws on is on file.'}</p>
        {missing.length > 0 && <div className="hr-health-gaps">
          {missing.map(gap => <div className="hr-health-gap" key={gap.label}>
            <span>{gap.label}</span>
            <button type="button" onClick={() => focusSection(gap.anchor)}>{gap.action}</button>
          </div>)}
        </div>}
      </section>
      <section className="hr-card hr-profile-card">
        <div className="hr-profile-card-head">
          <h2>At a glance</h2>
        </div>
        <div className="hr-glance">
          {glance.map(item => <button type="button" key={item.label} className={`hr-glance-tile ${item.n === 0 ? 'is-zero' : ''}`} onClick={() => onNavigate(item.tab as PersonTab)}>
            <strong>{item.n}</strong>
            <span>{item.label}</span>
          </button>)}
        </div>
      </section>
      {employees.length > 0 && <section className="hr-card hr-profile-card">
        <div className="hr-profile-card-head hr-portal-head">
          <h2>Employment</h2>
          <button type="button" className="hr-health-gap-link" onClick={() => onNavigate('employment')}>History</button>
        </div>
        <dl className="hr-kvs">
          {employees.map(employee => <div className="hr-kv-group" key={employee.id}>
            <div className="hr-kv"><dt>Matricule</dt><dd className="is-mono">{employee.matricule}</dd></div>
            <div className="hr-kv"><dt>Role</dt><dd>{employee.role}</dd></div>
            <div className="hr-kv"><dt>Entry date</dt><dd>{date(employee.start_date)}</dd></div>
            <div className="hr-kv"><dt>Status</dt><dd>{label(employee.status)}{employee.end_date ? ` · to ${date(employee.end_date)}` : ''}</dd></div>
          </div>)}
        </dl>
      </section>}
      <section className="hr-card hr-profile-card" id="hr-profile-portal">
        <div className="hr-profile-card-head hr-portal-head">
          <h2>Portal account</h2>
          <span className={`hr-portal-state ${account ? 'is-linked' : ''}`}>{account ? 'Linked' : 'Not linked'}</span>
        </div>
        {account ? <div className="hr-portal-linked">
          <p>Profile ID <strong>{account.profile_id}</strong></p>
          <p>Linked {date(account.linked_at)}</p>
        </div> : <>
          <p className="hr-portal-note">Linking an account gives {person.full_name.split(' ')[0] || 'this person'} access to their offers, documents and CRA tasks.</p>
          <AccountLinker person={person} workspace={workspace} run={run} busy={busy} />
        </>}
      </section>
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
  return <div className="hr-portal-linker">
    {loading && <p role="status" className="hr-source-list">Loading portal accounts…</p>}
    {loadError && <p role="alert" className="hr-error">{loadError}</p>}
    {!loading && !loadError && <>
      <label className="hr-portal-search">
        <Search size={16} aria-hidden="true" />
        <span className="hr-visually-hidden">Find this person's account</span>
        <input type="search" placeholder="Search by name or email" value={query} onChange={event => {
          setQuery(event.target.value);
          setSelected('');
        }} />
      </label>
      {matches.length ? <div className="hr-portal-matches">
        {matches.map(profile => <button type="button" key={profile.id} className="hr-portal-match" aria-pressed={selected === profile.id} onClick={() => setSelected(profile.id)}>
          <span className="hr-portal-avatar" aria-hidden="true">{initials(profile.full_name || profile.email)}</span>
          <span className="hr-portal-match-id">
            <strong>{profile.full_name || 'Unnamed account'}</strong>
            <small>{profile.email}</small>
          </span>
          <span className="hr-portal-match-action">{selected === profile.id ? 'Selected' : 'Select'}</span>
        </button>)}
      </div> : <p className="hr-source-list">No available account matches. The person must sign in to create a portal account first.</p>}
      <p className="hr-source-list">Linking grants this account access to the person's applications, offers and employment tasks.</p>
      <button type="button" className="hr-portal-cta" disabled={!selected || busy || saving} onClick={() => void link()}>
        {saving ? 'Linking…' : 'Link account →'}
      </button>
    </>}
    {error && <p role="alert" className="hr-error">{error}</p>}
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
  const {
    workspace,
    run,
    busy
  } = context;
  const applications = workspace.applications.filter(application => application.person_id === person.id);
  const [selected, setSelected] = useState(initialId ?? applications[0]?.id ?? '');
  const current = applications.find(application => application.id === selected) ?? applications[0];
  return <>
    {current && <>
      <label className="hr-field">
        <span>Application history</span>
        <select value={current.id} onChange={event => setSelected(event.target.value)}>
          {applications.map(application => <option value={application.id} key={application.id}>{workspace.opportunities.find(opportunity => opportunity.id === application.opportunity_id)?.title ?? 'Hiring need'} · {label(application.status)} · {date(application.created_at)}</option>)}
        </select>
      </label>
      <ApplicationDetail key={current.id} application={current} person={person} context={context} />
    </>}
  </>;
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
  if (loading) return <p role="status">Checking prerequisites…</p>;
  if (error) return <p role="alert" className="hr-error">
    {error}
  </p>;
  if (!requirements.length) return <p className="hr-source-list">No additional prerequisites for this stage.</p>;
  return <ul className="hr-requirements">
    {requirements.map(requirement => <li key={requirement.key} className={requirement.done ? 'complete' : ''}>
      {requirement.done ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
      <span>
        {requirement.label}
        <small className="hr-source-list">
          {requirement.done ? ' Evidence recorded' : ' Evidence required'}
        </small>
      </span>
    </li>)}
  </ul>;
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
  const contracts = workspace.contracts.filter(contract => contract.application_id === application.id);
  return <>
    <div className="hr-card">
      <div className="hr-card-head">
        <div>
          <h3>
            {opportunity?.title ?? 'Hiring need'}
          </h3>
          <small>Application opened {date(application.created_at)} · {label(application.source)}</small>
        </div>
        <div className="hr-inline">
          <Tag tone={application.status === 'active' ? 'good' : 'quiet'}>
            {label(application.status)}
          </Tag>
          <Tag>
            {label(application.stage)}
          </Tag>
        </div>
      </div>
      {application.reason && <p>
        {application.reason}
      </p>}
    </div>
    <Section title="Interviews" detail="Scheduling records the interview. Calendar invitations are sent manually.">
      {!interviews.length && <Empty>No interview has been scheduled for this application.</Empty>}
      {interviews.map(interview => <div key={interview.id} className="hr-card">
        <div className="hr-card-head">
          <div>
            <h3>{label(interview.kind)} interview</h3>
            <small>{new Date(interview.scheduled_at).toLocaleString()} · {interview.panel}</small>
          </div>
          <Tag>
            {label(interview.status)}
          </Tag>
        </div>
        <p>{interview.location || 'Location not set'} · Invitation {label(interview.invitation_status)}</p>
        {interview.notes && <p>
          {interview.notes}
        </p>}
        {interview.status === 'scheduled' && <details className="hr-disclosure">
          <summary>Record interview outcome</summary>
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
            {['Technical skills', 'Communication', 'Motivation'].map((competency, index) => <div className="hr-wide hr-fields" key={competency}>
              <Field name={`rating_${index}`} label={`${competency} rating (1–5)`} type="number" min={1} max={5} required />
              <Field name={`evidence_${index}`} label={`${competency} evidence`} required />
            </div>)}
            <Field name="notes" label="Interviewer notes" type="textarea" required />
          </Form>
          <Form run={run} busy={busy} button="Cancel interview" success="Interview cancelled." submit={data => ({
            kind: 'cancel_interview',
            interview_id: interview.id,
            expected_version: interview.version,
            rationale: text(data, 'rationale')
          })}>
            <Field name="rationale" label="Cancellation reason" required />
          </Form>
        </details>}
      </div>)}
      {application.status === 'active' && <details className="hr-disclosure">
        <summary>Schedule an interview</summary>
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
      </details>}
      <div style={{
        marginTop: 20
      }}>
        <AiPanel person={person} workspace={workspace} run={run} reload={reload} application={application} kind="interview_prep" />
      </div>
    </Section>
    <Section title="Employment offers" detail="Compensation and margin use deterministic calculations. Approvals use your actual permissions.">
      {offers.map(offer => <div key={offer.id} className="hr-card">
        <div className="hr-card-head">
          <h3>
            {offer.title}
          </h3>
          <Tag tone={offer.status === 'accepted' ? 'good' : ''}>
            {label(offer.status)}
          </Tag>
        </div>
        <div className="hr-stat-line">
          <div><small>Monthly salary</small>€{offer.salary_monthly.toLocaleString()}</div>
          <div><small>Daily cost</small>€{offer.cjm}</div>
          <div><small>Target daily rate</small>€{offer.target_tjm}</div>
          <div><small>Gross margin</small>{offer.margin_pct.toFixed(1)}%</div>
        </div>
        <p>{offer.contract_type} · Valid until {date(offer.valid_until)} · Delivery {label(offer.delivery_status)}</p>
        {['pending_approval', 'pending_direction'].includes(offer.status) && (offer.status !== 'pending_direction' || workspace.capabilities.approve_direction) && <Form run={run} busy={busy} button={offer.status === 'pending_direction' ? 'Record direction approval' : 'Approve offer'} success="Offer approval recorded." submit={data => ({
          kind: 'approve_offer',
          offer_id: offer.id,
          expected_version: offer.version,
          note: text(data, 'note')
        })}>
          <Field name="note" label="Approval rationale" required />
        </Form>}
        {offer.status === 'pending_direction' && !workspace.capabilities.approve_direction && <p>Awaiting direction approval from an administrator.</p>}
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
      </div>)}
      {!offers.length && <Empty>No employment offer yet.</Empty>}
      {application.status === 'active' && application.stage !== 'decision' && <p className="hr-source-list">Complete the interview evidence and move to Decision before drafting an employment offer.</p>}
      {application.status === 'active' && application.stage === 'decision' && <details className="hr-disclosure">
        <summary>Draft an employment offer</summary>
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
      </details>}
    </Section>
    <Section title="Contracts" detail="Hiring requires the accepted offer and signatures linked to this application.">
      {contracts.map(contract => {
        const signature = workspace.signatures.find(item => item.contract_id === contract.id);
        const counter = workspace.countersignatures.find(item => item.contract_id === contract.id);
        return <div className="hr-card" key={contract.id}>
          <div className="hr-card-head">
            <div className="hr-inline">
              <FileText size={18} aria-hidden="true" />
              <h3>
                {contract.title}
              </h3>
            </div>
            <Tag tone={signature && counter ? 'good' : 'quiet'}>
              {signature && counter ? 'Both signatures recorded' : 'Awaiting signatures'}
            </Tag>
          </div>
          <p>Candidate: {signature ? `${signature.signer_name}, ${date(signature.signed_at)}` : 'Pending'} · Employer: {counter ? `${counter.signer_name}, ${date(counter.signed_at)}` : 'Pending'}</p>
          {!counter && <Form run={run} busy={busy} button="Countersign as employer" success="Employer countersignature recorded." submit={data => ({
            kind: 'countersign_contract',
            contract_id: contract.id,
            signer_name: text(data, 'signer_name')
          })}>
            <Field name="signer_name" label="Employer signer's full name" required />
          </Form>}
        </div>;
      })}
      {!contracts.length && <Empty>No contract is linked to this application.</Empty>}
      <p>
        <a href={`/hr/contracts?person=${encodeURIComponent(person.id)}&application=${encodeURIComponent(application.id)}`}>Share a contract for this application</a>
      </p>
    </Section>
    {application.status === 'active' && <Section title="Hire and start preboarding" detail="The person keeps all prior applications and employment periods.">
      <div className="hr-two-column">
        <div className="hr-card">
          <Readiness key={`hire-${workspace.events.length}-${workspace.signatures.length}-${workspace.countersignatures.length}`} applicationId={application.id} stage="hire" />
        </div>
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
  return <details className="hr-disclosure">
    <summary>Engage directly — no application</summary>
    <p className="hr-source-list">For people hired outside the pipeline (freelancers, direct contracts). Skips offers and contracts — an optional rationale is recorded as audit evidence.</p>
    <Form run={run} busy={busy} button="Record engagement" success="Engagement recorded. The person can be staffed on projects right away." submit={data => ({
      kind: 'engage_person',
      person_id: person.id,
      role: text(data, 'role'),
      contract_type: text(data, 'contract_type'),
      start_date: text(data, 'start_date'),
      manager_email: text(data, 'manager_email'),
      rationale: text(data, 'rationale')
    })}>
      <Field name="role" label="Engagement role" value={person.headline} required />
      <Field name="contract_type" label="Contract type" value="Freelance" options={options(['Freelance', 'CDI', 'CDD', 'Internship', 'Apprenticeship'])} required />
      <Field name="start_date" label="Start date" type="date" value={today()} required />
      <Field name="manager_email" label="Manager email" type="email" />
      <Field name="rationale" label="Engagement rationale" type="textarea" hint="Optional — why this person is engaged without the application pipeline." />
    </Form>
  </details>;
}
/** Rail-and-body section used across the Employment tab. Design reference:
   Employee · Employment (minimal) — a 240px rail carries the section title
   and a one-line rationale, hairlines separate sections, and the content
   sits borderless on the right. */
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
  return <section className="hr-emp-section">
    <div className="hr-emp-side">
      <h2>{title}</h2>
      {detail && <p>{detail}</p>}
      {rail}
    </div>
    <div className="hr-emp-body">{children}</div>
  </section>;
}
/** Compact journey-task composer — one rounded bar (title, phase, due date,
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
  return <div>
    <form className="hr-emp-composer" onSubmit={event => void onSubmit(event)}>
      <input name="title" placeholder="Add a task…" aria-label="New task" required maxLength={300} className="hr-emp-composer-input" />
      <select name="phase" defaultValue="onboarding" aria-label="Phase" className="hr-emp-composer-select">
        {(['preboarding', 'onboarding', 'probation'] as const).map(phase => <option key={phase} value={phase}>
          {label(phase)}
        </option>)}
      </select>
      <input name="due_date" type="date" aria-label="Due date" className="hr-emp-composer-date" />
      <button type="submit" className="hr-emp-add" disabled={busy || saving}>
        {saving ? 'Adding…' : 'Add'}
      </button>
    </form>
    <p className="hr-source-list">Owner: {actorEmail} · Required</p>
    {error && <p role="alert" className="hr-error">
      {error}
    </p>}
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
  const salaries = workspace.salaries.filter(entry => entry.employee_id === employee.id).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const reviews = workspace.reviews.filter(review => review.employee_id === employee.id);
  const exit = workspace.exits.find(record => record.employee_id === employee.id);
  const ended = employee.status === 'ended';
  const canEdit = !ended && workspace.capabilities.recruit;
  const [editingPeople, setEditingPeople] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState('');
  const [editingTaskId, setEditingTaskId] = useState('');
  const [recordingReviewId, setRecordingReviewId] = useState('');
  const [addingSalary, setAddingSalary] = useState(false);
  const [editingSalaryId, setEditingSalaryId] = useState('');
  const [schedulingReview, setSchedulingReview] = useState(false);
  const [startingExit, setStartingExit] = useState(false);
  const [cancellingHire, setCancellingHire] = useState(false);
  const completeCount = tasks.filter(task => task.completed_at).length;
  const periodRail = periods && onSelectPeriod ? <label className="hr-field hr-emp-period">
    <span>Period</span>
    <select value={employee.id} onChange={event => onSelectPeriod(event.target.value)} aria-label="Employment period">
      {periods.map(period => <option value={period.id} key={period.id}>
        {date(period.start_date)} – {period.end_date ? date(period.end_date) : 'present'}
      </option>)}
    </select>
  </label> : undefined;
  const managerBuddy = (value: string, emptyLabel: string) => value ? <span className="hr-emp-value">
      {value}
      {canEdit && <button type="button" className="hr-emp-mini" onClick={() => setEditingPeople(open => !open)}>
        Change
      </button>}
    </span> : canEdit ? <button type="button" className="hr-emp-assign" onClick={() => setEditingPeople(open => !open)}>
      <Plus size={13} aria-hidden="true" />
      {emptyLabel}
    </button> : 'Not set';
  return <>
    <EmpSection title="Employment" rail={periodRail}>
      <dl className="hr-emp-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <Tag tone={ended ? 'quiet' : 'good'}>
              {label(employee.status)}
            </Tag>
          </dd>
        </div>
        <div>
          <dt>Matricule</dt>
          <dd>{employee.matricule}</dd>
        </div>
        <div>
          <dt>Contract</dt>
          <dd>{employee.contract_type ? label(employee.contract_type) : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Entry date</dt>
          <dd>{date(employee.start_date)}</dd>
        </div>
        <div>
          <dt>Onboarding</dt>
          <dd>{employee.onboarding_completed_at ? `Completed ${date(employee.onboarding_completed_at)}` : employee.status === 'preboarding' ? 'Not started' : 'In progress'}</dd>
        </div>
        <div>
          <dt>Probation</dt>
          <dd>{employee.probation_end ? `${label(employee.probation_status)} · ${date(employee.probation_end)}` : label(employee.probation_status)}</dd>
        </div>
        <div>
          <dt>Manager</dt>
          <dd>{managerBuddy(employee.manager_email, 'Assign manager')}</dd>
        </div>
        <div>
          <dt>Buddy</dt>
          <dd>{managerBuddy(employee.parrain, 'Assign buddy')}</dd>
        </div>
      </dl>
      {!ended && <div className="hr-emp-actions">
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
        {employee.status === 'preboarding' && <button type="button" className="hr-emp-ghost plain" onClick={() => setCancellingHire(open => !open)}>
          Cancel hire — candidate renounced
        </button>}
      </div>}
      {editingPeople && canEdit && <Form run={run} busy={busy} button="Save manager and buddy" success="Manager and buddy updated." submit={data => ({
        kind: 'update_employment',
        employee_id: employee.id,
        expected_version: employee.version,
        manager_email: text(data, 'manager_email'),
        parrain: text(data, 'parrain')
      })}>
        <Field name="manager_email" label="Manager email" type="email" value={employee.manager_email} />
        <Field name="parrain" label="Buddy" value={employee.parrain} />
      </Form>}
      {cancellingHire && employee.status === 'preboarding' && <Form run={run} busy={busy} title="Cancel hire" button="Cancel hire" success="Hire cancelled. Employment closed, application withdrawn and commitments released." submit={data => ({
        kind: 'cancel_hire',
        employee_id: employee.id,
        expected_version: employee.version,
        rationale: text(data, 'rationale')
      })}>
        <Field name="rationale" label="Renunciation rationale" type="textarea" required />
      </Form>}
    </EmpSection>
    <EmpSection title="Salary" detail="Dated monthly salary history. A new entry closes the previous one the day before it starts; hiring seeds the first entry from the accepted offer.">
      {!salaries.length && <div className="hr-emp-empty">
        <span>No salary recorded</span>
      </div>}
      {!!salaries.length && <ul className="hr-emp-tasks">
        {salaries.map(entry => {
          const editing = editingSalaryId === entry.id;
          return <li key={entry.id} className="hr-emp-task">
            <div className="hr-emp-task-main">
              <span className="hr-emp-task-title">
                €{entry.salary_monthly.toLocaleString()} / month
              </span>
              <span className="hr-emp-task-meta">
                {date(entry.start_date)} – {entry.end_date ? date(entry.end_date) : 'ongoing'}
                {entry.rationale ? ` · ${entry.rationale}` : ''}
              </span>
            </div>
            {!entry.end_date && <Tag tone="good">Current</Tag>}
            {canEdit && <button type="button" className="hr-emp-mini" onClick={() => {
              setEditingSalaryId(editing ? '' : entry.id);
              setAddingSalary(false);
            }}>
              {editing ? 'Close' : 'Edit'}
            </button>}
            {editing && canEdit && <div className="hr-emp-task-form">
              <Form run={run} busy={busy} button="Save salary entry" success="Salary entry updated." submit={data => ({
                kind: 'save_salary',
                employee_id: employee.id,
                salary_id: entry.id,
                expected_version: entry.version,
                salary_monthly: number(data, 'salary_monthly'),
                start_date: text(data, 'start_date'),
                end_date: nullable(data, 'end_date'),
                rationale: text(data, 'rationale')
              })}>
                <Field name="salary_monthly" label="Monthly salary (€)" type="number" min={0} step="0.01" value={entry.salary_monthly} required />
                <Field name="start_date" label="Effective from" type="date" value={entry.start_date} required />
                <Field name="end_date" label="Effective until (empty = ongoing)" type="date" value={entry.end_date} />
                <Field name="rationale" label="Change rationale" type="textarea" required />
              </Form>
            </div>}
          </li>;
        })}
      </ul>}
      {canEdit && !addingSalary && <button type="button" className="hr-emp-assign" onClick={() => {
        setAddingSalary(true);
        setEditingSalaryId('');
      }}>
        <Plus size={13} aria-hidden="true" />
        Record salary change
      </button>}
      {canEdit && addingSalary && <Form run={run} busy={busy} button="Record salary change" success="Salary change recorded." submit={data => ({
        kind: 'save_salary',
        employee_id: employee.id,
        salary_monthly: number(data, 'salary_monthly'),
        start_date: text(data, 'start_date'),
        rationale: text(data, 'rationale')
      })}>
        <Field name="salary_monthly" label="Monthly salary (€)" type="number" min={0} step="0.01" required />
        <Field name="start_date" label="Effective from" type="date" value={today()} required />
        <Field name="rationale" label="Rationale" type="textarea" hint="Raise, correction, indexation — recorded as audit evidence." />
      </Form>}
    </EmpSection>
    <EmpSection title="Journey checklist" detail={tasks.length ? `${completeCount} of ${tasks.length} complete. Required tasks are enforced when the journey closes.` : 'Required tasks are enforced when the journey closes.'}>
      {!tasks.length && <div className="hr-emp-empty">
        <span>No tasks yet</span>
      </div>}
      {!!tasks.length && <ul className="hr-emp-tasks">
        {tasks.map(task => {
          const overdue = !task.completed_at && !!task.due_date && task.due_date < today();
          const completing = completingTaskId === task.id;
          const editing = editingTaskId === task.id;
          return <li key={task.id} className={`hr-emp-task ${task.completed_at ? 'is-done' : ''}`}>
            <button type="button" className="hr-emp-check" aria-label={task.completed_at ? `${task.title} — completed` : `Complete ${task.title}`} aria-expanded={completing} disabled={ended || !!task.completed_at} onClick={() => {
              setCompletingTaskId(completing ? '' : task.id);
              setEditingTaskId('');
            }}>
              <Check size={12} aria-hidden="true" />
            </button>
            <div className="hr-emp-task-main">
              <span className="hr-emp-task-title">
                {task.title}
              </span>
              <span className="hr-emp-task-meta">
                {label(task.phase)} · {task.assignee || 'Unassigned'} · {task.due_date ? `Due ${date(task.due_date)}` : 'No due date'}
                {task.dependency_id && ` · After ${tasks.find(item => item.id === task.dependency_id)?.title ?? 'another task'}`}
              </span>
              {task.evidence && <span className="hr-emp-task-meta">
                {task.evidence}
              </span>}
            </div>
            {task.required && <Tag>Required</Tag>}
            <Tag tone={task.completed_at ? 'good' : overdue ? 'urgent' : 'quiet'}>
              {task.completed_at ? 'Complete' : overdue ? 'Overdue' : 'Open'}
            </Tag>
            {!task.completed_at && canEdit && <button type="button" className="hr-emp-mini" onClick={() => {
              setEditingTaskId(editing ? '' : task.id);
              setCompletingTaskId('');
            }}>
              {editing ? 'Close' : 'Edit'}
            </button>}
            {completing && canEdit && <div className="hr-emp-task-form">
              <Form run={run} busy={busy} button="Complete task" success="Task evidence recorded." submit={data => ({
                kind: 'complete_task',
                task_id: task.id,
                expected_version: task.version,
                evidence: text(data, 'evidence')
              })}>
                <Field name="evidence" label="Completion evidence" value={task.evidence} required />
              </Form>
            </div>}
            {editing && canEdit && <div className="hr-emp-task-form">
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
                <label className="hr-checkbox">
                  <input type="checkbox" name="required" defaultChecked={task.required} />
                  Required before completion
                </label>
                <Field name="evidence" label="Progress evidence" type="textarea" value={task.evidence} />
              </Form>
            </div>}
          </li>;
        })}
      </ul>}
      {canEdit && <TaskComposer employee={employee} context={context} />}
      {canEdit && <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="onboarding_plan" bare cta="Draft plan with AI" />}
    </EmpSection>
    <EmpSection title="Reviews" detail="A held review records the outcome. Onboarding alone doesn’t confirm probation.">
      {!reviews.length && <div className="hr-emp-empty">
        <span>No reviews scheduled</span>
        {!ended && <button type="button" className="hr-emp-ghost" onClick={() => setSchedulingReview(open => !open)}>
          Schedule review
        </button>}
      </div>}
      {!!reviews.length && <ul className="hr-emp-tasks">
        {reviews.map(review => {
          const recording = recordingReviewId === review.id;
          return <li key={review.id} className="hr-emp-task">
            <div className="hr-emp-task-main">
              <span className="hr-emp-task-title">
                {label(review.kind)} review
              </span>
              <span className="hr-emp-task-meta">
                {review.status === 'held' && review.held_at ? `Held ${date(review.held_at)}` : `Due ${date(review.due_date)}`}
              </span>
              {review.status === 'held' && <span className="hr-emp-task-meta">
                {label(review.outcome)} · {review.rationale}
              </span>}
            </div>
            <Tag tone={review.status === 'held' ? 'good' : 'quiet'}>
              {label(review.status)}
            </Tag>
            {!ended && review.status !== 'held' && <button type="button" className="hr-emp-mini" onClick={() => setRecordingReviewId(recording ? '' : review.id)}>
              {recording ? 'Close' : 'Record outcome'}
            </button>}
            {recording && review.status !== 'held' && !ended && <div className="hr-emp-task-form">
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
      {!!reviews.length && !ended && <div className="hr-emp-actions">
        <button type="button" className="hr-emp-ghost" onClick={() => setSchedulingReview(open => !open)}>
          Schedule review
        </button>
      </div>}
      {schedulingReview && !ended && <Form run={run} busy={busy} button="Schedule review" success="Review scheduled." submit={data => ({
        kind: 'schedule_review',
        employee_id: employee.id,
        review_kind: text(data, 'review_kind'),
        due_date: text(data, 'due_date')
      })}>
        <Field name="review_kind" label="Review type" value="probation" options={options(['probation', 'annual'])} required />
        <Field name="due_date" label="Due date" type="date" value={employee.probation_end} required />
      </Form>}
    </EmpSection>
    <EmpSection title={exit ? 'Departure and handover' : 'Offboarding'} detail="Closes assignments and keeps the employment period on record.">
      {!exit && <>
        <div className="hr-emp-empty">
          <span>No exit in progress</span>
          {!ended && <button type="button" className="hr-emp-ghost plain" onClick={() => setStartingExit(open => !open)}>
            Start exit workflow →
          </button>}
        </div>
        {startingExit && !ended && <Form run={run} busy={busy} button="Open offboarding" success="Offboarding opened and employment state updated." submit={data => ({
          kind: 'open_exit',
          employee_id: employee.id,
          expected_version: employee.version,
          exit_kind: text(data, 'exit_kind'),
          exit_date: text(data, 'exit_date'),
          notice_end: nullable(data, 'notice_end'),
          rationale: text(data, 'rationale')
        })}>
          <Field name="exit_kind" label="Exit type" options={options(['resignation', 'rupture_conventionnelle', 'dismissal', 'probation_end', 'cdd_end'])} required />
          <Field name="exit_date" label="Exit date" type="date" required />
          <Field name="notice_end" label="Notice end" type="date" />
          <Field name="rationale" label="Reason" type="textarea" required />
        </Form>}
      </>}
      {exit && <>
        <div className="hr-emp-empty">
          <span>
            {label(exit.kind)} · {date(exit.exit_date)}
          </span>
          <Tag tone={exit.status === 'completed' ? 'good' : 'quiet'}>
            {label(exit.status)}
          </Tag>
        </div>
        {exit.status === 'completed' && <>
          <p className="hr-emp-note">
            {exit.handover_plan}
          </p>
          <p className="hr-emp-note">
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
          <ul className="hr-emp-tasks">
            {workspace.exitItems.filter(item => item.offboarding_id === exit.id).map(item => <li className={`hr-emp-task ${item.completed_at ? 'is-done' : ''}`} key={item.id}>
              <button type="button" className="hr-emp-check" aria-label={item.completed_at ? `${item.title} — completed` : `Complete ${item.title}`} disabled={!!item.completed_at}>
                <Check size={12} aria-hidden="true" />
              </button>
              <div className="hr-emp-task-main">
                <span className="hr-emp-task-title">
                  {item.title}
                </span>

              </div>
              <Tag tone={item.completed_at ? 'good' : 'quiet'}>
                {item.completed_at ? 'Complete' : item.required ? 'Required' : 'Optional'}
              </Tag>
              {!item.completed_at && <div className="hr-emp-task-form">
                <Form run={run} busy={busy} button="Complete exit task" success="Exit task completed." submit={() => ({
                  kind: 'complete_exit_item',
                  item_id: item.id,
                  expected_version: item.version
                })}>
                  <p className="hr-emp-note">Mark this task as done when completed.</p>
                </Form>
              </div>}
            </li>)}
          </ul>
          <details className="hr-disclosure">
            <summary>Add an exit task</summary>
            <Form run={run} busy={busy} button="Add exit task" success="Exit task added." submit={data => ({
              kind: 'save_exit_item',
              exit_id: exit.id,
              title: text(data, 'title'),
              required: checked(data, 'required')
            })}>
              <Field name="title" label="Task" required />
              <label className="hr-checkbox">
                <input type="checkbox" name="required" defaultChecked />
                Required before closing exit
              </label>
            </Form>
          </details>
          <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="handover" bare cta="Draft handover" />
          <p className="hr-emp-note">
            Complete required tasks, record a handover and a rehire decision before closing. Existing assignments will end at the exit date.
          </p>
          <div className="hr-emp-actions">
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
  return <section className="hr-builder-step">
    <div className="hr-builder-step-head">
      <span className="hr-builder-step-num" aria-hidden="true">{index}</span>
      <h4>{title}</h4>
      {note && <span className="hr-builder-step-note">{note}</span>}
    </div>
    {children}
  </section>;
}
/**
 * Staffing composer (reference: “Assign to project — employee”, Main.dc.html).
 *
 * Five numbered steps on the left — project, pricing line, allocation, period,
 * commitment — and a preview rail on the right that prices the draft and plots
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
  return <form className="hr-builder" onSubmit={event => void onSubmit(event)}>
    <div className="hr-builder-steps">
      <BuilderStep index={1} title="Project">
        {projects.length > 4 && <div className="hr-builder-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a project or client…" aria-label="Search projects" />
        </div>}
        <div className="hr-builder-projects">
          {matches.map(item => {
            const client = workspace.clients.find(entry => entry.id === item.client_id)?.name;
            const elapsed = item.start_date && item.end_date && item.end_date > item.start_date
              ? Math.max(0, Math.min(100, Math.round(100 * (new Date(`${day}T12:00:00`).getTime() - new Date(`${item.start_date}T12:00:00`).getTime()) / (new Date(`${item.end_date}T12:00:00`).getTime() - new Date(`${item.start_date}T12:00:00`).getTime()))))
              : null;
            const left = item.end_date ? workingDaysBetween(day > (item.start_date ?? day) ? day : item.start_date ?? day, item.end_date).length : null;
            return <button type="button" key={item.id} className="hr-builder-project" aria-pressed={item.id === projectId} onClick={() => pickProject(item)}>
              <span className="hr-builder-radio" aria-hidden="true" />
              <span className="hr-builder-project-main">
                <span className="hr-builder-project-top">
                  <span className="hr-builder-code">{item.title}</span>
                  {client && <span className="hr-builder-chip">{client}</span>}
                  <span className="hr-builder-quiet">{label(item.pricing_model)} · {item.currency}</span>
                </span>
                <span className="hr-builder-project-span">
                  <span className="hr-builder-quiet">{[item.start_date ? date(item.start_date) : null, item.end_date ? date(item.end_date) : 'open-ended'].filter(Boolean).join(' → ')}</span>
                  {elapsed !== null && <span className="hr-builder-elapsed" aria-hidden="true"><span style={{ width: `${elapsed}%` }} /></span>}
                </span>
              </span>
              {left !== null && <span className="hr-builder-project-right">
                <strong>{left}</strong>
                <span>working days left</span>
              </span>}
            </button>;
          })}
          {!matches.length && <p className="hr-builder-quiet">{projects.length ? `No open project matches “${query.trim()}”.` : 'No open project to staff on yet.'}</p>}
        </div>
      </BuilderStep>
      {profiles.length > 0 && <BuilderStep index={2} title="Pricing line" note="The TJM profile this person is billed on">
        <div className="hr-builder-lines">
          {profiles.map(item => {
            const staffed = workspace.assignments.filter(assignment => assignment.project_id === projectId && assignment.pricing_line === item.name && !['completed', 'cancelled'].includes(assignment.status)).length;
            return <button type="button" key={item.name} className="hr-builder-line" aria-pressed={item.name === line?.name} onClick={() => setLineName(item.name)}>
              <span className="hr-builder-line-main">
                <strong>{item.name}</strong>
                <span className="hr-builder-quiet">{staffed ? `${staffed} already staffed` : 'Nobody staffed yet'}</span>
              </span>
              <span className="hr-builder-rate">{lineRateLabel(item.tjm, project?.currency ?? 'EUR')}</span>
            </button>;
          })}
        </div>
      </BuilderStep>}
      <BuilderStep index={profiles.length > 0 ? 3 : 2} title="Allocation">
        <div className="hr-builder-alloc">
          <div className="hr-builder-presets" role="group" aria-label="Allocation presets">
            {ALLOCATION_PRESETS.map(preset => <button type="button" key={preset} aria-pressed={allocation === preset} onClick={() => setAllocation(preset)}>
              {preset}%
            </button>)}
          </div>
          <label className="hr-builder-custom">
            Custom
            <input type="number" min={1} max={100} step={1} value={allocation} aria-label="Allocation (%)" onChange={event => setAllocation(Math.max(1, Math.min(100, Number(event.target.value) || 0)))} />
            %
          </label>
        </div>
        <p className="hr-builder-quiet">
          {allocation === 100 ? 'Full time on this project — no capacity left for another.' : `${allocation}% of her week here, ${100 - allocation}% free for other projects.`}
        </p>
      </BuilderStep>
      <BuilderStep index={profiles.length > 0 ? 4 : 3} title="Period" note={windowHint ? `Project window: ${windowHint}` : 'This project has no delivery dates yet.'}>
        <div className="hr-builder-dates">
          <div className="hr-builder-date">
            <span className="hr-builder-label">Starts</span>
            <DateField name="start_date" value={start} min={startMin} max={windowEnd ?? undefined} onChange={setStart} aria-label="Starts" required />
            <div className="hr-builder-chips">
              <button type="button" onClick={() => setStart(day)}>Today</button>
              <button type="button" onClick={() => setStart(nextMonday(day))}>Next Monday</button>
              {windowStart && <button type="button" onClick={() => setStart(windowStart)}>Project start</button>}
            </div>
          </div>
          <div className="hr-builder-date">
            <span className="hr-builder-label">Ends</span>
            <DateField name="end_date" value={endDay} min={start} max={windowEnd ?? undefined} onChange={value => { setEnd(value); setOpenRequested(false); }} aria-label="Ends, if known" />
            <div className="hr-builder-chips">
              {windowEnd && <button type="button" aria-pressed={end === windowEnd} onClick={() => { setEnd(windowEnd); setOpenRequested(false); }}>Project end</button>}
              <button type="button" aria-pressed={openEnded} disabled={!!windowEnd} title={windowEnd ? 'The project ends on a fixed date, so the assignment needs one too.' : undefined} onClick={() => { setOpenRequested(current => !current); setEnd(''); }}>Open-ended</button>
            </div>
          </div>
        </div>
        {outsideWindow && <p role="alert" className="hr-builder-alert">
          <AlertCircle size={16} aria-hidden="true" />
          These dates fall outside the project window{windowHint ? ` (${windowHint})` : ''}. Move them inside, or extend the contract first.
        </p>}
        {!outsideWindow && outsideEmployment && <p role="alert" className="hr-builder-alert">
          <AlertCircle size={16} aria-hidden="true" />
          These dates fall outside this employment period ({date(employee.start_date)} → {employee.planned_exit_date ? date(employee.planned_exit_date) : 'open-ended'}).
        </p>}
        {!outsideWindow && !outsideEmployment && <p className="hr-builder-quiet">
          {openEnded ? 'Open-ended — capacity counts it until someone ends it.' : `${workDays} working days in this period.`}
        </p>}
      </BuilderStep>
      <BuilderStep index={profiles.length > 0 ? 5 : 4} title="Commitment">
        <div className="hr-builder-commits">
          {COMMITMENTS.map(item => <button type="button" key={item.value} className="hr-builder-commit" aria-pressed={status === item.value} onClick={() => setStatus(item.value)}>
            <strong>{label(item.value)}</strong>
            <span className="hr-builder-quiet">{item.hint}</span>
          </button>)}
        </div>
      </BuilderStep>
    </div>
    <aside className="hr-builder-preview" aria-label="Assignment preview">
      <div className="hr-builder-preview-head">
        <span className="hr-builder-eyebrow">Preview</span>
        <strong>{personName(workspace, employee.person_id)} → {project?.title ?? 'no project'}</strong>
        <span className="hr-builder-quiet">{[line?.name, rate ? lineRateLabel(rate, project?.currency ?? 'EUR') : null, label(status)].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="hr-builder-tiles">
        <div className="hr-builder-tile">
          <span className="hr-builder-quiet">Staffed days</span>
          <strong>{openEnded || !workDays ? '—' : halfDays(staffedDays)}</strong>
          <span className="hr-builder-quiet">{openEnded ? 'No end date yet' : `${allocation}% × ${workDays} working days`}</span>
        </div>
        <div className="hr-builder-tile">
          <span className="hr-builder-quiet">Billable value</span>
          <strong>{rate && !openEnded && workDays ? amount(staffedDays * rate, project?.currency ?? 'EUR') : '—'}</strong>
          <span className="hr-builder-quiet">{rate ? 'If every day lands in the CRA' : 'No daily rate on this line'}</span>
        </div>
      </div>
      {load.length > 0 && <div className="hr-builder-load">
        <div className="hr-builder-load-top">
          <span>Her load per month</span>
          <span className="hr-builder-quiet">{months.length} {months.length === 1 ? 'month' : 'months'}</span>
        </div>
        <div className="hr-builder-chart" aria-hidden="true">
          <span className="hr-builder-ceiling">100%</span>
          {load.map(month => {
            const total = Math.min(100, month.booked + month.draft);
            return <span className="hr-builder-column" key={month.key}>
              <span className="hr-builder-bar" style={{ height: `${Math.max(2, total)}%` }}>
                <span className="hr-builder-bar-draft" style={{ height: `${total ? Math.round(100 * Math.min(month.draft, total) / total) : 0}%` }} />
              </span>
              <span className="hr-builder-quiet">{month.label}</span>
            </span>;
          })}
        </div>
        <span className="hr-builder-quiet">
          {clash ? 'Some days are already booked — the save will be refused above 100%.' : counts ? 'Shaded is already booked, bright is this draft.' : 'Proposed work is not counted against capacity.'}
        </span>
      </div>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="hr-error">{error}</p>}
      {message && <p role="status" className="hr-source-list">{message}</p>}
      <div className="hr-builder-submit">
        <button className="btn" type="submit" disabled={busy || saving || invalid}>
          {saving ? 'Saving…' : 'Create assignment'}
        </button>
        <span className="hr-builder-quiet">
          {invalid ? 'Pick a project and a period inside its window.' : `It shows on her CRA from ${date(start)}.`}
        </span>
      </div>
    </aside>
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
  return <>
    <section className="hr-person-metrics" aria-label="Staffing overview">
      <div className="hr-person-metric is-wide">
        <div className="hr-person-metric-top">
          <span>Booked today</span>
          <span>{availableToday}% available</span>
        </div>
        <div className="hr-person-metric-figure">
          <strong>{bookedToday}%</strong>
          {!!draftToday && <span className="hr-person-metric-delta">→ {bookedPreview}% with this draft</span>}
        </div>
        <div className="hr-person-meter" aria-hidden="true">
          {!!draftToday && <span className="is-draft" style={{
            width: `${bookedPreview}%`
          }} />}
          <span style={{
            width: `${Math.min(100, bookedToday)}%`
          }} />
        </div>
      </div>
      <div className="hr-person-metric">
        <span className="hr-person-metric-label">Next availability</span>
        <strong className="hr-person-metric-value">{nextAvailability ? date(nextAvailability.day) : '—'}</strong>
        <span className="hr-person-metric-note">{nextAvailability?.after ? `After ${nextAvailability.after}` : nextAvailability ? 'Open capacity' : live.length ? 'Fully booked' : 'Not employed'}</span>
      </div>
      <div className="hr-person-metric">
        <span className="hr-person-metric-label">Days on projects</span>
        <strong className="hr-person-metric-value">{daysOnProjects}</strong>
        <span className="hr-person-metric-note">Across {projectCount} {projectCount === 1 ? 'project' : 'projects'}</span>
      </div>
      <div className="hr-person-metric">
        <span className="hr-person-metric-label">Available this year</span>
        <strong className="hr-person-metric-value">{availability.ready ? fmtDays(availability.availableDays) : '…'}</strong>
        <span className="hr-person-metric-note">
          {availability.error ? `CRA unavailable — ${availability.error}` : availability.ready ? `${fmtDays(availability.openDays)} open days − ${fmtDays(availability.projectDays)} project − ${fmtDays(availability.paidLeaveDays)} CP − ${fmtDays(availability.rttDays)} RTT · usable for internal` : 'Reading the CRA…'}
        </span>
      </div>
    </section>
    <section>
      <div className="hr-person-section-head">
        <h2>Active assignments</h2>
        {!!live.length && !assignOpen && <button type="button" className="btn hr-person-assign-btn" aria-expanded={assignOpen} onClick={() => setAssignOpen(true)}>
          <Plus size={16} aria-hidden="true" /> Assign to project
        </button>}
      </div>
      {assignOpen && live.map(employee => <div className="hr-assign-panel" key={employee.id}>
        <div className="hr-assign-panel-head">
          <div>
            <h3>New assignment · {employee.role}</h3>
            <p>Staff {person.full_name.split(' ')[0]} on a project's pricing line. Dates must fit the project window.</p>
          </div>
          <button type="button" className="hr-assign-panel-cancel" onClick={() => { setAssignOpen(false); setDraft(null); }}>Cancel</button>
        </div>
        <AssignForm employee={employee} workspace={workspace} run={run} busy={busy} onDraft={setDraft} />
      </div>)}
      {open.map(assignment => <AssignmentCard key={assignment.id} assignment={assignment} workspace={workspace} run={run} busy={busy} openProject={openProject} />)}
      {!open.length && <Empty>No active assignment. Use “Assign to project” above to commit this person to a project.</Empty>}
    </section>
    <Section title="Past assignments" detail="Ended and cancelled periods, including repeats." action={history.length ? <div className="hr-segmented" role="group" aria-label="Filter history">
      {filters.map(item => <button key={item.key} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
        {item.label}
        {' '}
        {item.count}
      </button>)}
    </div> : undefined}>
      {filtered.map(assignment => <div className="hr-card" key={assignment.id}>
        <div className="hr-card-head">
          <div>
            <h3 className="hr-assign-title">
              {openProject ? <button type="button" className="hr-project-link" onClick={() => openProject(assignment.project_id)} title="Open project in Sales">{workspace.projects.find(project => project.id === assignment.project_id)?.title ?? 'Project'}</button> : workspace.projects.find(project => project.id === assignment.project_id)?.title ?? 'Project'}
            </h3>
            <div className="hr-assign-meta">
              {assignment.pricing_line
                ? <span className="hr-assign-line">{assignment.pricing_line}</span>
                : <span>{assignment.position}</span>}
              <span>{assignment.allocation_pct}% allocation</span>
              <span>{date(assignment.start_date)} → {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</span>
            </div>
          </div>
          <div className="hr-inline">
            <span className="hr-source-list">{durationLabel(assignment, day)}</span>
            <Tag tone={assignment.status === 'cancelled' ? 'quiet' : ''}>
              {label(assignment.status)}
            </Tag>
          </div>
        </div>
      </div>)}
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
  return <article className="hr-assign-card">
    <div className="hr-assign-top">
      <div className="hr-assign-info">
        <div className="hr-assign-name-row">
          <span className="hr-assign-project">
            {project && openProject ? <button type="button" className="hr-project-link" onClick={() => openProject(project.id)} title="Open project in Sales">{project.title}</button> : project?.title ?? 'Project'}
          </span>
          <span className="hr-assign-pill">{label(assignment.status)}</span>
          {overdue && <span className="hr-assign-pill is-urgent">End overdue</span>}
        </div>
        <div className="hr-assign-meta">
          {assignment.pricing_line
            ? <span className="hr-assign-line">{assignment.pricing_line}</span>
            : <span>{assignment.position}</span>}
          <span aria-hidden="true">·</span>
          <span>{assignment.allocation_pct}%</span>
          <span aria-hidden="true">·</span>
          <span>{date(assignment.start_date)} → {assignment.end_date ? date(assignment.end_date) : 'open-ended'}</span>
        </div>
      </div>
      <div className="hr-assign-actions">
        <button type="button" className="btn secondary" aria-expanded={editing} onClick={() => { setEditing(current => !current); setClosing(false); }}>
          {editing ? 'Close' : 'Edit…'}
        </button>
        <button type="button" className="btn secondary" aria-expanded={closing} onClick={() => { setClosing(current => !current); setEditing(false); }}>
          {closing ? 'Close' : 'End or cancel…'}
        </button>
      </div>
    </div>
    {endTime !== null && <>
      <div className="hr-assign-track" aria-hidden="true">
        <span className="hr-assign-fill" style={{ width: `${limePct}%` }} />
        <span className="hr-assign-marker" style={{ left: `${limePct}%` }} />
      </div>
      <div className="hr-assign-scale">
        <span>{started ? `Started ${date(assignment.start_date)}` : `Starts ${date(assignment.start_date)}`}</span>
        <span className="hr-assign-progress">{overdue ? 'Planned end passed' : `${limePct}% elapsed`}</span>
        <span>{assignment.end_date ? `Planned end ${date(assignment.end_date)}` : 'Open-ended'}</span>
      </div>
    </>}
    {overdue && <p className="hr-assignment-note">
      <span aria-hidden="true">!</span>
      <span>Planned end passed <strong>{overdueDays} days ago</strong> and no ending has been recorded. End the assignment below or agree a new end date with the client.</span>
    </p>}
    {editing && <AssignmentEdit assignment={assignment} workspace={workspace} day={day} run={run} busy={busy} onClose={() => setEditing(false)} />}
    {closing && <AssignmentClose assignment={assignment} day={day} run={run} busy={busy} onClose={() => setClosing(false)} />}
  </article>;
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
  return <div className="hr-assign-close">
    <div className="hr-assign-close-head">
      <h4>Edit this assignment</h4>
      {project && <small className="hr-assign-summary">{project.title}{windowEnd ? ` · ends ${date(windowEnd)}` : ''}</small>}
    </div>
    <div className="hr-assign-grid">
      {profiles.length > 0 && <div className="hr-assign-field">
        <span>Pricing line</span>
        <select className="hr-assign-input" value={pricingLine} onChange={event => setPricingLine(event.target.value)}>
          <option value="">Whole project</option>
          {assignment.pricing_line && !profiles.some(line => line.name === assignment.pricing_line) && <option value={assignment.pricing_line}>{assignment.pricing_line} (removed line)</option>}
          {profiles.map(line => <option key={line.name} value={line.name}>{`${line.name} · ${lineRateLabel(line.tjm, project?.currency ?? 'EUR')}`}</option>)}
        </select>
        <small>The TJM profile this assignment bills against.</small>
      </div>}
      <div className="hr-assign-field">
        <span>Allocation (%)</span>
        <input type="number" className="hr-assign-input" min={1} max={100} value={allocation} onChange={event => setAllocation(event.target.value)} />
      </div>
      <div className="hr-assign-field">
        <span>Commitment</span>
        <select className="hr-assign-input" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          {(['proposed', 'reserved', 'confirmed', 'active'] as const).filter(item => !(cannotPropose && item === 'proposed')).map(item => <option key={item} value={item}>{label(item)}</option>)}
        </select>
        {cannotPropose && <small>Started commitments cannot return to proposed.</small>}
      </div>
      <div className="hr-assign-field">
        <span>Starts</span>
        <input type="date" className="hr-assign-input" value={startDate} min={startMin} max={endMax} onChange={event => setStartDate(event.target.value)} />
        {startMin && <small>No earlier than {date(startMin)}.</small>}
      </div>
      <div className="hr-assign-field">
        <span>Ends{endRequired ? '' : ', if known'}</span>
        <input type="date" className="hr-assign-input" value={endDate} min={startDate} max={endMax} onChange={event => setEndDate(event.target.value)} />
        {windowEnd
          ? <small>The project ends {date(windowEnd)}; an end date is required.</small>
          : <small>Leave empty for open-ended. Capacity is still checked against overlapping commitments.</small>}
      </div>
      <div className="hr-assign-field">
        <span>Change rationale</span>
        <textarea className="hr-assign-input" rows={2} placeholder="Why is this changing?" maxLength={5000} value={rationale} onChange={event => setRationale(event.target.value)} />
      </div>
    </div>
    <div className="hr-assign-foot">
      <span className="hr-assign-summary">{summary}</span>
      <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Discard</button>
      <button type="button" className="btn" disabled={!ready || busy || saving} onClick={() => void submit()}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
    {error && <p role="alert" className="hr-error">{error}</p>}
  </div>;
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
  const reasonField = <div className="hr-assign-field">
    <span>Reason</span>
    <div className="hr-choice-row">
      {ASSIGN_REASONS.map(item => <button key={item} type="button" className="hr-choice" aria-pressed={reason === item} onClick={() => setReason(item)}>
        {item}
      </button>)}
    </div>
    <textarea className="hr-assign-input" rows={2} placeholder="Add a note (optional)" maxLength={5000} value={note} onChange={event => setNote(event.target.value)} />
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
        rationale: note.trim() ? `${reason} — ${note.trim()}` : reason,
        cancel: !isEnd
      }, isEnd ? 'Assignment ended with history preserved.' : 'Assignment cancelled with history preserved.');
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <div className="hr-assign-close">
    <div className="hr-assign-close-head">
      <h4>Close this assignment</h4>
      <div className="hr-segmented" role="group" aria-label="Close mode">
        <button type="button" aria-pressed={isEnd} onClick={() => setMode('end')}>End</button>
        <button type="button" aria-pressed={!isEnd} onClick={() => setMode('cancel')}>Cancel</button>
      </div>
    </div>
    {isEnd && <div className="hr-assign-grid">
      <div className="hr-assign-field">
        <span>Actual end date</span>
        <div className="hr-choice-row">
          {assignment.end_date && <button type="button" className="hr-choice" aria-pressed={when === 'planned'} onClick={() => { setWhen('planned'); setCustomDate(''); }}>
            <strong>{date(assignment.end_date)}</strong>
            <small>Planned end</small>
          </button>}
          <button type="button" className="hr-choice" aria-pressed={when === 'today'} onClick={() => { setWhen('today'); setCustomDate(''); }}>
            <strong>{date(day)}</strong>
            <small>Today</small>
          </button>
        </div>
        <input type="date" className="hr-assign-input" value={customDate} min={assignment.start_date} max={lastAllowedDay} aria-label="Custom end date" onChange={event => { setWhen('custom'); setCustomDate(event.target.value); }} />
      </div>
      {reasonField}
    </div>}
    {!isEnd && cancellable && reasonField}
    {!isEnd && !cancellable && <div className="hr-assign-info">
      Cancelling removes an assignment that never started. This one started on {date(assignment.start_date)}, so it can only be ended.
    </div>}
    <div className="hr-assign-foot">
      <span className="hr-assign-summary">{summary}</span>
      <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Discard</button>
      <button type="button" className="btn" disabled={!ready || busy || saving} onClick={() => void submit()}>
        {saving ? 'Saving…' : isEnd ? 'End assignment' : 'Cancel assignment'}
      </button>
    </div>
    {error && <p role="alert" className="hr-error">{error}</p>}
  </div>;
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
    {employees.length > 1 && <label className="hr-field">
      <span>Employment period</span>
      <select value={current.id} onChange={event => setSelected(event.target.value)}>
        {employees.map(employee => <option value={employee.id} key={employee.id}>{employee.role} · {date(employee.start_date)}{employee.end_date && ` to ${date(employee.end_date)}`} · {label(employee.status)}</option>)}
      </select>
    </label>}
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
    <Form run={run} busy={busy} title="Add an activity note" button="Add note" success="Activity recorded. Recruitment stage aging is unchanged." reset submit={data => ({
      kind: 'add_note',
      person_id: person.id,
      rationale: text(data, 'rationale')
    })}>
      <Field name="rationale" label="Note" type="textarea" required />
    </Form>
    <Section title="Complete lifecycle timeline">
      {events.length ? <ol className="hr-timeline">
        {events.map(event => <li key={event.id}>
          <strong>
            {label(event.kind)}
            {event.next_state && ` · ${label(event.next_state)}`}
          </strong>
          <small>{new Date(event.created_at).toLocaleString()} · {event.actor_email}{event.application_id ? ' · Application' : event.employee_id ? ' · Employment' : ''}</small>
          <p>
            {event.rationale}
          </p>
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
  /** Borderless variant for the minimal Employment sections. */
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
  return <section className={bare ? 'hr-emp-ai' : 'hr-card hr-suggestion'}>
    <div className={bare ? 'hr-emp-ai-head' : 'hr-card-head'}>
      <div>
        <div className="hr-inline">
          <Sparkles size={16} aria-hidden="true" />
          <h3>
            {aiTitles[kind]}
          </h3>
        </div>
        {!bare && <p>AI uses this record's permitted evidence. Review the sources and edit the draft before applying it.</p>}
      </div>
      <button className={bare ? 'hr-emp-ghost plain' : 'btn secondary'} disabled={generating} onClick={() => void generate()}>
        {generating ? 'Preparing draft…' : cta ?? 'Generate draft'}
      </button>
    </div>
    {error && <p role="alert" className="hr-error">
      {error}
    </p>}
    {suggestions.slice(0, 3).map(suggestion => {
      const parsed = assistancePayloadSchema.safeParse(suggestion.payload);
      const sources = z.array(assistanceSourceSchema).safeParse(suggestion.sources);
      if (!parsed.success) return <p role="alert" key={suggestion.id}>This suggestion has an unsupported format and cannot be applied.</p>;
      const payload = parsed.data;
      const targetVersion = person.version;
      const stale = suggestion.status === 'stale' || suggestion.input_version !== targetVersion || !sources.success || sources.data.some(source => {
        const records = source.type === 'person' ? workspace.people : source.type === 'application' ? workspace.applications : source.type === 'employee' ? workspace.employees : source.type === 'opportunity' ? workspace.opportunities : source.type === 'task' ? workspace.tasks : source.type === 'assignment' ? workspace.assignments : source.type === 'project' ? workspace.projects : [];
        const record = records.find(item => item.id === source.id);
        return !record || record.version !== source.version;
      });
      return <div key={suggestion.id} style={{
        borderTop: '1px solid var(--qs-line)',
        paddingTop: 16,
        marginTop: 16
      }}>
        <div className="hr-card-head">
          <Tag tone={stale ? 'urgent' : suggestion.status === 'accepted' ? 'good' : 'quiet'}>
            {stale ? 'Source changed. Generate a fresh draft.' : label(suggestion.status)}
          </Tag>
          <small className="hr-source-list">{suggestion.model} · {date(suggestion.created_at)}</small>
        </div>
        <p>
          {payload.summary}
        </p>
        <ol>
          {payload.items.map((item, index) => <li key={index}>
            <strong>
              {item.title}
            </strong>
            <p>
              {item.detail}
            </p>
            <span className="hr-source-list">
              {item.source_ids.map(id => sourceDescription(workspace, id)).join(' · ') || 'No specific source cited'}
            </span>
          </li>)}
        </ol>
        {sources.success && <div className="hr-source-list">Sources: {sources.data.map(source => `${sourceDescription(workspace, source.id)} (version ${source.version})`).join(' · ')}</div>}
        {suggestion.status === 'draft' && <div className="hr-inline">
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
        {kind === 'onboarding_plan' && suggestion.status === 'accepted' && !stale && employee && <details className="hr-disclosure" style={{
          marginTop: 16
        }}>
          <summary>Review and add an individual task</summary>
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
            <label className="hr-checkbox"><input type="checkbox" name="required" />Required before completion</label>
          </Form>
        </details>}
        {kind === 'handover' && suggestion.status === 'accepted' && !stale && employee && <div className="hr-source-list" style={{
          marginTop: 16
        }}><AlertCircle size={13} aria-hidden="true" /> Copy and edit the draft in Exit details. Saving it is a separate action.</div>}
      </div>;
    })}
    {!suggestions.length && <p className="hr-source-list">No draft generated for this context yet.</p>}
  </section>;
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
