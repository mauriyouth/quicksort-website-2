import { test, expect } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { PersonWorkspace } from '@app/hr/PersonWorkspace';
    createRoot(document.getElementById('root')).render(<main style={{ padding: 16 }}><PersonWorkspace person={window.__person} context={window.__context} tab="profile" onNavigate={() => {}} /></main>);
  `);
});
test.afterAll(async () => { await harness?.close(); });

const employeeId = '31000000-0000-4000-8000-000000000001';
const person = {
  id: '30000000-0000-4000-8000-000000000001',
  full_name: 'Sam Rivera',
  email: 'sam@example.invalid',
  phone: '',
  headline: '',
  location: '',
  skills: '',
  languages: '',
  degrees: '',
  certifications: '',
  notes: '',
  source: '',
  owner_email: '',
  contact_allowed: true,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const employee = {
  id: employeeId,
  person_id: person.id,
  application_id: null,
  offer_id: null,
  matricule: 'QS-1',
  role: 'Engineer',
  manager_email: '',
  parrain: '',
  start_date: '2026-01-01',
  end_date: null,
  planned_exit_date: null,
  status: 'active',
  onboarding_completed_at: null,
  probation_status: 'pending',
  probation_end: null,
  version: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
function workspace() {
  return {
    jobs: [], people: [person], applications: [], employees: [employee], opportunities: [], interviews: [], offers: [], tasks: [], reviews: [], exits: [], exitItems: [], assignments: [], events: [], contracts: [], signatures: [], countersignatures: [], suggestions: [], projects: [], clients: [], accounts: [],
    capabilities: { recruit: true, approve_offer: false, approve_direction: false, staff: true, admin: true },
  };
}
// Three completed months; August and September have several daily entries
// to prove the count groups by month instead of counting rows.
const craRows = [
  { month: '2026-08-01' }, { month: '2026-08-01' }, { month: '2026-08-01' },
  { month: '2026-09-01' }, { month: '2026-09-01' },
  { month: '2026-10-01' },
];
async function installFixture(page: import('@playwright/test').Page, rows: unknown[]) {
  await page.route(`${fixtureSupabaseURL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return reply({});
    if (path.endsWith('/cra_entries')) return reply(rows);
    if (path.endsWith('/profiles')) return reply([]);
    return reply({ message: `Unexpected endpoint ${path}` }, 404);
  });
  await page.addInitScript(([personValue, workspaceValue]: [unknown, unknown]) => {
    (window as Record<string, unknown>).__person = personValue;
    (window as Record<string, unknown>).__context = {
      workspace: workspaceValue,
      run: async () => {},
      busy: false,
      reload: async () => {},
      actorEmail: 'admin@example.invalid',
    };
  }, [person, workspace()]);
}

test('the CRA glance tile and tab badge count completed months, not employment periods', async ({ page }) => {
  await installFixture(page, craRows);
  await page.goto(harness.url);
  await expect(page.getByRole('button', { name: /^1\s*Employment$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^3\s*CRA$/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^CRA\s*3$/ })).toBeVisible();
});

test('a person without CRA entries sees zero', async ({ page }) => {
  await installFixture(page, []);
  await page.goto(harness.url);
  await expect(page.getByRole('button', { name: /^0\s*CRA$/ })).toBeVisible();
});
