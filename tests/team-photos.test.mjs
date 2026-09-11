import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import handler from '../apps/candidate/api/team-photo.mjs';
import photos from '../apps/candidate/src/teamPhotos.json' with { type: 'json' };

test('photo downloads require verified authentication and share every portrait with signed-in users', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.VITE_SUPABASE_URL;
  const originalKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  let verified = false;
  globalThis.fetch = async () => new Response(JSON.stringify(verified ? { id: 'candidate-a' } : {}), { status: verified ? 200 : 401 });
  async function request(url, authorization, method = 'GET') {
    const res = { code: 200, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
      send(body) { this.body = body; return this; },
    };
    await handler({ method, url, headers: { authorization } }, res);
    return res;
  }
  try {
    assert.equal((await request('/api/team-photo?photo=issa-hammoud&size=hd')).code, 401);
    assert.equal((await request('/api/team-photo?photo=issa-hammoud&size=hd', 'Bearer invalid')).code, 401);
    verified = true;
    assert.equal((await request('/api/team-photo?photo=../../secret', 'Bearer valid')).code, 404);
    assert.equal((await request('/api/team-photo?photo=issa-hammoud&size=original', 'Bearer valid')).code, 404);
    assert.equal((await request('/api/team-photo', 'Bearer valid', 'POST')).code, 405);
    assert.equal(photos.length, 13);
    if (!existsSync(new URL('../apps/candidate/private/team-photos', import.meta.url))) {
      t.diagnostic('Private HD assets absent: file-serving checks run in the deployment checkout only.');
      return;
    }
    for (const photo of photos) {
      assert.ok(photo.width >= 1600 && photo.height >= 2400);
      for (const size of ['preview', 'hd']) {
        const result = await request(`/api/team-photo?photo=${photo.id}&size=${size}`, 'Bearer valid');
        assert.equal(result.code, 200, `${photo.id} ${size}`);
        assert.equal(result.body.readUInt16BE(0), 0xffd8);
        assert.ok(result.body.length < 4.5 * 1024 * 1024);
        assert.equal(result.headers['Cache-Control'], 'private, no-store');
        if (size === 'hd') assert.match(result.headers['Content-Disposition'], /^attachment/);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY; else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
