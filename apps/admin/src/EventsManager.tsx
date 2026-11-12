import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, ArrowUpRight } from 'lucide-react';
import { db, errorMessage, type Row, type Database } from '@quicksort/candidate-db';
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@quicksort-sas/ui';
import { EmptyState, linkButton, PageAlerts, PageHeading, StatusBadge } from './ui';

type EventRecord = Row<'events'>;
type EventValues = Database['public']['Tables']['events']['Insert'];

export function EventsManager() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [editing, setEditing] = useState<EventRecord | null | undefined>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db().from('events').select('*').order('event_date');
      if (result.error) throw result.error;
      setEvents(result.data || []);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function action(work: () => Promise<void>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); setMessage(success); await load(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  function checkUpdate(error: { code?: string; message: string } | null) {
    if (error?.code === 'PGRST116') throw new Error('This event changed in another session. Refresh and reopen it before saving.');
    if (error) throw error;
  }
  return <div className="flex flex-col gap-6">
    <PageHeading title="Events" eyebrow="Community" action={<Button variant="pivot" disabled={busy} onClick={() => { setEditing(null); setError(''); setMessage(''); }}><Plus data-icon="inline-start"/>Add event</Button>}>
      Manage the cards in the website's circular gallery. Published changes appear without a website deployment.
    </PageHeading>
    <PageAlerts error={error} message={message} />
    {editing !== undefined && <EventEditor key={editing?.id || 'new'} event={editing} busy={busy} onCancel={() => setEditing(undefined)} onSave={(values, file) => action(async () => {
      let uploaded = '';
      if (file) {
        const extension = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
        if (!extension || file.size > 5 * 1024 * 1024 || !file.size) throw new Error('Choose a JPG, PNG or WebP banner up to 5 MB.');
        uploaded = `${crypto.randomUUID()}.${extension}`;
        const result = await db().storage.from('event-banners').upload(uploaded, file, { contentType: file.type, upsert: false });
        if (result.error) throw result.error;
        values.banner_url = db().storage.from('event-banners').getPublicUrl(uploaded).data.publicUrl;
      }
      const result = editing
        ? await db().from('events').update(values).eq('id', editing.id).eq('updated_at', editing.updated_at).select('id').single()
        : await db().from('events').insert(values).select('id').single();
      if (result.error) {
        if (uploaded) await db().storage.from('event-banners').remove([uploaded]);
        checkUpdate(result.error);
      }
      setEditing(undefined);
    }, values.published ? 'Event published on the website.' : 'Event saved as a draft.')} />}
    <Card>
      <CardHeader>
        <CardTitle>Event cards</CardTitle>
        <CardAction><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => {setError(''); void load();}}>Refresh</Button></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading events…</p>}
        {!loading && !events.length && !error && <EmptyState title="No events yet">Add an event and its banner to start your gallery.</EmptyState>}
        {!!events.length && <ItemGroup>
          {events.map(event => <Item variant="outline" key={event.id}>
            <ItemMedia variant="image" className="size-20">
              <img src={event.banner_url} alt="" width={80} height={80} className="size-full object-contain"/>
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>{event.title}</ItemTitle>
              <ItemDescription>{new Date(event.event_date + 'T12:00:00').toLocaleDateString()} · {event.location}</ItemDescription>
              <div><StatusBadge status={event.published ? 'published' : 'draft'}/></div>
            </ItemContent>
            <ItemActions className="flex-wrap">
              <a className={linkButton({ variant: 'outline', size: 'sm' })} href={event.event_url} target="_blank" rel="noopener noreferrer">Luma <ArrowUpRight data-icon="inline-end"/></a>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => {setEditing(event);setError('');setMessage('');}}>Edit</Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void action(async () => {
                const result = await db().from('events').update({published: !event.published}).eq('id', event.id).eq('updated_at', event.updated_at).select('id').single();
                checkUpdate(result.error);
                if (editing?.id === event.id) setEditing(undefined);
              }, event.published ? 'Event hidden from the website.' : 'Event published on the website.')}>{event.published ? 'Unpublish' : 'Publish'}</Button>
            </ItemActions>
          </Item>)}
        </ItemGroup>}
      </CardContent>
    </Card>
  </div>;
}

function EventEditor({event,busy,onSave,onCancel}: {event:EventRecord|null;busy:boolean;onSave:(values:EventValues,file:File|null)=>Promise<void>;onCancel:()=>void}) {
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState(event?.banner_url || '');
  const [error,setError] = useState('');
  const [published,setPublished] = useState(Boolean(event?.published));
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  },[file]);
  function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key:string) => String(form.get(key) || '').trim();
    try {
      const url = new URL(value('event_url'));
      if (url.protocol !== 'https:' || url.hostname !== 'luma.com' || url.username || url.password || url.port || url.pathname === '/') throw new Error();
    } catch { setError('Enter an event link starting with https://luma.com/.'); return; }
    if (!file && !event?.banner_url) {setError('Choose an event banner.');return;}
    setError('');
    void onSave({title:value('title'),event_date:value('event_date'),location:value('location'),event_url:value('event_url'),banner_url:event?.banner_url || '',published},file);
  }
  return <Card>
    <CardHeader><CardTitle>{event ? 'Edit event' : 'Add event'}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <PageAlerts error={error} />
      <form onSubmit={submit}><fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="event-title">Event title</FieldLabel>
            <Input id="event-title" name="title" required maxLength={200} defaultValue={event?.title}/>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-date">Date</FieldLabel>
              <Input id="event-date" type="date" name="event_date" required defaultValue={event?.event_date}/>
            </Field>
            <Field>
              <FieldLabel htmlFor="event-location">Location</FieldLabel>
              <Input id="event-location" name="location" required maxLength={160} defaultValue={event?.location || 'Paris'}/>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="event-url">Luma event link</FieldLabel>
            <Input id="event-url" type="url" name="event_url" required maxLength={2000} defaultValue={event?.event_url} placeholder="https://luma.com/your-event"/>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-banner">Event banner</FieldLabel>
            <Input id="event-banner" type="file" accept="image/jpeg,image/png,image/webp" required={!event && !file} onChange={e => {
              const next=e.target.files?.[0]; if (!next) return;
              if (!['image/jpeg','image/png','image/webp'].includes(next.type) || next.size > 5*1024*1024 || !next.size) {setError('Choose a JPG, PNG or WebP banner up to 5 MB.');e.target.value='';return;}
              setError('');setFile(next);
            }}/>
            <FieldDescription>Square banners work best. JPG, PNG or WebP, up to 5 MB.</FieldDescription>
          </Field>
          {preview && <img src={preview} alt="Event banner preview" width={220} height={220} className="max-w-full rounded-sm border border-border object-contain"/>}
          <Field orientation="horizontal">
            <Checkbox id="event-published" checked={published} onCheckedChange={(checked) => setPublished(checked === true)}/>
            <FieldLabel htmlFor="event-published" className="font-normal">Publish on the website</FieldLabel>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </FieldGroup>
      </fieldset></form>
    </CardContent>
  </Card>;
}
