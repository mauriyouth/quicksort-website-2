import { useEffect, useRef, useState } from 'react';
import { useSession } from '@clerk/react';
import { Upload, Sparkles } from 'lucide-react';
import { z } from 'zod';
import { db, errorMessage } from '@quicksort/hr-db';
import { MAX_INTAKE_PDF_BYTES, parsedProfileSchema, type ParsedProfile } from '../candidate-intake';
import { Button, Card, CardContent, Checkbox, Field as UiField, FieldLabel } from '@quicksort-sas/ui';
import { Field, Form, Tag, checked, text, type RunCommand } from './ui';
import type { Opportunity } from './domain';
import { fileCv } from './recruitmentCv';
/** Positions a new candidate can be filed against (closed ones are hidden). */
const CLOSED_POSITION = new Set(['filled', 'closed', 'cancelled', 'rejected']);
const removeTransferCopy = (path: string) => void db().storage.from('candidate-documents').remove([path]).catch(() => {});
export function Intake({
  actorEmail,
  run,
  busy,
  positions,
  onAdded
}: {
  actorEmail: string;
  run: RunCommand;
  busy: boolean;
  positions: Opportunity[];
  /** Called once the person is saved; a warning means a follow-up step (application, Drive filing) failed. */
  onAdded: (warning?: string) => void;
}) {
  const {
    session
  } = useSession();
  const [profile, setProfile] = useState<ParsedProfile | null>(null);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // The parsed PDF stays in the candidate-documents bucket until the person is
  // saved, so the server can file it on Google Drive; removed afterwards, or
  // when the dialog closes without saving.
  const storagePath = useRef('');
  useEffect(() => () => {
    if (storagePath.current) removeTransferCopy(storagePath.current);
  }, []);
  const openPositions = positions.filter(position => !CLOSED_POSITION.has(position.status));
  async function parse(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > MAX_INTAKE_PDF_BYTES) {
      setError('Choose a non-empty PDF up to 10 MB.');
      return;
    }
    setParsing(true);
    setError('');
    // Upload straight to Supabase Storage so the 10 MB PDF never passes through
    // the API body (Vercel caps it at 4.5 MB). The API reads it back from the bucket.
    let uploadedPath = '';
    try {
      const token = await session?.getToken({
        template: 'supabase'
      });
      if (!token || !session?.user.id) throw new Error('Your session expired. Sign in again.');
      uploadedPath = `${session.user.id}/${crypto.randomUUID()}.pdf`;
      if (storagePath.current) removeTransferCopy(storagePath.current);
      storagePath.current = '';
      const uploaded = await db().storage.from('candidate-documents').upload(uploadedPath, file, {
        upsert: false,
        contentType: 'application/pdf'
      });
      if (uploaded.error) throw new Error('The PDF could not be uploaded. Please try again.');
      const response = await fetch('/api/parse-candidate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          profile: {
            kind: 'storage',
            path: uploadedPath,
            name: file.name
          }
        }),
        signal: AbortSignal.timeout(115000)
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({
          error: z.string()
        }).safeParse(result);
        throw new Error(failure.success ? failure.data.error : `Resume extraction failed (${response.status}).`);
      }
      const parsed = z.object({
        profile: parsedProfileSchema
      }).parse(result).profile;
      setProfile(parsed);
      setFileName(file.name);
      storagePath.current = uploadedPath;
      uploadedPath = '';
      requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      // Failed parse: nothing references the transfer copy.
      if (uploadedPath) removeTransferCopy(uploadedPath);
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const reviewedRun: RunCommand = async (input, success) => {
    const { position_id: positionId, ...command } = input as { position_id?: string; full_name: string };
    const result = await run(command, success);
    const personId = result ? result.person_id : undefined;
    if (!personId) return onAdded();
    const position = openPositions.find(p => p.id === positionId);
    const warnings: string[] = [];
    if (position) {
      try {
        await run({ kind: 'create_application', person_id: personId, opportunity_id: position.id }, `Person added and linked to "${position.title}".`);
      } catch (failure) {
        warnings.push(`The person was saved, but the application to "${position.title}" failed: ${errorMessage(failure)}`);
      }
    }
    const path = storagePath.current;
    if (path) {
      storagePath.current = '';
      const warning = await fileCv(() => session?.getToken({ template: 'supabase' }) ?? Promise.resolve(null), {
        storagePath: path,
        personId,
        personName: command.full_name,
        position: position ? { title: position.title, openedAt: position.created_at } : null
      });
      if (warning) warnings.push(warning);
      removeTransferCopy(path);
    }
    onAdded(warnings.join(' '));
  };
  return <>
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-prose min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4" aria-hidden="true" />
              <h3 className="m-0 text-[15px] font-medium">Start with a resume</h3>
            </div>
            <p className="m-0 text-[13px] leading-relaxed text-muted-foreground">Extract a profile from a PDF, then review and edit every field before saving. You can also enter the person manually.</p>
          </div>
          <Button variant="outline" disabled={parsing || busy} onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden="true" />
            {parsing ? 'Extracting…' : 'Choose PDF'}
          </Button>
        </div>
        <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" aria-label="Resume PDF" onChange={event => void parse(event.target.files?.[0])} />
        {profile && <div className="flex flex-col items-start gap-2">
          <Tag tone="quiet">Extraction confidence: {profile.confidence}</Tag>
          <p className="m-0 text-[13px] text-muted-foreground">Source: {fileName}. Extracted facts are suggestions until you save the reviewed profile.</p>
        </div>}
        {error && <p role="alert" className="m-0 text-[13px] text-destructive">
          {error}
        </p>}
      </CardContent>
    </Card>
    <div ref={formRef}>
      <Form key={fileName || 'manual'} title={profile ? 'Review the extracted profile' : 'Person details'} run={reviewedRun} busy={busy || parsing} button="Save reviewed person" success="Person added to the talent pool. Open their record to create an application." submit={data => ({
        kind: 'create_person',
        full_name: text(data, 'full_name'),
        email: text(data, 'email'),
        phone: text(data, 'phone'),
        headline: text(data, 'headline'),
        location: text(data, 'location'),
        skills: text(data, 'skills'),
        notes: text(data, 'notes'),
        source: text(data, 'source'),
        owner_email: text(data, 'owner_email'),
        contact_allowed: checked(data, 'contact_allowed'),
        position_id: text(data, 'position_id')
      })}>
        <Field name="position_id" label="Position" options={openPositions.map(position => ({
          value: position.id,
          label: position.title
        }))} hint={profile ? 'The CV is filed on Google Drive under <year>/<position>, or "Candidatures spontanées" when no position is set.' : 'Creates the application to this position.'} />
        <Field name="full_name" label="Full name" value={profile?.fullName} required />
        <Field name="headline" label="Professional headline" value={profile?.headline} />
        <Field name="email" label="Email" type="email" value={profile?.email} />
        <Field name="phone" label="Phone" type="tel" value={profile?.phone} />
        <Field name="location" label="Location" value={profile?.location} />
        <Field name="owner_email" label="Record owner" type="email" value={actorEmail} />
        <Field name="source" label="Source" value={profile ? 'resume' : 'other'} options={['career_site', 'linkedin', 'referral', 'job_board', 'spontaneous', 'rediscovery', 'resume', 'other'].map(value => ({
          value,
          label: value.replace(/_/g, ' ')
        }))} required />
        <Field name="skills" label="Skills and certifications" type="textarea" value={profile?.skills.join(', ')} />
        <Field name="notes" label="Profile notes" type="textarea" value={profile ? `${profile.summary}\n\nResume source: ${fileName}` : ''} />
        <UiField orientation="horizontal" className="col-span-full gap-2">
          <Checkbox id="hr-intake-contact" name="contact_allowed" value="on" defaultChecked />
          <FieldLabel htmlFor="hr-intake-contact" className="font-normal">Contact permitted for future opportunities</FieldLabel>
        </UiField>
      </Form>
    </div>
  </>;
}
