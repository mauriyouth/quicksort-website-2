import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  GMAIL_SCOPE,
  buildQuery,
  getMessageMeta,
  getMessagePdfs,
  gmailToken,
  listMessageIds,
} from '../apps/admin/server/freelancer-invoices/gmail.ts';
import { pollMailbox, senderAddress } from '../apps/admin/server/freelancer-invoices/poll.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {
  client_email: 'drive@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};

const b64url = (value) => Buffer.from(value).toString('base64url');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('buildQuery lists known senders with a PDF attachment after Paris midnight (epoch seconds)', () => {
  // 2026-01-01 00:00 Europe/Paris (UTC+1) = 2025-12-31T23:00:00Z
  assert.equal(
    buildQuery(['a@x.fr', 'b@y.fr'], '2026-01-01'),
    'from:(a@x.fr OR b@y.fr) has:attachment filename:pdf after:1767222000',
  );
  // Summer time (UTC+2): 2026-07-01 00:00 Paris = 2026-06-30T22:00:00Z
  assert.equal(buildQuery(['a@x.fr'], '2026-07-01'), `from:(a@x.fr) has:attachment filename:pdf after:${Date.UTC(2026, 5, 30, 22) / 1000}`);
});

test('gmailToken impersonates the mailbox with the read-only scope', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return json({ access_token: 'gmail-token', expires_in: 3600 });
  };
  const token = await gmailToken(sa, 'mohamed@quicksort.fr', fetchImpl);
  assert.equal(token, 'gmail-token');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [, payload] = form.get('assertion').split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(claims.sub, 'mohamed@quicksort.fr');
  assert.equal(claims.scope, GMAIL_SCOPE);
  assert.equal(GMAIL_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
});

test('gmailToken explains a refused delegation', async () => {
  const fetchImpl = async () => json({ error: 'unauthorized_client', error_description: 'Client is unauthorized' }, 401);
  await assert.rejects(gmailToken(sa, 'mohamed@quicksort.fr', fetchImpl), /domain-wide delegation/);
});

test('listMessageIds follows nextPageToken', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(new URL(String(url)));
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const page = new URL(String(url)).searchParams.get('pageToken');
    if (!page) return json({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' });
    return json({ messages: [{ id: 'm3' }] });
  };
  const ids = await listMessageIds('tok', 'mohamed@quicksort.fr', 'from:(a@x.fr) has:attachment filename:pdf after:2026/01/01', fetchImpl);
  assert.deepEqual(ids, ['m1', 'm2', 'm3']);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].pathname, '/gmail/v1/users/mohamed%40quicksort.fr/messages');
  assert.equal(urls[0].searchParams.get('q'), 'from:(a@x.fr) has:attachment filename:pdf after:2026/01/01');
  assert.equal(urls[1].searchParams.get('pageToken'), 'p2');
});

test('listMessageIds returns nothing for an empty mailbox', async () => {
  const ids = await listMessageIds('tok', 'mohamed@quicksort.fr', 'q', async () => json({ resultSizeEstimate: 0 }));
  assert.deepEqual(ids, []);
});

test('getMessagePdfs returns only the PDF and never fetches other attachments', async () => {
  const requested = [];
  const pdfBytes = Buffer.from('%PDF-1.4 invoice');
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    requested.push(u.pathname);
    if (u.pathname.endsWith('/messages/msg1')) {
      return json({
        id: 'msg1',
        internalDate: String(Date.UTC(2026, 10, 3, 9)),
        payload: {
          mimeType: 'multipart/mixed',
          headers: [{ name: 'Subject', value: 'Facture' }, { name: 'From', value: 'Karim <karim@ex.fr>' }],
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', filename: '', body: { data: b64url('Bonjour') } },
                { mimeType: 'text/html', filename: '', body: { data: b64url('<p>Bonjour</p>') } },
              ],
            },
            { mimeType: 'application/pdf', filename: 'facture-oct.pdf', body: { attachmentId: 'att-pdf', size: 16 } },
            { mimeType: 'image/png', filename: 'logo.png', body: { attachmentId: 'att-png', size: 100 } },
          ],
        },
      });
    }
    if (u.pathname.endsWith('/attachments/att-pdf')) return json({ size: pdfBytes.length, data: pdfBytes.toString('base64url') });
    throw new Error(`unexpected request ${u.pathname}`);
  };
  const message = await getMessagePdfs('tok', 'mohamed@quicksort.fr', 'msg1', fetchImpl);
  assert.equal(message.from, 'Karim <karim@ex.fr>');
  assert.equal(message.internalDate, '2026-11-03T09:00:00.000Z');
  assert.equal(message.pdfs.length, 1);
  assert.equal(message.pdfs[0].fileName, 'facture-oct.pdf');
  assert.deepEqual(Buffer.from(message.pdfs[0].bytes), pdfBytes);
  assert.ok(!requested.some((p) => p.includes('att-png')), 'the PNG attachment is never requested');
  assert.equal(requested.length, 2);
});

test('getMessageMeta reads only the From header and the date, never the body', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    requested.push(u);
    return json({ id: 'm9', internalDate: String(Date.UTC(2026, 10, 3, 9)), payload: { headers: [{ name: 'From', value: 'Karim <karim@ex.fr>' }] } });
  };
  const meta = await getMessageMeta('tok', 'mohamed@quicksort.fr', 'm9', fetchImpl);
  assert.deepEqual(meta, { from: 'Karim <karim@ex.fr>', internalDate: '2026-11-03T09:00:00.000Z' });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get('format'), 'metadata');
  assert.deepEqual(requested[0].searchParams.getAll('metadataHeaders'), ['From']);
});

test('getMessagePdfs accepts an octet-stream part named .pdf', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/messages/m2')) {
      return json({
        payload: {
          headers: [{ name: 'from', value: 'a@x.fr' }],
          parts: [{ mimeType: 'application/octet-stream', filename: 'INVOICE.PDF', body: { attachmentId: 'a1' } }],
        },
      });
    }
    return json({ data: Buffer.from('pdf').toString('base64url') });
  };
  const message = await getMessagePdfs('tok', 'mohamed@quicksort.fr', 'm2', fetchImpl);
  assert.equal(message.from, 'a@x.fr');
  assert.equal(message.internalDate, null);
  assert.deepEqual(message.pdfs.map((p) => p.fileName), ['INVOICE.PDF']);
});

test('senderAddress lowercases the bare address', () => {
  assert.equal(senderAddress('Karim <KARIM@ex.fr>'), 'karim@ex.fr');
  assert.equal(senderAddress(' Bob@Y.fr '), 'bob@y.fr');
  assert.equal(senderAddress('"Doe, Jane" <jane@z.fr>'), 'jane@z.fr');
});

function pollDeps(overrides = {}) {
  const calls = { list: [], meta: [], get: [], ingest: [], record: [] };
  const messages = overrides.messages ?? {};
  const deps = {
    senders: [
      { employeeId: 'emp-karim', email: 'karim@ex.fr' },
      { employeeId: 'emp-lea', email: 'lea@ex.fr' },
    ],
    mailbox: 'mohamed@quicksort.fr',
    after: '2026-01-01',
    seenMessageIds: new Set(overrides.seen ?? []),
    failedAttempts: new Map(Object.entries(overrides.failedAttempts ?? {})),
    record: async (entry) => { calls.record.push(entry); },
    gmail: {
      list: async (query) => { calls.list.push(query); return Object.keys(messages); },
      meta: async (id) => { calls.meta.push(id); return { from: messages[id].from, internalDate: messages[id].internalDate }; },
      get: async (id) => { calls.get.push(id); return messages[id]; },
    },
    ingest: async (input) => {
      calls.ingest.push(input);
      if (overrides.ingest) return overrides.ingest(input);
      return { invoiceId: `inv-${calls.ingest.length}`, duplicate: false };
    },
  };
  return { deps, calls };
}

const at = '2026-11-03T09:00:00.000Z';
const pdf = (name) => ({ fileName: name, bytes: new Uint8Array([1, 2, 3]) });

test('pollMailbox skips a message already seen', async () => {
  const { deps, calls } = pollDeps({
    seen: ['old'],
    messages: { old: { from: 'karim@ex.fr', internalDate: at, pdfs: [pdf('a.pdf')] }, fresh: { from: 'karim@ex.fr', internalDate: at, pdfs: [pdf('b.pdf')] } },
  });
  const result = await pollMailbox(deps);
  assert.deepEqual(calls.get, ['fresh']);
  assert.equal(calls.ingest.length, 1);
  assert.equal(result.messages, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.invoices, 1);
  assert.equal(calls.list[0], 'from:(karim@ex.fr OR lea@ex.fr) has:attachment filename:pdf after:1767222000');
});

test('pollMailbox maps a display-name sender to its employee', async () => {
  const { deps, calls } = pollDeps({ messages: { m1: { from: 'Karim <KARIM@ex.fr>', internalDate: at, pdfs: [pdf('f.pdf')] } } });
  await pollMailbox(deps);
  assert.equal(calls.ingest.length, 1);
  assert.equal(calls.ingest[0].employeeId, 'emp-karim');
  assert.equal(calls.ingest[0].source, 'email');
  assert.equal(calls.ingest[0].gmailMessageId, 'm1');
  assert.equal(calls.ingest[0].fileName, 'f.pdf');
  assert.equal(calls.ingest[0].actorEmail, 'mailbox-sync');
  assert.deepEqual(calls.record, [{ id: 'm1', status: 'done', attempts: 1, error: null, internalDate: at }]);
});

test('pollMailbox skips an unknown sender from its headers alone and records it done', async () => {
  const { deps, calls } = pollDeps({ messages: { m1: { from: 'Spam <spam@evil.com>', internalDate: at, pdfs: [pdf('x.pdf')] } } });
  const result = await pollMailbox(deps);
  assert.deepEqual(calls.meta, ['m1']);
  assert.deepEqual(calls.get, [], 'the full message is never fetched');
  assert.equal(calls.ingest.length, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.invoices, 0);
  assert.deepEqual(calls.record, [{ id: 'm1', status: 'done', attempts: 1, error: 'Not read: spam@evil.com is not a known freelancer address.', internalDate: at }]);
  assert.ok(deps.seenMessageIds.has('m1'));
});

test('pollMailbox skips a sender shared by two freelancers and records it done', async () => {
  const { deps, calls } = pollDeps({ messages: { m1: { from: 'compta@shared.fr', internalDate: at, pdfs: [pdf('x.pdf')] } } });
  deps.senders.push({ employeeId: 'emp-karim', email: 'compta@shared.fr' }, { employeeId: 'emp-lea', email: 'compta@shared.fr' });
  const result = await pollMailbox(deps);
  assert.deepEqual(calls.get, []);
  assert.equal(calls.ingest.length, 0);
  assert.equal(result.skipped, 1);
  assert.equal(calls.record[0].status, 'done');
  assert.match(calls.record[0].error, /compta@shared\.fr belongs to several freelancers/);
});

test('pollMailbox records a full message Gmail cannot return as failed', async () => {
  const { deps, calls } = pollDeps({ messages: { m1: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('n.pdf')] } } });
  deps.gmail.get = async () => { throw new Error('Gmail answered 503.'); };
  const result = await pollMailbox(deps);
  assert.equal(calls.record[0].status, 'failed');
  assert.match(calls.record[0].error, /503/);
  assert.equal(result.failed, 1);
});

test('pollMailbox ingests every PDF of a message', async () => {
  const { deps, calls } = pollDeps({ messages: { m1: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('one.pdf'), pdf('two.pdf')] } } });
  const result = await pollMailbox(deps);
  assert.deepEqual(calls.ingest.map((c) => c.fileName), ['one.pdf', 'two.pdf']);
  assert.ok(calls.ingest.every((c) => c.employeeId === 'emp-lea' && c.source === 'email'));
  assert.equal(result.invoices, 2);
});

test('pollMailbox counts duplicates and keeps going after a failed PDF', async () => {
  const { deps, calls } = pollDeps({
    messages: { m1: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('dup.pdf'), pdf('broken.pdf'), pdf('ok.pdf')] } },
    ingest: (input) => {
      if (input.fileName === 'dup.pdf') return { invoiceId: 'inv-old', duplicate: true };
      if (input.fileName === 'broken.pdf') throw new Error('Drive upload failed');
      return { invoiceId: 'inv-new', duplicate: false };
    },
  });
  const result = await pollMailbox(deps);
  assert.equal(result.duplicates, 1);
  assert.equal(result.invoices, 1);
  assert.equal(result.failed, 1);
  assert.match(result.lastFailure, /Drive upload failed/);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].status, 'failed');
  assert.equal(calls.record[0].attempts, 1);
  assert.match(calls.record[0].error, /broken\.pdf: Drive upload failed/);
  assert.equal(calls.record[0].internalDate, at);
});

test('pollMailbox marks a message of duplicates done so it is not read again', async () => {
  const { deps, calls } = pollDeps({
    messages: { m1: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('a.pdf'), pdf('b.pdf')] } },
    ingest: () => ({ invoiceId: 'inv-old', duplicate: true }),
  });
  const result = await pollMailbox(deps);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(calls.record.map((r) => r.status), ['done']);
});

test('pollMailbox counts retries and gives up after 5 attempts', async () => {
  const failing = { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('x.pdf')] };
  const { deps, calls } = pollDeps({
    messages: { again: failing, last: failing },
    failedAttempts: { again: 2, last: 4 },
    ingest: () => { throw new Error('Drive down'); },
  });
  const result = await pollMailbox(deps);
  const byId = Object.fromEntries(calls.record.map((r) => [r.id, r]));
  assert.equal(byId.again.status, 'failed');
  assert.equal(byId.again.attempts, 3);
  assert.equal(byId.last.status, 'done', 'the 5th failure stops the retries');
  assert.equal(byId.last.attempts, 5);
  assert.match(byId.last.error, /Drive down/);
  assert.equal(result.abandoned, 1);
  assert.match(result.lastAbandoned, /last.*Drive down/);
});

test('pollMailbox does not query Gmail without known senders', async () => {
  const { deps, calls } = pollDeps({ messages: {} });
  deps.senders = [];
  const result = await pollMailbox(deps);
  assert.equal(calls.list.length, 0);
  assert.equal(result.messages, 0);
});

test('pollAfter is max(backfill_from, last_polled_at - 2 days)', async () => {
  const { pollAfter } = await import('../apps/admin/server/freelancer-invoices/run.ts');
  assert.equal(pollAfter('2026-01-01', null), '2026-01-01');
  assert.equal(pollAfter('2026-01-01', '2026-11-11T08:00:00Z'), '2026-11-09');
  assert.equal(pollAfter('2026-01-01', '2026-01-02T08:00:00Z'), '2026-01-01');
});

test('pollMailbox records a message Gmail cannot return as failed and keeps going', async () => {
  const { deps, calls } = pollDeps({ messages: { gone: null, next: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('n.pdf')] } } });
  const meta = deps.gmail.meta;
  deps.gmail.meta = async (id) => {
    if (id === 'gone') { calls.meta.push(id); throw new Error('Gmail answered 404: Not Found.'); }
    return meta(id);
  };
  const result = await pollMailbox(deps);
  const byId = Object.fromEntries(calls.record.map((r) => [r.id, r]));
  assert.equal(byId.gone.status, 'failed');
  assert.equal(byId.gone.attempts, 1);
  assert.match(byId.gone.error, /404/);
  assert.equal(byId.gone.internalDate, null);
  assert.equal(byId.next.status, 'done');
  assert.equal(calls.ingest.length, 1);
  assert.equal(result.invoices, 1);
  assert.equal(result.failed, 1);
  assert.match(result.lastFailure, /404/);
});

test('pollMailbox gives up on an unreadable message at the 5th attempt', async () => {
  const { deps, calls } = pollDeps({ messages: { gone: null }, failedAttempts: { gone: 4 } });
  deps.gmail.meta = async () => { throw new Error('Gmail answered 500.'); };
  const result = await pollMailbox(deps);
  assert.equal(calls.record[0].status, 'done');
  assert.equal(calls.record[0].attempts, 5);
  assert.equal(result.abandoned, 1);
  assert.ok(deps.seenMessageIds.has('gone'));
});

test('pollMailbox counts a failed record and continues', async () => {
  const { deps, calls } = pollDeps({
    messages: { a: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('a.pdf')] }, b: { from: 'lea@ex.fr', internalDate: at, pdfs: [pdf('b.pdf')] } },
  });
  deps.record = async (entry) => { if (entry.id === 'a') throw new Error('db down'); calls.record.push(entry); };
  const result = await pollMailbox(deps);
  assert.equal(calls.ingest.length, 2);
  assert.deepEqual(calls.record.map((r) => r.id), ['b']);
  assert.equal(result.failed, 1);
  assert.match(result.lastFailure, /db down/);
  assert.ok(!deps.seenMessageIds.has('a'));
});
