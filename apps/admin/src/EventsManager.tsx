import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, ArrowUpRight } from 'lucide-react';
import { db, errorMessage, type Row, type Database } from '@quicksort/candidate-db';
import { Heading, Notice, Empty, Pill } from '@quicksort/candidate-ui';

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
  return <>
    <Heading title="Events" eyebrow="Community" action={<button className="btn" disabled={busy} onClick={() => { setEditing(null); setError(''); setMessage(''); }}><Plus size={16}/>Add event</button>}>
      Manage the cards in the website’s circular gallery. Published changes appear without a website deployment.
    </Heading>
    <Notice error>{error}</Notice><Notice>{message}</Notice>
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
    <section className="panel">
      <div className="panel-head"><h2>Event cards</h2><button className="btn secondary small" disabled={busy || loading} onClick={() => {setError(''); void load();}}>Refresh</button></div>
      {loading && <p role="status">Loading events…</p>}
      {!loading && !events.length && !error && <Empty title="No events yet">Add an event and its banner to start your gallery.</Empty>}
      {events.map(event => <div className="list-row" key={event.id}>
        <div style={{display:'flex',alignItems:'center',gap:16,minWidth:0}}>
          <img src={event.banner_url} alt="" width={80} height={80} style={{objectFit:'contain',borderRadius:8,flexShrink:0}}/>
          <div><h3>{event.title}</h3><p className="muted">{new Date(event.event_date + 'T12:00:00').toLocaleDateString()} · {event.location}</p><Pill status={event.published ? 'published' : 'draft'}/></div>
        </div>
        <div className="actions">
          <a className="btn secondary small" href={event.event_url} target="_blank" rel="noopener noreferrer">Luma <ArrowUpRight size={14}/></a>
          <button className="btn secondary small" disabled={busy} onClick={() => {setEditing(event);setError('');setMessage('');}}>Edit</button>
          <button className="btn secondary small" disabled={busy} onClick={() => void action(async () => {
            const result = await db().from('events').update({published: !event.published}).eq('id', event.id).eq('updated_at', event.updated_at).select('id').single();
            checkUpdate(result.error);
            if (editing?.id === event.id) setEditing(undefined);
          }, event.published ? 'Event hidden from the website.' : 'Event published on the website.')}>{event.published ? 'Unpublish' : 'Publish'}</button>
        </div>
      </div>)}
    </section>
  </>;
}

function EventEditor({event,busy,onSave,onCancel}: {event:EventRecord|null;busy:boolean;onSave:(values:EventValues,file:File|null)=>Promise<void>;onCancel:()=>void}) {
  const [file,setFile] = useState<File|null>(null);
  const [preview,setPreview] = useState(event?.banner_url || '');
  const [error,setError] = useState('');
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
    void onSave({title:value('title'),event_date:value('event_date'),location:value('location'),event_url:value('event_url'),banner_url:event?.banner_url || '',published:form.get('published') === 'on'},file);
  }
  return <section className="panel"><h2>{event ? 'Edit event' : 'Add event'}</h2><Notice error>{error}</Notice>
    <form className="form" onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,display:'grid',gap:20,minWidth:0}}>
      <label>Event title<input name="title" required maxLength={200} defaultValue={event?.title}/></label>
      <div className="form-columns">
        <label>Date<input type="date" name="event_date" required defaultValue={event?.event_date}/></label>
        <label>Location<input name="location" required maxLength={160} defaultValue={event?.location || 'Paris'}/></label>
      </div>
      <label>Luma event link<input type="url" name="event_url" required maxLength={2000} defaultValue={event?.event_url} placeholder="https://luma.com/your-event"/></label>
      <label>Event banner<input type="file" accept="image/jpeg,image/png,image/webp" required={!event && !file} onChange={e => {
        const next=e.target.files?.[0]; if (!next) return;
        if (!['image/jpeg','image/png','image/webp'].includes(next.type) || next.size > 5*1024*1024 || !next.size) {setError('Choose a JPG, PNG or WebP banner up to 5 MB.');e.target.value='';return;}
        setError('');setFile(next);
      }}/><span className="muted small-text">Square banners work best. JPG, PNG or WebP, up to 5 MB.</span></label>
      {preview && <img src={preview} alt="Event banner preview" width={220} height={220} style={{objectFit:'contain',borderRadius:12,maxWidth:'100%'}}/>}
      <label className="check"><input type="checkbox" name="published" defaultChecked={event?.published}/>Publish on the website</label>
      <div className="actions"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button><button type="button" className="btn secondary" onClick={onCancel}>Cancel</button></div>
    </fieldset></form>
  </section>;
}
