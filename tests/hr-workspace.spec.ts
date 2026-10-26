import { test, expect, type Page, type Route } from '@playwright/test';
import { z } from 'zod';
import seed from './fixtures/hr-workspace.json';
import type { Suggestion } from '../apps/admin/src/hr/domain';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { HrWorkspace } from '@app/hr/HrWorkspace';
    const view = new URLSearchParams(location.search).get('view') || 'overview';
    createRoot(document.getElementById('root')).render(
      <main style={{ padding: 24, maxWidth: 1400, margin: 'auto' }}>
        <HrWorkspace view={view} actorEmail="hr@example.invalid" role="hr" />
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

async function mock(page: Page, {
  staffingOnly = false,
  failFirstTask = false,
  staleSuggestion = false,
} = {}) {
  const suggestions: Suggestion[] = [];
  const snapshot = { ...structuredClone(seed), suggestions };
  const requests: Request[] = [];
  if (staffingOnly) snapshot.capabilities = { recruit: false, approve_offer: false, approve_direction: false, staff: true, admin: false };
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
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    if (url.pathname.endsWith('/rpc/hr_workspace_snapshot')) return reply(route, snapshot);
    if (url.pathname.endsWith('/rpc/hr_application_requirements')) return reply(route, [
      { key: 'screening', label: 'Screening evidence reviewed', done: true },
      { key: 'signatures', label: 'Contract signed by the candidate and employer', done: true },
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
  return { snapshot, requests };
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
  await expect(page.getByLabel('Application history').locator('option')).toHaveCount(2);
  await expect(page.getByText('Both signatures recorded', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Employment/ }).click();
  await expect(page.getByLabel('Employment period').locator('option')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Journey checklist' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('rehire-employment.png'), fullPage: true });
  await page.getByRole('button', { name: 'Close record', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  await expect(page.getByRole('dialog').getByText('Access verified with the employee.', { exact: true })).toBeVisible();
  const completions = requests.filter((request) => request.kind === 'complete_task');
  expect(completions).toHaveLength(2);
  expect(completions[1].request_id).toBe(completions[0].request_id);
});

test('staffing permissions expose assignments without opening confidential person records', async ({ page }) => {
  await mock(page, { staffingOnly: true });
  await page.goto(`${harness.url}?view=people`);
  // Staffing-only users land on the employee list and never see person records.
  await expect(page.getByRole('tab', { name: 'Employees' })).toBeVisible();
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
  const dialog = page.getByRole('dialog');
  // Without a job post the role is named manually.
  await dialog.getByLabel('Role to hire').fill('Support Engineer');
  // Linking a job post replaces the manual role: title and requirements come from the post.
  await dialog.getByLabel('Linked job post').selectOption(job.id);
  await expect(dialog.getByLabel('Role to hire')).toHaveCount(0);
  await expect(dialog.getByText(`Role and requirements are taken from “${job.title}”.`, { exact: true })).toBeVisible();
  await dialog.getByLabel('Search Linked clients').fill('Test');
  await dialog.getByRole('button', { name: client.name, exact: true }).click();
  await expect(dialog.getByText(client.name, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create hiring need', exact: true }).click();
  expect(requests.map((request) => request.kind)).toEqual(['create_requisition']);
  expect(requests[0]).toMatchObject({ title: job.title, job_id: job.id, client_ids: [client.id] });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
