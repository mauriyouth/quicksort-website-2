import { test, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import type { Database } from '../packages/hr-db/src/database.types';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });

type Table<K extends keyof Database['public']['Tables']> = Database['public']['Tables'][K]['Row'];
type View<K extends keyof Database['public']['Views']> = Database['public']['Views'][K]['Row'];
const userId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const firstApplication = '33333333-3333-4333-8333-333333333333';
const secondApplication = '44444444-4444-4444-8444-444444444444';
const employmentId = '55555555-5555-4555-8555-555555555555';
const ownTaskId = '77777777-7777-4777-8777-777777777777';
const hrTaskId = '88888888-8888-4888-8888-888888888888';
const firstOffer = '99999999-9999-4999-8999-999999999999';
const secondOffer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = '2026-10-04T12:00:00Z';
const email = 'alex@example.test';
const commandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('respond_offer'), request_id: z.uuid(), offer_id: z.uuid(), expected_version: z.number(), response: z.enum(['accepted', 'declined']), rationale: z.string() }),
  z.object({ kind: z.literal('complete_task'), request_id: z.uuid(), task_id: z.uuid(), expected_version: z.number(), evidence: z.string() }),
]);
type PortalCommand = z.infer<typeof commandSchema>;
type PortalFixture = {
  profiles: Table<'profiles'>[];
  candidate_documents: Table<'candidate_documents'>[];
  tool_requests: Table<'tool_requests'>[];
  my_applications: View<'my_applications'>[];
  my_application_events: View<'my_application_events'>[];
  my_employment: View<'my_employment'>[];
  my_onboarding_items: View<'my_onboarding_items'>[];
  my_offers: View<'my_offers'>[];
  my_payslips: View<'my_payslips'>[];
  my_documents: View<'my_documents'>[];
  my_document_types: View<'my_document_types'>[];
  my_freelancer_invoices?: Database['public']['Functions']['my_freelancer_invoices']['Returns'];
};
function portalFixture(): PortalFixture {
  return {
    profiles: [{ id: userId, email, full_name: 'Alex Morgan', created_at: now }],
    candidate_documents: [], tool_requests: [],
    my_applications: [
      { id: firstApplication, person_id: personId, opportunity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Alex Morgan', title: 'Platform engineer', stage: 'screening', status: 'active', created_at: now, updated_at: now },
      { id: secondApplication, person_id: personId, opportunity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Alex Morgan', title: 'Data engineer', stage: 'technical_interview', status: 'active', created_at: now, updated_at: now },
    ],
    my_application_events: [
      { id: 1, application_id: firstApplication, to_stage: 'screening', kind: 'move_application', created_at: now },
      { id: 2, application_id: secondApplication, to_stage: 'technical_interview', kind: 'move_application', created_at: now },
    ],
    my_employment: [], my_onboarding_items: [],
    my_offers: [
      { id: firstOffer, application_id: firstApplication, title: 'Platform employment offer', contract_type: 'CDI', salary_monthly: 4500, status: 'shared', shared_at: now, valid_until: '2099-01-01', version: 4 },
      { id: secondOffer, application_id: secondApplication, title: 'Data employment offer', contract_type: 'CDI', salary_monthly: 4800, status: 'shared', shared_at: now, valid_until: '2099-01-01', version: 2 },
    ],
    my_payslips: [],
    my_documents: [],
    my_document_types: [],
  };
}
const payslipOne = 'abababab-abab-4bab-8bab-abababababab';
const payslipTwo = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
function addPayslips(state: PortalFixture) {
  state.my_payslips.push(
    { id: payslipOne, person_id: personId, title: 'Payslip March 2026', valid_from: '2026-03-01', file_name: 'payslip-2026-03.pdf', size_bytes: 52000, created_at: now },
    { id: payslipTwo, person_id: personId, title: 'Payslip February 2026', valid_from: '2026-02-01', file_name: 'payslip-2026-02.pdf', size_bytes: 51000, created_at: now },
  );
}
function addEmployment(state: PortalFixture) {
  state.my_employment.push({ id: employmentId, person_id: personId, matricule: 'QS-0001', role: 'Platform engineer', start_date: '2026-10-01', end_date: null, status: 'preboarding', onboarding_completed_at: null, probation_status: 'pending', probation_end: '2027-01-01', contract_type: 'CDI' });
  state.my_onboarding_items.push(
    { id: ownTaskId, employee_id: employmentId, phase: 'preboarding', title: 'Confirm your emergency contact', assignee: email, due_date: '2026-10-05', required: true, dependency_id: null, evidence: '', completed_at: null, version: 3 },
    { id: hrTaskId, employee_id: employmentId, phase: 'preboarding', title: 'Provision equipment', assignee: 'hr@example.test', due_date: '2026-10-05', required: true, dependency_id: null, evidence: '', completed_at: null, version: 1 },
  );
}
const tables = z.enum(['profiles', 'candidate_documents', 'tool_requests', 'my_applications', 'my_application_events', 'my_employment', 'my_onboarding_items', 'my_offers', 'my_payslips', 'my_documents', 'my_document_types']);
async function portalApi(page: Page, state: PortalFixture, failFirstCommand = false) {
  const commands: PortalCommand[] = [];
  let shouldFail = failFirstCommand;
  await page.route(`${fixtureSupabaseURL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (data: unknown, status = 200) => route.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
    if (url.pathname.endsWith('/rpc/cra_context')) return reply({ employees: state.my_employment.map(employee => ({ id: employee.id, full_name: 'Alex Morgan', role: employee.role, start_date: employee.start_date, end_date: employee.end_date })), assignments: [] });
    if (url.pathname.endsWith('/rpc/my_name_from_hr')) return reply(state.my_employment.length > 0);
    if (url.pathname.endsWith('/rpc/my_freelancer_invoices')) return reply(state.my_freelancer_invoices ?? []);
    if (url.pathname.endsWith('/rpc/cra_month_snapshot')) return reply({ version: 0, entries: [], updated_at: null, updated_by: null });
    // Leave-balance strip on the CRA screen: no balances, default accrual rates.
    if (url.pathname.endsWith('/rpc/employee_leave_balances') || url.pathname.endsWith('/leave_accrual_settings')) return reply([]);
    if (url.pathname.includes('/storage/') && request.method() === 'POST') return reply({ Id: crypto.randomUUID(), Key: url.pathname.split('/object/').pop() });
    if (url.pathname.includes('/storage/')) return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/pdf', body: '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF' });
    if (url.pathname.endsWith('/rpc/hr_command')) {
      const parsed = z.object({ command: commandSchema }).parse(request.postDataJSON());
      const command = parsed.command;
      commands.push(command);
      if (shouldFail) { shouldFail = false; return reply({ message: 'This record changed. Refresh before saving.', code: 'P0001' }, 409); }
      if (command.kind === 'respond_offer') {
        const offer = state.my_offers.find(row => row.id === command.offer_id);
        if (!offer) throw new Error('Unexpected offer target');
        offer.status = command.response; offer.version += 1;
      } else {
        const task = state.my_onboarding_items.find(row => row.id === command.task_id);
        if (!task) throw new Error('Unexpected task target');
        task.evidence = command.evidence; task.completed_at = now; task.version += 1;
      }
      return reply({ request_id: command.request_id });
    }
    const table = tables.safeParse(url.pathname.split('/').pop());
    if (table.success && table.data === 'candidate_documents' && request.method() === 'POST') {
      const body = z.record(z.string(), z.unknown()).parse(request.postDataJSON());
      state.candidate_documents.push({ id: crypto.randomUUID(), created_at: now, ...body } as Table<'candidate_documents'>);
      return reply(null, 201);
    }
    if (!table.success || request.method() !== 'GET') throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
    const rows = state[table.data];
    return reply(request.headers().accept?.includes('object') ? rows[0] ?? null : rows);
  });
  return commands;
}

let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`import {BrowserRouter} from '${process.cwd()}/apps/admin/node_modules/react-router-dom'; import {HrPortal} from '@app/portal/HrPortal'; createRoot(document.getElementById('root')).render(<BrowserRouter><HrPortal userId="${userId}" email="${email}"/></BrowserRouter>);`);
});
test.afterAll(async () => { await harness.close(); });

test('portal selects each application and its own timeline without collapsing repeat applications', async ({ page }) => {
  await portalApi(page, portalFixture());
  await page.goto(new URL('/application', harness.url).href);
  await expect(page.getByRole('heading', { name: 'Platform engineer', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Application', exact: true }).locator('option')).toHaveCount(2);
  await expect(page.locator('.timeline').getByText('Pre-qualification')).toBeVisible();
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption(secondApplication);
  await expect(page.getByRole('heading', { name: 'Data engineer', exact: true })).toBeVisible();
  await expect(page.locator('.timeline').getByText('Technical interview')).toBeVisible();
  await expect(page.locator('.timeline').getByText('Pre-qualification')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Data employment offer', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform employment offer', exact: true })).toHaveCount(0);
});

test('pre-hire portal has no in-app contract signing; contracts go through Youtrust', async ({ page }) => {
  await portalApi(page, portalFixture());
  await page.goto(new URL('/application', harness.url).href);
  await expect(page.getByRole('link', { name: 'My application', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My contracts', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My onboarding', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tool access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My CRA', exact: true })).toHaveCount(0);
  await page.goto(new URL('/contracts', harness.url).href);
  await expect(page.getByText('Page not found').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review & sign', exact: true })).toHaveCount(0);
});

test('employees no longer see in-app contract signing or My application', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  await expect(page.getByRole('link', { name: 'My onboarding', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My contracts', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My application', exact: true })).toHaveCount(0);
  await expect(page.getByText('Waiting for your signature')).toHaveCount(0);
  await expect(page.getByText('To sign', { exact: true })).toHaveCount(0);
  await page.goto(new URL('/contracts', harness.url).href);
  await expect(page.getByText('Page not found').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review & sign', exact: true })).toHaveCount(0);
  await page.goto(new URL('/application', harness.url).href);
  await expect(page.getByText('Page not found').first()).toBeVisible();
});

test('employees can open My CRA through portal navigation and a direct link', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  await page.getByRole('link', { name: 'My CRA', exact: true }).click();
  // CRA keeps the viewed month in the path: /cra lands on /cra/YYYY/MM.
  await expect(page).toHaveURL(/\/cra\/\d{4}\/\d{2}$/);
  await expect(page.getByRole('heading', { name: 'Monthly CRA', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Employee', exact: true })).toHaveValue('Alex Morgan · Platform engineer');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Monthly CRA', exact: true })).toBeVisible();
});

test('employee completes their actual task with evidence while HR-owned tasks remain unavailable', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  const commands = await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  const ownTask = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: 'Confirm your emergency contact', exact: true }) });
  const hrTask = page.locator('.list-row').filter({ has: page.getByRole('heading', { name: 'Provision equipment', exact: true }) });
  await expect(hrTask.getByRole('button', { name: 'Complete', exact: true })).toBeDisabled();
  await ownTask.getByLabel('Evidence for Confirm your emergency contact').fill('Contact details shared in my secure profile.');
  await ownTask.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Task completed.' })).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({ kind: 'complete_task', task_id: ownTaskId, expected_version: 3, evidence: 'Contact details shared in my secure profile.' });
  expect(state.my_onboarding_items[0].completed_at).toBe(now);
  expect(state.my_onboarding_items[1].completed_at).toBeNull();
  await expect(ownTask.getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
});

test('offer response retains the selection and message after a command error, then records acceptance and decline separately', async ({ page }) => {
  const state = portalFixture();
  const commands = await portalApi(page, state, true);
  await page.goto(new URL('/application', harness.url).href);
  await page.getByLabel('Your response').selectOption('accepted');
  await page.getByLabel('Message to HR').fill('I accept the platform offer as shared.');
  await page.getByRole('button', { name: 'Confirm response', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This record changed.');
  await expect(page.getByLabel('Your response')).toHaveValue('accepted');
  await expect(page.getByLabel('Message to HR')).toHaveValue('I accept the platform offer as shared.');
  expect(state.my_offers[0].status).toBe('shared');
  await page.getByRole('button', { name: 'Confirm response', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your offer response has been recorded.' })).toBeVisible();
  expect(commands[1]).toMatchObject({ kind: 'respond_offer', offer_id: firstOffer, expected_version: 4, response: 'accepted', rationale: 'I accept the platform offer as shared.' });
  await page.getByRole('combobox', { name: 'Application', exact: true }).selectOption(secondApplication);
  await page.getByLabel('Your response').selectOption('declined');
  await page.getByLabel('Message to HR').fill('I am proceeding with my other application.');
  await page.getByRole('button', { name: 'Confirm response', exact: true }).click();
  await expect.poll(() => state.my_offers[1].status).toBe('declined');
  expect(commands[2]).toMatchObject({ kind: 'respond_offer', offer_id: secondOffer, expected_version: 2, response: 'declined', rationale: 'I am proceeding with my other application.' });
  expect(state.my_offers[0].status).toBe('accepted');
});

test('a linked employee sees their payslips in the HR layout and downloads one through the own-payslip action', async ({ page }) => {
  const state = portalFixture(); addEmployment(state); addPayslips(state);
  const bodies: unknown[] = [];
  await page.route('**/api/documents', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });
  await portalApi(page, state);
  await page.goto(new URL('/payslips', harness.url).href);
  await expect(page.getByText('2 payslips · Payslip February 2026 → Payslip March 2026')).toBeVisible();
  const row = page.locator('.payslips-person-list li').filter({ hasText: 'Payslip March 2026' });
  await expect(row.getByText('Latest', { exact: true })).toBeVisible();
  await expect(page.locator('.payslips-person-list li').filter({ hasText: 'Payslip February 2026' })).toBeVisible();
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download Payslip March 2026', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('payslip-2026-03.pdf');
  expect(bodies).toEqual([{ action: 'download-own-payslip', documentId: payslipOne }]);
});

test('an employee sees their HR folder as the HR checklist: required slots, other documents and the status HR sees', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  const type = (code: string, label: string, patch: Partial<View<'my_document_types'>> = {}): View<'my_document_types'> => ({ code, label, folder: 'administratif', requirement_group: null, requires_expiry: false, warn_days: [], sensitive: false, position: 0, required: false, self_upload: true, relevant: true, ...patch });
  state.my_document_types.push(
    type('CNI', "Carte d'identité", { folder: 'identite', requirement_group: 'identity', required: true, sensitive: true, position: 10 }),
    type('PASSPORT', 'Passeport', { folder: 'identite', requirement_group: 'identity', required: true, sensitive: true, position: 11 }),
    type('CARTE_VITALE', 'Carte Vitale', { folder: 'securite_sociale', required: true, sensitive: true, position: 20 }),
    type('EMPLOYMENT_CONTRACT', 'Contrat de travail', { folder: 'contrat_travail', required: true, self_upload: false, position: 30 }),
    type('DIPLOMA', 'Diplôme', { folder: 'diplomes', position: 60 }),
    type('OTHER', 'Autre', { folder: 'divers', position: 999 }),
    type('KBIS', 'Extrait Kbis', { position: 42, relevant: false }),
  );
  const upload = (n: number, name: string, category: string) => ({ id: `e${n}e${n}e${n}e${n}-e${n}e${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`, candidate_id: userId, name, category, type_code: null, size_bytes: 1048576, storage_path: `${userId}/${n}.pdf`, created_at: now });
  state.candidate_documents.push(upload(1, 'passport.pdf', 'identity'), upload(2, 'diploma.pdf', 'qualification'), upload(3, 'old-id.pdf', 'identity'), upload(4, 'cv.pdf', 'resume'));
  const filed = (n: number, patch: Partial<View<'my_documents'>>): View<'my_documents'> => ({ id: `f${n}f${n}f${n}f${n}-f${n}f${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`, upload_path: `${userId}/${n}.pdf`, uploaded_by_me: true, type_code: 'OTHER', type_label: 'Autre', title: `upload ${n}`, file_name: `${n}.pdf`, mime_type: 'application/pdf', size_bytes: 1048576, status: 'active', needs_review: false, issued_on: null, expires_on: null, warn_days: [], created_at: now, ...patch });
  state.my_documents.push(
    filed(1, { title: 'passport.pdf', file_name: 'passport.pdf', type_code: 'PASSPORT', type_label: 'Passeport', expires_on: '2099-01-01', warn_days: [60] }),
    filed(2, { title: 'diploma.pdf', file_name: 'diploma.pdf', type_code: 'DIPLOMA', type_label: 'Diplôme', needs_review: true }),
    filed(3, { title: 'old-id.pdf', file_name: 'old-id.pdf', status: 'superseded' }),
    filed(5, { upload_path: null, uploaded_by_me: false, title: 'Attestation employeur', file_name: 'attestation.pdf', type_code: 'OTHER', type_label: 'Autre' }),
    // A replaced upload the employee already deleted does not linger.
    filed(6, { upload_path: `${userId}/gone.pdf`, title: 'gone.pdf', status: 'archived' }),
  );
  const bodies: unknown[] = [];
  await page.route('**/api/documents', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });
  await portalApi(page, state);
  await page.goto(new URL('/documents', harness.url).href);
  const row = (name: string) => page.locator('.doc-rowline').filter({ has: page.locator('.doc-row-name', { hasText: new RegExp(`^${name}$`) }) });
  await expect(page.locator('.doc-count')).toHaveText('1 of 3 sent');
  await expect(page.locator('.doc-summary')).toContainText('2 missing');
  await expect(row("Carte d'identité or Passeport").locator('.doc-pill')).toHaveText('Verified');
  await expect(row("Carte d'identité or Passeport")).toContainText('passport.pdf');
  await expect(row('Carte Vitale').locator('.doc-pill')).toHaveText('Missing');
  await expect(row('Contrat de travail')).toContainText('HR adds this');
  await expect(row('Contrat de travail').getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0);
  await expect(row('Attestation employeur').locator('.doc-pill')).toHaveText('Verified');
  await expect(row('Attestation employeur')).toContainText('Added by HR');
  await expect(row('Attestation employeur').getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(row('diploma.pdf').locator('.doc-pill')).toHaveText('To classify');
  await expect(row('old-id.pdf').locator('.doc-pill')).toHaveText('Replaced');
  await expect(row('cv.pdf').locator('.doc-pill')).toHaveText('With your application');
  await expect(row('gone.pdf')).toHaveCount(0);
  await expect(page.locator('.doc-rowline')).toHaveCount(7);
  const download = page.waitForEvent('download');
  await row('Attestation employeur').getByRole('button', { name: 'Download Attestation employeur', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('attestation.pdf');
  expect(bodies).toEqual([{ action: 'download-own-document', documentId: state.my_documents[3].id }]);

  // Uploading into the missing slot files it under that type.
  const chooser = page.waitForEvent('filechooser');
  await row('Carte Vitale').getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles({ name: 'vitale.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByText('Document sent. HR will check it.')).toBeVisible();
  expect(state.candidate_documents.at(-1)).toMatchObject({ name: 'vitale.pdf', category: 'other', type_code: 'CARTE_VITALE' });
  await expect(row('Carte Vitale').locator('.doc-pill')).toHaveText('Received');
  await expect(page.locator('.doc-count')).toHaveText('2 of 3 sent');

  // Adding another document: a type search limited to what concerns this employee.
  const search = page.getByRole('combobox', { name: 'Type' });
  await search.click();
  await expect(page.getByRole('option', { name: 'Extrait Kbis' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Contrat de travail' })).toHaveCount(0);
  await search.fill('dipl');
  await expect(page.getByRole('option')).toHaveText(['Diplôme']);
  await page.getByRole('option', { name: 'Diplôme' }).click();
  await expect(search).toHaveValue('Diplôme');
  const another = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Browse' }).click();
  await (await another).setFiles({ name: 'master.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect.poll(() => state.candidate_documents.at(-1)).toMatchObject({ name: 'master.pdf', category: 'qualification', type_code: 'DIPLOMA' });
});

test('a linked employee sees their HR name read-only; an unlinked account can still edit theirs', async ({ page }) => {
  const linked = portalFixture(); addEmployment(linked);
  await portalApi(page, linked);
  await page.goto(new URL('/account', harness.url).href);
  await expect(page.getByLabel('Full name')).toHaveValue('Alex Morgan');
  await expect(page.getByLabel('Full name')).toBeDisabled();
  await expect(page.getByText('Managed by HR from your employee record.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await portalApi(page, portalFixture());
  await page.goto(new URL('/account', harness.url).href);
  await expect(page.getByLabel('Full name')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
});

test('an account with no payslips sees the empty state', async ({ page }) => {
  await portalApi(page, portalFixture());
  await page.goto(new URL('/application', harness.url).href);
  await page.getByRole('link', { name: 'Payslips', exact: true }).click();
  await expect(page).toHaveURL(new URL('/payslips', harness.url).href);
  await expect(page.getByText('Your payslips appear here once HR has filed them.')).toBeVisible();
});

test('an ended employment still sees its payslips', async ({ page }) => {
  const state = portalFixture(); addEmployment(state); addPayslips(state);
  state.my_employment[0].status = 'ended'; state.my_employment[0].end_date = '2026-09-30';
  await portalApi(page, state);
  await page.goto(new URL('/payslips', harness.url).href);
  await expect(page.getByRole('link', { name: 'Payslips', exact: true })).toBeVisible();
  await expect(page.locator('.payslips-person-list li').filter({ hasText: 'Payslip March 2026' })).toBeVisible();
  await expect(page.getByText('Opens when you join')).toHaveCount(0);
});

test('a freelancer sees their invoices with a portal status and sends a new one', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  state.my_employment[0].contract_type = 'Freelance';
  state.my_freelancer_invoices = [
    { id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', number: 'FAC-2026-10', period_month: '2026-10-01', amount_ttc_cents: 1080000, received_at: '2026-11-02T09:00:00Z', portal_status: 'to_pay' },
    { id: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', number: 'FAC-2026-09', period_month: '2026-09-01', amount_ttc_cents: 960000, received_at: '2026-10-03T09:00:00Z', portal_status: 'paid' },
    { id: 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4', number: 'FAC-2026-08', period_month: '2026-08-01', amount_ttc_cents: 990000, received_at: '2026-09-03T09:00:00Z', portal_status: 'not_accepted' },
  ];
  const bodies: Record<string, unknown>[] = [];
  const auth: (string | undefined)[] = [];
  await page.route('**/api/freelancer-invoices', async route => {
    bodies.push(route.request().postDataJSON());
    auth.push(route.request().headers().authorization);
    state.my_freelancer_invoices!.unshift({ id: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', number: '', period_month: null, amount_ttc_cents: null, received_at: now, portal_status: 'received' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ received: true, duplicate: false }) });
  });
  await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  await page.getByRole('link', { name: 'My invoices', exact: true }).click();
  await expect(page).toHaveURL(new URL('/invoices', harness.url).href);
  const rows = page.getByRole('row');
  const october = rows.filter({ hasText: 'FAC-2026-10' });
  await expect(october).toContainText('To pay');
  await expect(october).toContainText('October 2026');
  await expect(october).toContainText(/10\s?800,00\s?€/);
  await expect(rows.filter({ hasText: 'FAC-2026-09' })).toContainText('Paid');
  // A rejected invoice shows as not accepted, with no review note.
  await expect(rows.filter({ hasText: 'FAC-2026-08' })).toContainText('Not accepted');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload an invoice', exact: true }).click();
  await (await chooser).setFiles({ name: 'invoice-november.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByText("Invoice sent. We'll check it against your CRA.")).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual({ action: 'portal_upload', fileName: 'invoice-november.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') });
  expect(bodies[0]).not.toHaveProperty('employeeId');
  expect(auth[0]).toBe('Bearer fixture-session');
  // The new invoice lists as received while it is being read.
  await expect(page.getByRole('table', { name: 'My invoices' }).locator('tbody tr')).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Being read' })).toContainText('Received');
});

test('a freelancer keeps My invoices for 90 days after the employment ends', async ({ page }) => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');
  const state = portalFixture(); addEmployment(state);
  Object.assign(state.my_employment[0], { contract_type: 'Freelance', status: 'ended', end_date: daysAgo(30) });
  state.my_freelancer_invoices = [];
  await portalApi(page, state);
  await page.goto(new URL('/invoices', harness.url).href);
  await expect(page.getByRole('link', { name: 'My invoices', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload an invoice', exact: true })).toBeVisible();

  state.my_employment[0].end_date = daysAgo(120);
  await page.reload();
  await expect(page.getByRole('link', { name: 'My invoices', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload an invoice', exact: true })).toHaveCount(0);
});

test('a CDI employee has no My invoices tab', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  await expect(page.getByRole('link', { name: 'My CRA', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My invoices', exact: true })).toHaveCount(0);
  await page.goto(new URL('/invoices', harness.url).href);
  await expect(page.getByRole('button', { name: 'Upload an invoice', exact: true })).toHaveCount(0);
});

test('public website shows a published job and removes it after unpublication', async ({ page }) => {
  let published = true;
  await page.route('**/rest/v1/jobs**', route => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(published ? [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', slug: 'ai-engineer', title: 'AI Engineer', department: 'Engineering', location: 'Paris', employment_type: 'CDI', description: 'Build useful AI.', linkedin_url: 'https://www.linkedin.com/jobs/view/123', published: true, created_at: now, updated_at: now }] : []) }));
  await page.goto('http://127.0.0.1:5183/career/ai-engineer');
  await expect(page.getByRole('heading', { name: 'AI Engineer', exact: true })).toBeVisible();
  const applicationLinks = page.getByRole('link', { name: 'Apply on LinkedIn' });
  await expect(applicationLinks).toHaveCount(2);
  for (const link of await applicationLinks.all()) {
    await expect(link).toHaveAttribute('href', 'https://www.linkedin.com/jobs/view/123');
  }
  published = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'This role is no longer available' })).toBeVisible();
});
