import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileBuffer } from '../apps/admin/server/documents/file.ts';

const personId = '22222222-2222-4222-8222-222222222222';
const requestId = '66666666-6666-4666-8666-666666666666';
const types = [{ code: 'EMPLOYMENT_CONTRACT', label: 'Contrat de travail', owner_kinds: ['person'], folder: 'contrat_travail', requires_expiry: false }];

function fakeClient({ rpcResult, existing = null } = {}) {
  const db = {
    document_types: types,
    hr_people: [{ id: personId, full_name: 'Ada Lovelace' }],
    document_folders: [],
    documents: existing ? [existing] : [],
  };
  const rpcCalls = [];
  const query = table => {
    const filters = [];
    const rows = () => db[table].filter(row => filters.every(([k, v, negate]) => (row[k] === v) !== Boolean(negate)));
    const q = {
      select: () => q,
      eq: (k, v) => { filters.push([k, v]); return q; },
      neq: (k, v) => { filters.push([k, v, true]); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: resolve => resolve({ data: rows(), error: null }),
      upsert: async (row, opts) => {
        const keys = opts.onConflict.split(',');
        if (!db[table].some(r => keys.every(k => r[k] === row[k]))) db[table].push(row);
        return { error: null };
      },
    };
    return q;
  };
  return {
    rpcCalls,
    client: {
      rpc: async (name, args) => { rpcCalls.push([name, args]); return rpcResult(args); },
      from: table => query(table),
    },
  };
}

function fakeStorage() {
  const log = [];
  return {
    log,
    provider: 'gdrive',
    async ensureFolder(root, path) { log.push(['ensureFolder', root, path]); return { id: `${root}:${path.join('|')}`, name: path.at(-1), link: null }; },
    async ensureChild(parent, name) { log.push(['ensureChild', parent.id, name]); return { id: `${parent.id}>${name}`, name, link: null }; },
    async uploadFile(folder, file, bytes) {
      log.push(['uploadFile', folder.id, file]);
      return { id: 'file-1', name: file.name, mimeType: file.mimeType, size: bytes.byteLength, modifiedAt: null, link: null, folderIds: [folder.id], sha256: 'abc', isFolder: false };
    },
    async trash(id) { log.push(['trash', id]); },
  };
}

const input = { personId, typeCode: 'EMPLOYMENT_CONTRACT', title: 'Contrat signé', fileName: 'contrat.pdf', bytes: new Uint8Array([1, 2, 3]), signatureRequestId: requestId };

test('fileBuffer uploads into the type folder and registers through register_signed_document', async () => {
  const { client, rpcCalls } = fakeClient({ rpcResult: () => ({ data: { id: 'doc-1' }, error: null }) });
  const storage = fakeStorage();
  const result = await fileBuffer(client, storage, { ...input, supersedes: 'old-doc' });
  assert.deepEqual(result, { id: 'doc-1' });
  const upload = storage.log.find(entry => entry[0] === 'uploadFile');
  assert.ok(upload[1].endsWith('03_Contrat_travail'), upload[1]);
  assert.deepEqual(upload[2], { name: 'contrat.pdf', mimeType: 'application/pdf' });
  const [name, args] = rpcCalls[0];
  assert.equal(name, 'register_signed_document');
  assert.equal(args.signature_request, requestId);
  assert.equal(args.supersedes, 'old-doc');
  assert.equal(args.document.owner_kind, 'person');
  assert.equal(args.document.person_id, personId);
  assert.equal(args.document.provider_file_id, 'file-1');
  assert.equal(args.document.sha256, 'abc');
  assert.equal(args.document.size_bytes, 3);
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'));
});

test('a refused registration trashes the uploaded file once and rethrows', async () => {
  const error = { code: 'P0001', message: 'Document does not belong to this signature request.' };
  const { client } = fakeClient({ rpcResult: () => ({ data: null, error }) });
  const storage = fakeStorage();
  await assert.rejects(fileBuffer(client, storage, input), e => e === error);
  assert.deepEqual(storage.log.filter(entry => entry[0] === 'trash'), [['trash', 'file-1']]);
});

test('a duplicate provider file id returns the existing row and keeps the file', async () => {
  const existing = { id: 'doc-existing', storage_provider: 'gdrive', provider_file_id: 'file-1', status: 'active' };
  const { client } = fakeClient({ existing, rpcResult: () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) });
  const storage = fakeStorage();
  assert.deepEqual(await fileBuffer(client, storage, input), { id: 'doc-existing' });
  assert.ok(!storage.log.some(entry => entry[0] === 'trash'));
});
