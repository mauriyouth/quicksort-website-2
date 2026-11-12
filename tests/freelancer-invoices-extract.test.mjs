import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toInvoiceFields, extractInvoice, ExtractionError } from '../apps/admin/server/freelancer-invoices/extract.ts';

/** Minimal one-page text PDF (pdfjs rebuilds the missing xref). */
function pdfWith(lines) {
  const stream = lines.length ? `BT /F1 12 Tf 50 750 Td 14 TL ${lines.map(l => `(${l}) Tj T*`).join(' ')} ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
const invoicePdf = pdfWith(['Facture FA-2026-10 du 31/10/2026', 'Prestations octobre 2026', 'Total HT 8 400,00 EUR TVA 1 680,00 EUR TTC 10 080,00 EUR']);
const emptyPdf = pdfWith([]);
const cfg = { apiKey: 'k', model: 'kimi-k2.6' };
const reply = (content) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });

test('toInvoiceFields converts euros, dates and period', () => {
  const f = toInvoiceFields({ total_ht: 8400, total_vat: 1680, total_ttc: 10080, issue_date: '31/10/2026', period: 'octobre 2026' });
  assert.equal(f.amountTtcCents, 1008000);
  assert.equal(f.amountHtCents, 840000);
  assert.equal(f.issueDate, '2026-10-31');
  assert.equal(f.periodMonth, '2026-10-01');
});

test('toInvoiceFields coerces French amount strings', () => {
  const f = toInvoiceFields({ total_ht: '8 400,00 €', total_vat: '1 680,00 €', total_ttc: null });
  assert.equal(f.amountHtCents, 840000);
  assert.equal(f.amountTtcCents, 1008000);
});

test('toInvoiceFields parses period formats', () => {
  const p = (period) => toInvoiceFields({ period }).periodMonth;
  assert.equal(p('Oct. 2026'), '2026-10-01');
  assert.equal(p('10/2026'), '2026-10-01');
  assert.equal(p('du 01/10/2026 au 31/10/2026'), '2026-10-01');
  assert.equal(p('Décembre 2025'), '2025-12-01');
  assert.equal(p('juin 2026'), '2026-06-01');
});

test('toInvoiceFields derives the period from an early issue date only', () => {
  assert.equal(toInvoiceFields({ issue_date: '2026-11-03' }).periodMonth, '2026-10-01');
  assert.equal(toInvoiceFields({ issue_date: '03/01/2026' }).periodMonth, '2025-12-01');
  assert.equal(toInvoiceFields({ issue_date: '2026-10-20' }).periodMonth, null);
});

test('toInvoiceFields applies the VAT exemption mention', () => {
  const f = toInvoiceFields({ total_ht: 5000, vat_exemption_mention: 'TVA non applicable, art. 293 B du CGI' });
  assert.equal(f.vatCents, 0);
  assert.equal(f.amountTtcCents, f.amountHtCents);
});

test('toInvoiceFields makes credit notes negative and cleans the IBAN', () => {
  const f = toInvoiceFields({ document_kind: 'avoir', total_ht: 100, total_vat: 20, total_ttc: 120, issuer_iban: 'fr76 3000 4000' });
  assert.equal(f.isCreditNote, true);
  assert.deepEqual([f.amountHtCents, f.vatCents, f.amountTtcCents], [-10000, -2000, -12000]);
  assert.equal(f.issuerIban, 'FR7630004000');
});

test('extractInvoice parses a fenced JSON answer', async () => {
  const body = '```json\n' + JSON.stringify({ looks_like_invoice: true, document_kind: 'facture', number: 'FA-1', total_ht: 8400, total_vat: 1680, total_ttc: 10080, issue_date: '31/10/2026', period: 'octobre 2026' }) + '\n```';
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return reply(body)(); };
  const f = await extractInvoice(cfg, invoicePdf, Date.now() + 60_000, fetchImpl);
  assert.equal(f.number, 'FA-1');
  assert.equal(f.amountTtcCents, 1008000);
  assert.equal(f.looksLikeInvoice, true);
  assert.deepEqual(sent.thinking, { type: 'disabled' });
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.match(sent.messages[1].content, /FA-2026-10/);
});

test('extractInvoice throws ExtractionError on HTTP failure', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(extractInvoice(cfg, invoicePdf, Date.now() + 60_000, fetchImpl), (e) => e instanceof ExtractionError && e.status === 500);
});

test('extractInvoice returns looksLikeInvoice false for an empty PDF without calling fetch', async () => {
  let calls = 0;
  const f = await extractInvoice(cfg, emptyPdf, Date.now() + 60_000, async () => { calls++; return reply('{}')(); });
  assert.equal(calls, 0);
  assert.equal(f.looksLikeInvoice, false);
  assert.equal(f.amountTtcCents, null);
});

test('extractInvoice returns an empty result when the answer is never JSON', async () => {
  const f = await extractInvoice(cfg, invoicePdf, Date.now() + 5_000, reply('sorry'));
  assert.equal(f.looksLikeInvoice, false);
});

test('toInvoiceFields does not read months out of other words', () => {
  const p = (period) => toInvoiceFields({ period }).periodMonth;
  assert.equal(p('Maintenance 2026'), null);
  assert.equal(p('Mission marketing 2026'), null);
  assert.equal(p('de mars à mai 2026'), '2026-03-01');
  assert.equal(p('mai 2026'), '2026-05-01');
});

test('toInvoiceFields keeps an explicit VAT amount despite a loose "non applicable" mention', () => {
  const f = toInvoiceFields({ total_ht: 100, total_vat: 20, total_ttc: 120, vat_exemption_mention: 'TVA 20 % non applicable aux acomptes' });
  assert.deepEqual([f.amountHtCents, f.vatCents, f.amountTtcCents], [10000, 2000, 12000]);
});

test('toInvoiceFields rounds cents without float error', () => {
  assert.equal(toInvoiceFields({ total_ht: 1.005 }).amountHtCents, 101);
  assert.equal(toInvoiceFields({ total_ht: 19.99 }).amountHtCents, 1999);
});

test('extractInvoice flags extractionFailed when the answer is never usable', async () => {
  const f = await extractInvoice(cfg, invoicePdf, Date.now() + 5_000, reply('sorry'));
  assert.equal(f.extractionFailed, true);
  const empty = await extractInvoice(cfg, emptyPdf, Date.now() + 5_000, reply('{}'));
  assert.notEqual(empty.extractionFailed, true);
});
