import { useEffect, useState } from 'react';
import { Download, ImageIcon } from 'lucide-react';
import { db, errorMessage, saveBlob } from '@quicksort/db';
import { Heading, Notice } from '@quicksort/ui';
import photos from './teamPhotos.json';
import './teamPhotos.css';

async function fetchPhoto(id: string, size: 'preview' | 'hd', signal?: AbortSignal) {
  const { data, error } = await db().auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Please sign in to view team photos.');
  const response = await fetch(`/api/team-photo?photo=${encodeURIComponent(id)}&size=${size}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }, signal,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error || 'Unable to load this photo. Please try again.');
  }
  return response.blob();
}

function PhotoCard({ photo }: { photo: (typeof photos)[number] }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setError('');
    void fetchPhoto(photo.id, 'preview', controller.signal).then((blob) => {
      if (!controller.signal.aborted) {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      }
    }).catch((e) => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id, attempt]);
  async function download() {
    setBusy(true); setError('');
    try { saveBlob(await fetchPhoto(photo.id, 'hd'), `${photo.id}-portrait-hd.jpg`); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <article className="team-photo-card">
    <div className="team-photo-frame">
      {src ? <img src={src} alt={`${photo.name} portrait`} width={480} height={720} />
        : <span role="status"><ImageIcon size={28} />{error ? 'Photo unavailable' : 'Loading portrait…'}</span>}
    </div>
    <div className="team-photo-details">
      <h2>{photo.name}</h2>
      <p className="muted small-text">JPEG · {photo.width} × {photo.height} px</p>
      <button className="btn secondary" onClick={() => void download()} disabled={busy} aria-label={`Download HD photo of ${photo.name}`}>
        <Download size={16} />{busy ? 'Downloading…' : 'Download HD'}
      </button>
      {error && <><Notice error>{error}</Notice>{!src && <button className="link-button" onClick={() => setAttempt((n) => n + 1)}>Retry photo</button>}</>}
    </div>
  </article>;
}

export function TeamPhotos() {
  return <>
    <Heading eyebrow="Shared gallery" title="Team photos">
      Browse everyone’s portraits and download a high-resolution photo. This gallery is shared with all signed-in candidates.
    </Heading>
    <div className="team-photo-grid">{photos.map((photo) => <PhotoCard key={photo.id} photo={photo} />)}</div>
  </>;
}
