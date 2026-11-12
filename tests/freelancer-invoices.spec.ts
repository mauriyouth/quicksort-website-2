import { test, expect, type Page, type Route } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });

let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  // Rendered at the width the admin workspace gets next to the sidebar on a 1155px screen.
  harness = await startComponentHarness(`
    import { BrowserRouter } from '${process.cwd()}/apps/admin/node_modules/react-router-dom';
    import { FreelancerInvoices } from '@app/sales/freelancer-invoices/FreelancerInvoices';
    createRoot(document.getElementById('root')).render(
      <BrowserRouter><main style={{ padding: 24, maxWidth: 800, margin: 'auto' }}><FreelancerInvoices /></main></BrowserRouter>
    );
  `, { adminStyles: true });
});
test.afterAll(async () => { await harness?.close(); });

const json = (route: Route, value: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });

const ALICE = '71000000-0000-4000-8000-0000000000a1';
const BOB = '71000000-0000-4000-8000-0000000000b1';
const CHLOE = '71000000-0000-4000-8000-0000000000c1';
const DAVID = '71000000-0000-4000-8000-0000000000d1';
const BOB_INVOICE = '72000000-0000-4000-8000-0000000000b1';

const billing = (companyName = '') => ({ companyName, siret: '', iban: '', extraEmails: [] as string[] });
const invoice = (id: string, employeeId: string, extra: Record<string, unknown>) => ({
  id, employeeId, number: 'F-1', issueDate: '2026-11-01', periodMonth: '2026-10-01', dueDate: '2026-12-01',
  amountHtCents: 840000, vatCents: 168000, amountTtcCents: 1008000, isCreditNote: false, flags: [], review: 'ok', reviewNote: '',
  paidAt: null, paidByTransactionId: null, source: 'email', createdAt: '2026-11-02T09:00:00Z', version: 1, documentId: 'doc-1',
  display: { status: 'to_pay', warning: false, overdue: false }, suggestions: [], ...extra,
});
const match = (_days: number, cents: number) => ({ invoicedHtCents: cents, expectedCents: cents, diffCents: 0, ok: true, reason: 'match' });

const MONTH = {
  rows: [
    {
      employeeId: ALICE, name: 'Alice Martin', expected: { days: 12, cents: 840000 }, missingRate: false,
      rates: [{ dailyRate: 700, startDate: '2026-01-01', endDate: null }], check: match(12, 840000), missing: false, billing: billing('Alice SAS'),
      invoices: [invoice('72000000-0000-4000-8000-0000000000a1', ALICE, {
        number: 'F-101', paidAt: '2026-11-08', paidByTransactionId: 'tx-paid', display: { status: 'paid', warning: false, overdue: false },
      })],
    },
    {
      employeeId: BOB, name: 'Bob Durand', expected: { days: 13, cents: 845000 }, missingRate: false,
      rates: [{ dailyRate: 650, startDate: '2026-01-01', endDate: null }],
      check: { invoicedHtCents: 900000, expectedCents: 845000, diffCents: 55000, ok: false, reason: 'mismatch' }, missing: false, billing: billing(),
      invoices: [invoice(BOB_INVOICE, BOB, {
        number: 'BD-7', amountHtCents: 900000, vatCents: 180000, amountTtcCents: 1080000, review: 'to_check', source: 'portal',
        createdAt: '2026-11-03T09:00:00Z', display: { status: 'to_check', warning: true, overdue: false },
        suggestions: [{ transactionId: 'tx-bob', amountCents: -1080000, settledAt: '2026-11-09', counterparty: 'BOB DURAND CONSEIL', why: 'Same amount' }],
      })],
    },
    {
      employeeId: CHLOE, name: 'Chloé Petit', expected: { days: 10, cents: 600000 }, missingRate: false,
      rates: [{ dailyRate: 600, startDate: '2026-01-01', endDate: null }], check: match(10, 600000), missing: false, billing: billing(),
      invoices: [invoice('72000000-0000-4000-8000-0000000000c1', CHLOE, {
        number: 'CP-3', amountHtCents: 600000, vatCents: 120000, amountTtcCents: 720000, issueDate: '2026-09-04', dueDate: '2026-10-04',
        display: { status: 'to_pay', warning: false, overdue: true },
      })],
    },
    {
      employeeId: DAVID, name: 'David Roux', expected: { days: 15, cents: 750000 }, missingRate: false,
      rates: [{ dailyRate: 500, startDate: '2026-01-01', endDate: null }],
      check: { invoicedHtCents: 0, expectedCents: 750000, diffCents: 750000, ok: false, reason: 'mismatch' }, missing: true, billing: billing(), invoices: [],
    },
  ],
  unassigned: [],
};

async function mock(page: Page, answers: Record<string, { status?: number; body: unknown }> = {}) {
  const posts: Array<Record<string, unknown>> = [];
  const gets: string[] = [];
  await page.route(`${fixtureSupabaseURL}/**`, (route) => json(route, []));
  await page.route('**/api/freelancer-invoices**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'GET') {
      gets.push(url.search);
      const resource = url.searchParams.get('resource');
      if (resource === 'month') return json(route, MONTH);
      if (resource === 'events') return json(route, { events: [{ id: 'e1', kind: 'received', actor_email: 'freelancer invoices cycle', detail: {}, created_at: '2026-11-03T09:00:00Z' }] });
      if (resource === 'settings') return json(route, {
        mailbox: 'mohamed@quicksort.fr', backfillFrom: '2026-01-01', lastPolledAt: '2026-11-10T08:00:00Z', lastError: null,
        driveServiceAccountEmail: 'drive-bot@quicksort.iam.gserviceaccount.com',
      });
      return json(route, { error: 'Unknown resource.' }, 400);
    }
    const body = req.postDataJSON();
    posts.push(body);
    const answer = answers[body.action];
    if (answer) return json(route, answer.body, answer.status ?? 200);
    return json(route, { saved: true });
  });
  return { posts, gets };
}

test('tabs count each kind of invoice and the mismatch shows what the CRA says', async ({ page }) => {
  const { gets } = await mock(page);
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await expect(page.getByRole('tab', { name: 'To check (1)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'To pay (1)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Paid (1)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Missing (1)' })).toBeVisible();
  expect(gets.some((q) => /resource=month&month=\d{4}-\d{2}-01/.test(q))).toBe(true);

  await expect(page.getByRole('row', { name: /Bob Durand/ })).toContainText('CRA says €8,450 (13 d × €650)');
  await expect(page.getByRole('row', { name: /Alice Martin/ })).toContainText('✓ 12 d × €700');
  await expect(page.getByRole('row', { name: /Alice Martin/ })).toContainText('Paid 8 Nov');
  await expect(page.getByRole('row', { name: /Alice Martin/ })).toContainText('email · 2 Nov');
  await expect(page.getByRole('row', { name: /Chloé Petit/ })).toContainText('To pay · due 4 Oct');
  await expect(page.getByRole('row', { name: /David Roux/ })).toContainText('Missing');

  await page.getByRole('tab', { name: 'To check (1)' }).click();
  await expect(page.getByRole('row', { name: /Bob Durand/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Alice Martin/ })).toHaveCount(0);
});

test('confirming a suggested payment posts both ids', async ({ page }) => {
  const { posts } = await mock(page);
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('row', { name: /Bob Durand/ }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('BOB DURAND CONSEIL')).toBeVisible();
  await panel.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => posts.find((p) => p.action === 'confirm_match')).toEqual({ action: 'confirm_match', invoiceId: BOB_INVOICE, transactionId: 'tx-bob' });
});

test('a refused payment says the debit is already used', async ({ page }) => {
  await mock(page, { confirm_match: { status: 409, body: { error: 'This debit already pays another invoice. Unlink it there first.' } } });
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('row', { name: /Bob Durand/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('dialog').getByText('This payment is already linked to another invoice. Unlink it there, or record it as one payment for several invoices.')).toBeVisible();
});

test('accepting a difference needs a note of 3 characters', async ({ page }) => {
  const { posts } = await mock(page);
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('row', { name: /Bob Durand/ }).click();
  const panel = page.getByRole('dialog');
  const accept = panel.getByRole('button', { name: 'Accept difference' });
  await expect(accept).toBeDisabled();
  await panel.getByLabel('Review note').fill('ok');
  await expect(accept).toBeDisabled();
  await panel.getByLabel('Review note').fill('ok, extra day agreed');
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect.poll(() => posts.find((p) => p.action === 'accept_difference')).toEqual({ action: 'accept_difference', id: BOB_INVOICE, note: 'ok, extra day agreed' });
});

test('without a daily rate the CRA check says so', async ({ page }) => {
  await mock(page);
  const noRate = structuredClone(MONTH);
  Object.assign(noRate.rows[1], { missingRate: true });
  await page.route('**/api/freelancer-invoices?resource=month**', (route) => json(route, noRate));
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await expect(page.getByRole('row', { name: /Bob Durand/ })).toContainText('No TJM on file');
});

test('settings show the mailbox and the delegation setup', async ({ page }) => {
  const { posts } = await mock(page);
  await page.goto(new URL('/sales/freelancer-invoices/settings', harness.url).href);
  await expect(page.getByLabel('Mailbox address')).toHaveValue('mohamed@quicksort.fr');
  await expect(page.getByText('drive-bot@quicksort.iam.gserviceaccount.com')).toBeVisible();
  await expect(page.getByText('https://www.googleapis.com/auth/gmail.readonly')).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(() => posts.some((p) => p.action === 'sync')).toBe(true);
});

test('no horizontal scroll at 1155px', async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 1155, height: 900 });
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await expect(page.getByRole('row', { name: /Bob Durand/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('row', { name: /Bob Durand/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('one debit can pay several invoices of the same freelancer', async ({ page }) => {
  const { posts } = await mock(page);
  const BOB_SECOND = '72000000-0000-4000-8000-0000000000b2';
  const twoInvoices = structuredClone(MONTH);
  twoInvoices.rows[1].invoices.push(invoice(BOB_SECOND, BOB, { number: 'BD-8', amountHtCents: 100000, vatCents: 20000, amountTtcCents: 120000 }));
  await page.route('**/api/freelancer-invoices?resource=month**', (route) => json(route, twoInvoices));
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('row', { name: /Bob Durand · BD-7/ }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('checkbox', { name: /BD-8/ }).click();
  await panel.getByRole('button', { name: 'Confirm for 2 invoices' }).click();
  await expect.poll(() => posts.find((p) => p.action === 'link_debit')).toEqual({ action: 'link_debit', invoiceIds: [BOB_INVOICE, BOB_SECOND], transactionId: 'tx-bob' });
  expect(posts.some((p) => p.action === 'confirm_match')).toBe(false);
});

test('an invoice with no period waits under To check; a rejected one does not', async ({ page }) => {
  await mock(page);
  const withUnassigned = structuredClone(MONTH);
  withUnassigned.unassigned = [
    { ...invoice('72000000-0000-4000-8000-0000000000e1', ALICE, { number: 'NP-1', periodMonth: null, review: 'to_check', display: { status: 'to_check', warning: true, overdue: false } }), name: 'Alice Martin' },
    { ...invoice('72000000-0000-4000-8000-0000000000e2', ALICE, { number: 'NP-2', periodMonth: null, review: 'rejected', display: { status: 'rejected', warning: true, overdue: false } }), name: 'Alice Martin' },
  ] as never[];
  await page.route('**/api/freelancer-invoices?resource=month**', (route) => json(route, withUnassigned));
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('tab', { name: 'To check (2)' }).click();
  await expect(page.getByRole('row', { name: /Alice Martin · NP-1/ })).toContainText('No period set');
  await expect(page.getByRole('row', { name: /NP-2/ })).toHaveCount(0);
});

test('an admin uploads the missing invoice from the freelancer panel', async ({ page }) => {
  const { posts } = await mock(page, { upload: { body: { received: true, duplicate: false } } });
  await page.goto(new URL('/sales/freelancer-invoices', harness.url).href);
  await page.getByRole('row', { name: /David Roux/ }).click();
  const panel = page.getByRole('dialog');
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Upload invoice', exact: true }).click();
  await (await chooser).setFiles({ name: 'facture-octobre.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(panel.getByText('Invoice uploaded. It is read and checked like an emailed one.')).toBeVisible();
  expect(posts.find((p) => p.action === 'upload')).toEqual({
    action: 'upload', employeeId: DAVID, fileName: 'facture-octobre.pdf', mimeType: 'application/pdf', data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'),
  });
});
