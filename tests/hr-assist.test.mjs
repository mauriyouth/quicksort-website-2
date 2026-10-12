import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHrAssistant } from '../apps/admin/api/hr-assist.ts';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-anon-key';
const personId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const suggestionId = '33333333-3333-4333-8333-333333333333';
const payload = { summary: 'Prepare a platform interview.', items: [{ title: 'Discuss Kubernetes', detail: 'Ask for a concrete production incident.', source_ids: [personId] }] };
const snapshot = {
  people: [{ id: personId, version: 3, full_name: 'Ada', headline: 'Platform engineer', skills: 'Kubernetes', location: 'Paris', contact_allowed: true, email: 'private@example.test', notes: 'PRIVATE NOTES' }],
  applications: [], employees: [], opportunities: [], tasks: [], assignments: [], projects: [],
  offers: [{ salary_monthly: 9000 }], exits: [{ exit_interview: 'PRIVATE EXIT' }],
};
function response() { return { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } }; }
function assistant({ role = 'hr', output = payload, workspace = snapshot, saveError = null } = {}) {
  const prompts = [], commands = [];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }) }),
    rpc: async (name, args) => {
      if (name === 'sync_clerk_profile') return { data: personId, error: null };
      if (name === 'hr_workspace_snapshot') return { data: workspace, error: null };
      if (name === 'hr_command') { commands.push(args.command); return { data: { suggestion_id: suggestionId }, error: saveError }; }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const handler = createHrAssistant({ createClient: () => client, loadAiSettings: async () => ({ apiKey: 'sk-test-key', model: 'gpt-4.1-mini' }), generateText: async args => { prompts.push(args); return { output }; } });
  return { prompts, commands, async run(body = { kind: 'interview_prep', person_id: personId }) { const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res); return res; } };
}

test('HR assistant rejects sales before sending records to the model', async () => {
  const app = assistant({ role: 'sales' });
  const res = await app.run();
  assert.equal(res.code, 403);
  assert.equal(app.prompts.length, 0);
  assert.equal(app.commands.length, 0);
});

test('HR assistant saves an attributed grounded draft and strips unrelated sensitive context', async () => {
  const app = assistant();
  const res = await app.run();
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { suggestion_id: suggestionId, payload, sources: [{ type: 'person', id: personId, version: 3 }] });
  const context = JSON.parse(app.prompts[0].messages[0].content);
  assert.deepEqual(context.person, { id: personId, version: 3, full_name: 'Ada', headline: 'Platform engineer', skills: 'Kubernetes', location: 'Paris', contact_allowed: true });
  assert.equal(JSON.stringify(context).includes('PRIVATE'), false);
  assert.equal('offers' in context, false);
  assert.equal('exits' in context, false);
  assert.equal(app.commands[0].kind, 'save_suggestion');
  assert.equal(app.commands[0].input_version, 3);
  assert.deepEqual(app.commands[0].payload, payload);
  assert.equal(app.commands.length, 1);
});

test('HR assistant rejects invented citations instead of saving unsupported advice', async () => {
  const app = assistant({ output: { ...payload, items: [{ ...payload.items[0], source_ids: [otherId] }] } });
  const res = await app.run();
  assert.equal(res.code, 502);
  assert.equal(app.commands.length, 0);
});

test('HR assistant rejects a journey belonging to another person before model generation', async () => {
  const app = assistant();
  const res = await app.run({ kind: 'interview_prep', person_id: personId, application_id: otherId });
  assert.equal(res.code, 404);
  assert.equal(app.prompts.length, 0);
});

test('HR assistant does not report a saved suggestion when source versions have changed', async () => {
  const app = assistant({ saveError: { message: 'Source changed', code: '40001' } });
  const res = await app.run();
  assert.equal(res.code, 409);
  assert.equal('suggestion_id' in res.body, false);
});

test('alumni drafts respect the person contact preference', async () => {
  const app = assistant({ workspace: { ...snapshot, people: [{ ...snapshot.people[0], contact_allowed: false }] } });
  const res = await app.run({ kind: 'alumni_reconnect', person_id: personId });
  assert.equal(res.code, 422);
  assert.equal(app.prompts.length, 0);
});

test('staffing advice saves project demand versions for later freshness checks', async () => {
  const project = { id: otherId, version: 7, title: 'Platform migration', status: 'active', start_date: '2026-10-01', end_date: '2027-03-31' };
  const projectPayload = { summary: 'Review the platform migration fit.', items: [{ title: 'Discuss the migration scope', detail: 'Confirm the Kubernetes requirements and dates with the project owner.', source_ids: [personId, otherId] }] };
  const app = assistant({ workspace: { ...snapshot, projects: [project] }, output: projectPayload });
  const res = await app.run({ kind: 'staffing_match', person_id: personId });
  assert.equal(res.code, 200);
  assert.deepEqual(app.commands[0].sources, [{ type: 'person', id: personId, version: 3 }, { type: 'project', id: otherId, version: 7 }]);
  assert.deepEqual(JSON.parse(app.prompts[0].messages[0].content).projects, [project]);
});
