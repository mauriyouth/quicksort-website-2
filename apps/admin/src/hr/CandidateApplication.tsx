import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@clerk/react';
import { ArrowUpRight, GraduationCap, X } from 'lucide-react';
import { z } from 'zod';
import { errorMessage } from '@quicksort/hr-db';
import { Button, Input, NativeSelect, NativeSelectOption, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, Textarea } from '@quicksort-sas/ui';
import { cn } from 'cn';
import { parsedProfileSchema, type ExperienceItem } from '../candidate-intake';
import { linkButton } from '../ui';
import type { Application, ApplicationStage, Event, Person } from './domain';
import { Readiness, stages, type RecordContext } from './PersonWorkspace';
import { findCv, type FiledCv } from './recruitmentCv';
import { Dialog, Empty, Field, Form, date, initials, label, text } from './ui';

/**
 * Applications tab of a person record: one application at a time, its
 * pipeline stepper, the candidate context (resume, experience, skills,
 * credentials, activity) and the stage decision panel. The application's
 * interviews, offers, contract and hire sections render below (`records`).
 */

const card = 'rounded-xl border border-border bg-card text-card-foreground';
const cardTitle = 'm-0 text-base font-semibold';
const quiet = 'text-[13px] text-muted-foreground';
const SIGNALS = ['Skills match the role', 'Right seniority', 'Relevant experience', 'Location works', 'Strong referral'];
const REASONS = ['Skills gap', 'Not senior enough', 'Salary expectations', 'Location / remote', 'Culture or motivation', 'Other'];

const listed = (raw: string) => raw.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
const lines = (raw: string) => raw.split('\n').map(item => item.trim()).filter(Boolean);
/** "English — C1", "MSc Data Science · Sorbonne · 2019" → ["English", "C1"]… */
const parts = (line: string) => line.split(/\s+[—–·|]\s+|\s+-\s+|\s*:\s+/).map(part => part.trim()).filter(Boolean);
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
/** Two-letter badge: initials of several words, else the first two letters ("Contoso" → "CO"). */
const badge = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? initials(name) : name.trim().slice(0, 2)).toUpperCase();
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function months(start: string, end: string) {
  const [sy, sm] = start.split('-').map(Number);
  const now = new Date();
  const [ey, em] = end ? end.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
  if (!sy || !ey) return 0;
  return Math.max(0, (ey - sy) * 12 + ((em || 1) - (sm || 1)) + 1);
}
function duration(total: number) {
  const years = Math.floor(total / 12), rest = total % 12;
  return [years ? `${years} yr${years === 1 ? '' : 's'}` : '', rest ? `${rest} mo${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '< 1 mo';
}
function monthLabel(value: string) {
  const [y, m] = value.split('-').map(Number);
  if (!y) return '';
  return m ? new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : String(y);
}
const newestFirst = (items: ExperienceItem[]) => [...items].sort((a, b) => (b.end ? b.start : '9999').localeCompare(a.end ? a.start : '9999') || b.start.localeCompare(a.start));

function Pill({ selected, danger, dashed, children, ...props }: { selected?: boolean; danger?: boolean; dashed?: boolean } & React.ComponentProps<'button'>) {
  return <button type="button" aria-pressed={dashed ? undefined : !!selected} className={cn('min-h-9 rounded-full border px-3.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', selected ? danger ? 'border-destructive bg-destructive font-semibold text-white' : 'border-foreground bg-foreground font-semibold text-background' : dashed ? 'border-dashed border-faint bg-card hover:border-foreground' : 'border-border bg-card hover:border-faint')} {...props}>
    {children}
  </button>;
}
function CardHead({ title, level = 2, action }: { title: string; level?: 2 | 3; action?: ReactNode }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
    <Heading className={level === 2 ? cardTitle : 'm-0 text-sm font-semibold'}>{title}</Heading>
    {action}
  </div>;
}
function AddButton({ onClick, children = '+ Add' }: { onClick: () => void; children?: ReactNode }) {
  return <Button type="button" variant="ghost" size="sm" onClick={onClick}>{children}</Button>;
}
/** One-line inline adder used by skills, languages, education and certifications. */
function InlineAdd({ label: title, placeholder, onSave, onCancel, busy }: { label: string; placeholder: string; onSave: (value: string) => Promise<void>; onCancel: () => void; busy: boolean }) {
  const [value, setValue] = useState('');
  return <form className="flex flex-wrap gap-2" onSubmit={event => {
    event.preventDefault();
    if (value.trim()) void onSave(value.trim()).then(onCancel, () => {});
  }}>
    <Input aria-label={title} autoFocus className="min-w-0 flex-1 basis-48" value={value} placeholder={placeholder} onChange={event => setValue(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') onCancel();
    }} />
    <Button type="submit" size="sm" disabled={busy || !value.trim()}>Add</Button>
    <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
  </form>;
}

export function CandidateApplication({ person, context, initialId, records }: {
  person: Person;
  context: RecordContext;
  initialId?: string | null;
  records: (application: Application) => ReactNode;
}) {
  const { workspace, run, busy } = context;
  const applications = workspace.applications.filter(application => application.person_id === person.id);
  const [selected, setSelected] = useState(initialId ?? applications[0]?.id ?? '');
  const current = applications.find(application => application.id === selected) ?? applications[0];
  const [target, setTarget] = useState<ApplicationStage | ''>('');
  const [done, setDone] = useState<{ text: string; undo: () => Promise<unknown> } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [cv, setCv] = useState<FiledCv | null | undefined>(undefined);
  const [cvError, setCvError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const { session } = useSession();
  // Stable token getter: the CV lookup must not re-run when the session object is re-created.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const getToken = useCallback(() => sessionRef.current?.getToken({ template: 'supabase' }) ?? Promise.resolve(null), []);
  const signedIn = !!session;
  useEffect(() => {
    let cancelled = false;
    setCv(undefined);
    setCvError('');
    void findCv(getToken, person.id).then(file => {
      if (!cancelled) setCv(file);
    }).catch(failure => {
      if (!cancelled) {
        setCvError(errorMessage(failure));
        setCv(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [person.id, getToken, signedIn]);
  const currentId = current?.id;
  useEffect(() => {
    setTarget('');
    setDone(null);
  }, [currentId]);

  if (!current) return <>
    <Empty>No application yet. Add this person to a hiring need from Recruitment to start one.</Empty>
    <CandidateContext person={person} context={context} cv={cv} cvError={cvError} preview={() => setPreviewing(true)} getToken={getToken} />
    <ResumePreview person={person} cv={cv} open={previewing} close={() => setPreviewing(false)} />
  </>;

  const opportunity = workspace.opportunities.find(item => item.id === current.opportunity_id);
  const active = current.status === 'active';
  const stageIndex = stages.indexOf(current.stage);
  const next = stages[stageIndex + 1] as ApplicationStage | undefined;
  const moveTarget = target && stages.indexOf(target) > stageIndex ? target : next ?? '';
  const latest = () => context.workspace.applications.find(item => item.id === current.id) ?? current;
  const advanced = async (from: ApplicationStage, to: ApplicationStage) => {
    setTarget('');
    setDone({
      text: `Moved to ${label(to)}`,
      undo: () => run({ kind: 'move_application', application_id: current.id, expected_version: latest().version, to_stage: from, rationale: `Undo of the move to ${label(to)}` }, `Moved back to ${label(from)}.`)
    });
  };
  const closed = (status: string) => setDone({
    text: `Application closed · ${label(status)}`,
    undo: () => run({ kind: 'reopen_application', application_id: current.id, expected_version: latest().version, rationale: 'Undo of the disposition' }, 'Application reopened.')
  });
  const age = daysSince(current.stage_entered_at);

  return <div className="flex min-w-0 flex-col gap-5">
    <section aria-label="Application" className={cn(card, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2">
          <label htmlFor={`application-${person.id}`} className="label-mono">Application</label>
          <NativeSelect id={`application-${person.id}`} className="min-w-0 font-semibold" value={current.id} onChange={event => setSelected(event.target.value)}>
            {applications.map(application => <NativeSelectOption value={application.id} key={application.id}>
              {workspace.opportunities.find(item => item.id === application.opportunity_id)?.title ?? 'Hiring need'}{applications.length > 1 ? ` · ${date(application.created_at)}` : ''}
            </NativeSelectOption>)}
          </NativeSelect>
          <StatusTag status={current.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {person.email && <a className={linkButton({ variant: 'outline', size: 'sm' })} href={`mailto:${person.email}`}>Email</a>}
          {active && <Button variant="outline" size="sm" onClick={() => setScheduling(true)}>Schedule interview</Button>}
        </div>
      </div>
      <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-border px-5 py-2.5', quiet)}>
        <span>Opened {date(current.created_at)}</span>
        {active && <span>· {plural(age, 'day')} in current stage</span>}
        <span>·</span>
        <OwnerControl application={current} context={context} />
      </div>
      <ol aria-label="Pipeline stages" className="m-0 grid list-none grid-cols-[repeat(8,minmax(112px,1fr))] gap-1.5 overflow-x-auto p-4 px-5">
        {stages.map((stage, index) => {
          const isDone = index < stageIndex || current.status === 'hired';
          const isCurrent = index === stageIndex && current.status !== 'hired';
          const isTarget = active && index === stages.indexOf(moveTarget as ApplicationStage) && index > stageIndex;
          const pickable = active && index > stageIndex;
          const tag = isDone ? 'Done' : isCurrent ? active ? 'Current' : 'Closed' : isTarget ? 'Moving to' : `Step ${index + 1}`;
          return <li key={stage} className="min-w-0">
            <button type="button" aria-disabled={!pickable || undefined} aria-current={isCurrent ? 'step' : undefined} onClick={() => {
              if (pickable) setTarget(stage);
            }} className={cn('flex min-h-16 w-full flex-col gap-0.5 rounded-lg px-2.5 pb-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', isCurrent && (active ? 'bg-pivot/15' : 'bg-destructive/5'), isTarget && 'bg-muted', pickable ? 'cursor-pointer hover:bg-muted' : 'cursor-default', !isDone && !isCurrent && !isTarget && 'text-muted-foreground')}>
              <span aria-hidden="true" className={cn('mb-2 block h-1 rounded-sm', isDone ? 'bg-foreground' : isCurrent ? active ? 'bg-pivot' : 'bg-destructive' : isTarget ? 'bg-[repeating-linear-gradient(90deg,var(--foreground)_0_6px,transparent_6px_10px)]' : 'bg-border')} />
              <span className="label-mono">{tag}</span>
              <span className="text-sm font-semibold">{label(stage)}</span>
            </button>
          </li>;
        })}
      </ol>
    </section>

    {done && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-foreground px-4 py-3.5 text-background">
      <span>{done.text}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" className="border border-background/40 text-background hover:bg-background/10 hover:text-background" disabled={busy} onClick={() => void done.undo().then(() => setDone(null), () => {})}>Undo</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Dismiss" className="text-background hover:bg-background/10 hover:text-background" onClick={() => setDone(null)}><X aria-hidden="true" /></Button>
      </div>
    </div>}

    <div className="grid items-start gap-5 @min-[46rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,21rem)]">
      <div className="order-2 flex min-w-0 flex-col gap-5 @min-[46rem]:order-1">
        <CandidateContext person={person} context={context} application={current} cv={cv} cvError={cvError} preview={() => setPreviewing(true)} getToken={getToken} />
      </div>
      <div className="order-1 flex min-w-0 flex-col gap-5 @min-[46rem]:sticky @min-[46rem]:top-20 @min-[46rem]:order-2">
        {active
          ? <DecisionPanel key={current.id} application={current} context={context} target={moveTarget} setTarget={setTarget} onAdvanced={advanced} onClosed={closed} />
          : <ClosedPanel application={current} context={context} onReopened={() => setDone(null)} />}
      </div>
    </div>

    {records(current)}

    {scheduling && <Dialog title={`Schedule an interview · ${person.full_name}`} close={() => setScheduling(false)}>
      <Form run={async (input, success) => {
        const result = await run(input, success);
        setScheduling(false);
        return result;
      }} busy={busy} button="Schedule interview" success="Interview recorded. Send the calendar invitation manually." submit={data => ({
        kind: 'schedule_interview',
        application_id: current.id,
        interview_kind: text(data, 'interview_kind') as 'hr' | 'technical' | 'client',
        scheduled_at: new Date(text(data, 'scheduled_at')).toISOString(),
        panel: text(data, 'panel'),
        location: text(data, 'location')
      })}>
        <Field name="interview_kind" label="Interview type" options={['hr', 'technical', 'client'].map(value => ({ value, label: label(value) }))} required />
        <Field name="scheduled_at" label="Date and time" type="datetime-local" required />
        <Field name="panel" label="Interview panel" required hint="Names or email addresses of the interviewers." />
        <Field name="location" label="Meeting link or location" />
      </Form>
    </Dialog>}
    <ResumePreview person={person} cv={cv} open={previewing} close={() => setPreviewing(false)} />
  </div>;
}

function StatusTag({ status }: { status: Application['status'] }) {
  return <span className={cn('label-mono rounded px-2 py-1', status === 'active' ? 'bg-pivot/25 text-foreground' : status === 'hired' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}>{label(status)}</span>;
}

function OwnerControl({ application, context }: { application: Application; context: RecordContext }) {
  const { run, busy, actorEmail } = context;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(application.owner_email || actorEmail);
  if (!editing) return <span className="inline-flex items-center gap-1">
    Owner:
    <Button variant="link" size="xs" className="h-auto px-0 text-[13px] text-foreground" onClick={() => {
      setValue(application.owner_email || actorEmail);
      setEditing(true);
    }}>{application.owner_email || 'Assign'}</Button>
  </span>;
  return <form className="inline-flex flex-wrap items-center gap-1.5" onSubmit={event => {
    event.preventDefault();
    void run({ kind: 'assign_application_owner', application_id: application.id, expected_version: application.version, owner_email: value.trim() }, '').then(() => setEditing(false), () => {});
  }}>
    <label htmlFor={`owner-${application.id}`}>Owner:</label>
    <Input id={`owner-${application.id}`} type="email" autoFocus className="h-8 w-60" value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => {
      if (event.key === 'Escape') setEditing(false);
    }} />
    <Button type="submit" size="sm" disabled={busy}>Save</Button>
    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
  </form>;
}

function DecisionPanel({ application, context, target, setTarget, onAdvanced, onClosed }: {
  application: Application;
  context: RecordContext;
  target: ApplicationStage | '';
  setTarget: (stage: ApplicationStage) => void;
  onAdvanced: (from: ApplicationStage, to: ApplicationStage) => void;
  onClosed: (status: string) => void;
}) {
  const { workspace, run, busy } = context;
  const [mode, setMode] = useState<'advance' | 'reject'>('advance');
  const [signals, setSignals] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [disposition, setDisposition] = useState<'rejected' | 'withdrawn'>('rejected');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [ready, setReady] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const onLoaded = useCallback((value: boolean) => setReady(value), []);
  useEffect(() => setReady(null), [target]);
  const stageIndex = stages.indexOf(application.stage);
  const targets = stages.slice(stageIndex + 1);
  const canAdvance = !!target && comment.trim().length > 0 && ready !== false && !saving && !busy;
  const canClose = (!!reason || details.trim().length > 0) && !saving && !busy;
  const tab = (on: boolean) => cn('min-h-10 rounded-[7px] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground');
  async function submit(action: () => Promise<unknown>, after: () => void) {
    setSaving(true);
    setError('');
    try {
      await action();
      after();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }
  return <section aria-label="Stage decision" className={cn(card, 'flex flex-col gap-[18px] border-faint p-5')}>
    <div className="flex flex-col gap-1">
      <h2 className={cardTitle}>Decision</h2>
      <span className={quiet}>Currently in <strong className="font-semibold text-foreground">{label(application.stage)}</strong></span>
    </div>
    <div role="tablist" aria-label="Decision type" className="grid grid-cols-2 gap-1 rounded-[10px] bg-muted p-1">
      <button type="button" role="tab" aria-selected={mode === 'advance'} className={tab(mode === 'advance')} onClick={() => setMode('advance')}>Advance</button>
      <button type="button" role="tab" aria-selected={mode === 'reject'} className={tab(mode === 'reject')} onClick={() => setMode('reject')}>Reject or close</button>
    </div>

    {mode === 'advance' && (targets.length ? <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Move to</span>
        <div className="flex flex-wrap gap-1.5">
          {targets.map((stage, index) => <Pill key={stage} selected={stage === target} onClick={() => setTarget(stage)}>{label(stage)}{index === 0 ? '  ·  next' : ''}</Pill>)}
        </div>
      </div>
      {target && <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Required for {label(target)}</span>
        <Readiness key={`${target}-${workspace.events.length}`} applicationId={application.id} stage={target} onLoaded={onLoaded} />
      </div>}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">What supports this move?</span>
        <div className="flex flex-wrap gap-1.5">
          {SIGNALS.map(signal => <Pill key={signal} selected={signals.includes(signal)} onClick={() => setSignals(list => list.includes(signal) ? list.filter(item => item !== signal) : [...list, signal])}>{signal}</Pill>)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`advance-${application.id}`} className="text-[13px] font-semibold">Comment <span className="text-destructive">*</span></label>
        <Textarea id={`advance-${application.id}`} rows={4} className="resize-y" value={comment} onChange={event => setComment(event.target.value)} placeholder="Factual evidence for the move, e.g. what you saw in the CV or call." />
        <span className="text-xs text-muted-foreground">Internal. Saved to the candidate record, never shared with them.</span>
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
      <Button size="lg" className="h-12 text-[15px]" disabled={!canAdvance} onClick={() => {
        if (!target) return;
        const to = target, from = application.stage;
        const rationale = [signals.join(' · '), comment.trim()].filter(Boolean).join(' — ');
        void submit(() => run({ kind: 'move_application', application_id: application.id, expected_version: application.version, to_stage: to, rationale }, ''), () => {
          setSignals([]);
          setComment('');
          onAdvanced(from, to);
        });
      }}>{saving ? 'Recording…' : `Move to ${target ? label(target) : '…'} →`}</Button>
    </div> : <p className={cn('m-0', quiet)}>This application is at the last stage. Hire the candidate from the section below once the contract is signed.</p>)}

    {mode === 'reject' && <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Disposition</span>
        <div className="flex flex-wrap gap-1.5">
          {(['rejected', 'withdrawn'] as const).map(value => <Pill key={value} selected={disposition === value} onClick={() => setDisposition(value)}>{label(value)}</Pill>)}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">Reason <span className="text-destructive">*</span></span>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map(value => <Pill key={value} danger selected={reason === value} onClick={() => setReason(current => current === value ? '' : value)}>{value}</Pill>)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`reject-${application.id}`} className="text-[13px] font-semibold">Details</label>
        <Textarea id={`reject-${application.id}`} rows={3} className="resize-y" value={details} onChange={event => setDetails(event.target.value)} placeholder="Pick a reason above or describe it here." />
        <span className="text-xs text-muted-foreground">History is kept. The application can be reopened later.</span>
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
      <Button size="lg" variant="destructive" className="h-12 text-[15px]" disabled={!canClose} onClick={() => {
        const status = disposition;
        void submit(() => run({ kind: 'dispose_application', application_id: application.id, expected_version: application.version, status, reason: [reason, details.trim()].filter(Boolean).join(' — ') }, ''), () => onClosed(status));
      }}>{saving ? 'Recording…' : 'Record disposition'}</Button>
    </div>}
  </section>;
}

function ClosedPanel({ application, context, onReopened }: { application: Application; context: RecordContext; onReopened: () => void }) {
  const { run, busy } = context;
  const [error, setError] = useState('');
  const reopenable = application.status === 'rejected' || application.status === 'withdrawn';
  return <section aria-label="Stage decision" className={cn(card, 'flex flex-col gap-3 p-5')}>
    <h2 className={cardTitle}>{application.status === 'hired' ? 'Hired' : `Closed · ${label(application.status)}`}</h2>
    {application.reason && <p className="m-0 text-sm">{application.reason}</p>}
    <span className={quiet}>Last stage: {label(application.stage)} · updated {date(application.updated_at)}</span>
    {reopenable && <Button variant="outline" disabled={busy} onClick={() => {
      setError('');
      void run({ kind: 'reopen_application', application_id: application.id, expected_version: application.version }, 'Application reopened.').then(onReopened, failure => setError(errorMessage(failure)));
    }}>Reopen application</Button>}
    {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
  </section>;
}

/* ---------- Candidate context (left column) ---------- */

function CandidateContext({ person, context, application, cv, cvError, preview, getToken }: {
  person: Person;
  context: RecordContext;
  application?: Application;
  cv: FiledCv | null | undefined;
  cvError: string;
  preview: () => void;
  getToken: () => Promise<string | null | undefined>;
}) {
  const { workspace, run, busy } = context;
  // Profile edits send only the changed field; the command keeps the rest.
  const save = (fields: Partial<Pick<Person, 'skills' | 'languages' | 'degrees' | 'certifications' | 'experience' | 'linkedin_url'>>) => run({ kind: 'update_person', person_id: person.id, expected_version: person.version, full_name: person.full_name, ...fields }, '').then(() => undefined);
  const opportunity = application ? workspace.opportunities.find(item => item.id === application.opportunity_id) : undefined;
  const experience = newestFirst(person.experience);
  const now = experience.find(item => !item.end);
  return <>
    <ResumeCard cv={cv} error={cvError} preview={preview} />
    <section className={cn(card, 'flex flex-col gap-4 p-5')}>
      <h2 className={cardTitle}>At a glance</h2>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Glance term="Current title">{now ? `${now.title}${now.company ? ` · ${now.company}` : ''}` : person.headline || '—'}</Glance>
        <Glance term="Hiring need">{opportunity?.title ?? '—'}</Glance>
        <Glance term="Location">{person.location || '—'}</Glance>
        <Glance term="Applied via">{application ? <>
          {person.linkedin_url && application.source === 'linkedin' ? <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn</a> : label(application.source)}
          {application.referrer && ` (${application.referrer})`} · {date(application.created_at)}
        </> : label(person.source || 'other')}</Glance>
        {person.linkedin_url && <Glance term="LinkedIn"><a className="inline-flex items-center gap-1 font-medium" href={person.linkedin_url} target="_blank" rel="noopener noreferrer">LinkedIn profile <ArrowUpRight className="size-3" aria-hidden="true" /></a></Glance>}
      </dl>
    </section>
    <Experience person={person} items={experience} save={save} busy={busy} getToken={getToken} hasCv={!!cv} />
    <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      <SkillsLanguages person={person} experience={experience} save={save} busy={busy} />
      <EducationCertifications person={person} save={save} busy={busy} />
    </div>
    {application && <Activity events={workspace.events.filter(event => event.application_id === application.id)} />}
  </>;
}

function Glance({ term, children }: { term: string; children: ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{term}</dt>
    <dd className="m-0 mt-1 break-words">{children}</dd>
  </div>;
}

function ResumeCard({ cv, error, preview }: { cv: FiledCv | null | undefined; error: string; preview: () => void }) {
  return <section className={cn(card, 'flex flex-wrap items-center justify-between gap-4 px-5 py-4')}>
    <div className="flex min-w-0 items-center gap-3.5">
      <button type="button" disabled={!cv} onClick={preview} aria-label="Preview resume" className="flex h-[72px] w-14 flex-none flex-col gap-1 rounded border border-border bg-background px-[7px] py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:cursor-pointer disabled:opacity-50">
        <span className="block h-[5px] w-[70%] rounded-[1px] bg-foreground" />
        {[100, 90, 100, 60].map((width, index) => <span key={index} className="block h-[3px] bg-border" style={{ width: `${width}%` }} />)}
      </button>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className={cardTitle}>Resume</h2>
        <span className={cn(quiet, 'break-all')}>
          {cv === undefined ? 'Looking for the CV on Google Drive…' : cv ? `${cv.name}${cv.createdTime || cv.modifiedTime ? ` · uploaded ${date(cv.createdTime || cv.modifiedTime || '')}` : ''}` : error ? <span className="text-destructive">{error}</span> : 'No CV filed on Google Drive yet. CVs added in Add person are filed automatically.'}
        </span>
      </div>
    </div>
    {cv && <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={preview}>Preview</Button>
      <a className={linkButton({ variant: 'outline' })} href={`https://drive.google.com/uc?export=download&id=${encodeURIComponent(cv.id)}`}>Download</a>
    </div>}
  </section>;
}

function ResumePreview({ person, cv, open, close }: { person: Person; cv: FiledCv | null | undefined; open: boolean; close: () => void }) {
  if (!cv) return null;
  const view = cv.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(cv.id)}/view`;
  return <Sheet open={open} onOpenChange={value => {
    if (!value) close();
  }}>
    <SheetContent side="right" className="w-full gap-0 sm:max-w-[640px]">
      <SheetHeader className="flex-row flex-wrap items-center justify-between gap-2.5 border-b border-border pr-14">
        <div className="flex min-w-0 flex-col gap-0.5">
          <SheetTitle className="text-base">Resume · {person.full_name}</SheetTitle>
          <SheetDescription className="text-xs break-all">{cv.name}</SheetDescription>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <a className={linkButton({ variant: 'outline', size: 'sm' })} href={view} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          <a className={linkButton({ variant: 'outline', size: 'sm' })} href={`https://drive.google.com/uc?export=download&id=${encodeURIComponent(cv.id)}`}>Download</a>
        </div>
      </SheetHeader>
      <div className="min-h-0 flex-1 bg-muted">
        {open && <iframe title={`CV of ${person.full_name}`} src={`https://drive.google.com/file/d/${encodeURIComponent(cv.id)}/preview`} className="size-full border-0" allow="autoplay" />}
      </div>
      <div className={cn('flex flex-wrap items-center justify-between gap-2.5 border-t border-border px-[18px] py-2.5', quiet)}>
        <span>Shown in Google Drive's viewer. You need access to the CV folder.</span>
        {person.linkedin_url && <a href={person.linkedin_url} target="_blank" rel="noopener noreferrer">Compare with LinkedIn profile ↗</a>}
      </div>
    </SheetContent>
  </Sheet>;
}

const blankPosition: ExperienceItem = { title: '', company: '', contract_type: '', start: '', end: '', location: '', summary: '', skills: [] };

function Experience({ person, items, save, busy, getToken, hasCv }: {
  person: Person;
  items: ExperienceItem[];
  save: (fields: { experience?: ExperienceItem[]; linkedin_url?: string }) => Promise<void>;
  busy: boolean;
  getToken: () => Promise<string | null | undefined>;
  hasCv: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [found, setFound] = useState<{ experience: ExperienceItem[]; linkedinUrl: string } | null>(null);
  const [error, setError] = useState('');
  const total = items.reduce((sum, item) => sum + months(item.start, item.end), 0);
  const shown = showAll ? items : items.slice(0, 3);
  async function importFromResume() {
    setImporting(true);
    setError('');
    setFound(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Your session expired. Sign in again.');
      const response = await fetch('/api/parse-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile: { kind: 'drive', personId: person.id } }),
        signal: AbortSignal.timeout(115000)
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = z.object({ error: z.string() }).safeParse(result);
        throw new Error(failure.success ? failure.data.error : `Resume extraction failed (${response.status}).`);
      }
      const profile = z.object({ profile: parsedProfileSchema }).parse(result).profile;
      if (!profile.experience.length) throw new Error('No positions were found in the CV.');
      setFound({ experience: profile.experience, linkedinUrl: profile.linkedinUrl });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setImporting(false);
    }
  }
  return <section className={cn(card, 'flex flex-col gap-4 p-5')}>
    <CardHead title="Experience" action={<div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!hasCv || importing || busy} title={hasCv ? undefined : 'No CV filed on Google Drive'} onClick={() => void importFromResume()}>{importing ? 'Reading the CV…' : 'Import from resume'}</Button>
      <Button variant="outline" size="sm" onClick={() => setAdding(true)}>+ Add</Button>
    </div>} />
    {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
    {found && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
      <span>{plural(found.experience.length, 'position')} found in the CV.{items.length ? ` This replaces the ${plural(items.length, 'position')} listed now.` : ''}</span>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save({ experience: found.experience, ...(!person.linkedin_url && found.linkedinUrl ? { linkedin_url: found.linkedinUrl } : {}) }).then(() => setFound(null), () => {})}>{items.length ? 'Replace' : 'Add positions'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setFound(null)}>Cancel</Button>
      </div>
    </div>}
    {adding && <PositionForm busy={busy} cancel={() => setAdding(false)} save={position => save({ experience: newestFirst([position, ...items]) }).then(() => setAdding(false))} />}
    {items.length ? <ol className="m-0 flex list-none flex-col p-0">
      {shown.map((item, index) => <li key={`${item.company}-${item.start}-${index}`} className="group/position flex gap-3.5 pb-[18px] last:pb-0">
        <div aria-hidden="true" className="flex flex-none flex-col items-center">
          <span className={cn('flex size-9 items-center justify-center rounded-lg text-xs font-semibold', !item.end ? 'bg-foreground text-background' : 'bg-muted text-foreground')}>{badge(item.company || item.title || '?')}</span>
          {index < shown.length - 1 && <span className="mt-1.5 w-px flex-1 bg-border" />}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{item.title || 'Untitled position'}</span>
            <Button variant="ghost" size="xs" className="text-muted-foreground opacity-0 group-hover/position:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${item.title || 'position'}`} disabled={busy} onClick={() => void save({ experience: items.filter(other => other !== item) }).catch(() => {})}>Remove</Button>
          </div>
          {(item.company || item.contract_type) && <span className="text-foreground/80">{[item.company, item.contract_type].filter(Boolean).join(' · ')}</span>}
          <span className={quiet}>{[item.start ? `${monthLabel(item.start)} – ${item.end ? monthLabel(item.end) : 'Present'}` : '', item.start ? duration(months(item.start, item.end)) : '', item.location].filter(Boolean).join(' · ')}</span>
          {item.summary && <span className="mt-1 text-[13px] text-foreground/80">{item.summary}</span>}
          {item.skills.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.skills.map(skill => <span key={skill} className="rounded bg-muted px-2 py-0.5 text-xs">{skill}</span>)}
          </div>}
        </div>
      </li>)}
    </ol> : !adding && <p className={cn('m-0', quiet)}>No positions yet. Import them from the resume or add them by hand.</p>}
    {items.length > 0 && <span className={quiet}>
      {total ? `${duration(total)} of experience` : plural(items.length, 'position')}
      {items.length > 3 && <> · <Button variant="link" size="xs" className="h-auto px-0 text-[13px] text-foreground" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show fewer' : `Show all ${items.length} positions`}</Button></>}
    </span>}
  </section>;
}

function PositionForm({ save, cancel, busy }: { save: (position: ExperienceItem) => Promise<void>; cancel: () => void; busy: boolean }) {
  const [position, setPosition] = useState<ExperienceItem>(blankPosition);
  const [skills, setSkills] = useState('');
  const [error, setError] = useState('');
  const set = (key: keyof ExperienceItem) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPosition(value => ({ ...value, [key]: event.target.value }));
  const field = 'flex min-w-0 flex-col gap-1.5 text-[13px] font-medium';
  return <form className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2" onSubmit={event => {
    event.preventDefault();
    setError('');
    if (position.end && position.start && position.end < position.start) return setError('The end month is before the start month.');
    void save({ ...position, title: position.title.trim(), company: position.company.trim(), skills: listed(skills).slice(0, 12) }).catch(failure => setError(errorMessage(failure)));
  }}>
    <label className={field}>Title<Input required value={position.title} onChange={set('title')} /></label>
    <label className={field}>Company<Input value={position.company} onChange={set('company')} /></label>
    <label className={field}>Contract type<Input value={position.contract_type} onChange={set('contract_type')} placeholder="CDI, Freelance…" /></label>
    <label className={field}>Location<Input value={position.location} onChange={set('location')} /></label>
    <label className={field}>Start<Input type="month" required value={position.start} onChange={set('start')} /></label>
    <label className={field}>End<Input type="month" value={position.end} onChange={set('end')} /><span className="text-xs font-normal text-muted-foreground">Leave empty for a current position.</span></label>
    <label className={cn(field, 'sm:col-span-2')}>Key missions and outcomes<Textarea rows={2} value={position.summary} onChange={set('summary')} /></label>
    <label className={cn(field, 'sm:col-span-2')}>Skills used<Input value={skills} onChange={event => setSkills(event.target.value)} placeholder="Comma-separated" /></label>
    {error && <p role="alert" className="m-0 text-[13px] text-destructive sm:col-span-2">{error}</p>}
    <div className="flex gap-2 sm:col-span-2">
      <Button type="submit" size="sm" disabled={busy}>Add position</Button>
      <Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
    </div>
  </form>;
}

function SkillsLanguages({ person, experience, save, busy }: { person: Person; experience: ExperienceItem[]; save: (fields: { skills?: string; languages?: string }) => Promise<void>; busy: boolean }) {
  const [adding, setAdding] = useState<'' | 'skill' | 'language'>('');
  const skills = listed(person.skills);
  const known = new Set(skills.map(skill => skill.toLowerCase()));
  // Skills used in listed positions that the profile does not have yet.
  const suggested = [...new Set(experience.flatMap(item => item.skills))].filter(skill => !known.has(skill.toLowerCase())).slice(0, 10);
  const addSkill = (skill: string) => save({ skills: [...skills, skill].join(', ') });
  const languages = lines(person.languages);
  return <section className={cn(card, 'flex flex-col gap-4 p-5')}>
    <div className="flex flex-col gap-2">
      <CardHead title="Skills" action={<AddButton onClick={() => setAdding('skill')} />} />
      {adding === 'skill' && <InlineAdd label="New skill" placeholder="e.g. Kubernetes" busy={busy} onSave={addSkill} onCancel={() => setAdding('')} />}
      {skills.length > 0 && <div className="flex flex-wrap gap-1.5">
        {skills.map(skill => <span key={skill} className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-[13px]">{skill}</span>)}
      </div>}
      {suggested.length > 0 && <>
        <span className="text-xs text-muted-foreground">Suggested from experience · click to add to the profile</span>
        <div className="flex flex-wrap gap-1.5">
          {suggested.map(skill => <Pill key={skill} dashed disabled={busy} onClick={() => void addSkill(skill).catch(() => {})}>+ {skill}</Pill>)}
        </div>
      </>}
      {!skills.length && !suggested.length && adding !== 'skill' && <span className={quiet}>No skills recorded.</span>}
    </div>
    <div className="h-px bg-border" />
    <div className="flex flex-col gap-2">
      <CardHead level={3} title="Languages" action={<AddButton onClick={() => setAdding('language')} />} />
      {adding === 'language' && <InlineAdd label="New language" placeholder="e.g. English — C1" busy={busy} onSave={value => save({ languages: [...languages, value].join('\n') })} onCancel={() => setAdding('')} />}
      {languages.map(line => {
        const [name, ...level] = parts(line);
        return <div key={line} className="flex justify-between gap-3 text-[13px]"><span>{name}</span><span className="text-muted-foreground">{level.join(' · ')}</span></div>;
      })}
      {!languages.length && adding !== 'language' && <span className={quiet}>No languages recorded.</span>}
    </div>
  </section>;
}

function EducationCertifications({ person, save, busy }: { person: Person; save: (fields: { degrees?: string; certifications?: string }) => Promise<void>; busy: boolean }) {
  const [adding, setAdding] = useState<'' | 'degree' | 'certification'>('');
  const degrees = lines(person.degrees);
  const certifications = lines(person.certifications);
  return <section className={cn(card, 'flex flex-col gap-4 p-5')}>
    <div className="flex flex-col gap-3">
      <CardHead title="Education" action={<AddButton onClick={() => setAdding('degree')} />} />
      {adding === 'degree' && <InlineAdd label="New degree" placeholder="Degree — School — Year" busy={busy} onSave={value => save({ degrees: [...degrees, value].join('\n') })} onCancel={() => setAdding('')} />}
      {degrees.map(line => {
        const [degree, ...rest] = parts(line);
        const year = rest.length > 1 || /^\d{4}$/.test(rest[0] ?? '') ? rest.pop() : '';
        return <div key={line} className="flex gap-3">
          <span aria-hidden="true" className="flex size-9 flex-none items-center justify-center rounded-lg bg-muted"><GraduationCap className="size-[18px]" /></span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">{degree}</span>
            {rest.length > 0 && <span className="text-[13px] text-foreground/80">{rest.join(' · ')}</span>}
            {year && <span className={quiet}>{year}</span>}
          </div>
        </div>;
      })}
      {!degrees.length && adding !== 'degree' && <span className={quiet}>No degrees recorded.</span>}
    </div>
    <div className="h-px bg-border" />
    <div className="flex flex-col gap-2">
      <CardHead level={3} title="Certifications" action={<AddButton onClick={() => setAdding('certification')} />} />
      {adding === 'certification' && <InlineAdd label="New certification" placeholder="Certification — Year" busy={busy} onSave={value => save({ certifications: [...certifications, value].join('\n') })} onCancel={() => setAdding('')} />}
      {certifications.map(line => {
        const [name, ...rest] = parts(line);
        return <div key={line} className="flex justify-between gap-3 text-[13px]"><span>{name}</span><span className="text-muted-foreground">{rest.join(' · ')}</span></div>;
      })}
      {!certifications.length && adding !== 'certification' && <span className={quiet}>No certifications recorded.</span>}
    </div>
  </section>;
}

function eventTitle(event: Event) {
  switch (event.kind) {
    case 'create_application': return 'Application opened';
    case 'move_application': return `Moved to ${label(event.next_state)}`;
    case 'dispose_application': return `Closed: ${label(event.next_state)}`;
    case 'reopen_application': return 'Application reopened';
    case 'assign_application_owner': return event.next_state ? `Owner set to ${event.next_state}` : 'Owner removed';
    case 'update_screening': return 'Screening updated';
    case 'add_note': return 'Note added';
    case 'schedule_interview': return 'Interview scheduled';
    case 'complete_interview': return 'Interview completed';
    case 'cancel_interview': return 'Interview cancelled';
    case 'create_offer': return 'Offer drafted';
    case 'approve_offer': return 'Offer approved';
    case 'cancel_offer': return 'Offer cancelled';
    case 'share_offer': return 'Offer shared';
    case 'respond_offer': return `Offer ${label(event.next_state || 'answered').toLowerCase()}`;
    case 'hire': return 'Hired';
    default: return label(event.kind);
  }
}

function Activity({ events }: { events: Event[] }) {
  const items = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <section className={cn(card, 'flex flex-col gap-3.5 p-5')}>
    <h2 className={cardTitle}>Activity</h2>
    {items.length ? <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
      {items.slice(0, 20).map(event => <li key={event.id} className="flex gap-3">
        <span aria-hidden="true" className="mt-1.5 size-2 flex-none rounded-full bg-foreground" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{eventTitle(event)}</span>
          <span className={quiet}>{event.actor_email} · {new Date(event.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          {event.rationale && <span className="text-[13px] whitespace-pre-line text-foreground/80">“{event.rationale}”</span>}
        </div>
      </li>)}
    </ol> : <p className={cn('m-0', quiet)}>No activity yet.</p>}
  </section>;
}
