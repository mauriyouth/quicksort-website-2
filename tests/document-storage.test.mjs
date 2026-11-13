import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createDriveStorage } from '../apps/admin/server/documents/storage/google-drive.ts';
import { documentFileName, folderPath, personFolderName } from '../apps/admin/server/documents/folders.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const settings = {
  client_email: 'documents@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  root_folder_id: 'clients-root',
  root_folder_name: 'Contrats_Clients',
  people_root_folder_id: 'people-root',
  people_root_folder_name: 'Collaborateurs',
};

/** Fake Drive: folders by (parent, name); records every request. */
function mockDrive(t, existing = {}, { folderDriveId = 'shared-drive-1' } = {}) {
  const calls = [];
  let created = 0;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const target = new URL(String(url));
    const method = init.method || 'GET';
    if (target.href === 'https://oauth2.googleapis.com/token')
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-1', expires_in: 3600 }) };
    calls.push({ url: target, method, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (target.pathname === '/upload/drive/v3/files')
      return { ok: true, status: 200, headers: { get: name => (name.toLowerCase() === 'location' ? 'https://upload.example/session-1' : null) } };
    if (target.pathname === '/drive/v3/files' && method === 'GET') {
      const [, name, parent] = /name='(.*)' and '(.*)' in parents/.exec(target.searchParams.get('q')) || [];
      const id = existing[`${parent}/${name}`];
      return { ok: true, status: 200, json: async () => ({ files: id ? [{ id, name }] : [] }) };
    }
    if (target.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ id: `new-${++created}`, name: body.name }) };
    }
    if (target.pathname === '/drive/v3/files/folder-1')
      return { ok: true, status: 200, json: async () => ({ id: 'folder-1', name: '01_Identite', driveId: folderDriveId, webViewLink: 'https://drive/folder-1' }) };
    if (target.pathname.endsWith('/files/doc-1') && target.searchParams.get('alt') === 'media')
      return { ok: true, status: 200, body: 'bytes', json: async () => ({}) };
    if (target.pathname.endsWith('/files/doc-1') && method === 'PATCH')
      return { ok: true, status: 200, json: async () => ({ id: 'doc-1', trashed: true }) };
    if (target.pathname.endsWith('/files/doc-1'))
      return { ok: true, status: 200, json: async () => ({ id: 'doc-1', name: 'cni.pdf', mimeType: 'application/pdf', size: '2048', webViewLink: 'https://drive/doc-1', parents: ['folder-1'], sha256Checksum: 'AB'.repeat(32) }) };
    throw new Error(`unexpected fetch ${method} ${target.href}`);
  });
  return calls;
}

test('folder paths follow the Client/Contract and Collaborateurs layout', () => {
  assert.deepEqual(folderPath({ kind: 'project', clientName: 'Teamwill', projectTitle: 'Refonte CRM' }, 'annexes'),
    { root: 'clients', path: ['Teamwill/Refonte CRM', '02_Annexes_Avenants'] });
  assert.deepEqual(folderPath({ kind: 'project', clientName: 'Teamwill', projectTitle: 'Refonte CRM' }, ''),
    { root: 'clients', path: ['Teamwill/Refonte CRM'] });
  assert.deepEqual(folderPath({ kind: 'client', clientName: 'Teamwill' }, 'administratif'),
    { root: 'clients', path: ['Teamwill', '_Societe'] }, 'Client Kbis goes to _Societe');
  assert.deepEqual(folderPath({ kind: 'person', fullName: 'Ada Lovelace', personId: '0f3c9a12-0000-4000-8000-000000000000' }, 'identite'),
    { root: 'people', path: ['LOVELACE Ada – 0f3c9a12', '01_Identite'] });
  assert.equal(personFolderName('Prince', 'abcdef12-3456'), 'Prince – abcdef12');
  assert.equal(folderPath({ kind: 'project', clientName: 'A', projectTitle: 'B' }, 'unknown').path[1], '99_Divers');
});

test('document file names read "<owner>_<type>.<ext>" and drop accents', () => {
  assert.equal(documentFileName('CARTE_VITALE', 'Amadou Ngam', 'scan.PDF'), 'amadou_ngam_carte_vitale.pdf');
  assert.equal(documentFileName('CNI', 'Élodie O’Neil', 'photo.jpg'), 'elodie_o_neil_cni.jpg');
  assert.equal(documentFileName('RIB', '', 'rib'), 'document_rib');
  assert.equal(documentFileName('PAYSLIP', 'Amadou Ngam', 'NGAM_03_2026_1.pdf', 'Bulletin de paie Mars 2026', '2026-03-01'), '03_amadou_ngam_payslip.pdf');
  assert.equal(documentFileName('PAYSLIP', 'Amadou Ngam', 'NGAM_03_2026_1.pdf'), 'amadou_ngam_payslip.pdf');
  assert.equal(documentFileName('CNI', 'Amadou Ngam', 'id.pdf', '', '2026-03-01'), 'amadou_ngam_cni.pdf');
});

test('ensureFolder walks the path, reusing existing folders and creating the rest', async t => {
  const calls = mockDrive(t, { 'clients-root/Teamwill/Refonte CRM': 'contract-folder' });
  const storage = createDriveStorage(settings);
  const folder = await storage.ensureFolder('clients', ['Teamwill/Refonte CRM', '01_Contrat']);
  assert.deepEqual(folder, { id: 'new-1', name: '01_Contrat', link: null });
  const created = calls.filter(c => c.method === 'POST');
  assert.equal(created.length, 1, 'Only the missing leaf is created');
  assert.deepEqual(created[0].body.parents, ['contract-folder']);
});

test('people documents use the HR root, and fail clearly when it is not connected', async t => {
  const calls = mockDrive(t);
  await createDriveStorage(settings).ensureFolder('people', ['LOVELACE Ada – 0f3c9a12']);
  assert.deepEqual(calls.find(c => c.method === 'POST').body.parents, ['people-root']);
  const { people_root_folder_id, ...clientsOnly } = settings;
  await assert.rejects(createDriveStorage(clientsOnly).ensureFolder('people', ['x']), /No HR documents folder is connected/);
});

test('company documents use the company root, linked, and fail clearly when it is not connected', async t => {
  const calls = mockDrive(t);
  const root = await createDriveStorage({ ...settings, company_root_folder_id: 'company-root', company_root_folder_name: 'Admin Quicksort' }).ensureFolder('company', []);
  assert.deepEqual(root, { id: 'company-root', name: 'Admin Quicksort', link: 'https://drive.google.com/drive/folders/company-root' });
  assert.equal(calls.length, 0);
  await assert.rejects(createDriveStorage(settings).ensureFolder('company', []), /No company documents folder is connected/);
});

test('company folders sit right under the company root', () => {
  assert.deepEqual(folderPath({ kind: 'company', companyName: 'Quicksort' }, 'urssaf'), { root: 'company', path: ['02_Attestation_URSSAF'] });
  assert.deepEqual(folderPath({ kind: 'company', companyName: 'Quicksort' }, ''), { root: 'company', path: [] });
  assert.equal(documentFileName('COMPANY_OTHER', 'Quicksort', 'x.pdf', 'Statuts à jour', null, '2026-01-15'), 'quicksort_statuts_a_jour_2026_01_15.pdf');
});

test('prepareUpload opens a resumable session and tells the browser how to PUT', async t => {
  const calls = mockDrive(t);
  const target = await createDriveStorage(settings).prepareUpload({ id: 'folder-1', name: '01_Identite', link: null }, { name: 'cni.pdf', mimeType: 'application/pdf', size: 2048 });
  assert.deepEqual(target, {
    uploadUrl: 'https://upload.example/session-1',
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    fileId: null,
  });
  assert.deepEqual(calls.find(c => c.url.pathname === '/upload/drive/v3/files').body, { name: 'cni.pdf', parents: ['folder-1'] });
});

test('prepareUpload refuses a folder outside a Shared Drive, naming it', async t => {
  const calls = mockDrive(t, {}, { folderDriveId: null });
  await assert.rejects(
    createDriveStorage(settings).prepareUpload({ id: 'folder-1', name: '01_Identite', link: null }, { name: 'cni.pdf', mimeType: 'application/pdf', size: 2048 }),
    /"01_Identite".*personal My Drive/,
  );
  assert.equal(calls.some(c => c.url.pathname === '/upload/drive/v3/files'), false, 'no upload session opened');
});

test('getFile normalises Drive metadata, download streams bytes, trash is recoverable', async t => {
  const calls = mockDrive(t);
  const storage = createDriveStorage(settings);
  assert.deepEqual(await storage.getFile('doc-1'), { id: 'doc-1', name: 'cni.pdf', mimeType: 'application/pdf', size: 2048, modifiedAt: null, link: 'https://drive/doc-1', folderIds: ['folder-1'], sha256: 'ab'.repeat(32), isFolder: false });
  assert.equal((await storage.download('doc-1')).body, 'bytes');
  await storage.trash('doc-1');
  const trash = calls.at(-1);
  assert.equal(trash.method, 'PATCH', 'Trash, never a permanent DELETE');
  assert.deepEqual(trash.body, { trashed: true });
});
