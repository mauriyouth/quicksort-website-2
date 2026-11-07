import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentsHandler } from '../apps/admin/server/documents/handler.ts';
import { FOLDER_LABELS, datedSubfolder } from '../apps/admin/server/documents/folders.ts';

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
  { code: 'PAYSLIP', label: 'Bulletin de paie', owner_kinds: ['person'], folder: 'bulletins', requires_expiry: false },
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
    admin_statuses: [],
    hr_events: [],
    documents: [],
    ...tables,
  };
  const calls = [];
  const query = table => {
    const filters = [];
    const rows = () => db[table].filter(row => filters.every(([k, v, negate]) => (row[k] === v) !== Boolean(negate)));
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push([k, v]); return q; },
      neq: (k, v) => { filters.push([k, v, true]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => (rows().length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: rows()[0] ?? null, error: null }),
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
  const handler = createDocumentsHandler({ createClient: () => supa.client, storage: async () => storage, storageFromEncrypted: encrypted => { storage.log.push(['fromEncrypted', encrypted]); return storage; } });
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

test('payslips file under 08_Bulletins_de_paie/<period year>', async () => {
  assert.equal(FOLDER_LABELS.bulletins, '08_Bulletins_de_paie');
  assert.deepEqual(datedSubfolder('PAYSLIP', { validFrom: '2025-12-01' }, new Date('2026-11-01')), ['2025']);
  assert.deepEqual(datedSubfolder('TRANSPORT_PASS', { validFrom: '2025-03-01' }), ['Navigo', '2025']);

  const { storage, handler } = setup({ role: 'hr' });
  const res = await call(handler, { action: 'prepare-upload', owner: { kind: 'person', id: personId }, typeCode: 'PAYSLIP', title: 'Paie décembre 2025', fileName: 'bulletin.pdf', mimeType: 'application/pdf', size: 10, validFrom: '2025-12-01' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(storage.log.filter(entry => entry[0] === 'ensureChild').map(entry => entry[2]), ['08_Bulletins_de_paie', '2025']);
  assert.equal(res.body.folder.name, '2025');
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

test('a double submit after a payslip move returns the live row and never trashes the file', async () => {
  const archived = { id: '99999999-9999-4999-8999-999999999999', storage_provider: 'gdrive', provider_file_id: 'file-1', status: 'archived' };
  const live = { id: documentId, storage_provider: 'gdrive', provider_file_id: 'file-1', status: 'active' };
  const { storage, handler } = setup({
    tables: {
      document_folders: [{ storage_provider: 'gdrive', owner_kind: 'person', owner_id: personId, folder_code: 'identite', provider_folder_id: 'folder-id' }],
      documents: [archived, live],
    },
    rpc: { register_document: () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) },
  });
  storage.files['file-1'] = { id: 'file-1', name: 'x.pdf', mimeType: '', size: 1, folderIds: ['folder-id'], sha256: null, link: null, modifiedAt: null };
  const res = await call(handler, { action: 'register', owner: { kind: 'person', id: personId }, folderId: 'folder-id', fileId: 'file-1', typeCode: 'RIB', title: 'RIB' });
  assert.equal(res.code, 200);
  assert.equal(res.body.document.id, documentId);
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'));
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

test('person photos stream without an access log entry', async () => {
  const doc = { id: documentId, owner_kind: 'person', type_code: 'PHOTO', storage_provider: 'gdrive', provider_file_id: 'file-1', file_name: 'ada_lovelace_photo.jpg', mime_type: 'image/jpeg', size_bytes: 10 };
  const { supa, handler } = setup({ role: 'hr', tables: { documents: [doc] } });
  const res = await call(handler, { action: 'download', documentId, preview: true });
  assert.equal(res.code, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.ok(!supa.calls.some(([name]) => name === 'log_document_access'), 'The header photo is not an audited access');
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

const payslipRow = { provider_file_id: 'slip-1', file_name: 'bulletin.pdf', mime_type: 'application/pdf', size_bytes: 10, storage_provider: 'gdrive', encrypted_credentials: 'cipher' };

test('an employee downloads their own payslip; foreign, unknown and sales callers get 404 and no storage call', async () => {
  const own = setup({ role: 'employee', rpc: { payslip_download_source: ({ document_id }) => ({ data: document_id === documentId ? [payslipRow] : [], error: null }) } });
  let res = await call(own.handler, { action: 'download-own-payslip', documentId });
  assert.equal(res.code, 200);
  assert.equal(res.body.toString(), 'drive:slip-1');
  assert.match(res.headers['content-disposition'], /attachment/);
  assert.ok(own.storage.log.some(entry => entry[0] === 'fromEncrypted' && entry[1] === 'cipher'));
  assert.ok(!own.supa.calls.some(([name]) => name === 'log_document_access'), 'The RPC logs the access itself');
  res = await call(own.handler, { action: 'download-own-payslip', documentId, preview: true });
  assert.match(res.headers['content-disposition'], /^inline/);

  own.storage.log.length = 0;
  res = await call(own.handler, { action: 'download-own-payslip', documentId: '66666666-6666-4666-8666-666666666666' });
  assert.equal(res.code, 404);
  assert.equal(res.body.error, 'Payslip not found.');
  assert.deepEqual(own.storage.log, []);

  const sales = setup({ role: 'sales', rpc: { payslip_download_source: () => ({ data: [], error: null }) } });
  res = await call(sales.handler, { action: 'download-own-payslip', documentId });
  assert.equal(res.code, 404);
  assert.deepEqual(sales.storage.log, []);
});

test('an employee downloads documents of their own HR folder from Drive or portal storage; others get 404', async () => {
  const hrFiled = { ...payslipRow, provider_file_id: 'attestation-1', file_name: 'attestation.pdf' };
  const ownUpload = { ...payslipRow, provider_file_id: 'candidate-documents/u1/id.pdf', file_name: 'id.pdf', storage_provider: 'supabase', encrypted_credentials: null };
  const rows = { [documentId]: [hrFiled], '45454545-4545-4545-8545-454545454545': [ownUpload] };
  const own = setup({ role: 'employee', rpc: { own_document_download_source: ({ document_id }) => ({ data: rows[document_id] || [], error: null }) } });
  let res = await call(own.handler, { action: 'download-own-document', documentId });
  assert.equal(res.code, 200);
  assert.equal(res.body.toString(), 'drive:attestation-1');
  assert.match(res.headers['content-disposition'], /attachment/);
  res = await call(own.handler, { action: 'download-own-document', documentId: '45454545-4545-4545-8545-454545454545', preview: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.toString(), 'candidate-documents:u1/id.pdf');
  assert.match(res.headers['content-disposition'], /^inline/);
  assert.ok(!own.supa.calls.some(([name]) => name === 'log_document_access'), 'The RPC logs the access itself');

  own.storage.log.length = 0;
  res = await call(own.handler, { action: 'download-own-document', documentId: '66666666-6666-4666-8666-666666666666' });
  assert.equal(res.code, 404);
  assert.equal(res.body.error, 'Document not found.');
  assert.deepEqual(own.storage.log, []);
});

const personB = '77777777-7777-4777-8777-777777777777';
const slip = { id: documentId, type_code: 'PAYSLIP', status: 'active', person_id: personId, provider_file_id: 'slip-1', provider_folder_id: 'old-folder', valid_from: '2026-09-01', storage_provider: 'gdrive' };
const moveSetup = (extra = {}) => setup({
  role: 'hr',
  tables: {
    hr_people: [{ id: personId, full_name: 'Ada Lovelace' }, { id: personB, full_name: 'Grace Hopper' }],
    documents: [slip],
    hr_events: [{ person_id: personId, kind: 'matricule_changed', employee_id: 'emp-1', previous_state: '00026' }],
  },
  rpc: { move_payslip: args => ({ data: { id: 'new-doc', person_id: args.to_person_id, provider_folder_id: args.to_folder_id }, error: null }) },
  ...extra,
});

test('move-payslip files into the new person\'s bulletins/<year> folder and calls move_payslip', async () => {
  const { supa, storage, handler } = moveSetup();
  const res = await call(handler, { action: 'move-payslip', documentId, toPersonId: personB, requestId: '88888888-8888-4888-8888-888888888888' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(storage.log.filter(entry => entry[0] === 'ensureChild').map(entry => entry[2]), ['08_Bulletins_de_paie', '2026']);
  const move = storage.log.find(entry => entry[0] === 'move');
  assert.deepEqual(move.slice(0, 3), ['move', 'slip-1', 'old-folder']);
  assert.match(move[3], />2026#/);
  const [, args] = supa.calls.find(([name]) => name === 'move_payslip');
  assert.deepEqual(args, { document_id: documentId, to_person_id: personB, to_folder_id: move[3], request_id: '88888888-8888-4888-8888-888888888888' });
  assert.equal(res.body.document.person_id, personB);
  assert.deepEqual(res.body.previousMatricule, { employeeId: 'emp-1', value: '00026' });
  assert.ok(!supa.calls.some(([name]) => name === 'register_document'));
});

test('move-payslip has no previous matricule when the old person never had one changed', async () => {
  const { handler } = moveSetup({ tables: { hr_people: [{ id: personId, full_name: 'Ada' }, { id: personB, full_name: 'Grace' }], documents: [slip] } });
  const res = await call(handler, { action: 'move-payslip', documentId, toPersonId: personB });
  assert.equal(res.code, 200);
  assert.equal(res.body.previousMatricule, null);
});

test('a refused move puts the file back in the old folder', async () => {
  const { storage, handler } = moveSetup({ rpc: { move_payslip: () => ({ data: null, error: { code: 'P0001', message: 'Only an active payslip can be moved.' } }) } });
  const res = await call(handler, { action: 'move-payslip', documentId, toPersonId: personB });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'Only an active payslip can be moved.');
  const moves = storage.log.filter(entry => entry[0] === 'move');
  assert.equal(moves.length, 2);
  assert.deepEqual(moves[1], ['move', 'slip-1', moves[0][3], 'old-folder']);
});

test('move-payslip refuses other document types, archived payslips and employees', async () => {
  let ctx = moveSetup({ tables: { hr_people: [{ id: personId, full_name: 'Ada' }, { id: personB, full_name: 'Grace' }], documents: [{ ...slip, type_code: 'CNI' }] } });
  let res = await call(ctx.handler, { action: 'move-payslip', documentId, toPersonId: personB });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, 'Only an active payslip can be moved.');
  ctx = moveSetup({ tables: { hr_people: [{ id: personId, full_name: 'Ada' }, { id: personB, full_name: 'Grace' }], documents: [{ ...slip, status: 'archived' }] } });
  res = await call(ctx.handler, { action: 'move-payslip', documentId, toPersonId: personB });
  assert.equal(res.code, 400);
  assert.ok(!ctx.storage.log.some(entry => entry[0] === 'move'));
  ctx = setup({ role: 'employee' });
  res = await call(ctx.handler, { action: 'move-payslip', documentId, toPersonId: personB });
  assert.equal(res.code, 403);
});

test('first upload on an archived project creates its folder under archived/<end year>', async () => {
  const archived = { id: projectId, title: 'Refonte CRM', client_id: clientId, drive_folder_id: null, status: 'archive', end_date: '2026-06-30' };
  const { storage, handler } = setup({ tables: { sales_projects: [archived], admin_statuses: [{ kind: 'project', key: 'archive', is_terminal: true }] } });
  const res = await call(handler, { action: 'prepare-upload', owner: { kind: 'project', id: projectId }, typeCode: 'CLIENT_CONTRACT', title: 'Contrat signé', fileName: 'c.pdf', size: 10 });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(storage.log[0], ['ensureFolder', 'clients', ['archived', '2026', 'Teamwill/Refonte CRM']]);

  // Without saved statuses, the built-in "archive" status is terminal too; an open project stays at the root.
  const builtin = setup({ tables: { sales_projects: [archived] } });
  await call(builtin.handler, { action: 'prepare-upload', owner: { kind: 'project', id: projectId }, typeCode: 'CLIENT_CONTRACT', title: 'Contrat signé', fileName: 'c.pdf', size: 10 });
  assert.deepEqual(builtin.storage.log[0], ['ensureFolder', 'clients', ['archived', '2026', 'Teamwill/Refonte CRM']]);
  const open = setup({ tables: { sales_projects: [{ ...archived, status: 'en_cours' }] } });
  await call(open.handler, { action: 'prepare-upload', owner: { kind: 'project', id: projectId }, typeCode: 'CLIENT_CONTRACT', title: 'Contrat signé', fileName: 'c.pdf', size: 10 });
  assert.deepEqual(open.storage.log[0], ['ensureFolder', 'clients', ['Teamwill/Refonte CRM']]);
});
