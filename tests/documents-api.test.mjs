import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentsHandler } from '../apps/admin/server/documents/handler.ts';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-anon-key';

const actorId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const clientId = '44444444-4444-4444-8444-444444444444';
const documentId = '55555555-5555-4555-8555-555555555555';

const types = [
  { code: 'CNI', label: "Carte d'identité", owner_kinds: ['person'], folder: 'identite', requires_expiry: true },
  { code: 'RIB', label: 'RIB', owner_kinds: ['person'], folder: 'administratif', requires_expiry: false },
  { code: 'CLIENT_CONTRACT', label: 'Contrat principal', owner_kinds: ['project'], folder: 'contrat', requires_expiry: false },
];

/** In-memory PostgREST: eq filters, maybeSingle/single, upsert with ignoreDuplicates. */
function fakeSupabase({ role = 'admin', tables = {}, rpc = {} } = {}) {
  const db = {
    user_roles: [{ user_id: actorId, role }],
    document_types: types,
    hr_people: [{ id: personId, full_name: 'Ada Lovelace' }],
    sales_clients: [{ id: clientId, name: 'Teamwill' }],
    sales_projects: [{ id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: null }],
    document_folders: [],
    documents: [],
    ...tables,
  };
  const calls = [];
  const query = table => {
    const filters = [];
    const rows = () => db[table].filter(row => filters.every(([k, v]) => row[k] === v));
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push([k, v]); return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => (rows()[0] ? { data: rows()[0], error: null } : { data: null, error: { code: 'PGRST116' } }),
      then: (resolve) => resolve({ data: rows(), error: null }),
      upsert: async (row, opts) => {
        const keys = opts.onConflict.split(',');
        if (!db[table].some(r => keys.every(k => r[k] === row[k]))) db[table].push(row);
        return { error: null };
      },
    };
    return q;
  };
  return {
    db,
    calls,
    client: {
      rpc: async (name, args) => {
        calls.push([name, args]);
        if (name === 'sync_clerk_profile') return { data: actorId, error: null };
        if (rpc[name]) return rpc[name](args, db);
        return { data: null, error: null };
      },
      from: table => {
        if (!(table in db)) throw new Error(`unexpected table ${table}`);
        return query(table);
      },
      storage: { from: bucket => ({ download: async path => ({ data: new Blob([`${bucket}:${path}`]), error: null }) }) },
    },
  };
}

/** Storage double: folders are created on demand and files are put in place by the test. */
function fakeStorage() {
  const log = [];
  let n = 0;
  const files = {};
  return {
    log,
    files,
    provider: 'gdrive',
    async ensureFolder(root, path) { log.push(['ensureFolder', root, path]); return { id: `${root}:${path.join('|')}`, name: path.at(-1), link: null }; },
    async ensureChild(parent, name) { log.push(['ensureChild', parent.id, name]); return { id: `${parent.id}>${name}#${++n}`, name, link: null }; },
    async prepareUpload(folder, file) { log.push(['prepareUpload', folder.id, file]); return { uploadUrl: 'https://upload.example/1', method: 'PUT', headers: {}, fileId: null }; },
    async getFile(id) { return files[id]; },
    async listFiles() { return []; },
    async download(id) { return new globalThis.Response(`drive:${id}`); },
    async move(id, from, to) { log.push(['move', id, from, to]); },
    async trash(id) { log.push(['trash', id]); },
  };
}

function makeRes() {
  return {
    code: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

const call = async (handler, body) => {
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body }, res);
  return res;
};

const setup = (options = {}) => {
  const supa = fakeSupabase(options);
  const storage = fakeStorage();
  const handler = createDocumentsHandler({ createClient: () => supa.client, storage: async () => storage });
  return { supa, storage, handler };
};

test('prepare-upload files a person document under the HR tree and caches the folders', async () => {
  const { supa, storage, handler } = setup({ role: 'hr' });
  const res = await call(handler, { action: 'prepare-upload', owner: { kind: 'person', id: personId }, typeCode: 'CNI', title: 'Recto verso', fileName: 'scan.pdf', mimeType: 'application/pdf', size: 1200, expiresOn: '2034-05-01' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.fileName, 'ada_lovelace_cni.pdf');
  assert.deepEqual(storage.log[0], ['ensureFolder', 'people', ['LOVELACE Ada – 22222222']]);
  assert.equal(storage.log[1][2], '01_Identite');
  assert.deepEqual(supa.db.document_folders.map(f => f.folder_code), ['', 'identite']);

  // Second upload reuses the cached folders: no Drive folder lookups.
  storage.log.length = 0;
  await call(handler, { action: 'prepare-upload', owner: { kind: 'person', id: personId }, typeCode: 'CNI', title: 'Again', fileName: 'scan.pdf', size: 1, expiresOn: '2034-05-01' });
  assert.deepEqual(storage.log.map(entry => entry[0]), ['prepareUpload']);
});

test('prepare-upload refuses a missing expiry, a wrong owner and sales documents for HR', async () => {
  const { handler } = setup({ role: 'hr' });
  const base = { action: 'prepare-upload', title: 'x', fileName: 'x.pdf', size: 1 };
  let res = await call(handler, { ...base, owner: { kind: 'person', id: personId }, typeCode: 'CNI' });
  assert.equal(res.code, 400);
  assert.match(res.body.error, /needs an expiry date/);
  res = await call(handler, { ...base, owner: { kind: 'person', id: personId }, typeCode: 'CLIENT_CONTRACT' });
  assert.match(res.body.error, /cannot be filed on a person/);
  res = await call(handler, { ...base, owner: { kind: 'project', id: projectId }, typeCode: 'CLIENT_CONTRACT' });
  assert.equal(res.code, 403);
});

test('project uploads reuse the legacy contract folder linked on the project', async () => {
  const { storage, handler } = setup({ tables: { sales_projects: [{ id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: 'legacy-folder', drive_folder_name: 'Teamwill/Refonte CRM', drive_folder_link: null }] } });
  const res = await call(handler, { action: 'prepare-upload', owner: { kind: 'project', id: projectId }, typeCode: 'CLIENT_CONTRACT', title: 'Contrat signé', fileName: 'c.pdf', size: 10 });
  assert.equal(res.code, 200);
  assert.ok(!storage.log.some(entry => entry[0] === 'ensureFolder'), 'No new project folder');
  assert.deepEqual(storage.log[0], ['ensureChild', 'legacy-folder', '01_Contrat']);
});

test('register checks the file location, then registers through register_document', async () => {
  const { supa, storage, handler } = setup({
    tables: { document_folders: [{ storage_provider: 'gdrive', owner_kind: 'person', owner_id: personId, folder_code: 'identite', provider_folder_id: 'folder-id' }] },
    rpc: { register_document: (args) => ({ data: { id: documentId, ...args.document }, error: null }) },
  });
  storage.files['file-1'] = { id: 'file-1', name: '2026-10-31_CNI.pdf', mimeType: 'application/pdf', size: 1200, folderIds: ['folder-id'], sha256: 'ab'.repeat(32), link: null, modifiedAt: null };
  storage.files['stray'] = { ...storage.files['file-1'], id: 'stray', folderIds: ['elsewhere'] };
  const body = { action: 'register', owner: { kind: 'person', id: personId }, folderId: 'folder-id', typeCode: 'CNI', title: 'CNI', expiresOn: '2034-05-01' };

  let res = await call(handler, { ...body, folderId: 'someone-elses-folder', fileId: 'file-1' });
  assert.equal(res.code, 400);
  res = await call(handler, { ...body, fileId: 'stray' });
  assert.match(res.body.error, /not in the expected folder/);

  res = await call(handler, { ...body, fileId: 'file-1', supersedes: documentId });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const [, args] = supa.calls.find(([name]) => name === 'register_document');
  assert.equal(args.supersedes, documentId);
  assert.equal(args.document.person_id, personId);
  assert.equal(args.document.project_id, null);
  assert.equal(args.document.size_bytes, 1200, 'Size comes from storage, not the browser');
  assert.equal(args.document.sha256, 'ab'.repeat(32));
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'));
});

test('a refused registration trashes the orphan upload and shows the database reason', async () => {
  const { storage, handler } = setup({
    tables: { document_folders: [{ storage_provider: 'gdrive', owner_kind: 'person', owner_id: personId, folder_code: 'identite', provider_folder_id: 'folder-id' }] },
    rpc: { register_document: () => ({ data: null, error: { code: 'P0001', message: 'Only an active document can be renewed.' } }) },
  });
  storage.files['file-1'] = { id: 'file-1', name: 'x.pdf', mimeType: '', size: 1, folderIds: ['folder-id'], sha256: null, link: null, modifiedAt: null };
  const res = await call(handler, { action: 'register', owner: { kind: 'person', id: personId }, folderId: 'folder-id', fileId: 'file-1', typeCode: 'RIB', title: 'RIB' });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'Only an active document can be renewed.');
  assert.deepEqual(storage.log.at(-1), ['trash', 'file-1']);
});

test('a double-submitted registration returns the existing document and keeps the file', async () => {
  const existing = { id: documentId, storage_provider: 'gdrive', provider_file_id: 'file-1' };
  const { storage, handler } = setup({
    tables: {
      document_folders: [{ storage_provider: 'gdrive', owner_kind: 'person', owner_id: personId, folder_code: 'identite', provider_folder_id: 'folder-id' }],
      documents: [existing],
    },
    rpc: { register_document: () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) },
  });
  storage.files['file-1'] = { id: 'file-1', name: 'x.pdf', mimeType: '', size: 1, folderIds: ['folder-id'], sha256: null, link: null, modifiedAt: null };
  const res = await call(handler, { action: 'register', owner: { kind: 'person', id: personId }, folderId: 'folder-id', fileId: 'file-1', typeCode: 'RIB', title: 'RIB' });
  assert.equal(res.code, 200);
  assert.equal(res.body.document.id, documentId);
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'));
});

test('download logs person documents and streams Drive and Supabase files', async () => {
  const doc = { id: documentId, owner_kind: 'person', storage_provider: 'gdrive', provider_file_id: 'file-1', file_name: 'Carte d’identité.pdf', mime_type: 'application/pdf', size_bytes: 10 };
  const { supa, handler } = setup({ role: 'hr', tables: { documents: [doc] } });
  let res = await call(handler, { action: 'download', documentId });
  assert.equal(res.code, 200);
  assert.equal(res.body.toString(), 'drive:file-1');
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.match(res.headers['content-disposition'], /filename\*=UTF-8''Carte%20d%E2%80%99identit%C3%A9\.pdf/);
  assert.ok(supa.calls.some(([name, args]) => name === 'log_document_access' && args.document_id === documentId));

  doc.storage_provider = 'supabase';
  doc.provider_file_id = 'contracts/offers/contract.pdf';
  res = await call(handler, { action: 'download', documentId });
  assert.equal(res.body.toString(), 'contracts:offers/contract.pdf');
});

test('download of a large file answers a link, and unknown documents are 404', async () => {
  const doc = { id: documentId, owner_kind: 'project', storage_provider: 'gdrive', provider_file_id: 'file-1', file_name: 'big.pdf', mime_type: 'application/pdf', size_bytes: 50 * 1024 * 1024 };
  const { supa, storage, handler } = setup({ tables: { documents: [doc] } });
  storage.files['file-1'] = { id: 'file-1', link: 'https://drive.google.com/file/d/file-1' };
  let res = await call(handler, { action: 'download', documentId });
  assert.deepEqual(res.body, { link: 'https://drive.google.com/file/d/file-1' });
  assert.ok(!supa.calls.some(([name]) => name === 'log_document_access'), 'Only person documents are access-logged');
  res = await call(handler, { action: 'download', documentId: '66666666-6666-4666-8666-666666666666' });
  assert.equal(res.code, 404);
});

test('list-unfiled shows loose legacy files only, and file-existing moves then registers them', async () => {
  const legacy = { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: 'legacy-folder', drive_folder_name: 'Teamwill/Refonte CRM', drive_folder_link: null };
  const { supa, storage, handler } = setup({
    tables: { sales_projects: [legacy], documents: [{ id: documentId, project_id: projectId, storage_provider: 'gdrive', provider_file_id: 'filed' }] },
    rpc: { register_document: (args) => ({ data: { id: 'new-doc', ...args.document }, error: null }) },
  });
  const file = (id, extra = {}) => ({ id, name: `${id}.pdf`, mimeType: 'application/pdf', size: 5, folderIds: ['legacy-folder'], sha256: null, link: null, modifiedAt: null, isFolder: false, ...extra });
  storage.listFiles = async folderId => (folderId === 'legacy-folder' ? [file('contrat-signe'), file('filed'), file('01_Contrat', { isFolder: true })] : []);
  storage.files['contrat-signe'] = file('contrat-signe');
  storage.files['elsewhere'] = file('elsewhere', { folderIds: ['other'] });

  let res = await call(handler, { action: 'list-unfiled', owner: { kind: 'project', id: projectId } });
  assert.deepEqual(res.body.files.map(f => f.id), ['contrat-signe'], 'Registered files and subfolders are hidden');

  res = await call(handler, { action: 'file-existing', owner: { kind: 'project', id: projectId }, fileId: 'elsewhere', typeCode: 'CLIENT_CONTRACT', title: 'x' });
  assert.equal(res.code, 400, 'Only files from the project folder can be filed');

  res = await call(handler, { action: 'file-existing', owner: { kind: 'project', id: projectId }, fileId: 'contrat-signe', typeCode: 'CLIENT_CONTRACT', title: 'Contrat signé' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  const move = storage.log.find(entry => entry[0] === 'move');
  assert.deepEqual(move.slice(0, 3), ['move', 'contrat-signe', 'legacy-folder']);
  assert.match(move[3], /^legacy-folder>01_Contrat/);
  const [, args] = supa.calls.find(([name]) => name === 'register_document');
  assert.equal(args.document.provider_folder_id, move[3]);
});

test('a refused legacy filing moves the file back where it was', async () => {
  const legacy = { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: 'legacy-folder', drive_folder_name: '', drive_folder_link: null };
  const { storage, handler } = setup({
    tables: { sales_projects: [legacy] },
    rpc: { register_document: () => ({ data: null, error: { code: 'P0001', message: 'Only an active document can be renewed.' } }) },
  });
  storage.files['f'] = { id: 'f', name: 'f.pdf', mimeType: '', size: 1, folderIds: ['legacy-folder'], sha256: null, link: null, modifiedAt: null, isFolder: false };
  const res = await call(handler, { action: 'file-existing', owner: { kind: 'project', id: projectId }, fileId: 'f', typeCode: 'CLIENT_CONTRACT', title: 'x' });
  assert.equal(res.code, 400);
  const moves = storage.log.filter(entry => entry[0] === 'move');
  assert.equal(moves.length, 2);
  assert.deepEqual(moves[1], ['move', 'f', moves[0][3], 'legacy-folder']);
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'), 'Legacy files are never trashed');
});

test('employees and sales roles are rejected', async () => {
  for (const role of ['employee', 'sales']) {
    const { handler } = setup({ role });
    const res = await call(handler, { action: 'download', documentId });
    assert.equal(res.code, 403, role);
  }
});
