import { useRef, useState } from 'react';
import { useSession } from '@clerk/react';
import { Upload, Sparkles } from 'lucide-react';
import { z } from 'zod';
import { errorMessage } from '@quicksort/hr-db';
import { MAX_INTAKE_PDF_BYTES, parsedProfileSchema, type ParsedProfile } from '../candidate-intake';
import { Field, Form, Tag, checked, text, type RunCommand } from './ui';
export function Intake({
  actorEmail,
  run,
  busy,
  onAdded
}: {
  actorEmail: string;
  run: RunCommand;
  busy: boolean;
  onAdded: () => void;
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
  async function parse(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > MAX_INTAKE_PDF_BYTES) {
      setError('Choose a non-empty PDF up to 3 MB.');
      return;
    }
    setParsing(true);
    setError('');
    try {
      const token = await session?.getToken({
        template: 'supabase'
      });
      if (!token) throw new Error('Your session expired. Sign in again.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const content = String(reader.result).split(',')[1];
          if (content) resolve(content);else reject(new Error('The PDF could not be read.'));
        };
        reader.onerror = () => reject(new Error('The PDF could not be read.'));
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/parse-candidate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          profile: {
            kind: 'pdf',
            data,
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
      requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const reviewedRun: RunCommand = async (input, success) => {
    await run(input, success);
    onAdded();
  };
  return <>
    <div className="hr-card">
      <div className="hr-card-head">
        <div>
          <div className="hr-inline">
            <Sparkles size={16} aria-hidden="true" />
            <h3>Start with a resume</h3>
          </div>
          <p>Extract a profile from a PDF, then review and edit every field before saving. You can also enter the person manually.</p>
        </div>
        <button className="btn secondary" disabled={parsing || busy} onClick={() => fileRef.current?.click()}>
          <Upload size={15} aria-hidden="true" />
          {parsing ? 'Extracting…' : 'Choose PDF'}
        </button>
      </div>
      <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" aria-label="Resume PDF" onChange={event => void parse(event.target.files?.[0])} />
      {profile && <>
        <Tag tone="quiet">Extraction confidence: {profile.confidence}</Tag>
        <p>Source: {fileName}. Extracted facts are suggestions until you save the reviewed profile.</p>
      </>}
      {error && <p role="alert" className="hr-error">
        {error}
      </p>}
    </div>
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
        contact_allowed: checked(data, 'contact_allowed')
      })}>
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
        <label className="hr-checkbox hr-wide"><input type="checkbox" name="contact_allowed" defaultChecked />Contact permitted for future opportunities</label>
      </Form>
    </div>
  </>;
}
