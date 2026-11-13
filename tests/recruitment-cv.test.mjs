import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRecruitmentCvHandler, cleanName, cvYear, uniqueCvName, SPONTANEOUS_FOLDER } from '../apps/admin/server/recruitment-cv.ts';
import { encryptApiKey } from '../apps/admin/server/ai-settings.ts';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-anon-key';
process.env.AI_SETTINGS_ENCRYPTION_KEY = '1'.repeat(64);

const actorId = '11111111-1111-4111-8111-111111111111';
const personId = '44444444-4444-4444-8444-444444444444';
const cvRoot = 'cv-root';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'cv@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const withCvRoot = encryptApiKey(JSON.stringify({ ...sa, root_folder_id: 'contracts', root_folder_name: 'Contrats_Clients', recruitment_root_folder_id: cvRoot, recruitment_root_folder_name: 'CVs' }));
const withoutCvRoot = encryptApiKey(JSON.stringify({ ...sa, root_folder_id: 'contracts', root_folder_name: 'Contrats_Clients' }));
const pdf = Buffer.from('%PDF-1.7 fake cv');

function makeClient({ role = 'hr', encrypted = withCvRoot, download = pdf } = {}) {
  const single = (data) => ({ select: () => ({ eq: () => ({ single: async () => ({ data, error: null }), maybeSingle: async () => ({ data, error: null }) }) }) });
  return {
    rpc: async () => ({ data: actorId, error: null }),
    from: (table) => {
      if (table === 'user_roles') return single({ role });
      if (table === 'google_drive_settings') return single({ encrypted_credentials: encrypted });
      throw new Error(`unexpected table ${table}`);
    },
    storage: { from: () => ({ download: async () => (download ? { data: new Blob([download]), error: null } : { data: null, error: { message: 'missing' } }) }) },
  };
}

const makeRes = () => ({ code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });

/**
 * Fake Drive: folders by (parent, name), files with parents/appProperties.
 * Records every call as { method, url, body }.
 */
function mockDrive(t, { files = [] } = {}) {
  const calls = [];
  const folders = new Map();
  let nextId = 1;
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method || 'GET';
    if (target.host === 'oauth2.googleapis.com') return json({ access_token: 't', expires_in: 3600 });
    calls.push({ method, url: target, body: init.body });
    if (target.pathname === '/upload/drive/v3/files') {
      const meta = JSON.parse(init.body.toString('utf8').split('\r\n\r\n')[1].split('\r\n')[0]);
      const file = { id: `file-${nextId++}`, ...meta };
      files.push(file);
      return json(file);
    }
    const copy = target.pathname.match(/\/files\/([^/]+)\/copy$/);
    if (copy) {
      const body = JSON.parse(init.body);
      const file = { id: `copy-${nextId++}`, ...body };
      files.push(file);
      return json(file);
    }
    if (target.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body);
      const folder = { id: `folder-${nextId++}`, name: body.name };
      folders.set(`${body.parents[0]}/${body.name}`, folder);
      return json(folder);
    }
    if (target.pathname === '/drive/v3/files') {
      const q = target.searchParams.get('q');
      const person = q.match(/value='([^']+)'/);
      if (person) return json({ files: files.filter(f => f.appProperties?.quicksortPersonId === person[1]) });
      const folderQuery = q.match(/name='([^']+)' and '([^']+)' in parents/);
      if (folderQuery) {
        const hit = folders.get(`${folderQuery[2]}/${folderQuery[1]}`);
        return json({ files: hit ? [hit] : [] });
      }
      const parent = q.match(/'([^']+)' in parents/)[1];
      return json({ files: files.filter(f => f.parents?.includes(parent)) });
    }
    // GET /files/<id>: Shared Drive check before uploads.
    return json({ id: target.pathname.split('/').pop(), name: 'folder', driveId: 'shared-1' });
  });
  return { calls, folders, files };
}

const post = async (body, client = makeClient()) => {
  const res = makeRes();
  await createRecruitmentCvHandler({ createClient: () => client })({ method: 'POST', headers: { authorization: 'Bearer actor' }, body }, res);
  return res;
};

test('CV naming helpers', () => {
  assert.equal(cleanName(' Jane / Doe\n'), 'Jane Doe');
  assert.equal(cvYear('2025-12-30T10:00:00Z'), '2025');
  assert.equal(cvYear(null, new Date('2026-11-07T12:00:00Z')), '2026');
  const now = new Date('2026-11-07T12:00:00Z');
  assert.equal(uniqueCvName('Jane Doe', new Set(), now), 'Jane Doe.pdf');
  assert.equal(uniqueCvName('Jane Doe', new Set(['Jane Doe.pdf']), now), 'Jane Doe – 2026-11-07.pdf');
  assert.equal(uniqueCvName('Jane Doe', new Set(['Jane Doe.pdf', 'Jane Doe – 2026-11-07.pdf']), now), 'Jane Doe – 2026-11-07 (2).pdf');
});

test('file: uploads the PDF into <root>/<opening year>/<position>, tagged with the person', async t => {
  const drive = mockDrive(t);
  const res = await post({ action: 'file', storagePath: 'user_abc/0d6c1d1e-1111-4111-8111-111111111111.pdf', personId, personName: 'Jane Doe', position: { title: 'Data Engineer', openedAt: '2025-12-01T09:00:00Z' } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const year = drive.folders.get(`${cvRoot}/2025`);
  assert.ok(year, 'year folder created under the CV root');
  const position = drive.folders.get(`${year.id}/Data Engineer`);
  assert.ok(position, 'position folder created under the year');
  assert.equal(res.body.file.name, 'Jane Doe.pdf');
  assert.deepEqual(res.body.file.parents, [position.id]);
  assert.equal(res.body.file.appProperties.quicksortPersonId, personId);
});

test('file: without a position goes to Candidatures spontanées, dated on name clash', async t => {
  const drive = mockDrive(t);
  const body = { action: 'file', storagePath: 'user_abc/0d6c1d1e-1111-4111-8111-111111111111.pdf', personId, personName: 'Jane Doe', position: null };
  await post(body);
  const res = await post(body);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const year = drive.folders.get(`${cvRoot}/${new Date().getFullYear()}`);
  assert.ok(drive.folders.get(`${year.id}/${SPONTANEOUS_FOLDER}`));
  assert.match(res.body.file.name, /^Jane Doe – \d{4}-\d{2}-\d{2}\.pdf$/);
});

test('file: rejects non-PDF content and unsafe storage paths', async t => {
  mockDrive(t);
  let res = await post({ action: 'file', storagePath: 'user_abc/0d6c1d1e-1111-4111-8111-111111111111.pdf', personId, personName: 'Jane' }, makeClient({ download: Buffer.from('not a pdf') }));
  assert.equal(res.code, 400);
  res = await post({ action: 'file', storagePath: '../other/x.pdf', personId, personName: 'Jane' });
  assert.equal(res.code, 400);
});

test('copy: copies the latest CV into the position folder once', async t => {
  const drive = mockDrive(t, { files: [{ id: 'cv-1', name: 'Jane Doe.pdf', parents: ['elsewhere'], appProperties: { quicksortPersonId: personId } }] });
  const body = { action: 'copy', personId, personName: 'Jane Doe', position: { title: 'Data Engineer', openedAt: '2026-03-01T00:00:00Z' } };
  let res = await post(body);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.copied, true);
  assert.ok(drive.calls.some(c => c.method === 'POST' && c.url.pathname.endsWith('/files/cv-1/copy')));
  res = await post(body);
  assert.equal(res.body.copied, false);
  assert.equal(res.body.reason, 'already-filed');
});

test('copy: no CV on Drive is not an error', async t => {
  mockDrive(t);
  const res = await post({ action: 'copy', personId, personName: 'Jane', position: { title: 'X', openedAt: '2026-01-01' } });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { copied: false, reason: 'no-cv' });
});

test('access: HR or admin only, and the CV folder must be configured', async t => {
  mockDrive(t);
  const body = { action: 'copy', personId, personName: 'Jane', position: { title: 'X', openedAt: '2026-01-01' } };
  let res = await post(body, makeClient({ role: 'candidate' }));
  assert.equal(res.code, 403);
  res = await post(body, makeClient({ encrypted: withoutCvRoot }));
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'not-configured');
});

test('find: returns the newest filed CV, or null when none is filed', async t => {
  mockDrive(t, { files: [{ id: 'cv-9', name: 'Jane Doe.pdf', parents: ['p'], appProperties: { quicksortPersonId: personId } }] });
  let res = await post({ action: 'find', personId });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.file.id, 'cv-9');
  res = await post({ action: 'find', personId: '55555555-5555-4555-8555-555555555555' });
  assert.equal(res.code, 200);
  assert.equal(res.body.file, null);
});
