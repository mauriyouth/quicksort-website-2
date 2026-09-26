import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesPipelineHandler } from '../apps/admin/api/sales-pipeline.ts';

process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';

function resetEnv() {
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
}

function fakeClient({ role = 'admin', opportunities = [], clients = [], people = [], sponsors = [], inserted = [] } = {}) {
  const singleResults = {
    user_roles: { data: { role }, error: null },
    sales_opportunities: { data: opportunities[0] ?? null, error: null },
    profiles: { data: { email: 'bm@quicksort.io' }, error: null },
  };
  const listResults = {
    sales_opportunities: { data: opportunities, error: null },
    sales_clients: { data: clients, error: null },
    sales_people: { data: people, error: null },
    sales_sponsors: { data: sponsors, error: null },
  };
  return {
    async rpc(name) { assert.equal(name, 'sync_clerk_profile'); return { data: '00000000-0000-0000-0000-000000000001', error: null }; },
    from(table) {
      const calls = { table, updates: [] };
      fakeClient.calls.push(calls);
      return {
        select() {
          return {
            eq() { return this; },
            order() { return this; },
            single: async () => singleResults[table] ?? { data: null, error: null },
            then: (resolve) => resolve(listResults[table] ?? { data: [], error: null }),
          };
        },
        update(values) {
          calls.updates.push(values);
          return {
            eq() { return this; },
            select() {
              return { single: async () => ({ data: { ...opportunities[0], ...values }, error: null }) };
            },
          };
        },
        insert(values) { inserted.push(values); return { then: (resolve) => resolve({ data: values, error: null }) }; },
      };
    },
  };
}
fakeClient.calls = [];

function makeHandler(client) {
  return createSalesPipelineHandler({ createClient: () => client });
}

async function request(handler, { method = 'GET', authorization = 'Bearer token', query, body } = {}) {
  const res = {
    code: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ method, url: '/api/sales-pipeline', headers: { authorization }, query, body }, res);
  return res;
}

const CLIENT = { id: '33333333-3333-4333-8333-333333333333', name: 'Acme', health: 'good' };
const PEOPLE = [
  { id: '44444444-4444-4444-8444-444444444444', name: 'Nadia Benali', role: 'CTO', client_id: CLIENT.id },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Karim Said', role: 'PMO', client_id: CLIENT.id },
];
const OPPORTUNITIES = [
  {
    id: '11111111-1111-4111-8111-111111111111', title: 'Data platform', stage: 'proposal', client_id: CLIENT.id, pricing_model: 'regie',
    currency: 'EUR', tjm: 500, estimated_days: 10, amount: 5000, probability: 60,
    owner_email: 'bm@quicksort.io', lost_reason: '', expected_close: null, updated_at: '2026-10-01',
  },
  {
    id: '22222222-2222-4222-8222-222222222222', title: 'Mobile app', stage: 'lead', client_id: CLIENT.id, pricing_model: 'forfait',
    currency: 'EUR', tjm: null, estimated_days: null, fixed_price: 12000, amount: 12000,
    probability: 10, owner_email: 'bm@quicksort.io', lost_reason: '', expected_close: null, updated_at: '2026-10-01',
  },
];
const SPONSORS = [
  { opportunity_id: OPPORTUNITIES[0].id, person_id: PEOPLE[0].id, influence: 'champion', is_primary: true },
  { opportunity_id: OPPORTUNITIES[0].id, person_id: PEOPLE[1].id, influence: 'supporter', is_primary: false },
];

test('sales pipeline: authentication and role gate', async () => {
  const handler = makeHandler(fakeClient({}));
  assert.equal((await request(handler, { authorization: null })).code, 401);
  assert.equal((await request(handler, { authorization: 'token' })).code, 401);
  const denied = makeHandler(fakeClient({ role: 'candidate' }));
  assert.equal((await request(denied)).code, 403);
  assert.equal((await request(handler, { method: 'POST' })).code, 405);
});

test('sales pipeline: board groups by stage with derived totals and pricing split', async () => {
  const res = await request(makeHandler(fakeClient({ opportunities: OPPORTUNITIES, clients: [CLIENT], people: PEOPLE, sponsors: SPONSORS })));
  assert.equal(res.code, 200);
  const { stages, summary } = res.body;
  assert.equal(stages.length, 7);
  const proposal = stages.find((s) => s.key === 'proposal');
  assert.equal(proposal.count, 1);
  assert.equal(proposal.total, 5000);
  assert.equal(proposal.weighted, 3000); // 5000 × 60 %
  const lead = stages.find((s) => s.key === 'lead');
  assert.equal(lead.total, 12000);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.openTotal, 17000);
  assert.equal(summary.weightedTotal, 3000 + 1200);
  assert.deepEqual(summary.regie, { count: 1, total: 5000 });
  assert.deepEqual(summary.forfait, { count: 1, total: 12000 });
  // Sponsor mapping rides along with the card (sales.md §8.8).
  assert.deepEqual(proposal.items[0].sponsors.map((s) => [s.name, s.influence, s.isPrimary]), [
    ['Nadia Benali', 'champion', true],
    ['Karim Said', 'supporter', false],
  ]);
});

test('sales pipeline: search matches sponsor names', async () => {
  const res = await request(makeHandler(fakeClient({ opportunities: OPPORTUNITIES, clients: [CLIENT], people: PEOPLE, sponsors: SPONSORS })), {
    query: { q: 'nadia' },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.summary.openCount, 1);
  assert.equal(res.body.stages.find((s) => s.key === 'proposal').count, 1);
});

test('sales pipeline: unconfigured connection is a clean 503', async (t) => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  t.after(resetEnv);
  const res = await request(makeHandler(fakeClient({})));
  assert.equal(res.code, 503);
});

test('sales pipeline: stage move validates lost reason, updates probability and logs activity', async () => {
  const inserted = [];
  const client = fakeClient({ opportunities: OPPORTUNITIES, inserted });
  const handler = makeHandler(client);

  const missingReason = await request(handler, { method: 'PATCH', body: { id: OPPORTUNITIES[0].id, stage: 'lost' } });
  assert.equal(missingReason.code, 422);

  const moved = await request(handler, { method: 'PATCH', body: { id: OPPORTUNITIES[0].id, stage: 'lost', lostReason: 'Budget freeze' } });
  assert.equal(moved.code, 200);
  assert.equal(moved.body.opportunity.stage, 'lost');
  assert.equal(moved.body.opportunity.probability, 0);
  assert.equal(moved.body.opportunity.lost_reason, 'Budget freeze');

  const won = await request(handler, { method: 'PATCH', body: { id: OPPORTUNITIES[0].id, stage: 'won' } });
  assert.equal(won.code, 200);
  assert.equal(won.body.opportunity.probability, 100);

  // The stage change lands on the activity timeline with the author and the lost reason.
  const stageChanges = inserted.filter((a) => a.type === 'stage_change');
  assert.equal(stageChanges.length, 2);
  assert.equal(stageChanges[0].author_email, 'bm@quicksort.io');
  assert.match(stageChanges[0].text, /Budget freeze/);

  const bad = await request(handler, { method: 'PATCH', body: { id: OPPORTUNITIES[0].id, stage: 'sideways' } });
  assert.equal(bad.code, 400);
});
