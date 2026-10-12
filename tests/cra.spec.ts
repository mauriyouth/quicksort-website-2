import { test, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';
import { entrySchema, type Snapshot } from '../apps/admin/src/cra/domain';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { CraScreen } from '@app/cra/CraScreen';
    const audience = new URLSearchParams(location.search).get('audience') || 'employee';
    createRoot(document.getElementById('root')).render(<main style={{ padding: 16 }}><CraScreen audience={audience} draftOwner="employee@example.invalid" /></main>);
  `);
});
test.afterAll(async () => { await harness?.close(); });

const employeeId = '31000000-0000-4000-8000-000000000001';
const otherEmployeeId = '31000000-0000-4000-8000-000000000002';
const projectId = '32000000-0000-4000-8000-000000000001';
const saveSchema = z.object({ target_employee: z.uuid(), target_month: z.iso.date(), expected_version: z.number().int(), entries: entrySchema.array() });
const employees = [
  { id: employeeId, full_name: 'Sam Rivera', role: 'Engineer', start_date: '2026-01-01', end_date: null },
  { id: otherEmployeeId, full_name: 'Jordan Lee', role: 'Designer', start_date: '2026-10-12', end_date: null },
];
async function mock(page: Page, { admin = false, failSave = false, conflict = false, assignments }: { admin?: boolean; failSave?: boolean; conflict?: boolean; assignments?: unknown[] } = {}) {
  const saves: z.infer<typeof saveSchema>[] = [];
  const months = new Map<string, Snapshot>();
  const contextAssignments = assignments ?? [{ id: '33000000-0000-4000-8000-000000000001', employee_id: employeeId, project_id: projectId, title: 'Client platform', client_name: 'Acme', start_date: '2026-10-05', end_date: '2026-10-16', status: 'active' }];
  await page.route(`${fixtureSupabaseURL}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return reply({});
    if (path.endsWith('/cra_context')) return reply({
      employees: admin ? employees : employees.slice(0, 1),
      assignments: contextAssignments,
    });
    const input = z.object({ target_employee: z.uuid(), target_month: z.iso.date() }).parse(route.request().postDataJSON());
    const key = `${input.target_employee}:${input.target_month}`;
    const snapshot = months.get(key) || { version: 0, entries: [], updated_at: null, updated_by: null };
    if (path.endsWith('/cra_month_snapshot')) return reply(snapshot);
    if (path.endsWith('/cra_save_month')) {
      const save = saveSchema.parse(route.request().postDataJSON());
      saves.push(save);
      if (failSave && saves.length === 1) return reply({ message: 'Connection failed. Try saving again.' }, 503);
      if (conflict && saves.length === 1) {
        months.set(key, { version: 1, entries: [{ day: '2026-10-01', part: 'full', status: 'rtt', project_id: null }], updated_at: '2026-10-04T14:00:00Z', updated_by: 'admin@example.invalid' });
        return reply({ message: 'This CRA was changed by another person. Reload the month before saving.' }, 409);
      }
      const saved = { version: snapshot.version + 1, entries: save.entries, updated_at: '2026-10-04T14:00:00Z', updated_by: admin ? 'admin@example.invalid' : 'employee@example.invalid' };
      months.set(key, saved); return reply(saved);
    }
    return reply({ message: `Unexpected endpoint ${path}` }, 404);
  });
  return { saves, months };
}
async function openOctober(page: Page, admin = false) {
  await page.goto(`${harness.url}?audience=${admin ? 'admin' : 'employee'}&month=2026-10`);
  await expect(page.getByRole('region', { name: 'Months' }).getByRole('button', { pressed: true })).toBeVisible();
}
function dayCell(page: Page, day: string) {
  return page.getByRole('button', { name: new RegExp(`Activity for ${day}:`) });
}
async function paint(page: Page, days: string[], brush: string | RegExp, duration?: string) {
  for (const day of days) await dayCell(page, day).click();
  if (duration) await page.getByRole('radio', { name: duration, exact: true }).click();
  await page.getByRole('button', { name: brush, exact: true }).click();
}

test('employee paints all activities with brushes, saves, and reloads the saved CRA', async ({ page }) => {
  const { saves } = await mock(page);
  await openOctober(page);
  await page.getByRole('combobox', { name: 'Employee', exact: true }).focus();
  await expect(page.getByRole('option', { name: /Sam Rivera/ })).toHaveCount(1);
  await paint(page, ['2026-10-01'], /^RTT Reduced working time/);
  await paint(page, ['2026-10-02'], /^Congés sans solde Unpaid leave/);
  await paint(page, ['2026-10-05'], /^Acme Client project · Client platform/);
  await paint(page, ['2026-10-06'], /^Congés Payés Paid leave/);
  await paint(page, ['2026-10-07'], /^Internal Non-billable/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  expect(saves).toEqual([{ target_employee: employeeId, target_month: '2026-10-01', expected_version: 0, entries: [
    { day: '2026-10-01', part: 'full', status: 'rtt', project_id: null },
    { day: '2026-10-02', part: 'full', status: 'unpaid_leave', project_id: null },
    { day: '2026-10-05', part: 'full', status: 'client_project', project_id: projectId },
    { day: '2026-10-06', part: 'full', status: 'paid_leave', project_id: null },
    { day: '2026-10-07', part: 'full', status: 'internal', project_id: null },
  ] }]);
  // The saved CRA comes back after a full reload.
  await page.reload();
  await expect(dayCell(page, '2026-10-05')).toHaveAccessibleName(/Client Project Client platform \(Acme\), full day/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('half days fill mornings and afternoons, then merge back into a full day', async ({ page }) => {
  const { saves } = await mock(page);
  await openOctober(page);
  await expect(page.getByText('22 working days')).toBeVisible();
  await paint(page, ['2026-10-08'], /^RTT Reduced working time/, 'Morning');
  await expect(dayCell(page, '2026-10-08')).toHaveAccessibleName(/morning RTT, afternoon not filled/);
  await paint(page, ['2026-10-08'], /^Internal Non-billable/, 'Afternoon');
  await expect(dayCell(page, '2026-10-08')).toHaveAccessibleName(/morning RTT, afternoon Internal/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[0].entries.filter(entry => entry.day === '2026-10-08')).toEqual([
    { day: '2026-10-08', part: 'am', status: 'rtt', project_id: null },
    { day: '2026-10-08', part: 'pm', status: 'internal', project_id: null },
  ]);
  await expect(page.getByText(' / 22 days filled')).toBeVisible();
  // Painting both halves with the same activity collapses to one full-day entry.
  await page.reload();
  await paint(page, ['2026-10-08'], /^Internal Non-billable/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[1].entries.filter(entry => entry.day === '2026-10-08')).toEqual([
    { day: '2026-10-08', part: 'full', status: 'internal', project_id: null },
  ]);
});

test('default project fills empty weekdays within assignment dates and keeps existing leave', async ({ page }) => {
  const { saves } = await mock(page);
  await openOctober(page);
  await paint(page, ['2026-10-06'], /^Congés Payés Paid leave/);
  await page.getByRole('button', { name: /Fill 21 empty/ }).click();
  await expect(dayCell(page, '2026-10-05')).toHaveAccessibleName(/Client Project Client platform \(Acme\), full day/);
  await expect(dayCell(page, '2026-10-06')).toHaveAccessibleName(/Congés Payés, full day/);
  // The project is assigned 10-05 → 10-16, so 10-19 stays empty.
  await expect(dayCell(page, '2026-10-19')).toHaveAccessibleName(/not filled, full day/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[0].entries.map(entry => entry.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
});

test('client brush skips days outside the assignment and reports the skip', async ({ page }) => {
  const { saves } = await mock(page);
  await openOctober(page);
  await page.getByRole('button', { name: 'Select empty', exact: true }).click();
  await page.getByRole('button', { name: /^Acme Client project · Client platform/, exact: true }).click();
  await expect(page.getByText(/skipped \(project not assigned on those dates\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[0].entries.map(entry => entry.day)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
});

test('assigned projects appear as brushes even outside the viewed month, but only paint covered days', async ({ page }) => {
  await mock(page, { assignments: [{ id: '33000000-0000-4000-8000-000000000001', employee_id: employeeId, project_id: projectId, title: 'Client platform', client_name: 'Acme', start_date: '2026-11-02', end_date: null, status: 'confirmed' }] });
  await openOctober(page);
  const brush = page.getByRole('button', { name: /^Acme Client project · Client platform/, exact: true });
  await expect(brush).toBeVisible();
  // Nothing is assignable in October, so no default-project strip is offered.
  await expect(page.getByRole('button', { name: /Fill [\d.]+ empty/ })).toHaveCount(0);
  await dayCell(page, '2026-10-05').click();
  await brush.click();
  await expect(page.getByText('No days updated — the project is not assigned on the selected dates.', { exact: true })).toBeVisible();
  // In November the same brush paints the days it covers.
  await page.getByRole('button', { name: /November 2026/ }).click();
  await paint(page, ['2026-11-03'], /^Acme Client project · Client platform/);
  await expect(dayCell(page, '2026-11-03')).toHaveAccessibleName(/Client Project Client platform \(Acme\), full day/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
});

test('admin can fill another employee and drafts stay separate per employee and month', async ({ page }) => {
  const { saves } = await mock(page, { admin: true });
  await openOctober(page, true);
  await paint(page, ['2026-10-01'], /^RTT Reduced working time/);
  await page.getByRole('button', { name: /November 2026/ }).click();
  await expect(page.getByRole('button', { name: /November 2026/, pressed: true })).toBeVisible();
  await expect(dayCell(page, '2026-11-02')).toHaveAccessibleName(/not filled, full day/);
  await page.getByRole('button', { name: /October 2026/ }).click();
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/RTT, full day/);
  const picker = page.getByRole('combobox', { name: 'Employee', exact: true });
  await picker.fill('Jordan');
  await page.getByRole('option', { name: /Jordan Lee/ }).click();
  // Jordan starts 2026-10-12: earlier days are locked even when selecting all.
  await expect(dayCell(page, '2026-10-01')).toBeDisabled();
  await page.getByRole('button', { name: 'Select empty', exact: true }).click();
  await expect(page.getByText(/\d+ days selected/)).toBeVisible();
  await page.getByRole('button', { name: /^Internal Non-billable/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[0].target_employee).toBe(otherEmployeeId);
  expect(saves[0].entries[0]).toEqual({ day: '2026-10-12', part: 'full', status: 'internal', project_id: null });
  expect(saves[0].entries.every(entry => entry.day >= '2026-10-12')).toBe(true);
  await picker.fill('Sam');
  await page.getByRole('option', { name: /Sam Rivera/ }).click();
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/RTT, full day/);
});

test('months saved before half-day support load their entries as full days', async ({ page }) => {
  // Legacy snapshot: entries without a `part` column (pre-migration remote DB).
  await page.route(`${fixtureSupabaseURL}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return reply({});
    if (path.endsWith('/cra_context')) return reply({ employees: employees.slice(0, 1), assignments: [] });
    if (path.endsWith('/cra_month_snapshot')) return reply({ version: 3, entries: [{ day: '2026-10-01', status: 'rtt', project_id: null }], updated_at: '2026-10-02T10:00:00Z', updated_by: 'admin@example.invalid' });
    return reply({ message: 'Unexpected endpoint' }, 404);
  });
  await openOctober(page);
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/RTT, full day/);
  await expect(page.getByText(/Saved by admin@example.invalid on/)).toBeVisible();
});

test('failed save keeps entries and succeeds when retried', async ({ page }) => {
  const { saves } = await mock(page, { failSave: true });
  await openOctober(page);
  await paint(page, ['2026-10-01'], /^Internal Non-billable/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Connection failed. Try saving again.');
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/Internal, full day/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('CRA saved.', { exact: true })).toBeVisible();
  expect(saves[1]).toEqual(saves[0]);
});

test('conflict keeps local changes until the user reloads the other editor’s save', async ({ page }) => {
  await mock(page, { conflict: true });
  await openOctober(page);
  await paint(page, ['2026-10-01'], /^Internal Non-billable/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('changed by another person');
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/Internal, full day/);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dayCell(page, '2026-10-01')).toHaveAccessibleName(/RTT, full day/);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('shift-click selects a range and clear empties it', async ({ page }) => {
  await mock(page);
  await openOctober(page);
  await dayCell(page, '2026-10-05').click();
  await dayCell(page, '2026-10-07').click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 days selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^RTT Reduced working time/ }).click();
  await expect(dayCell(page, '2026-10-06')).toHaveAccessibleName(/RTT, full day/);
  await page.getByRole('button', { name: 'Select empty', exact: true }).click();
  await expect(page.getByText('19 days selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Select days to fill', { exact: true })).toBeVisible();
});

test('CRA works at desktop and mobile widths in light and dark themes', async ({ page }, info) => {
  await mock(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openOctober(page);
  await paint(page, ['2026-10-01'], /^RTT Reduced working time/);
  await paint(page, ['2026-10-02'], /^Acme Client project · Client platform/, 'Morning');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await expect(dayCell(page, '2026-10-01')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Acme Client project · Client platform/, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`cra-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  expect(errors).toEqual([]);
});
