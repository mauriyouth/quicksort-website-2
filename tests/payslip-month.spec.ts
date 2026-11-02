import { test, expect, type Page, type Route } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { BrowserRouter } from '${process.cwd()}/apps/admin/node_modules/react-router-dom';
    import { PayslipsMonth } from '@app/payslips/PayslipsMonth';
    createRoot(document.getElementById('root')).render(
      <BrowserRouter><main style={{ padding: 24, maxWidth: 1100, margin: 'auto' }}><PayslipsMonth /></main></BrowserRouter>
    );
  `);
});
test.afterAll(async () => { await harness?.close(); });

const ADA = '54000000-0000-4000-8000-0000000000a1';
const BEN = '54000000-0000-4000-8000-0000000000a2';
const EMPLOYEES = [
  { id: '54000000-0000-4000-8000-000000000001', person_id: ADA, matricule: '00026', status: 'active', end_date: null, start_date: '2024-01-01', contract_type: 'CDI' },
  { id: '54000000-0000-4000-8000-000000000002', person_id: BEN, matricule: 'QS-0003', status: 'active', end_date: null, start_date: '2026-09-15', contract_type: 'CDI' },
];
const PEOPLE = [{ id: ADA, full_name: 'Ada Test' }, { id: BEN, full_name: 'Ben Example' }];
const DOCS = [
  { id: 'doc-ada-oct', person_id: ADA, valid_from: '2026-10-01', title: 'Bulletin de paie Octobre 2026', file_name: 'ADA_10_2026.pdf' },
  { id: 'doc-ada-aug', person_id: ADA, valid_from: '2026-08-01', title: 'Bulletin de paie Août 2026', file_name: 'ADA_08_2026.pdf' },
];

const json = (route: Route, value: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });

async function mock(page: Page) {
  const previews: string[] = [];
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (url.pathname.endsWith('/employees')) return json(route, EMPLOYEES);
    if (url.pathname.endsWith('/hr_people')) return json(route, PEOPLE);
    if (url.pathname.endsWith('/documents')) return json(route, DOCS);
    return json(route, []);
  });
  await page.route('**/api/documents', async (route) => {
    const body = route.request().postDataJSON();
    previews.push(body.documentId);
    return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: '%PDF-1.4\n%%EOF' });
  });
  return { previews };
}

test('opens on the latest filed month, flags who is missing, and previews a payslip', async ({ page }) => {
  const { previews } = await mock(page);
  await page.goto(harness.url);
  await expect(page.getByLabel('Month', { exact: true })).toHaveValue('10');
  await expect(page.getByLabel('Year', { exact: true })).toHaveValue('2026');
  await expect(page.getByRole('status')).toHaveText('2 employed · 1 filed · 1 missing');

  const ben = page.getByRole('listitem').filter({ hasText: 'Ben Example' });
  await expect(ben.getByText('Missing')).toBeVisible();
  await expect(ben.getByText('—')).toBeVisible(); // QS- placeholder is not shown as a matricule

  await page.getByRole('listitem').filter({ hasText: 'Ada Test' }).getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('region', { name: 'Preview of Bulletin de paie Octobre 2026 for Ada Test' }).locator('iframe')).toBeVisible();
  expect(previews).toEqual(['doc-ada-oct']);
});

test('changing month and filtering by name', async ({ page }) => {
  await mock(page);
  await page.goto(harness.url);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByLabel('Month', { exact: true })).toHaveValue('09');
  await expect(page.getByRole('status')).toHaveText('2 employed · 0 filed · 2 missing');

  await page.getByLabel('Month', { exact: true }).selectOption('08');
  await expect(page.getByRole('status')).toHaveText('1 employed · 1 filed'); // Ben only started in September
  await expect(page).toHaveURL(/month=2026-08/);

  await page.getByLabel('Month', { exact: true }).selectOption('10');
  await page.getByLabel('Filter by name or matricule').fill('00026');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('Ada Test');
});
