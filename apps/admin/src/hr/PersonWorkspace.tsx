import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '@clerk/react';
import { CheckCircle2, Circle, Plus, Sparkles, AlertCircle, FileText, Search } from 'lucide-react';
import { db, errorMessage } from '@quicksort/hr-db';
import type { Application, ApplicationStage, Assignment, Employee, Person, Requirement, SuggestionKind, Workspace } from './domain';
import { loadRequirements } from './data';
import { assistancePayloadSchema, assistanceSourceSchema, generateSuggestion, type AssistanceRequest } from './assist';
import { z } from 'zod';
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
export type RecordContext = {
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
  reload: () => Promise<void>;
  actorEmail: string;
  openProject?: (projectId: string) => void;
};
export type PersonTab = 'profile' | 'applications' | 'employment' | 'projects' | 'cra' | 'history';
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
    count: employees.length
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
      {activeTab === 'profile' && <Profile person={person} context={context} onNavigate={onNavigate} />}
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
      }), 'Profile updated.');
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
    n: employees.length,
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
  return <div className="hr-two-column hr-profile-columns">
    <form className="hr-profile-form" onSubmit={event => void onSubmit(event)}>
      <section className="hr-card hr-profile-card" key={`identity-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Identity</h2>
          <p>How this person appears across Quicksort</p>
        </div>
        <div className="hr-fields">
          <Field name="full_name" label="Full name" value={person.full_name} required />
          <Field name="headline" label="Professional headline" value={person.headline} />
        </div>
      </section>
      <section className="hr-card hr-profile-card" key={`contact-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Contact and ownership</h2>
          <p>Used for notifications, documents and access</p>
        </div>
        <div className="hr-fields">
          <Field name="email" label="Work email" type="email" value={person.email} />
          <Field name="phone" label="Phone" type="tel" value={person.phone} />
          <Field name="location" label="Location" value={person.location} />
          <Field name="owner_email" label="Record owner" type="email" value={person.owner_email || actorEmail} />
        </div>
      </section>
      <section className="hr-card hr-profile-card" key={`skills-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Skills</h2>
          <p>Matched against project staffing requests</p>
        </div>
        <SkillListField name="skills" label="Add skills" value={person.skills} placeholder="Type a skill, then press Enter" />
      </section>
      <section className="hr-card hr-profile-card" key={`languages-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Languages</h2>
          <p>Spoken and written levels, as presented to clients</p>
        </div>
        <SkillListField name="languages" label="Add a language" value={person.languages} placeholder="e.g. French — native, then press Enter" />
      </section>
      <section className="hr-card hr-profile-card" key={`degrees-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Degrees and education</h2>
          <p>Highest qualifications first</p>
        </div>
        <SkillListField name="degrees" label="Add a degree" value={person.degrees} placeholder="e.g. Master MIAGE — Université Paris-Dauphine" />
      </section>
      <section className="hr-card hr-profile-card" key={`certifications-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Certifications</h2>
          <p>Professional certificates and accreditations</p>
        </div>
        <SkillListField name="certifications" label="Add a certification" value={person.certifications} placeholder="e.g. PSM I — 2023" />
      </section>
      <section className="hr-card hr-profile-card" key={`notes-${fieldsKey}`}>
        <div className="hr-profile-card-head">
          <h2>Notes and consent</h2>
          <p>Internal context kept with the record</p>
        </div>
        <Field name="notes" label="Profile notes" type="textarea" value={person.notes} />
        <label className="hr-checkbox hr-wide"><input type="checkbox" name="contact_allowed" defaultChecked={person.contact_allowed} />Contact permitted for future opportunities</label>
      </section>
      <div className="hr-profile-save">
        <span>{message || 'Changes are saved when you submit.'}</span>
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
      {error && <p role="alert" className="hr-error">
        {error}
      </p>}
    </form>
    <aside className="hr-profile-aside">
      <section className="hr-card hr-profile-card">
        <div className="hr-profile-card-head hr-portal-head">
          <div>
            <h2>Portal account</h2>
            <p>Connects applications, offers and documents</p>
          </div>
          <span className={`hr-portal-state ${account ? 'is-linked' : ''}`}>{account ? 'Linked' : 'Not linked'}</span>
        </div>
        {account ? <div className="hr-portal-linked">
          <p>Profile ID <strong>{account.profile_id}</strong></p>
          <p>Linked {date(account.linked_at)}</p>
        </div> : <AccountLinker person={person} workspace={workspace} run={run} busy={busy} />}
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
      <AiPanel person={person} workspace={workspace} run={run} reload={reload} kind="alumni_reconnect" />
    </aside>
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
  if (!current) return <Empty>No employment period yet. Complete hiring from an application to begin preboarding.</Empty>;
  return <>
    <label className="hr-field">
      <span>Employment period</span>
      <select value={current.id} onChange={event => setSelected(event.target.value)}>
        {employees.map(employee => <option value={employee.id} key={employee.id}>{employee.role} · {date(employee.start_date)}{employee.end_date && ` to ${date(employee.end_date)}`} · {label(employee.status)}</option>)}
      </select>
    </label>
    <EmploymentDetail key={current.id} person={person} employee={current} context={context} />
  </>;
}
export function EmploymentDetail({
  person,
  employee,
  context
}: {
  person: Person;
  employee: Employee;
  context: RecordContext;
}) {
  const {
    workspace,
    run,
    busy,
    reload
  } = context;
  const tasks = workspace.tasks.filter(task => task.employee_id === employee.id);
  const reviews = workspace.reviews.filter(review => review.employee_id === employee.id);
  const exit = workspace.exits.find(record => record.employee_id === employee.id);
  const ended = employee.status === 'ended';
  return <>
    <div className="hr-card">
      <div className="hr-card-head">
        <div>
          <h3>
            {employee.role}
          </h3>
          <small>
            {date(employee.start_date)}
            {employee.end_date && ` to ${date(employee.end_date)}`}
          </small>
        </div>
        <Tag tone={ended ? 'quiet' : 'good'}>
          {label(employee.status)}
        </Tag>
      </div>
      <div className="hr-stat-line">
        <div>
          <small>Manager</small>
          {employee.manager_email || 'Not set'}
        </div>
        <div>
          <small>Buddy</small>
          {employee.parrain || 'Not set'}
        </div>
        <div>
          <small>Onboarding</small>
          {employee.onboarding_completed_at ? `Completed ${date(employee.onboarding_completed_at)}` : 'In progress'}
        </div>
        <div><small>Probation</small>{label(employee.probation_status)} · {date(employee.probation_end)}</div>
      </div>
      <div className="hr-inline">
        {employee.status === 'preboarding' && <Action run={run} disabled={busy} input={{
          kind: 'start_onboarding',
          employee_id: employee.id,
          expected_version: employee.version
        }} success="Onboarding started.">Start onboarding</Action>}
        {!ended && !employee.onboarding_completed_at && <Action run={run} disabled={busy} input={{
          kind: 'complete_onboarding',
          employee_id: employee.id,
          expected_version: employee.version
        }} success="Onboarding completed. Probation remains a separate decision.">Complete onboarding</Action>}
      </div>
      {!ended && workspace.capabilities.recruit && <Form run={run} busy={busy} button="Save manager and buddy" success="Manager and buddy updated." submit={data => ({
        kind: 'update_employment',
        employee_id: employee.id,
        expected_version: employee.version,
        manager_email: text(data, 'manager_email'),
        parrain: text(data, 'parrain')
      })}>
        <Field name="manager_email" label="Manager email" type="email" value={employee.manager_email} />
        <Field name="parrain" label="Buddy" value={employee.parrain} />
      </Form>}
      {employee.status === 'preboarding' && <details className="hr-disclosure">
        <summary>Cancel hire — candidate renounced</summary>
        <Form run={run} busy={busy} button="Cancel hire" success="Hire cancelled. Employment closed, application withdrawn and commitments released." submit={data => ({
          kind: 'cancel_hire',
          employee_id: employee.id,
          expected_version: employee.version,
          rationale: text(data, 'rationale')
        })}>
          <Field name="rationale" label="Renunciation rationale" type="textarea" required />
        </Form>
      </details>}
    </div>
    <Section title="Journey checklist" detail={`${tasks.filter(task => task.completed_at).length} of ${tasks.length} complete. Required tasks and dependencies are enforced when closing the journey.`}>
      {!tasks.length && <Empty>No journey tasks yet.</Empty>}
      {tasks.map(task => <div className="hr-card" key={task.id}>
        <div className="hr-card-head">
          <div>
            <h3>
              {task.title}
            </h3>
            <small>{label(task.phase)} · {task.assignee || 'Unassigned'} · Due {date(task.due_date)}</small>
          </div>
          <div className="hr-inline">
            {task.required && <Tag>Required</Tag>}
            <Tag tone={task.completed_at ? 'good' : task.due_date && task.due_date < today() ? 'urgent' : 'quiet'}>
              {task.completed_at ? 'Complete' : 'Open'}
            </Tag>
          </div>
        </div>
        {task.dependency_id && <p>Depends on {tasks.find(item => item.id === task.dependency_id)?.title ?? 'another task'}.</p>}
        {task.evidence && <p>
          {task.evidence}
        </p>}
        {!task.completed_at && !ended && <Form run={run} busy={busy} button="Complete task" success="Task evidence recorded." submit={data => ({
          kind: 'complete_task',
          task_id: task.id,
          expected_version: task.version,
          evidence: text(data, 'evidence')
        })}>
          <Field name="evidence" label="Completion evidence" value={task.evidence} required />
        </Form>}
        {!task.completed_at && !ended && <details className="hr-disclosure" style={{ marginTop: 12 }}>
          <summary>Edit task, owner or deadline</summary>
          <Form run={run} busy={busy} button="Save task changes" success="Task ownership and schedule updated." submit={(data) => ({
            kind: 'save_task', employee_id: employee.id, task_id: task.id,
            expected_version: task.version, title: text(data, 'title'),
            phase: text(data, 'phase'), assignee: text(data, 'assignee'),
            due_date: nullable(data, 'due_date'), dependency_id: nullable(data, 'dependency_id'),
            required: checked(data, 'required'), evidence: text(data, 'evidence'),
          })}>
            <Field name="title" label="Task title" value={task.title} required />
            <Field name="phase" label="Phase" value={task.phase} options={options(['preboarding', 'onboarding', 'probation'])} required />
            <Field name="assignee" label="Task owner" value={task.assignee} required />
            <Field name="due_date" label="Due date" type="date" value={task.due_date} />
            <Field name="dependency_id" label="Depends on task" value={task.dependency_id} options={tasks.filter((item) => item.id !== task.id).map((item) => ({ value: item.id, label: item.title }))} />
            <label className="hr-checkbox"><input type="checkbox" name="required" defaultChecked={task.required} />Required before completion</label>
            <Field name="evidence" label="Progress evidence" type="textarea" value={task.evidence} />
          </Form>
        </details>}
      </div>)}
      {!ended && <details className="hr-disclosure">
        <summary>Add a journey task</summary>
        <Form run={run} busy={busy} button="Add task" success="Journey task added." reset submit={data => ({
          kind: 'save_task',
          employee_id: employee.id,
          title: text(data, 'title'),
          phase: text(data, 'phase'),
          assignee: text(data, 'assignee'),
          due_date: nullable(data, 'due_date'),
          dependency_id: nullable(data, 'dependency_id'),
          required: checked(data, 'required')
        })}>
          <Field name="title" label="Task" required />
          <Field name="phase" label="Phase" value="onboarding" options={options(['preboarding', 'onboarding', 'probation'])} required />
          <Field name="assignee" label="Owner email" type="email" value={context.actorEmail} required />
          <Field name="due_date" label="Due date" type="date" />
          <Field name="dependency_id" label="Depends on task" options={tasks.map(task => ({
            value: task.id,
            label: task.title
          }))} />
          <label className="hr-checkbox"><input type="checkbox" name="required" defaultChecked />Required before phase completion</label>
        </Form>
      </details>}
      {!ended && <div style={{
        marginTop: 20
      }}>
        <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="onboarding_plan" />
      </div>}
    </Section>
    <Section title="Probation and reviews" detail="Onboarding completion does not confirm probation. A held review records the human outcome.">
      {reviews.map(review => <div className="hr-card" key={review.id}>
        <div className="hr-card-head">
          <div>
            <h3>{label(review.kind)} review</h3>
            <small>Due {date(review.due_date)}</small>
          </div>
          <Tag tone={review.status === 'held' ? 'good' : 'quiet'}>
            {label(review.status)}
          </Tag>
        </div>
        {review.status === 'held' ? <p>{label(review.outcome)} · {review.rationale}</p> : !ended && <Form run={run} busy={busy} button="Record held review" success="Review decision recorded." submit={data => ({
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
        </Form>}
      </div>)}
      {!reviews.length && <Empty>No reviews scheduled.</Empty>}
      {!ended && <details className="hr-disclosure">
        <summary>Schedule a review</summary>
        <Form run={run} busy={busy} button="Schedule review" success="Review scheduled." submit={data => ({
          kind: 'schedule_review',
          employee_id: employee.id,
          review_kind: text(data, 'review_kind'),
          due_date: text(data, 'due_date')
        })}>
          <Field name="review_kind" label="Review type" value="probation" options={options(['probation', 'annual'])} required />
          <Field name="due_date" label="Due date" type="date" value={employee.probation_end} required />
        </Form>
      </details>}
    </Section>
    <Section title={exit ? 'Departure and handover' : 'Offboarding'} detail="A completed exit closes assignments and preserves the employment period.">
      {exit ? <>
        <div className="hr-card">
          <div className="hr-card-head">
            <h3>{label(exit.kind)} · {date(exit.exit_date)}</h3>
            <Tag tone={exit.status === 'completed' ? 'good' : 'quiet'}>
              {label(exit.status)}
            </Tag>
          </div>
          {exit.status === 'completed' && <>
            <p>
              {exit.handover_plan}
            </p>
            <p>Rehire {exit.rehire_eligible === null ? 'not assessed' : exit.rehire_eligible ? 'eligible' : 'ineligible'} · {exit.rehire_rationale}</p>
          </>}
        </div>
        {exit.status === 'open' && <>
          <Form key={`exit-${exit.id}`} run={run} busy={busy} title="Exit evidence" button="Save exit evidence" success="Exit evidence saved." submit={data => ({
            kind: 'save_exit',
            exit_id: exit.id,
            expected_version: exit.version,
            handover_plan: text(data, 'handover_plan'),
            successor: text(data, 'successor'),
            exit_interview: text(data, 'exit_interview'),
            rehire_eligible: text(data, 'rehire_eligible') === '' ? null : text(data, 'rehire_eligible') === 'yes',
            rehire_rationale: text(data, 'rehire_rationale'),
            legal_docs_evidence: text(data, 'legal_docs_evidence')
          })}>
            <Field name="handover_plan" label="Handover plan and evidence" type="textarea" value={exit.handover_plan} required />
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
            <Field name="legal_docs_evidence" label="Legal documents delivery evidence" type="textarea" value={exit.legal_docs_evidence} required />
          </Form>
          {workspace.exitItems.filter(item => item.offboarding_id === exit.id).map(item => <div className="hr-card" key={item.id}>
            <div className="hr-card-head">
              <h3>
                {item.title}
              </h3>
              <Tag tone={item.completed_at ? 'good' : 'quiet'}>
                {item.completed_at ? 'Complete' : item.required ? 'Required' : 'Optional'}
              </Tag>
            </div>
            {item.completed_at ? <p>
              {item.evidence}
            </p> : <Form run={run} busy={busy} button="Complete exit task" success="Exit task completed." submit={data => ({
              kind: 'complete_exit_item',
              item_id: item.id,
              expected_version: item.version,
              evidence: text(data, 'evidence')
            })}>
              <Field name="evidence" label="Completion evidence" value={item.evidence} required />
            </Form>}
          </div>)}
          <details className="hr-disclosure">
            <summary>Add an exit task</summary>
            <Form run={run} busy={busy} button="Add exit task" success="Exit task added." submit={data => ({
              kind: 'save_exit_item',
              exit_id: exit.id,
              title: text(data, 'title'),
              required: checked(data, 'required')
            })}>
              <Field name="title" label="Task" required />
              <label className="hr-checkbox"><input type="checkbox" name="required" defaultChecked />Required before closing exit</label>
            </Form>
          </details>
          <div style={{
            marginTop: 20
          }}>
            <AiPanel person={person} employee={employee} workspace={workspace} run={run} reload={reload} kind="handover" />
          </div>
          <div className="hr-card">
            <p>Complete required tasks, record a handover, legal-document evidence and a rehire decision before closing. Existing assignments will end at the exit date.</p>
            <Action run={run} disabled={busy} input={{
              kind: 'complete_exit',
              exit_id: exit.id,
              expected_version: exit.version
            }} success="Exit completed. Assignments ended and the person remains in Alumni.">Complete exit</Action>
          </div>
        </>}
      </> : !ended && <details className="hr-disclosure">
        <summary>Open an exit workflow</summary>
        <Form run={run} busy={busy} button="Open offboarding" success="Offboarding opened and employment state updated." submit={data => ({
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
        </Form>
      </details>}
    </Section>
  </>;
}
export function AssignForm({
  employee,
  workspace,
  run,
  busy
}: {
  employee: Employee;
  workspace: Workspace;
  run: RunCommand;
  busy: boolean;
}) {
  const projects = workspace.projects.filter(project => !['closed', 'cancelled', 'completed'].includes(project.status));
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const project = projects.find(item => item.id === projectId);
  // hr_command rejects dates outside the project window ('Assignment dates
  // must fit the project window.'); mirror the rule in the pickers so only
  // valid days can be chosen, and re-check in submit as a last line of defence.
  const windowStart = project?.start_date ?? null;
  const windowEnd = project?.end_date ?? null;
  const bounds = [employee.start_date, windowStart].filter((day): day is string => !!day).sort();
  const startMin = bounds.length ? bounds[bounds.length - 1] : undefined;
  const day = today();
  let startDefault = employee.start_date > day ? employee.start_date : day;
  if (windowStart && startDefault < windowStart) startDefault = windowStart;
  if (windowEnd && startDefault > windowEnd) startDefault = windowEnd;
  const windowHint = [windowStart ? `starts ${date(windowStart)}` : null, windowEnd ? `ends ${date(windowEnd)}` : null].filter(Boolean).join(' · ');
  return <Form run={run} busy={busy} button="Create assignment" success="Dated assignment recorded. Capacity was checked before saving." submit={data => {
    const startDay = text(data, 'start_date');
    const endDay = nullable(data, 'end_date');
    if (project && ((project.start_date && startDay < project.start_date) || (project.end_date && (!endDay || endDay > project.end_date)))) {
      throw new Error('Assignment dates must fit the project window.');
    }
    return {
      kind: 'assign_project',
      employee_id: employee.id,
      project_id: text(data, 'project_id'),
      position: text(data, 'position'),
      allocation_pct: number(data, 'allocation_pct'),
      start_date: startDay,
      end_date: endDay,
      status: text(data, 'status')
    };
  }}>
    <Field name="project_id" label="Project" value={projects[0]?.id} options={projects.map(project => ({
      value: project.id,
      label: project.title
    }))} onChange={setProjectId} hint={windowHint ? `Project window: ${windowHint}. Assignment dates must fit inside it.` : 'This project has no delivery dates yet.'} required />
    <Field name="position" label="Project role" value={employee.role} required />
    <Field name="allocation_pct" label="Allocation (%)" type="number" min={1} max={100} value={100} required />
    <Field name="status" label="Commitment" value="confirmed" options={options(['proposed', 'reserved', 'confirmed', 'active'])} required />
    <Field name="start_date" label="Starts" type="date" min={startMin} max={windowEnd ?? undefined} value={startDefault} required />
    <Field name="end_date" label="Ends, if known" type="date" min={startMin} max={windowEnd ?? undefined} hint={windowEnd ? `No later than ${date(windowEnd)}, when the project ends. Capacity includes open-ended confirmed commitments.` : 'Capacity includes open-ended confirmed commitments.'} />
  </Form>;
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
  const filtered = history.filter(assignment => filter === 'all' || (filter === 'cancelled') === (assignment.status === 'cancelled'));
  const bookedToday = open
    .filter(assignment => assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))
    .reduce((sum, assignment) => sum + assignment.allocation_pct, 0);
  const availableToday = Math.max(0, 100 - bookedToday);
  const projectCount = new Set(assignments.map(assignment => assignment.project_id)).size;
  const daysOnProjects = assignments.reduce((sum, assignment) => sum + spanDays(assignment, day), 0);
  const nextAvailability = live
    .map(employee => nextFree(workspace, employee, day))
    .filter(slot => slot !== null)
    .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
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
        <strong>{bookedToday}%</strong>
        <div className="hr-person-meter" aria-hidden="true">
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
    </section>
    <section>
      <div className="hr-person-section-head">
        <h2>Active assignments</h2>
        {!!live.length && <button type="button" className="btn hr-person-assign-btn" aria-expanded={assignOpen} onClick={() => setAssignOpen(current => !current)}>
          <Plus size={16} aria-hidden="true" /> Assign to project
        </button>}
      </div>
      {assignOpen && live.map(employee => <div className="hr-assign-panel" key={employee.id}>
        <div className="hr-assign-panel-head">
          <h3>New assignment · {employee.role}</h3>
          <button type="button" className="hr-assign-panel-cancel" onClick={() => setAssignOpen(false)}>Cancel</button>
        </div>
        <AssignForm employee={employee} workspace={workspace} run={run} busy={busy} />
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
              <span>{assignment.position}</span>
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
          <span>{assignment.position}</span>
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
  const [position, setPosition] = useState(assignment.position);
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
  const changed = position.trim() !== assignment.position
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
          : `Saves ${position.trim() || 'role'} · ${allocationNum}% · ${label(status)} · ${date(startDate)} → ${endDate ? date(endDate) : 'open-ended'}`;
  async function submit() {
    if (!ready || saving) return;
    setSaving(true);
    setError('');
    try {
      await run({
        kind: 'update_assignment',
        assignment_id: assignment.id,
        expected_version: assignment.version,
        position: position.trim(),
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
      <div className="hr-assign-field">
        <span>Project role</span>
        <input className="hr-assign-input" value={position} maxLength={200} onChange={event => setPosition(event.target.value)} />
      </div>
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
    <CraScreen audience="admin" draftOwner={context.actorEmail} fixedEmployeeId={current.id} />
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
  kind
}: {
  person: Person;
  application?: Application;
  employee?: Employee;
  workspace: Workspace;
  run: RunCommand;
  reload: () => Promise<void>;
  kind: AssistanceRequest['kind'];
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
  return <section className="hr-card hr-suggestion">
    <div className="hr-card-head">
      <div>
        <div className="hr-inline">
          <Sparkles size={16} aria-hidden="true" />
          <h3>
            {aiTitles[kind]}
          </h3>
        </div>
        <p>AI uses this record's permitted evidence. Review the sources and edit the draft before applying it.</p>
      </div>
      <button className="btn secondary" disabled={generating} onClick={() => void generate()}>
        {generating ? 'Preparing draft…' : 'Generate draft'}
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
        }}><AlertCircle size={13} aria-hidden="true" /> Copy and edit the draft in Exit evidence. Saving that evidence is a separate action.</div>}
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
