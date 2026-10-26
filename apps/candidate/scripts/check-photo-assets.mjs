import { access } from 'node:fs/promises';
import photos from '../src/teamPhotos.json' with { type: 'json' };
if (process.env.VERCEL) {
  for (const photo of photos) for (const size of ['preview', 'hd']) {
    await access(new URL('../private/team-photos/' + photo.id + '-' + size + '.jpg', import.meta.url));
  }
}
