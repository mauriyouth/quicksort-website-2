import { test, expect, type Page, type Route } from '@playwright/test';
import { z } from 'zod';
import seed from './fixtures/hr-workspace.json';
import type { Suggestion } from '../apps/admin/src/hr/domain';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { BrowserRouter } from '${process.cwd()}/apps/admin/node_modules/react-router-dom';
    import { HrWorkspace } from '@app/hr/HrWorkspace';
    const view = new URLSearchParams(location.search).get('view') || 'overview';
    createRoot(document.getElementById('root')).render(
      <main style={{ padding: 24, maxWidth: 1400, margin: 'auto' }}>
        <BrowserRouter><HrWorkspace view={view} actorEmail="hr@example.invalid" role="hr" /></BrowserRouter>
      </main>
    );
  `);
});
test.afterAll(async () => { await harness?.close(); });

const requestSchema = z.object({ kind: z.string(), request_id: z.uuid() }).passthrough();
type Request = z.infer<typeof requestSchema>;
async function reply(route: Route, value: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });
}

const SAM = 'a51da95e-be9a-42b7-81c1-bb2043e41b56';
const IMPORTED = 'c22e75a8-609e-4dfb-804d-9cc0eda7d1e6';
const SAM_EMPLOYEE = '825b9051-882b-4e1e-9ae1-8dce434b0b05';
const payslip = (id: string, title: string, valid_from: string) => ({ id, person_id: SAM, type_code: 'PAYSLIP', title, valid_from, file_name: `${id}.pdf`, status: 'active', created_at: '2026-11-01T10:00:00Z' });
// Served out of order on purpose: the section must sort the newest period first.
const SEPTEMBRE = payslip('doc-sep', 'Bulletin de paie Septembre 2026', '2026-09-01');
const OCTOBRE = payslip('doc-oct', 'Bulletin de paie Octobre 2026', '2026-10-01');
async function mock(page: Page, {
  staffingOnly = false,
  failFirstTask = false,
  staleSuggestion = false,
  payslips = false,
  admin = false,
  contractStage = false,
  signed = true,
  signatureRequests = [] as Array<Record<string, unknown>>,
} = {}) {
  const suggestions: Suggestion[] = [];
  const snapshot = { ...structuredClone(seed), suggestions, salaries: [] as never[] };
  const requests: Request[] = [];
  const signatureCalls: Array<Record<string, unknown>> = [];
  if (staffingOnly) snapshot.capabilities = { recruit: false, approve_offer: false, approve_direction: false, staff: true, admin: false };
  if (admin) snapshot.capabilities = { ...snapshot.capabilities, admin: true };
  // Sam's latest application, still open at the Contract stage.
  if (contractStage) Object.assign(snapshot.applications[0], { status: 'active', stage: 'contract' });
  await page.route('**/api/signatures', async (route) => {
    const body = route.request().postDataJSON();
    signatureCalls.push(body);
    if (body.action === 'list-requests') return reply(route, { requests: signatureRequests });
    if (body.action === 'list-templates') return reply(route, { templates: [] });
    return reply(route, {}, 400);
  });
  if (staleSuggestion) {
    const employee = snapshot.employees.find((item) => item.status === 'preboarding');
    const person = snapshot.people.find((item) => item.id === employee?.person_id);
    const task = snapshot.tasks.find((item) => item.employee_id === employee?.id && !item.completed_at);
    if (!person || !employee || !task) throw new Error('The fixture needs an open employee and task.');
    snapshot.suggestions.push({
      id: '00000000-0000-4000-8000-000000000061', person_id: person.id, application_id: null,
      employee_id: employee.id, opportunity_id: null, kind: 'onboarding_plan',
      payload: { summary: 'Review the role access plan.', items: [{ title: 'Verify role access', detail: 'Agree the access checklist with the manager.', source_ids: [task.id] }] },
      sources: [{ type: 'person', id: person.id, version: person.version }, { type: 'task', id: task.id, version: task.version + 1 }],
      input_version: person.version, model: 'test-model', status: 'draft', reviewed_by: null, reviewed_at: null,
      created_at: new Date().toISOString(),
    });
  }
  const rpcs: Array<Record<string, unknown>> = [];
  const moves: Array<Record<string, unknown>> = [];
  if (payslips) {
    await page.route('**/api/documents', async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'move-payslip') {
        moves.push(body);
        return reply(route, { document: { id: 'doc-moved' }, previousMatricule: { employeeId: SAM_EMPLOYEE, value: '00026' } });
      }
      return reply(route, { files: [] });
    });
  }
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    if (payslips && url.pathname.endsWith('/rpc/set_employee_matricule')) {
      const body = route.request().postDataJSON();
      rpcs.push(body);
      if (body.matricule === 'QS-0003') return reply(route, { message: 'Matricule QS-0003 already belongs to Imported Person renamed.' }, 400);
      return reply(route, null);
    }
    if (payslips && url.pathname.endsWith('/employees')) return reply(route, [{ person_id: SAM }, { person_id: IMPORTED }]);
    if (payslips && url.pathname.endsWith('/hr_people')) return reply(route, [{ id: SAM, full_name: 'Sam Rivera' }, { id: IMPORTED, full_name: 'Imported Person renamed' }]);
    if (payslips && url.pathname.endsWith('/documents')) {
      const rows = [OCTOBRE, SEPTEMBRE];
      return reply(route, url.search.includes('type_code=eq.PAYSLIP') ? rows : rows.map((row) => ({ ...row, status: 'active' })));
    }
    if (url.pathname.endsWith('/rpc/hr_workspace_snapshot')) return reply(route, snapshot);
    if (url.pathname.endsWith('/rpc/hr_application_requirements')) return reply(route, [
      { key: 'screening', label: 'Screening evidence reviewed', done: true },
      { key: 'signatures', label: 'The contract is signed in Youtrust', done: signed },
    ]);
    if (url.pathname.endsWith('/profiles')) return reply(route, snapshot.people.map((person) => ({ id: person.id, full_name: person.full_name, email: person.email })));
    if (url.pathname.endsWith('/rpc/hr_command')) {
      const command = z.object({ command: requestSchema }).parse(route.request().postDataJSON()).command;
      requests.push(command);
      if (command.kind === 'create_person') {
        const profile = z.object({ full_name: z.string(), email: z.string(), headline: z.string(), location: z.string(), phone: z.string(), skills: z.string(), notes: z.string(), source: z.string(), owner_email: z.string(), contact_allowed: z.boolean() }).parse(command);
        snapshot.people.push({ ...snapshot.people[0], ...profile, id: '00000000-0000-4000-8000-000000000071', version: 1 });
      }
      if (command.kind === 'complete_task') {
        if (failFirstTask && requests.filter((item) => item.kind === 'complete_task').length === 1) return reply(route, { message: 'Complete the prerequisite task first.' }, 409);
        const input = z.object({ task_id: z.uuid(), evidence: z.string() }).parse(command);
        const task = snapshot.tasks.find((item) => item.id === input.task_id);
        if (!task) return reply(route, { message: 'Task not found.' }, 404);
        task.completed_at = new Date().toISOString(); task.evidence = input.evidence; task.version += 1;
      }
      return reply(route, { request_id: command.request_id });
    }
    return reply(route, []);
  });
  return { snapshot, requests, rpcs, moves, signatureCalls };
}

test('all connected HR views render at desktop and mobile widths without page overflow', async ({ page }, info) => {
  await mock(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ['overview', 'recruiting', 'people', 'journeys']) {
      await page.goto(`${harness.url}?view=${view}`);
      await expect(page.getByRole('button', { name: 'Add person', exact: true })).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${view}-${width}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});

test('manual intake saves the reviewed identity before opening any application', async ({ page }) => {
  const { requests } = await mock(page);
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByLabel('Full name').fill('Taylor Morgan');
  await page.getByLabel('Email', { exact: true }).fill('taylor@example.invalid');
  await page.getByRole('button', { name: 'Save reviewed person' }).click();
  await expect(page.getByRole('button', { name: /Taylor Morgan/ })).toBeVisible();
  expect(requests.map((request) => request.kind)).toEqual(['create_person']);
  expect(requests[0]).toMatchObject({ full_name: 'Taylor Morgan', email: 'taylor@example.invalid' });
});

test('a rehire record retains both application and employment histories', async ({ page }, info) => {
  await mock(page);
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page.getByRole('tab', { name: /Applications/ }).click();
  await expect(page.getByLabel('Application', { exact: true }).locator('option')).toHaveCount(2);
  await expect(page.getByText('Signed in Youtrust', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Employment/ }).click();
  await expect(page.getByLabel('Employment period').locator('option')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Journey checklist' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('rehire-employment.png'), fullPage: true });
  // The record is a routed page now, not a modal: tabs live in the URL.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/employments/);
});

test('failed task completion keeps its evidence and uses the same retry key', async ({ page }) => {
  const { requests } = await mock(page, { failFirstTask: true });
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page.getByRole('tab', { name: /Employment/ }).click();
  await page.getByRole('button', { name: 'Complete Verify employment documents' }).click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Complete task', exact: true }) }).first();
  await form.getByLabel('Completion evidence').fill('Access verified with the employee.');
  await form.getByRole('button', { name: 'Complete task', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveText('Complete the prerequisite task first.');
  await expect(form.getByLabel('Completion evidence')).toHaveValue('Access verified with the employee.');
  await form.getByRole('button', { name: 'Complete task', exact: true }).click();
  await expect(page.getByText('Access verified with the employee.', { exact: true })).toBeVisible();
  const completions = requests.filter((request) => request.kind === 'complete_task');
  expect(completions).toHaveLength(2);
  expect(completions[1].request_id).toBe(completions[0].request_id);
});

test('staffing permissions expose assignments without opening confidential person records', async ({ page }) => {
  await mock(page, { staffingOnly: true });
  await page.goto(`${harness.url}?view=people`);
  // Staffing-only users land on the employee list and never see person records.
  // People are grouped by contract now; 'Everyone' is the default tab.
  await expect(page.getByRole('tab', { name: /^Everyone/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add person', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Sam Rivera/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Assign project', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Create assignment', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Applications' })).toHaveCount(0);
});

test('assignment dates must fit the project window', async ({ page }) => {
  const { requests } = await mock(page);
  const project = seed.projects[0];
  await page.goto(`${harness.url}?view=people`);
  // The active Senior Engineer starts before the project, so both window edges clamp.
  await page.getByRole('button', { name: /Imported Person renamed/ }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Assign to project' }).click();
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create assignment', exact: true }) });
  await expect(form.getByText(/Project window:/)).toBeVisible();

  // Days before the project start cannot be picked.
  await form.getByRole('button', { name: 'Starts' }).click();
  let picker = page.getByRole('dialog', { name: /2026|2027/ });
  for (let i = 0; i < 12; i += 1) {
    if (await picker.locator('[data-date="2026-10-01"]').count()) break;
    await picker.getByRole('button', { name: 'Previous month' }).click();
  }
  await expect(picker.locator('[data-date="2026-10-01"]')).toBeDisabled();
  await picker.locator('[data-date="2026-10-05"]').click();

  // Days past the project end cannot be picked either.
  await form.getByRole('button', { name: 'Ends, if known' }).click();
  picker = page.getByRole('dialog', { name: /2026|2027/ });
  for (let i = 0; i < 12; i += 1) {
    if (await picker.locator('[data-date="2027-08-01"]').count()) break;
    await picker.getByRole('button', { name: 'Next month' }).click();
  }
  await expect(picker.locator('[data-date="2027-08-01"]')).toBeDisabled();
  await picker.locator('[data-date="2027-07-31"]').click();
  // Dismiss the calendar popover so it cannot cover the submit button.
  await page.keyboard.press('Escape');

  await form.getByRole('button', { name: 'Create assignment', exact: true }).click();
  await expect(form.getByRole('alert')).toHaveCount(0);
  expect(requests.map((request) => request.kind)).toEqual(['assign_project']);
  expect(requests[0]).toMatchObject({ project_id: project.id, start_date: '2026-10-05', end_date: '2027-07-31' });
});

test('an open assignment can be edited instead of ended or cancelled', async ({ page }) => {
  const { snapshot, requests } = await mock(page);
  const employee = snapshot.employees.find((item) => item.status === 'active');
  const project = snapshot.projects[0];
  if (!employee || !project) throw new Error('The fixture needs an active employee and a project.');
  snapshot.assignments.push({
    id: '00000000-0000-4000-8000-000000000081',
    employee_id: employee.id,
    project_id: project.id,
    position: 'Engineer',
    allocation_pct: 60,
    start_date: '2026-11-02',
    end_date: '2027-01-29',
    status: 'confirmed',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Imported Person renamed/ }).click();
  await page.getByRole('tab', { name: 'Projects' }).click();
  await page.getByRole('button', { name: 'Edit…' }).click();

  const panel = page.locator('article', { hasText: 'Edit this assignment' });
  // Nothing changed yet: saving is pointless and stays disabled.
  await expect(panel.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await panel.getByRole('spinbutton').fill('80');
  // A change without a rationale is still blocked.
  await expect(panel.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await panel.getByPlaceholder('Why is this changing?').fill('Client raised the commitment to 80%.');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(requests.map((request) => request.kind)).toEqual(['update_assignment']);
  expect(requests[0]).toMatchObject({
    kind: 'update_assignment',
    assignment_id: '00000000-0000-4000-8000-000000000081',
    allocation_pct: 80,
    status: 'confirmed',
    rationale: 'Client raised the commitment to 80%.',
  });
});

test('changed task evidence disables AI acceptance and task creation', async ({ page }) => {
  await mock(page, { staleSuggestion: true });
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page.getByRole('tab', { name: /Employment/ }).click();
  await expect(page.getByRole('button', { name: 'Accept as reviewed draft', exact: true })).toBeDisabled();
  await expect(page.getByText('Source changed. Generate a fresh draft.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add reviewed task', exact: true })).toHaveCount(0);
});

test('creating a hiring need takes the role from the linked job post and links clients picked from the search as labels', async ({ page }) => {
  const { requests } = await mock(page);
  const client = seed.clients[0];
  const job = seed.jobs[0];
  await page.goto(`${harness.url}?view=recruiting`);
  await page.getByRole('tab', { name: 'Hiring needs' }).click();
  await page.getByRole('button', { name: 'Create hiring need', exact: true }).click();
  // Creating a hiring need is a page, not a popup.
  await expect(page.getByRole('heading', { name: 'New hiring need', level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Without a job post the role is named manually.
  await page.getByLabel('Role to hire').fill('Support Engineer');
  // Linking a job post replaces the manual role: title and requirements come from the post.
  await page.getByLabel('Linked job post').selectOption(job.id);
  await expect(page.getByLabel('Role to hire')).toHaveCount(0);
  await expect(page.getByText(`Role and requirements are taken from “${job.title}”.`, { exact: true })).toBeVisible();
  await page.getByLabel('Search Linked clients').fill('Test');
  await page.getByRole('button', { name: client.name, exact: true }).click();
  await expect(page.getByText(client.name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create hiring need', exact: true }).click();
  await expect.poll(() => requests.map((request) => request.kind)).toEqual(['create_requisition']);
  expect(requests[0]).toMatchObject({ title: job.title, job_id: job.id, client_ids: [client.id] });
});

test('a hiring need opens as a page with its applications, and can be archived but not deleted once it has applications', async ({ page }, info) => {
  const { requests } = await mock(page);
  const need = seed.opportunities.find((item) => item.title === 'Data Engineer')!;
  await page.goto(`${harness.url}?view=recruiting`);
  await page.getByRole('tab', { name: 'Hiring needs' }).click();
  await page.getByRole('link', { name: /Data Engineer/ }).click();
  await expect(page.getByRole('heading', { name: 'Data Engineer', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recruiting · Hiring needs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  // Its only application is closed, so archiving is allowed; deleting would orphan it.
  await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('hiring-need.png'), fullPage: true });
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => requests.map((request) => request.kind)).toEqual(['archive_requisition']);
  expect(requests[0]).toMatchObject({ opportunity_id: need.id, expected_version: need.version });
});

async function openSamEmployment(page: Page) {
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page.getByRole('tab', { name: /Employment/ }).click();
}

test('the Payslips section lists the newest period first and the Documents panel leaves payslips out', async ({ page }, info) => {
  await mock(page, { payslips: true });
  await page.setViewportSize({ width: 1155, height: 1000 });
  await openSamEmployment(page);
  const section = page.locator('section.hr-emp-section').filter({ has: page.getByRole('heading', { name: 'Payslips' }) });
  const titles = section.locator('.payslips-person-title');
  // Rows show the period; the 'Bulletin de paie' document type moves to the meta line.
  await expect(titles).toHaveText(['Octobre 2026', 'Septembre 2026']);
  const documents = page.locator('section.hr-emp-section').filter({ has: page.getByRole('heading', { name: 'Documents' }) });
  await expect(documents.getByText('Bulletin de paie')).toHaveCount(0);
  await section.screenshot({ path: info.outputPath('person-payslips.png') });
});

test('editing a matricule another person holds shows the server error inline', async ({ page }) => {
  const { rpcs } = await mock(page, { payslips: true });
  await openSamEmployment(page);
  await page.getByRole('button', { name: 'Change', exact: true }).first().click();
  await expect(page.getByText('Silae employee number for salaried staff')).toBeVisible();
  await page.getByLabel('Matricule').fill('QS-0003');
  await page.getByRole('button', { name: 'Save matricule' }).click();
  await expect(page.getByRole('alert')).toContainText('already belongs to');
  expect(rpcs).toHaveLength(1);
  expect(rpcs[0]).toMatchObject({ employee_id: SAM_EMPLOYEE, matricule: 'QS-0003' });
});

test('moving a payslip confirms the target, calls the API with toPersonId and offers the matricule reset', async ({ page }) => {
  const { moves, rpcs } = await mock(page, { payslips: true });
  await openSamEmployment(page);
  // Moving is a rare correction, so it sits in the row's More actions menu.
  await page.getByRole('button', { name: 'More actions for Octobre 2026' }).click();
  await page.getByRole('menuitem', { name: 'Move to another person…' }).click();
  await page.getByLabel('Move payslip to').selectOption({ label: 'Imported Person renamed' });
  await expect(page.getByText('Move Bulletin de paie Octobre 2026 from Sam Rivera to Imported Person renamed?')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByText("Reset Sam Rivera's matricule to 00026?")).toBeVisible();
  expect(moves).toHaveLength(1);
  expect(moves[0]).toMatchObject({ documentId: 'doc-oct', toPersonId: IMPORTED });
  await page.getByRole('button', { name: 'Reset matricule' }).click();
  await expect(page.getByText("Reset Sam Rivera's matricule to 00026?")).toHaveCount(0);
  expect(rpcs).toHaveLength(1);
  expect(rpcs[0]).toMatchObject({ employee_id: SAM_EMPLOYEE, matricule: '00026' });
});

const SAM_APPLICATION = seed.applications[0].id;
const signatureRequest = (title: string, application_id: string | null) => ({
  id: crypto.randomUUID(), person_id: SAM, template_id: null, title, type_code: 'CONTRACT_CDI', signers: [], supersedes: null,
  status: 'sent', error: '', youtrust_request_id: 'yt-1', signed_document_id: null, audit_document_id: null, application_id,
  created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z',
});

async function openSamApplication(page: Page) {
  await page.goto(`${harness.url}?view=people`);
  await page.getByRole('button', { name: /Sam Rivera/ }).click();
  await page.getByRole('tab', { name: /Applications/ }).click();
}

test('an admin sends the hiring contract from the application at the Contract stage', async ({ page }) => {
  const { signatureCalls } = await mock(page, {
    admin: true, contractStage: true,
    signatureRequests: [signatureRequest('Contrat CDI Sam', SAM_APPLICATION), signatureRequest('Avenant télétravail', null)],
  });
  await openSamApplication(page);
  await expect(page.getByRole('heading', { name: 'Contract signature' })).toBeVisible();
  await expect(page.getByText('The hiring contract for this application. Once signed in Youtrust, the person can be hired.')).toBeVisible();
  // Only the request sent from this application is listed; amendments from the employment page are not.
  await expect(page.getByRole('row', { name: /Contrat CDI Sam/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Avenant télétravail/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send for signature' })).toBeVisible();
  expect(signatureCalls.find((call) => call.action === 'list-requests')).toMatchObject({ personId: SAM });
  await expect(page.getByText('Countersign as employer')).toHaveCount(0);
});

test('an HR user sees whether the contract is signed but cannot send it', async ({ page }) => {
  await mock(page, { contractStage: true, signed: false });
  await openSamApplication(page);
  await expect(page.getByRole('heading', { name: 'Contract signature' })).toBeVisible();
  await expect(page.getByText('Not signed yet. An admin sends the contract from this page.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for signature' })).toHaveCount(0);
  await expect(page.getByText('Countersign as employer')).toHaveCount(0);
});

test('the hire prerequisites include the Youtrust signature', async ({ page }) => {
  await mock(page, { contractStage: true });
  await openSamApplication(page);
  await expect(page.getByRole('heading', { name: 'Hire and start preboarding' })).toBeVisible();
  await expect(page.getByText('The contract is signed in Youtrust')).toBeVisible();
  await expect(page.getByText('Countersign as employer')).toHaveCount(0);
});

test('Import from resume reads the CV and saves it to the record in one click, with undo', async ({ page }) => {
  const { requests, snapshot } = await mock(page);
  Object.assign(snapshot.people.find((person) => person.id === SAM)!, { degrees: 'BSc Mathematics — Sorbonne — 2013' });
  await page.route('**/api/recruitment-cv', (route) => reply(route, { file: { id: 'drive-cv-1', name: 'Sam Rivera - CV.pdf', createdTime: '2026-11-01T10:00:00Z' } }));
  const parses: unknown[] = [];
  await page.route('**/api/parse-candidate', (route) => {
    parses.push(route.request().postDataJSON());
    return reply(route, { model: 'kimi-k2.6', profile: {
      fullName: 'Sam Rivera', email: '', phone: '', headline: 'Platform engineer', currentRole: 'Lead engineer', company: 'Contoso',
      location: '', linkedinUrl: '', yearsExperience: 8, skills: ['TypeScript', 'Kubernetes'],
      experience: [{ title: 'Lead engineer', company: 'Contoso', contract_type: 'CDI', start: '2021-03', end: '', location: 'Paris', summary: 'Leads the platform team.', skills: ['Kubernetes'] }],
      education: [{ degree: 'MSc Computer Science', school: 'Sorbonne', start_year: '2013', end_year: '2015' }, { degree: 'BSc Mathematics', school: 'Sorbonne', start_year: '2010', end_year: '2013' }],
      certifications: [{ name: 'CKA', issuer: 'CNCF', year: '2021' }],
      languages: [{ language: 'English', level: 'C1' }],
      summary: 'Engineer who builds reliable platforms.', confidence: 'high',
    } });
  });
  await openSamApplication(page);
  await page.getByRole('button', { name: 'Import from resume' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updated from the resume' })).toContainText('description, 1 position, 2 degrees, 1 certification, 1 language, 1 skill');
  expect(parses).toEqual([{ profile: { kind: 'drive', personId: SAM } }]);
  // Saved straight away — no separate Apply step.
  const update = requests.filter((item) => item.kind === 'update_person');
  expect(update).toHaveLength(1);
  expect(update[0]).toMatchObject({
    person_id: SAM,
    summary: 'Engineer who builds reliable platforms.',
    // The stored "BSc Mathematics — Sorbonne — 2013" gains its range instead of being listed twice.
    degrees: 'BSc Mathematics — Sorbonne — 2010–2013\nMSc Computer Science — Sorbonne — 2013–2015',
    certifications: 'CKA — CNCF — 2021',
    languages: 'English — C1',
    skills: 'TypeScript, PostgreSQL, Kubernetes',
    headline: 'Platform engineer',
    experience: [expect.objectContaining({ title: 'Lead engineer', company: 'Contoso' })],
  });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => requests.filter((item) => item.kind === 'update_person').length).toBe(2);
  expect(requests.filter((item) => item.kind === 'update_person')[1]).toMatchObject({ person_id: SAM, summary: '', degrees: 'BSc Mathematics — Sorbonne — 2013', skills: 'TypeScript, PostgreSQL', experience: [] });
});

test('education shows the start and end year of each degree', async ({ page }) => {
  const { snapshot } = await mock(page);
  Object.assign(snapshot.people.find((person) => person.id === SAM)!, { degrees: 'MSc Computer Science — Sorbonne — 2013–2015\nLicence Maths — Lyon 1 — 2010 - 2013\nBac S — Lycée Henri-IV — 2010' });
  await openSamApplication(page);
  const education = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Education' }) });
  await expect(education.getByText('2013–2015', { exact: true })).toBeVisible();
  await expect(education.getByText('2010–2013', { exact: true })).toBeVisible();
  await expect(education.getByText('2010', { exact: true })).toBeVisible();
  await expect(education.getByText('Lyon 1', { exact: true })).toBeVisible();
});
