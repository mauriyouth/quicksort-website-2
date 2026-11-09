import { test, expect, type Page, type Route } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });

const PERSON = '54000000-0000-4000-8000-0000000000a1';
const TEMPLATE = '54000000-0000-4000-8000-0000000000b1';
const DRAFT = '54000000-0000-4000-8000-0000000000c1';
const OLD_CONTRACT = '54000000-0000-4000-8000-0000000000d1';

let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { SettingsPage } from '@app/SettingsPage';
    import { PersonSignatures } from '@app/signatures/PersonSignatures';
    const screen = location.pathname === '/person'
      ? <PersonSignatures personId="${PERSON}" />
      : <SettingsPage section="signatures" isOwner isAdmin email="admin@quicksort.test" />;
    createRoot(document.getElementById('root')).render(<main style={{ padding: 24, maxWidth: 800, margin: 'auto' }}>{screen}</main>);
  `);
});
test.afterAll(async () => { await harness?.close(); });

const json = (route: Route, value: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(value) });

const SIGNERS = [
  { role: 'person', name: 'Ada Test', email: 'ada@example.com', order: 0 },
  { role: 'quicksort', name: 'Mohamed Nah', email: 'mohamed@quicksort.test', order: 1 },
];
const request = (status: string, extra: Record<string, unknown> = {}) => ({
  id: `54000000-0000-4000-8000-00000000${status.length.toString().padStart(4, '0')}`, person_id: PERSON, template_id: TEMPLATE,
  title: `Contrat CDI (${status})`, type_code: 'CONTRACT_CDI', signers: SIGNERS, supersedes: null, status, error: '',
  youtrust_request_id: 'yt-1', doc_copy_file_id: null, pdf_file_id: 'pdf-1', pdf_folder_id: 'folder-1',
  signed_document_id: status === 'completed' ? '54000000-0000-4000-8000-0000000000e1' : null, audit_document_id: null,
  created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', ...extra,
});

async function mock(page: Page, requests: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = [];
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (url.pathname.endsWith('/document_types')) return json(route, [
      { code: 'CONTRACT_CDI', label: 'CDI contract', owner_kinds: ['person'], position: 1 },
      { code: 'KBIS', label: 'Extrait Kbis', owner_kinds: ['company'], position: 2 },
    ]);
    if (url.pathname.endsWith('/documents')) return json(route, [
      { id: OLD_CONTRACT, type_code: 'CONTRACT_CDI', title: 'Contrat CDI 2024', status: 'active', person_id: PERSON, file_name: 'cdi.pdf', created_at: '2024-01-01T00:00:00Z' },
    ]);
    return json(route, []);
  });
  await page.route('**/api/signatures', async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    switch (body.action) {
      case 'get-settings': return json(route, {
        staging: true, signatoryName: 'Mohamed Nah', signatoryEmail: 'mohamed@quicksort.test', hasApiKey: true, hasWebhookSecret: false,
        serviceAccountEmail: 'drive-bot@quicksort.iam.gserviceaccount.com', webhookUrl: 'https://admin.quicksort.test/api/youtrust-webhook',
      });
      case 'list-templates': return json(route, { templates: [
        { id: TEMPLATE, name: 'Contrat CDI', google_doc_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', signers: 'person_and_quicksort', type_code: 'CONTRACT_CDI', active: true },
      ] });
      case 'list-requests': return json(route, { requests });
      case 'prepare': return json(route, {
        fields: [{ name: 'nom_complet', value: 'Ada Test', known: true }, { name: 'clause_speciale', value: '', known: false }],
        signers: SIGNERS,
      });
      case 'preview': return json(route, {
        request: { ...request('draft'), id: DRAFT }, previewUrl: 'https://drive.google.com/file/d/pdf-1/view',
        pdfBase64: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF').toString('base64'),
      });
      default: return json(route, {}, 400);
    }
  });
  return calls;
}

test('the settings tab shows the webhook URL and the service account to share templates with', async ({ page }) => {
  await mock(page);
  await page.goto(new URL('/settings', harness.url).href);
  await expect(page.getByLabel('Webhook URL')).toHaveValue('https://admin.quicksort.test/api/youtrust-webhook');
  await expect(page.getByText('drive-bot@quicksort.iam.gserviceaccount.com')).toBeVisible();
  await expect(page.getByText('Share each template Doc with this address')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Contrat CDI', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'CDI contract', exact: true })).toBeVisible();
});

test('sending stays disabled until the unknown field is filled, and Build preview shows the PDF', async ({ page }) => {
  const calls = await mock(page);
  await page.goto(new URL('/person', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.getByLabel('Template').selectOption({ label: 'Contrat CDI' });

  await expect(page.getByLabel('nom_complet')).toHaveValue('Ada Test');
  await expect(page.getByLabel('Replaces')).toHaveValue('');
  const build = page.getByRole('button', { name: 'Build preview' });
  const send = page.getByRole('button', { name: 'Send for signature' });
  await expect(build).toBeDisabled();
  await expect(send).toBeDisabled();

  await page.getByLabel('clause_speciale').fill('Télétravail deux jours par semaine');
  await page.getByLabel('Replaces').selectOption({ label: 'Contrat CDI 2024' });
  await expect(build).toBeEnabled();
  await build.click();
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in Drive' })).toHaveAttribute('href', 'https://drive.google.com/file/d/pdf-1/view');
  await expect(send).toBeEnabled();

  const preview = calls.find((call) => call.action === 'preview');
  expect(preview).toMatchObject({
    personId: PERSON, templateId: TEMPLATE, supersedes: OLD_CONTRACT,
    values: { nom_complet: 'Ada Test', clause_speciale: 'Télétravail deux jours par semaine' },
  });
});

test('a custom PDF over 3 MB is refused before upload', async ({ page }) => {
  const calls = await mock(page);
  await page.goto(new URL('/person', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.getByLabel('Template').selectOption({ label: 'Custom PDF' });
  await page.getByLabel('PDF file').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(3 * 1024 * 1024 + 1) });
  await expect(page.getByText('This PDF is larger than 3 MB. Compress it, or send it from Youtrust directly.')).toBeVisible();
  expect(calls.some((call) => call.action === 'preview')).toBe(false);
});

test('request rows show their status labels and actions', async ({ page }) => {
  await mock(page, [request('completed'), request('sent'), request('signed_by_person')]);
  await page.goto(new URL('/person', harness.url).href);
  const completed = page.getByRole('row', { name: /Contrat CDI \(completed\)/ });
  await expect(completed.getByText('Signed', { exact: true })).toBeVisible();
  await expect(completed.getByRole('button', { name: 'Open signed document' })).toBeVisible();
  await expect(page.getByRole('row', { name: /\(sent\)/ }).getByText('Sent', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /\(sent\)/ }).getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('row', { name: /\(signed_by_person\)/ }).getByText('Signed by person', { exact: true })).toBeVisible();
});
