import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('published website colors remain connected to dark and light theme tokens', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const stylesheets = [...html.matchAll(/href="(\/assets\/[^" ]+\.css)"/g)];
  assert.ok(stylesheets.length, 'production page includes its stylesheet');
  const css = (await Promise.all(stylesheets.map(([, path]) => readFile(`dist${path}`, 'utf8')))).join('\n');
  for (const token of ['ink', 'line']) {
    const declarations = [...css.matchAll(new RegExp(`--qs-${token}\\s*:\\s*([^;}]+)`, 'g'))];
    assert.ok(declarations.length >= 2, `${token} is defined for both themes`);
    for (const [, value] of declarations) {
      assert.equal(value.replace(/\s/g, ''), `rgb(var(--qs-${token}-rgb))`,
        `${token} must follow the website theme; a fixed portal color makes dark-mode text unreadable`);
    }
  }
});
