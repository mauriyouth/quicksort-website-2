import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toDate } from '../apps/admin/scripts/import-employees-csv.mjs';

test('HR import preserves quoted multiline fields and stable references', () => {
  assert.deepEqual(parseCsv('\uFEFFRéférence interne;Nom;Commentaires\r\nR-23;Rivera;"Line one\nLine two with ""quotes"""\r\n'), [
    ['Référence interne', 'Nom', 'Commentaires'],
    ['R-23', 'Rivera', 'Line one\nLine two with "quotes"'],
  ]);
});
test('employment imports reject impossible dates and accept real source formats', () => {
  assert.equal(toDate('29/02/2024'), '2024-02-29');
  assert.equal(toDate('2026-10-04'), '2026-10-04');
  assert.equal(toDate('31/02/2026'), null);
  assert.equal(toDate('29/02/2025'), null);
  assert.equal(toDate('-'), null);
});

test('HR import rejects a truncated quoted field before any database request', () => {
  assert.throws(() => parseCsv('Référence interne;Nom\nR-23;"Unfinished'), /quoted field/);
});
