import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoondManagerHandler } from '../apps/admin/server/boondmanager.ts';
import { encryptApiKey } from '../apps/admin/server/ai-settings.ts';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-anon-key';
process.env.AI_SETTINGS_ENCRYPTION_KEY = '1'.repeat(64);
const personId = '11111111-1111-4111-8111-111111111111';
const encrypted = encryptApiKey(JSON.stringify({ username: 'owner', password: 'private', instance: 'acme.boondmanager.com' }));
async function runImport(t, attributes) {
  const commands = [];
  const client = {
    rpc: async (name, args) => {
      if (name === 'sync_clerk_profile') return { data: personId, error: null };
      assert.equal(name, 'hr_command'); commands.push(args.command);
      return { data: { person_id: personId, created: true }, error: null };
    },
    from: name => ({ select: () => ({ eq: () => ({
      single: async () => ({ data: { role: 'admin' }, error: null }),
      maybeSingle: async () => { assert.equal(name, 'boondmanager_settings'); return { data: { encrypted_credentials: encrypted }, error: null }; },
    }) }) }),
  };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url).startsWith('https://acme.boondmanager.com/api/resources?'), true);
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'api-9', attributes }], meta: { totals: { rows: 1 } } }) };
  });
  const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await createBoondManagerHandler({ createClient: () => client })({ method: 'POST', headers: { authorization: 'Bearer actor' }, body: { kind: 'employees' } }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  return { commands, result: res.body };
}

test('Boond resource import uses the CSV-compatible stable reference and dated employment intent', async t => {
  const { commands, result } = await runImport(t, { reference: 'csv-42', firstName: 'Ada', lastName: 'Lovelace', title: 'Engineer', startDate: '01/09/2024', endDate: '30/09/2026' });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].kind, 'import_person');
  assert.equal(commands[0].external_source, 'boondmanager:acme.boondmanager.com');
  assert.equal(commands[0].external_id, 'resources:csv-42');
  assert.deepEqual(commands[0].employment, { role: 'Engineer', start_date: '2024-09-01', end_date: '2026-09-30' });
  assert.equal(result.created, 1);
});

test('Boond resource import preserves a departed person without inventing an exit date', async t => {
  const { commands } = await runImport(t, { firstName: 'Ada', lastName: 'Lovelace', startDate: '2024-09-01', state: 'Alumni' });
  assert.equal('employment' in commands[0], false);
  assert.equal(commands[0].external_id, 'resources:api-9');
  assert.match(commands[0].notes, /departed resource has no valid exit date/);
});

test('Boond resource import does not invent a start date for malformed source dates', async t => {
  const { commands } = await runImport(t, { firstName: 'Ada', lastName: 'Lovelace', startDate: '31/02/2024' });
  assert.equal('employment' in commands[0], false);
  assert.match(commands[0].notes, /does not include a valid start date/);
});
