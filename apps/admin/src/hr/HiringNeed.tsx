import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  Field as UiField,
  FieldLabel,
  NativeSelect,
  NativeSelectOption,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@quicksort-sas/ui';
import type { CommandResult, Opportunity } from './domain';
import { personName, type RecordContext } from './PersonWorkspace';
import { Empty, Field, Form, PersonLink, SearchMultiField, Section, Tag, date, label, nullable, text, type RunCommand } from './ui';

export type NeedContext = RecordContext & {
  open: (personId: string, applicationId?: string) => void;
};

/** Where hiring needs live: the list is a recruiting tab, each need has its own page. */
export const NEEDS_LIST = '/hr/recruiting/needs';
export const needUrl = (id: string) => `/hr/recruiting/needs/${encodeURIComponent(id)}`;
/** The need id in /hr/recruiting/needs/<id> ('new' for the create page), or ''. */
export const needRoute = (pathname: string) => decodeURIComponent(pathname.match(/^\/hr\/recruiting\/needs\/([^/]+)\/?$/)?.[1] ?? '');
export const editableNeed = (opportunity: Opportunity) => !opportunity.archived_at && ['draft', 'pending_approval', 'approved'].includes(opportunity.status);

export function RequisitionForm({
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
  onSaved?: (result: CommandResult | void) => void;
  context: NeedContext;
}) {
  const [jobId, setJobId] = useState(opportunity?.job_id ?? '');
  const job = workspace.jobs.find(item => item.id === jobId);
  const save: RunCommand = async (input, success) => {
    const result = await run(input, success);
    onSaved?.(result);
    return result;
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
    {job ? <p className="col-span-full m-0 text-[13px] text-muted-foreground">Role and requirements are taken from “{job.title}”.</p> : <Field name="title" label="Role to hire" value={opportunity?.title} required hint="Named manually until a job post is linked. The post then provides the title and requirements." />}
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

function BackLink() {
  return <Link to={NEEDS_LIST} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground no-underline hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />Recruiting · Hiring needs</Link>;
}

/** /hr/recruiting/needs/<id>: one hiring need, its applications, and archive / delete. */
export function HiringNeedPage({
  needId,
  context
}: {
  needId: string;
  context: NeedContext;
}) {
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { workspace, run, busy, open } = context;
  if (needId === 'new') return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-col gap-4 border-b border-border pb-5">
      <BackLink />
      <h1 className="m-0 font-heading text-[28px] leading-none font-medium tracking-[-0.02em]">New hiring need</h1>
    </header>
    <RequisitionForm context={context} onSaved={result => {
      if (result?.opportunity_id) navigate(needUrl(result.opportunity_id), { replace: true });
    }} />
  </div>;
  const opportunity = workspace.opportunities.find(item => item.id === needId);
  if (!opportunity) return <div className="flex min-w-0 flex-col gap-6">
    <BackLink />
    <Empty>This hiring need no longer exists. It may have been deleted.</Empty>
  </div>;
  const applications = workspace.applications.filter(application => application.opportunity_id === opportunity.id);
  const active = applications.filter(application => application.status === 'active');
  const job = workspace.jobs.find(item => item.id === opportunity.job_id);
  const clients = workspace.clients.filter(client => opportunity.client_ids.includes(client.id));
  const project = workspace.projects.find(item => item.id === opportunity.project_id);
  const archived = !!opportunity.archived_at;
  const versioned = { opportunity_id: opportunity.id, expected_version: opportunity.version };
  const archive = () => void run({ kind: 'archive_requisition', ...versioned }, 'Hiring need archived.').catch(() => {});
  const restore = () => void run({ kind: 'restore_requisition', ...versioned }, 'Hiring need restored.').catch(() => {});
  const remove = () => void run({ kind: 'delete_requisition', ...versioned }, `Hiring need “${opportunity.title}” deleted.`).then(() => navigate(NEEDS_LIST, { replace: true })).catch(() => {});
  const archiveBlocked = active.length > 0;
  const deleteBlocked = applications.length > 0;
  return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-col gap-4 border-b border-border pb-5">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="m-0 font-heading text-[28px] leading-none font-medium tracking-[-0.02em]">{opportunity.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            {archived ? <Tag tone="quiet">Archived</Tag> : <Tag tone={['approved', 'published'].includes(opportunity.status) ? 'good' : 'quiet'}>{label(opportunity.status)}</Tag>}
            <span>{opportunity.hiring_mode === 'sur_mission' ? 'Client mission' : 'Ahead of demand'}</span>
            <span aria-hidden="true">·</span>
            <span>{opportunity.owner_email || 'Unassigned'}</span>
            <span aria-hidden="true">·</span>
            <span>{active.length} active of {applications.length} applications</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap gap-2">
            {archived ? <Button variant="outline" disabled={busy} onClick={restore}><ArchiveRestore aria-hidden="true" /> Restore</Button> : <Button variant="outline" disabled={busy || archiveBlocked} onClick={archive}><Archive aria-hidden="true" /> Archive</Button>}
            <Button variant="destructive" disabled={busy || deleteBlocked} onClick={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" /> Delete</Button>
          </div>
          {(deleteBlocked || (!archived && archiveBlocked)) && <p className="m-0 max-w-sm text-right text-xs text-muted-foreground">
            {!archived && archiveBlocked ? `Close its ${active.length} active ${active.length === 1 ? 'application' : 'applications'} to archive it. ` : ''}
            {deleteBlocked ? 'Needs with applications can only be archived, so candidate history is kept.' : ''}
          </p>}
        </div>
      </div>
    </header>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{opportunity.title}”?</AlertDialogTitle>
          <AlertDialogDescription>The hiring need is removed for good. The linked job post and clients are kept. To hide it but keep it, archive it instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => {
            setConfirmDelete(false);
            remove();
          }}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {archived && <p className="m-0 rounded-lg border border-border bg-muted/50 px-4 py-3 text-[13px] text-muted-foreground">Archived on {date(opportunity.archived_at)}. It is hidden from the recruiting board and takes no new applications. Restore it to edit it.</p>}
    <Section title="Details">
      {editableNeed(opportunity) ? <Card size="sm">
        <CardContent>
          <RequisitionForm key={opportunity.version} opportunity={opportunity} context={context} />
        </CardContent>
      </Card> : <Card size="sm">
        <CardContent>
          <dl className="m-0 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
            {[
              ['Job post', job ? `${job.title}${job.published ? ' (published)' : ' (draft)'}` : 'Not set'],
              ['Skill family', opportunity.skill_family || 'Not set'],
              ['Staffing project', project?.title ?? 'Not set'],
              ['Clients', clients.length ? clients.map(client => client.name).join(', ') : 'None'],
              ['Client need', opportunity.client_need || 'Not set'],
              ['Hiring justification', opportunity.justification || 'Not set']
            ].map(([term, value]) => <div key={term} className="flex min-w-0 flex-col gap-1">
              <dt className="label-mono">{term}</dt>
              <dd className="m-0 whitespace-pre-line">{value}</dd>
            </div>)}
          </dl>
          {!archived && <p className="mt-4 mb-0 text-xs text-muted-foreground">Published or closed hiring needs cannot be edited. Create a new one for changed requirements.</p>}
        </CardContent>
      </Card>}
    </Section>
    {opportunity.status === 'approved' && !archived && <Section title="Publish the connected job post">
      <Card size="sm">
        <CardContent>
          <Form run={run} busy={busy} button="Publish job post" success="Connected job post published and requisition updated." submit={data => ({
            kind: 'publish_requisition',
            ...versioned,
            job_id: text(data, 'job_id')
          })}>
            <Field name="job_id" label="Connected job post" value={opportunity.job_id} options={workspace.jobs.map(item => ({
              value: item.id,
              label: `${item.title}${item.published ? ' · Published' : ' · Draft'}`
            }))} required hint="Create a public job post in Job posts first, then connect it here." />
          </Form>
        </CardContent>
      </Card>
    </Section>}
    <Section title="Applications" detail={applications.length ? undefined : 'Add a person from the talent pool to this hiring need to start an application.'}>
      {applications.length ? <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Applied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...applications].sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.created_at.localeCompare(a.created_at)).map(application => <TableRow key={application.id}>
              <TableCell className="h-auto py-3">
                <PersonLink personId={application.person_id} name={personName(workspace, application.person_id)} detail={workspace.people.find(person => person.id === application.person_id)?.headline} open={() => open(application.person_id, application.id)} />
              </TableCell>
              <TableCell>{label(application.stage)}</TableCell>
              <TableCell><Tag tone={application.status === 'active' ? 'good' : 'quiet'}>{label(application.status)}</Tag></TableCell>
              <TableCell>{date(application.created_at)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </Card> : <Empty>No applications yet.</Empty>}
    </Section>
  </div>;
}
