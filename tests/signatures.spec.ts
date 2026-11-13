import { test, expect, type Page, type Route } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });

const PERSON = '54000000-0000-4000-8000-0000000000a1';
const TEMPLATE = '54000000-0000-4000-8000-0000000000b1';
const OTHER_TEMPLATE = '54000000-0000-4000-8000-0000000000b2';
const DRAFT = '54000000-0000-4000-8000-0000000000c1';
const OLD_CONTRACT = '54000000-0000-4000-8000-0000000000d1';
const APPLICATION = '54000000-0000-4000-8000-0000000000f1';

let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { SettingsPage } from '@app/SettingsPage';
    import { PersonSignatures } from '@app/signatures/PersonSignatures';
    const screen = location.pathname === '/person'
      ? <PersonSignatures personId="${PERSON}" />
      : location.pathname === '/application'
      ? <PersonSignatures personId="${PERSON}" applicationId="${APPLICATION}" />
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
  title: `Contrat CDI (${status})`, type_code: 'EMPLOYMENT_CONTRACT', signers: SIGNERS, supersedes: null, status, error: '',
  youtrust_request_id: 'yt-1', doc_copy_file_id: null, pdf_file_id: 'pdf-1', pdf_folder_id: 'folder-1',
  signed_document_id: status === 'completed' ? '54000000-0000-4000-8000-0000000000e1' : null, audit_document_id: null,
  created_at: '2026-11-02T10:00:00Z', updated_at: '2026-11-02T10:00:00Z', ...extra,
});

type Answer = { status?: number; body: unknown };
async function mock(page: Page, requests: unknown[] = [], answers: Record<string, Answer> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  await page.route(`${fixtureSupabaseURL}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return json(route, {});
    if (url.pathname.endsWith('/document_types')) return json(route, [
      { code: 'EMPLOYMENT_CONTRACT', label: 'CDI contract', owner_kinds: ['person'], position: 1 },
      { code: 'KBIS', label: 'Extrait Kbis', owner_kinds: ['company'], position: 2 },
      { code: 'FREELANCE_CONTRACT', label: 'Freelance contract', owner_kinds: ['person'], position: 3 },
      { code: 'OTHER', label: 'Autre', owner_kinds: ['person'], position: 4 },
    ]);
    if (url.pathname.endsWith('/documents')) return json(route, [
      { id: OLD_CONTRACT, type_code: 'EMPLOYMENT_CONTRACT', title: 'Contrat CDI 2024', status: 'active', person_id: PERSON, file_name: 'cdi.pdf', created_at: '2024-01-01T00:00:00Z' },
    ]);
    return json(route, []);
  });
  await page.route('**/api/signatures', async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const answer = answers[body.action];
    if (answer) return json(route, answer.body, answer.status ?? 200);
    switch (body.action) {
      case 'get-settings': return json(route, {
        staging: true, signatoryName: 'Mohamed Nah', signatoryEmail: 'mohamed@quicksort.test', hasApiKey: true, hasWebhookSecret: false,
        serviceAccountEmail: 'drive-bot@quicksort.iam.gserviceaccount.com', webhookUrl: 'https://admin.quicksort.test/api/youtrust-webhook',
      });
      case 'list-templates': return json(route, { templates: [
        { id: TEMPLATE, name: 'Contrat CDI', google_doc_id: '1AbCdEfGhIjKlMnOpQrStUvWxYz', signers: 'person_and_quicksort', type_code: 'EMPLOYMENT_CONTRACT', active: true },
        { id: OTHER_TEMPLATE, name: 'Attestation', google_doc_id: '2AbCdEfGhIjKlMnOpQrStUvWxYz', signers: 'quicksort', type_code: 'OTHER', active: true },
      ] });
      case 'list-template-docs': return json(route, { folder: null, docs: [] });
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
  await expect(page.getByText('Share each template Doc, or the templates folder, with this address')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Contrat CDI', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'CDI contract', exact: true })).toBeVisible();
});

test('without a templates folder, a new template takes a Google Doc link', async ({ page }) => {
  await mock(page);
  await page.goto(new URL('/settings', harness.url).href);
  await page.getByRole('button', { name: 'Add template' }).click();
  await expect(page.getByLabel('Google Doc link')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Google Doc', exact: true })).toHaveCount(0);
});

test('with a templates folder, a new template picks a Doc from it and saves its ID', async ({ page }) => {
  const DOC = '3AbCdEfGhIjKlMnOpQrStUvWxYz';
  const calls = await mock(page, [], {
    'list-template-docs': { body: { folder: { id: 'tpl-folder', name: 'Templates contrats' }, docs: [{ id: DOC, name: 'Contrat CDD' }] } },
    'save-template': { body: { template: { id: '54000000-0000-4000-8000-0000000000b9', name: 'Contrat CDD', google_doc_id: DOC, signers: 'person_and_quicksort', type_code: 'EMPLOYMENT_CONTRACT', active: true }, fields: ['nom'] } },
  });
  await page.goto(new URL('/settings', harness.url).href);
  await page.getByRole('button', { name: 'Add template' }).click();
  await expect(page.getByText('Share the "Templates contrats" folder with this address')).toBeVisible();
  await expect(page.getByLabel('Google Doc link')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Google Doc', exact: true }).selectOption({ label: 'Contrat CDD' });
  await expect(page.getByLabel('Template name')).toHaveValue('Contrat CDD');
  await page.getByLabel('Document type').selectOption({ label: 'CDI contract' });
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Fields found:')).toBeVisible();
  expect(calls.find((call) => call.action === 'save-template')).toMatchObject({ name: 'Contrat CDD', googleDocUrl: DOC });
});

test('editing a template whose Doc is outside the folder keeps it selected', async ({ page }) => {
  await mock(page, [], {
    'list-template-docs': { body: { folder: { id: 'tpl-folder', name: 'Templates contrats' }, docs: [{ id: '3AbCdEfGhIjKlMnOpQrStUvWxYz', name: 'Contrat CDD' }] } },
  });
  await page.goto(new URL('/settings', harness.url).href);
  await page.getByRole('button', { name: 'Edit Contrat CDI' }).click();
  await expect(page.getByRole('combobox', { name: 'Google Doc', exact: true })).toHaveValue('1AbCdEfGhIjKlMnOpQrStUvWxYz');
  await expect(page.getByRole('option', { name: 'Current Doc (outside the folder)' })).toHaveCount(1);
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

test('an error row shows its reason and offers Send again and Cancel', async ({ page }) => {
  const failed = request('error', { id: '54000000-0000-4000-8000-0000000000f1', error: 'Youtrust answered 500.' });
  const calls = await mock(page, [failed], { send: { body: { request: { ...failed, status: 'sent', error: '' } } } });
  await page.goto(new URL('/person', harness.url).href);
  const row = page.getByRole('row', { name: /Contrat CDI \(error\)/ });
  await expect(row.getByText('Youtrust answered 500.')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await row.getByRole('button', { name: 'Send again' }).click();
  await expect(page.getByText('Sent again for signature.')).toBeVisible();
  expect(calls.find((call) => call.action === 'send')).toMatchObject({ requestId: failed.id });
});

test('a filing note shows under the title whatever the status, and a missing audit trail still offers Refresh', async ({ page }) => {
  await mock(page, [
    request('completed', { id: '54000000-0000-4000-8000-0000000000f2', title: 'Contrat noted', audit_document_id: '54000000-0000-4000-8000-0000000000e2', error: 'The document it was meant to replace changed; filed as a new document.' }),
    request('completed', { id: '54000000-0000-4000-8000-0000000000f3', title: 'Contrat half filed', audit_document_id: null }),
    request('sent', { id: '54000000-0000-4000-8000-0000000000f4', title: 'Contrat failing', error: 'Filing the signed documents failed: Drive is down' }),
  ]);
  await page.goto(new URL('/person', harness.url).href);
  const noted = page.getByRole('row', { name: /Contrat noted/ });
  await expect(noted.getByText('The document it was meant to replace changed; filed as a new document.')).toBeVisible();
  await expect(noted.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  const half = page.getByRole('row', { name: /Contrat half filed/ });
  await expect(half.getByRole('button', { name: 'Open signed document' })).toBeVisible();
  await expect(half.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Contrat failing/ }).getByText('Filing the signed documents failed: Drive is down')).toBeVisible();
});

test('a failed discard keeps the draft, which can still be sent', async ({ page }) => {
  const calls = await mock(page, [], { 'discard-draft': { status: 502, body: { error: 'Drive is down.' } } });
  await page.goto(new URL('/person', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.getByLabel('Template').selectOption({ label: 'Contrat CDI' });
  await page.getByLabel('clause_speciale').fill('Aucune');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('Drive is down.')).toBeVisible();
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send for signature' })).toBeEnabled();

  await page.getByLabel('Template').selectOption({ label: 'Custom PDF' });
  await expect(page.getByText('Drive is down.')).toBeVisible();
  await expect(page.getByLabel('Template')).toHaveValue(TEMPLATE);
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
  expect(calls.filter((call) => call.action === 'discard-draft')).toHaveLength(2);
});

test('from an application, only its requests are listed and the preview carries the application', async ({ page }) => {
  const calls = await mock(page, [
    request('sent', { title: 'Contrat CDI (application)', application_id: APPLICATION }),
    request('completed', { title: 'Avenant (employment page)', application_id: null }),
  ]);
  await page.goto(new URL('/application', harness.url).href);
  await expect(page.getByRole('row', { name: /Contrat CDI \(application\)/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Avenant/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.getByLabel('Template').selectOption({ label: 'Contrat CDI' });
  await page.getByLabel('clause_speciale').fill('Aucune');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
  expect(calls.find((call) => call.action === 'prepare')).toMatchObject({ personId: PERSON, templateId: TEMPLATE, applicationId: APPLICATION });
  expect(calls.find((call) => call.action === 'preview')).toMatchObject({ personId: PERSON, applicationId: APPLICATION });
});

test('from an application, only contract templates and contract types are offered', async ({ page }) => {
  await mock(page);
  await page.goto(new URL('/application', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  const templates = page.getByLabel('Template').locator('option');
  await expect(templates).toHaveText(['Choose a template', 'Contrat CDI', 'Custom PDF']);
  await expect(page.getByLabel('Template').locator('option', { hasText: 'Attestation' })).toHaveCount(0);

  await page.getByLabel('Template').selectOption({ label: 'Custom PDF' });
  await expect(page.getByLabel('Document type').locator('option')).toHaveText(['Choose a type', 'CDI contract', 'Freelance contract']);
});

test('from the employment page, every active template and person type is offered', async ({ page }) => {
  await mock(page);
  await page.goto(new URL('/person', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await expect(page.getByLabel('Template').locator('option')).toHaveText(['Choose a template', 'Contrat CDI', 'Attestation', 'Custom PDF']);
  await page.getByLabel('Template').selectOption({ label: 'Custom PDF' });
  await expect(page.getByLabel('Document type').locator('option')).toHaveText(['Choose a type', 'CDI contract', 'Freelance contract', 'Autre']);
});

test('from the employment page, the preview carries no application', async ({ page }) => {
  const calls = await mock(page);
  await page.goto(new URL('/person', harness.url).href);
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await page.getByLabel('Template').selectOption({ label: 'Contrat CDI' });
  await page.getByLabel('clause_speciale').fill('Aucune');
  await page.getByRole('button', { name: 'Build preview' }).click();
  await expect(page.locator('object[type="application/pdf"]')).toBeVisible();
  expect(calls.find((call) => call.action === 'preview')).not.toHaveProperty('applicationId');
});
