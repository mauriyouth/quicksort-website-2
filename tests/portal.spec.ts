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
const contractId = '66666666-6666-4666-8666-666666666666';
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
  contracts: Table<'contracts'>[];
  contract_signatures: Table<'contract_signatures'>[];
  tool_requests: Table<'tool_requests'>[];
  my_applications: View<'my_applications'>[];
  my_application_events: View<'my_application_events'>[];
  my_employment: View<'my_employment'>[];
  my_onboarding_items: View<'my_onboarding_items'>[];
  my_offers: View<'my_offers'>[];
};
function portalFixture(): PortalFixture {
  return {
    profiles: [{ id: userId, email, full_name: 'Alex Morgan', created_at: now }],
    candidate_documents: [], contract_signatures: [], tool_requests: [],
    contracts: [{ id: contractId, candidate_id: userId, person_id: personId, application_id: firstApplication, employee_id: null, offer_id: firstOffer, title: 'Employment agreement', storage_path: `${userId}/contract.pdf`, document_sha256: 'a'.repeat(64), created_at: now }],
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
  };
}
function addEmployment(state: PortalFixture) {
  state.my_employment.push({ id: employmentId, person_id: personId, role: 'Platform engineer', start_date: '2026-10-01', end_date: null, status: 'preboarding', onboarding_completed_at: null, probation_status: 'pending', probation_end: '2027-01-01' });
  state.my_onboarding_items.push(
    { id: ownTaskId, employee_id: employmentId, phase: 'preboarding', title: 'Confirm your emergency contact', assignee: email, due_date: '2026-10-05', required: true, dependency_id: null, evidence: '', completed_at: null, version: 3 },
    { id: hrTaskId, employee_id: employmentId, phase: 'preboarding', title: 'Provision equipment', assignee: 'hr@example.test', due_date: '2026-10-05', required: true, dependency_id: null, evidence: '', completed_at: null, version: 1 },
  );
}
const tables = z.enum(['profiles', 'candidate_documents', 'contracts', 'contract_signatures', 'tool_requests', 'my_applications', 'my_application_events', 'my_employment', 'my_onboarding_items', 'my_offers']);
async function portalApi(page: Page, state: PortalFixture, failFirstCommand = false) {
  const commands: PortalCommand[] = [];
  let shouldFail = failFirstCommand;
  await page.route(`${fixtureSupabaseURL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (data: unknown, status = 200) => route.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
    if (url.pathname.endsWith('/rpc/cra_context')) return reply({ employees: state.my_employment.map(employee => ({ id: employee.id, full_name: 'Alex Morgan', role: employee.role, start_date: employee.start_date, end_date: employee.end_date })), assignments: [] });
    if (url.pathname.endsWith('/rpc/cra_month_snapshot')) return reply({ version: 0, entries: [], updated_at: null, updated_by: null });
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
    if (!table.success || request.method() !== 'GET') throw new Error(`Unexpected fixture request: ${request.method()} ${url.pathname}`);
    const rows = state[table.data];
    return reply(request.headers().accept?.includes('object') ? rows[0] ?? null : rows);
  });
  return commands;
}

let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`import {HrPortal} from '@app/portal/HrPortal'; createRoot(document.getElementById('root')).render(<HrPortal userId="${userId}" email="${email}"/>);`);
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

test('pre-hire portal exposes contracts for review and download before onboarding begins', async ({ page }) => {
  await portalApi(page, portalFixture());
  await page.goto(new URL('/application', harness.url).href);
  await expect(page.getByRole('link', { name: 'My contracts', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My onboarding', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tool access', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My CRA', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'My contracts', exact: true }).click();
  await page.getByRole('button', { name: 'Review & sign', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review: Employment agreement', exact: true })).toBeVisible();
  await expect(page.getByLabel('Your full legal name')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
  expect((await download).suggestedFilename()).toBe('Employment agreement.pdf');
});

test('employees can open My CRA through portal navigation and a direct link', async ({ page }) => {
  const state = portalFixture(); addEmployment(state);
  await portalApi(page, state);
  await page.goto(new URL('/onboarding', harness.url).href);
  await page.getByRole('link', { name: 'My CRA', exact: true }).click();
  await expect(page).toHaveURL(new URL('/cra', harness.url).href);
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
