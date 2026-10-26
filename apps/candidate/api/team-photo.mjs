import { readFile } from 'node:fs/promises';
import photos from '../src/teamPhotos.json' with { type: 'json' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please sign in to view team photos.' });
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Photo service is not configured.' });
  try {
    const verified = await fetch(`${url}/rest/v1/rpc/sync_clerk_profile`, {
      method: 'POST',
      headers: { authorization, apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    const identity = verified.ok ? await verified.json() : null;
    if (typeof identity !== 'string' || !/^[0-9a-f-]{36}$/i.test(identity)) {
      return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    }
    const query = new URL(req.url, 'http://localhost').searchParams;
    const photo = photos.find((item) => item.id === query.get('photo'));
    const size = query.get('size') || 'preview';
    if (!photo || !['preview', 'hd'].includes(size)) {
      return res.status(404).json({ error: 'Photo not found.' });
    }
    const file = new URL(`../private/team-photos/${photo.id}-${size}.jpg`, import.meta.url);
    const bytes = await readFile(file);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `${size === 'hd' ? 'attachment' : 'inline'}; filename="${photo.id}-portrait.jpg"`);
    return res.status(200).send(bytes);
  } catch {
    return res.status(503).json({ error: 'Photos are temporarily unavailable. Please try again.' });
  }
}
