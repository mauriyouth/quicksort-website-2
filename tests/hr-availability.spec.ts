import { test, expect } from '@playwright/test';
import { fixtureSupabaseURL, startComponentHarness } from './component-harness';

test.use({ channel: 'chromium' });
let harness: Awaited<ReturnType<typeof startComponentHarness>>;
test.beforeAll(async () => {
  harness = await startComponentHarness(`
    import { PersonWorkspace } from '@app/hr/PersonWorkspace';
    createRoot(document.getElementById('root')).render(<main style={{ padding: 16 }}><PersonWorkspace person={window.__person} context={window.__context} tab="projects" onNavigate={() => {}} /></main>);
  `);
});
test.afterAll(async () => { await harness?.close(); });

// The card reports the current calendar year, so fixtures are built from the
// real clock instead of a frozen date.
const year = new Date().getFullYear();
const employeeId = '31000000-0000-4000-8000-000000000001';
const projectId = '32000000-0000-4000-8000-000000000099';
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
  created_at: `${year}-01-01T00:00:00Z`,
  updated_at: `${year}-01-01T00:00:00Z`,
};
const employee = {
  id: employeeId,
  person_id: person.id,
  application_id: null,
  offer_id: null,
  matricule: 'QS-1',
  role: 'Engineer',
  contract_type: 'cdi',
  manager_email: '',
  parrain: '',
  start_date: `${year}-01-01`,
  end_date: null,
  planned_exit_date: null,
  status: 'active',
  onboarding_completed_at: null,
  probation_status: 'pending',
  probation_end: null,
  version: 1,
  created_at: `${year}-01-01T00:00:00Z`,
  updated_at: `${year}-01-01T00:00:00Z`,
};
function workspace(assignments: unknown[] = []) {
  return {
    jobs: [], people: [person], applications: [], employees: [employee], opportunities: [], interviews: [], offers: [], tasks: [], reviews: [], exits: [], exitItems: [], assignments, events: [], contracts: [], signatures: [], countersignatures: [], suggestions: [], projects: [], clients: [], accounts: [],
    capabilities: { recruit: true, approve_offer: false, approve_direction: false, staff: true, admin: true },
  };
}
function craSnapshot(entries: unknown[]) {
  return { version: 1, entries, updated_at: null, updated_by: null };
}
async function installFixture(page: import('@playwright/test').Page, rows: unknown[], assignments: unknown[] = []) {
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
  }, [person, workspace(assignments)]);
}
const card = (page: import('@playwright/test').Page) => page.locator('.hr-person-metric', { hasText: 'Available this year' });

test('with no CRA and no assignments, the whole open-day balance is available for internal', async ({ page }) => {
  await installFixture(page, []);
  await page.goto(harness.url);
  const note = card(page).locator('.hr-person-metric-note');
  await expect(note).toContainText('open days − 0 project − 0 CP − 0 RTT · usable for internal');
  const text = await note.innerText();
  const open = Number(/(\d+(?:\.\d+)?) open days/.exec(text)?.[1]);
  expect(open).toBeGreaterThan(200);
  await expect(card(page).locator('strong')).toHaveText(String(open));
});

test('CRA-recorded project, CP and RTT days shrink the balance', async ({ page }) => {
  const day = (n: number) => `${year}-03-${String(n).padStart(2, '0')}`;
  const rows = [{
    employee_id: employeeId,
    month: `${year}-03-01`,
    entries: craSnapshot([
      ...[2, 3, 4, 5].map(d => ({ day: day(d), part: 'full', status: 'client_project', project_id: projectId })),
      { day: day(6), part: 'am', status: 'client_project', project_id: projectId },
      ...[9, 10].map(d => ({ day: day(d), part: 'full', status: 'paid_leave', project_id: null })),
      { day: day(11), part: 'full', status: 'rtt', project_id: null },
      // Internal and unpaid leave do not consume the balance.
      { day: day(12), part: 'full', status: 'internal', project_id: null },
      { day: day(13), part: 'full', status: 'unpaid_leave', project_id: null },
    ]),
  }];
  await installFixture(page, rows);
  await page.goto(harness.url);
  const note = card(page).locator('.hr-person-metric-note');
  await expect(note).toContainText('− 4.5 project − 2 CP − 1 RTT · usable for internal');
  const text = await note.innerText();
  const open = Number(/(\d+(?:\.\d+)?) open days/.exec(text)?.[1]);
  await expect(card(page).locator('strong')).toHaveText(String(open - 7.5));
});

test('months without a CRA consume planned assignment days instead', async ({ page }) => {
  const assignment = {
    id: '33000000-0000-4000-8000-000000000001',
    employee_id: employeeId,
    project_id: projectId,
    position: 'Engineer',
    pricing_line: '',
    allocation_pct: 100,
    start_date: `${year}-06-01`,
    end_date: `${year}-06-30`,
    status: 'active',
    version: 1,
    created_at: `${year}-01-01T00:00:00Z`,
    updated_at: `${year}-01-01T00:00:00Z`,
  };
  await installFixture(page, [], [assignment]);
  await page.goto(harness.url);
  const note = card(page).locator('.hr-person-metric-note');
  await expect(note).toContainText(/− \d+ project/);
  const text = await note.innerText();
  const [, open, project] = /(\d+(?:\.\d+)?) open days − (\d+(?:\.\d+)?) project/.exec(text) ?? [];
  expect(Number(project)).toBeGreaterThan(15);
  await expect(card(page).locator('strong')).toHaveText(String(Number(open) - Number(project)));
});
