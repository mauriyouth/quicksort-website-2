import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCardAgent } from '../apps/admin/server/card-agent.ts';
const boardId = '11111111-1111-4111-8111-111111111111';
const columnId = '22222222-2222-4222-8222-222222222222';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'public-test';
function fixture({ authenticated = true, admin = true, access = true, empty = false, output, fail = false, apiKey = 'test' } = {}) {
  const calls = [];
  const client = {
    rpc: async () => ({ data: authenticated ? 'user-id' : null }),
    from(table) {
      const query = { select() { return query; }, eq() { return query; },
        single: async () => ({ data: table === 'user_roles' ? { role: admin ? 'admin' : 'candidate' } : access ? { id: boardId, name: 'Launch' } : null }),
        order: async () => ({ data: empty ? [] : [{ id: columnId, name: 'To do' }] }),
      }; return query;
    },
  };
  const handler = createCardAgent({ createClient: (_url, _key, options) => { calls.push(options); return client; },
    loadSettings: async () => ({ apiKey, model: 'test' }),
    generateText: async options => { calls.push(options); if (fail) throw Error('secret provider payload'); return { output: output || { cards: [{ title: 'Préparer le lancement', description: 'Respecter le budget.', columnId }] } }; },
  });
  return { calls, async request({ method = 'POST', authorization = 'Bearer user-token', body = { boardId, prompt: 'Une carte en français. Respecter le budget.' } } = {}) {
    const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method, headers: { authorization }, body }, res); return res;
  } };
}
test('generation preserves instructions and scopes context to an accessible board', async () => {
  const f = fixture(); const result = await f.request(); assert.equal(result.code, 200);
  assert.equal(await f.calls[0].accessToken(), 'user-token');
  const context = JSON.parse(f.calls[1].messages[0].content);
  assert.equal(context.instructions, 'Une carte en français. Respecter le budget.');
  assert.deepEqual(context.columns, [{ id: columnId, name: 'To do' }]);
  assert.equal(result.body.cards[0].title, 'Préparer le lancement');
});
test('rejects unauthenticated and inaccessible boards before generating', async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ admin: false }, 403], [{ access: false }, 403], [{ empty: true }, 422], [{ apiKey: '' }, 503]]) {
    const f = fixture(options); assert.equal((await f.request()).code, expected); assert.equal(f.calls.length, 1);
  }
  assert.equal((await fixture().request({ authorization: '' })).code, 401);
});
test('rejects invalid requests without calling provider', async () => {
  const f = fixture();
  assert.equal((await f.request({ method: 'GET' })).code, 405);
  for (const body of [{ boardId, prompt: ' ' }, { boardId, prompt: 'x'.repeat(6001) }, { boardId: 'forged', prompt: 'create cards' }]) assert.equal((await f.request({ body })).code, 400);
  assert.equal(f.calls.length, 0);
});
test('rejects invalid output and columns from another board; hides provider details', async () => {
  for (const output of [{ cards: [] }, { cards: [{ title: 'Card', description: '', columnId: boardId }] }, { cards: [{ title: 'x'.repeat(201), description: '', columnId }] }]) assert.equal((await fixture({ output }).request()).code, 502);
  const result = await fixture({ fail: true }).request(); assert.equal(result.code, 502); assert.doesNotMatch(JSON.stringify(result.body), /secret/);
});
