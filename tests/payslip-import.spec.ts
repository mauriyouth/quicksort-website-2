import { test, expect, type Page, type Route } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { PayslipImport } from '@app/payslips/PayslipImport';
    createRoot(document.getElementById('root')).render(
      <main style={{ padding: 24, maxWidth: 800, margin: 'auto' }}><PayslipImport /></main>
    );
  `);
});
test.afterAll(async () => { await harness?.close(); });

const ADA = { id: '53000000-0000-4000-8000-000000000001', person_id: '53000000-0000-4000-8000-0000000000a1', matricule: '00026', status: 'active', end_date: null, start_date: '2024-01-01', contract_type: 'CDI' };
const BEN = { id: '53000000-0000-4000-8000-000000000002', person_id: '53000000-0000-4000-8000-0000000000a2', matricule: 'QS-0000', status: 'active', end_date: null, start_date: '2024-02-01', contract_type: 'CDI' };
const FREE = { id: '53000000-0000-4000-8000-000000000003', person_id: '53000000-0000-4000-8000-0000000000a3', matricule: '00099', status: 'active', end_date: null, start_date: '2024-02-01', contract_type: 'Freelance' };
const PEOPLE = [
  { id: ADA.person_id, full_name: 'Ada Test' },
  { id: BEN.person_id, full_name: 'Ben Example' },
  { id: FREE.person_id, full_name: 'Free Lancer' },
];

const json = (route: Route, value: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });

async function mock(page: Page, { failRegisterFor = '', filed = [] as unknown[] } = {}) {
  const rpcs: Array<Record<string, unknown>> = [];
  const registers: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (url.pathname.endsWith('/rpc/set_employee_matricule')) { rpcs.push(route.request().postDataJSON()); return json(route, {}); }
    if (url.pathname.endsWith('/employees')) { queries.push(url.search); return json(route, [ADA, BEN, FREE].filter((e) => e.contract_type !== 'Freelance')); }
    if (url.pathname.endsWith('/hr_people')) return json(route, PEOPLE);
    if (url.pathname.endsWith('/documents')) return json(route, filed);
    return json(route, []);
  });
  await page.route('**/api/documents', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'prepare-upload') return json(route, { upload: { uploadUrl: 'https://storage.example.invalid/put', headers: {}, fileId: `file-${body.fileName}` }, folder: { id: 'folder-1' } });
    if (body.action === 'register') {
      registers.push(body);
      if (failRegisterFor && body.fileId === `file-${failRegisterFor}`) return json(route, { error: 'Drive refused this file.' }, 500);
      return json(route, { document: { id: `doc-${registers.length}` } });
    }
    return json(route, {}, 400);
  });
  await page.route('https://storage.example.invalid/put', (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  return { rpcs, registers, queries };
}

// The generator is an ES module with its own require() context; Playwright's CJS loader cannot import it, so run it in node.
const maker = resolve(process.cwd(), 'tests/fixtures/payslips/make-payslip.mjs');
const pdf = async (name: string, matricule: string, fileName: string) => ({
  name: fileName, mimeType: 'application/pdf',
  buffer: Buffer.from(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { makePayslip } from ${JSON.stringify(maker)}; const b = await makePayslip(JSON.parse(process.argv[1])); process.stdout.write(Buffer.from(b).toString('base64'));`,
    JSON.stringify({ name, matricule, periodLabel: 'Octobre 2026' })], { encoding: 'utf8' }), 'base64'),
});

test('a held matricule matches, a name-only match asks for confirmation, and filing sets the matricule once', async ({ page }) => {
  const { rpcs, registers, queries } = await mock(page);
  await page.goto(harness.url);
  await page.getByLabel('Payslip files').setInputFiles([
    await pdf('ADA TEST', '00026', 'ADA_TEST_10_2026_1.pdf'),
    await pdf('BEN EXAMPLE', '00031', 'BEN_EXAMPLE_10_2026_1.pdf'),
  ]);
  await expect(page.getByText('Matched', { exact: true })).toBeVisible();
  await expect(page.getByText('Confirm', { exact: true }).first()).toBeVisible();
  expect(queries[0]).toContain('contract_type=neq.Freelance');
  await expect(page.getByRole('button', { name: 'File 1 payslip' })).toBeEnabled();

  await page.getByLabel('Confirm BEN_EXAMPLE_10_2026_1.pdf').check();
  await expect(page.getByRole('button', { name: 'File 2 payslips' })).toBeEnabled();
  await page.getByRole('button', { name: 'File 2 payslips' }).click();
  await expect(page.getByText('Filed', { exact: true })).toHaveCount(2);

  expect(rpcs).toEqual([{ employee_id: BEN.id, matricule: '00031', request_id: expect.any(String) }]);
  expect(registers).toHaveLength(2);
  for (const r of registers) expect(r).toMatchObject({ typeCode: 'PAYSLIP', validFrom: '2026-10-01', title: 'Bulletin de paie Octobre 2026' });
});

test('replacing a held matricule needs its checkbox, and one failed row does not stop the rest', async ({ page }) => {
  const { rpcs, registers } = await mock(page, { failRegisterFor: 'ADA_TEST_10_2026_1.pdf' });
  await page.goto(harness.url);
  await page.getByLabel('Payslip files').setInputFiles([
    await pdf('ADA TEST', '00026', 'ADA_TEST_10_2026_1.pdf'),
    await pdf('ADA TEST', '00031', 'ADA_TEST_10_2026_2.pdf'),
  ]);
  await expect(page.getByText('Matched', { exact: true })).toBeVisible();
  const replace = page.getByLabel('Replace matricule 00026 with 00031');
  await expect(replace).toBeVisible();
  await page.getByLabel('Confirm ADA_TEST_10_2026_2.pdf').check();
  await expect(page.getByRole('button', { name: 'File 1 payslip' })).toBeEnabled();
  await replace.check();
  await page.getByRole('button', { name: 'File 2 payslips' }).click();
  await expect(page.getByRole('alert')).toHaveText('Drive refused this file.');
  await expect(page.getByText('Filed', { exact: true })).toHaveCount(1);
  expect(registers.map((r) => r.fileId)).toEqual(['file-ADA_TEST_10_2026_1.pdf', 'file-ADA_TEST_10_2026_2.pdf']);
  expect(rpcs).toHaveLength(1);
});

test('review table fits the content width', async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 1155, height: 900 });
  await page.goto(harness.url);
  await page.getByLabel('Payslip files').setInputFiles([
    await pdf('ADA TEST', '00026', 'ADA_TEST_10_2026_1.pdf'),
    await pdf('BEN EXAMPLE', '00031', 'BEN_EXAMPLE_10_2026_1.pdf'),
    await pdf('NOBODY KNOWN', '00077', 'NOBODY_KNOWN_10_2026_1.pdf'),
    { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') },
  ]);
  await expect(page.getByText('Unreadable', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-mohamedahmednah-dev-quicksort-website/ad1d9046-515a-475f-a5b9-c2ae4f5336ee/scratchpad/payslips-review.png', fullPage: true });
});

const filedFor = (personId: string, sha256: string) => ({ id: 'doc-filed', person_id: personId, valid_from: '2026-10-01', title: 'Bulletin de paie Octobre 2026', sha256 });

test('a person picked on an unknown row is checked against what is already filed for them', async ({ page }) => {
  const file = await pdf('NOBODY KNOWN', '00077', 'NOBODY_KNOWN_10_2026_1.pdf');
  const sha = createHash('sha256').update(file.buffer).digest('hex');

  // Identical copy already filed for Ben: the row cannot be filed.
  const m = await mock(page, { filed: [filedFor(BEN.person_id, sha)] });
  await page.goto(harness.url);
  await page.getByLabel('Payslip files').setInputFiles([file]);
  await page.getByLabel('Employee for NOBODY_KNOWN_10_2026_1.pdf').selectOption({ label: 'Ben Example' });
  await page.getByLabel('Confirm NOBODY_KNOWN_10_2026_1.pdf').check();
  await expect(page.getByText('Already filed for Ben Example')).toBeVisible();
  await expect(page.getByRole('button', { name: 'File 0 payslips' })).toBeDisabled();
  expect(m.registers).toHaveLength(0);
});

test('a differing copy filed for the picked person is superseded', async ({ page }) => {
  const file = await pdf('NOBODY KNOWN', '00077', 'NOBODY_KNOWN_10_2026_1.pdf');
  const { registers } = await mock(page, { filed: [filedFor(BEN.person_id, 'different')] });
  await page.goto(harness.url);
  await page.getByLabel('Payslip files').setInputFiles([file]);
  await page.getByLabel('Employee for NOBODY_KNOWN_10_2026_1.pdf').selectOption({ label: 'Ben Example' });
  await page.getByLabel('Confirm NOBODY_KNOWN_10_2026_1.pdf').check();
  await expect(page.getByText('Replaces the payslip already filed for Ben Example')).toBeVisible();
  await page.getByRole('button', { name: 'File 1 payslip' }).click();
  await expect(page.getByText('Filed', { exact: true })).toBeVisible();
  expect(registers[0]).toMatchObject({ supersedes: 'doc-filed' });
});
