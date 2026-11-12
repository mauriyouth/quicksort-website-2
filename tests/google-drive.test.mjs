import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createGoogleDriveHandler, contractFolderName } from '../apps/admin/server/google-drive.ts';
import { decryptApiKey, encryptApiKey } from '../apps/admin/server/ai-settings.ts';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-anon-key';
process.env.AI_SETTINGS_ENCRYPTION_KEY = '1'.repeat(64);

const personId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const rootFolderId = 'root-folder-id';
const contractFolderId = 'contract-folder-id';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = { client_email: 'contracts@example.iam.gserviceaccount.com', private_key: privateKeyPem };
const settings = { ...serviceAccount, root_folder_id: rootFolderId, root_folder_name: 'Contrats_Clients' };
const encrypted = encryptApiKey(JSON.stringify(settings));

/** Minimal PostgREST chain: every terminal returns `result` unless overridden. */
function chain(result, overrides = {}) {
  const c = {
    select: () => c,
    eq: () => c,
    order: () => c,
    maybeSingle: async () => (overrides.maybeSingle ? overrides.maybeSingle() : result),
    single: async () => (overrides.single ? overrides.single() : result),
    upsert: async (...args) => { (overrides.upserts ||= []).push(args); return { data: null, error: null }; },
    delete: async () => ({ data: null, error: null }),
    update: (...args) => { (overrides.updates ||= []).push(args); return c; },
  };
  return c;
}

function makeClient(overrides = {}) {
  return {
    rpc: async (name) => {
      assert.equal(name, 'sync_clerk_profile');
      return { data: personId, error: null };
    },
    from: (table) => {
      if (table === 'user_roles') return chain(null, { single: async () => ({ data: { role: 'admin' }, error: null }) });
      if (table === 'portal_owners') return chain(null, { maybeSingle: async () => ({ data: { user_id: personId }, error: null }) });
      if (table === 'google_drive_settings') return chain(null, { maybeSingle: async () => ({ data: { encrypted_credentials: encrypted, updated_at: '2026-10-23T09:00:00Z' }, error: null }) });
      if (table === 'sales_projects') return chain({ data: { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: null, drive_folder_name: null, drive_folder_link: null }, error: null }, overrides);
      if (table === 'sales_clients') return chain({ data: { id: clientId, name: 'Teamwill' }, error: null });
      if (table === 'document_folders') return chain({ data: null, error: null });
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function makeRes() {
  return { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
}

/** Routes Drive API calls; `drive` records requests as {url, method, body}. */
function mockDrive(t, drive, handlers = {}) {
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const target = String(url);
    if (target === 'https://oauth2.googleapis.com/token') {
      assert.equal(init.method, 'POST');
      const params = new URLSearchParams(init.body);
      assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      assert.ok(params.get('assertion').split('.').length === 3);
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-1', expires_in: 3600 }) };
    }
    if (target.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
      drive.push({ url: target, method: init.method, body: JSON.parse(init.body) });
      return handlers.uploadSession
        ? handlers.uploadSession(init)
        : { ok: true, status: 200, headers: { get: (name) => (name.toLowerCase() === 'location' ? 'https://www.googleapis.com/upload/drive/v3/session-1' : null) } };
    }
    if (target.startsWith('https://www.googleapis.com/drive/v3/files')) {
      drive.push({ url: target, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
      if (init.method === 'DELETE') return { ok: true, status: 204, json: async () => null };
      if (handlers.files) return handlers.files(target, init);
      const u = new URL(target);
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: contractFolderId, name: u.searchParams.get('fields') ? 'Teamwill/Refonte CRM' : '', webViewLink: 'https://drive.google.com/drive/folders/contract-folder-id' }) };
      // GET: folder search vs file read, distinguished by the path.
      // driveId: the folder sits in a Shared Drive, which uploads require.
      if (u.pathname.includes(contractFolderId)) return { ok: true, status: 200, json: async () => ({ id: contractFolderId, name: 'signed-contract.pdf', mimeType: 'application/pdf', size: '12345', modifiedTime: '2026-10-23T10:00:00Z', webViewLink: 'https://drive.google.com/file/d/abc', driveId: 'shared-drive-1' }) };
      return { ok: true, status: 200, json: async () => ({ files: [] }) };
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

test('contract folder names follow the Client/Contract convention', () => {
  assert.equal(contractFolderName('Teamwill', 'Refonte CRM'), 'Teamwill/Refonte CRM');
  assert.equal(contractFolderName('  Mc2i ', ' Migration  Data '), 'Mc2i/Migration Data');
  assert.ok(contractFolderName('Teamwill', 'Refonte CRM').length <= 200);
});

test('PUT saves the service account and resolves the Contrats_Clients root folder', async t => {
  const drive = [];
  mockDrive(t, drive, {
    files: async (target) => {
      const u = new URL(target);
      assert.match(u.searchParams.get('q'), /name='Contrats_Clients' and trashed=false/);
      return { ok: true, status: 200, json: async () => ({ files: [{ id: rootFolderId, name: 'Contrats_Clients', webViewLink: 'https://drive.google.com/drive/folders/root-folder-id' }] }) };
    },
  });
  const upserts = [];
  const base = makeClient();
  const client = {
    ...base,
    from: (table) => table === 'google_drive_settings'
      ? chain(null, { upserts })
      : base.from(table),
  };
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => client })(
    { method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { serviceAccountJson: JSON.stringify(serviceAccount), rootFolderId: '' } },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.saved, true);
  assert.equal(res.body.rootFolderName, 'Contrats_Clients');
  assert.equal(drive.length, 1, 'one Drive lookup (the root folder search)');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][0].id, 'connection');
  assert.ok(upserts[0][0].encrypted_credentials.startsWith('v1.'));
  assert.equal(upserts[0][0].encrypted_credentials.includes(privateKeyPem), false, 'key stored encrypted');
});

test('PUT with only the HR folder keeps the saved key and contracts root', async t => {
  const drive = [];
  mockDrive(t, drive, {
    files: async (target) => {
      const u = new URL(target);
      if (u.pathname.endsWith(`/files/${rootFolderId}`)) return { ok: true, status: 200, json: async () => ({ id: rootFolderId, name: 'Contrats_Clients' }) };
      if (u.pathname.endsWith('/files/hr-folder')) return { ok: true, status: 200, json: async () => ({ id: 'hr-folder', name: 'Collaborateurs' }) };
      throw new Error(`unexpected Drive call ${target}`);
    },
  });
  const upserts = [];
  const base = makeClient();
  const client = {
    ...base,
    from: (table) => table === 'google_drive_settings'
      ? chain(null, { upserts, maybeSingle: async () => ({ data: { encrypted_credentials: encrypted }, error: null }) })
      : base.from(table),
  };
  const handler = createGoogleDriveHandler({ createClient: () => client });
  let res = makeRes();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { peopleRootFolderId: 'hr-folder' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.rootFolderName, 'Contrats_Clients');
  assert.equal(res.body.peopleRootFolderName, 'Collaborateurs');
  assert.ok(!drive.some(d => new URL(d.url).searchParams.get('q')), 'No root folder search: the saved root is reused');
  const saved = JSON.parse(decryptApiKey(upserts[0][0].encrypted_credentials));
  assert.equal(saved.private_key, privateKeyPem, 'Saved key kept');
  assert.equal(saved.people_root_folder_id, 'hr-folder');

  res = makeRes();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { peopleRootFolderId: rootFolderId } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /must be separate from the contracts root/);
});

test('PUT with only the candidate CVs folder saves it and keeps it separate from the contracts root', async t => {
  const drive = [];
  mockDrive(t, drive, {
    files: async (target) => {
      const u = new URL(target);
      if (u.pathname.endsWith(`/files/${rootFolderId}`)) return { ok: true, status: 200, json: async () => ({ id: rootFolderId, name: 'Contrats_Clients' }) };
      if (u.pathname.endsWith('/files/cv-folder')) return { ok: true, status: 200, json: async () => ({ id: 'cv-folder', name: 'CVs' }) };
      throw new Error(`unexpected Drive call ${target}`);
    },
  });
  const upserts = [];
  const base = makeClient();
  const client = {
    ...base,
    from: (table) => table === 'google_drive_settings'
      ? chain(null, { upserts, maybeSingle: async () => ({ data: { encrypted_credentials: encrypted }, error: null }) })
      : base.from(table),
  };
  const handler = createGoogleDriveHandler({ createClient: () => client });
  let res = makeRes();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { recruitmentRootFolderId: 'https://drive.google.com/drive/u/1/folders/cv-folder' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.recruitmentRootFolderName, 'CVs');
  const saved = JSON.parse(decryptApiKey(upserts[0][0].encrypted_credentials));
  assert.equal(saved.recruitment_root_folder_id, 'cv-folder');

  res = makeRes();
  await handler({ method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { recruitmentRootFolderId: rootFolderId } }, res);
  assert.equal(res.code, 400);
  assert.match(res.body.error, /candidate CVs folder must be separate/);
});

test('PUT without a shared root folder explains the share step', async t => {
  const drive = [];
  mockDrive(t, drive, {
    files: async () => ({ ok: true, status: 200, json: async () => ({ files: [] }) }),
  });
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient() })(
    { method: 'PUT', headers: { authorization: 'Bearer actor' }, body: { serviceAccountJson: JSON.stringify(serviceAccount) } },
    res,
  );
  assert.equal(res.code, 502);
  assert.match(res.body.error, /Share your Drive contracts folder with the service-account email/);
});

test('prepare-upload creates the Client/Contract folder, links the project and opens a session', async t => {
  const drive = [];
  mockDrive(t, drive);
  const updates = [];
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({ updates }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'prepare-upload', projectId, fileName: 'signed-contract.pdf', mimeType: 'application/pdf', size: 12345 } },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.uploadUrl, 'https://www.googleapis.com/upload/drive/v3/session-1');
  assert.equal(res.body.folder.id, contractFolderId);
  const folderCreate = drive.find(d => d.method === 'POST' && String(d.url).includes('/drive/v3/files'));
  assert.equal(folderCreate.body.name, 'Teamwill/Refonte CRM');
  assert.deepEqual(folderCreate.body.parents, [rootFolderId]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0].drive_folder_id, contractFolderId);
  assert.equal(updates[0][0].drive_folder_name, 'Teamwill/Refonte CRM');
});

test('prepare-upload reuses the linked folder without creating a new one', async t => {
  const drive = [];
  mockDrive(t, drive);
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({
    single: async () => ({ data: { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: contractFolderId, drive_folder_name: 'Teamwill/Refonte CRM', drive_folder_link: 'https://drive.google.com/drive/folders/contract-folder-id' }, error: null }),
  }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'prepare-upload', projectId, fileName: 'annexe-1.pdf', mimeType: 'application/pdf', size: 5 } },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.folder.id, contractFolderId);
  assert.equal(drive.some(d => d.method === 'POST' && String(d.url).startsWith('https://www.googleapis.com/drive/v3/files')), false, 'no folder created');
  assert.ok(drive.some(d => String(d.url).startsWith('https://www.googleapis.com/upload/')), 'upload session opened');
});

test('list-files and confirm-upload read Drive, delete-file trashes', async t => {
  const drive = [];
  mockDrive(t, drive, {
    files: async (target) => {
      const u = new URL(target);
      if (u.pathname.endsWith(`/files/${contractFolderId}`))
        return { ok: true, status: 200, json: async () => ({ id: contractFolderId, name: 'signed-contract.pdf', mimeType: 'application/pdf', size: '12345', modifiedTime: '2026-10-23T10:00:00Z' }) };
      assert.match(u.searchParams.get('q'), /'contract-folder-id' in parents and trashed=false/);
      return { ok: true, status: 200, json: async () => ({ files: [{ id: 'f1', name: 'annexe.pdf', mimeType: 'application/pdf', size: '99' }] }) };
    },
  });
  const handler = createGoogleDriveHandler({ createClient: () => makeClient({
    single: async () => ({ data: { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: contractFolderId, drive_folder_name: 'Teamwill/Refonte CRM', drive_folder_link: 'https://drive.google.com/drive/folders/contract-folder-id' }, error: null }),
  }) });

  const listRes = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'list-files', folderId: contractFolderId } }, listRes);
  assert.equal(listRes.code, 200);
  assert.equal(listRes.body.files.length, 1);
  assert.equal(listRes.body.files[0].name, 'annexe.pdf');

  const confirmRes = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'confirm-upload', projectId, fileId: contractFolderId } }, confirmRes);
  assert.equal(confirmRes.code, 200);
  assert.equal(confirmRes.body.file.size, '12345');

  const deleteRes = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'delete-file', fileId: 'f1' } }, deleteRes);
  assert.equal(deleteRes.code, 200);
  assert.ok(drive.some(d => d.method === 'DELETE' && d.url.includes('/files/f1')));
});

test('non-admins are rejected', async t => {
  const client = {
    rpc: async () => ({ data: personId, error: null }),
    from: (table) => table === 'user_roles'
      ? chain(null, { single: async () => ({ data: { role: 'hr' }, error: null }) })
      : chain(null),
  };
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => client })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'list-files', folderId: contractFolderId } },
    res,
  );
  assert.equal(res.code, 403);
});

test('GET reports the connection without exposing the key', async t => {
  mockDrive(t, []);
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient() })(
    { method: 'GET', headers: { authorization: 'Bearer actor' }, body: undefined },
    res,
  );
  assert.equal(res.code, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.serviceAccountEmail, serviceAccount.client_email);
  assert.equal(res.body.rootFolderName, 'Contrats_Clients');
  assert.equal(JSON.stringify(res.body).includes('PRIVATE KEY'), false);
});

/** Drive mock for the archive moves: folders by name, parents per file. */
function mockArchiveDrive(t, drive, { parents = [rootFolderId], existing = {} } = {}) {
  let created = 0;
  mockDrive(t, drive, {
    files: async (target, init) => {
      const u = new URL(target);
      if (init.method === 'POST') {
        const body = JSON.parse(init.body);
        const id = `new-${body.name}-${++created}`;
        existing[`${body.parents[0]}/${body.name}`] = id;
        return { ok: true, status: 200, json: async () => ({ id, name: body.name }) };
      }
      if (init.method === 'PATCH') return { ok: true, status: 200, json: async () => ({ id: contractFolderId, parents: [u.searchParams.get('addParents')] }) };
      if (u.pathname.endsWith(`/files/${contractFolderId}`)) return { ok: true, status: 200, json: async () => ({ id: contractFolderId, parents }) };
      const q = u.searchParams.get('q') || '';
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name='([^']+)'/.exec(q)?.[1];
      const id = existing[`${parent}/${name}`];
      return { ok: true, status: 200, json: async () => ({ files: id ? [{ id, name }] : [] }) };
    },
  });
}

const linkedProject = (over = {}) => ({ data: { id: projectId, title: 'Refonte CRM', client_id: clientId, end_date: '2026-06-30', drive_folder_id: contractFolderId, drive_folder_name: 'Teamwill/Refonte CRM', drive_folder_link: null, ...over }, error: null });

test('archive-folder moves the contract folder into archived/<end year>', async t => {
  const drive = [];
  mockArchiveDrive(t, drive);
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({ single: async () => linkedProject() }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'archive-folder', projectId, archived: true } },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.moved, true);
  const creates = drive.filter(d => d.method === 'POST').map(d => [d.body.name, d.body.parents[0]]);
  assert.deepEqual(creates, [['archived', rootFolderId], ['2026', 'new-archived-1']]);
  const move = new URL(drive.find(d => d.method === 'PATCH').url);
  assert.equal(move.pathname.endsWith(`/files/${contractFolderId}`), true);
  assert.equal(move.searchParams.get('addParents'), 'new-2026-2');
  assert.equal(move.searchParams.get('removeParents'), rootFolderId);
});

test('archive-folder restores to the root, and is a no-op when already in place or unlinked', async t => {
  const drive = [];
  mockArchiveDrive(t, drive, { parents: ['year-folder'] });
  const res = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({ single: async () => linkedProject() }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'archive-folder', projectId, archived: false } },
    res,
  );
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const move = new URL(drive.find(d => d.method === 'PATCH').url);
  assert.equal(move.searchParams.get('addParents'), rootFolderId);
  assert.equal(move.searchParams.get('removeParents'), 'year-folder');

  const again = [];
  t.mock.restoreAll();
  mockArchiveDrive(t, again);
  const res2 = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({ single: async () => linkedProject() }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'archive-folder', projectId, archived: false } },
    res2,
  );
  assert.equal(res2.body.moved, false);
  assert.equal(again.some(d => d.method === 'PATCH'), false);

  const none = [];
  t.mock.restoreAll();
  mockArchiveDrive(t, none);
  const res3 = makeRes();
  await createGoogleDriveHandler({ createClient: () => makeClient({ single: async () => linkedProject({ drive_folder_id: null }), maybeSingle: async () => ({ data: null, error: null }) }) })(
    { method: 'POST', headers: { authorization: 'Bearer actor' }, body: { action: 'archive-folder', projectId, archived: true } },
    res3,
  );
  assert.equal(res3.code, 200, JSON.stringify(res3.body));
  assert.equal(res3.body.moved, false);
  assert.equal(none.some(d => d.method === 'PATCH' || d.method === 'POST'), false);
});
