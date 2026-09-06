import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { startServer } from './serve.mjs';

test('generated site exposes crawlable, unique, consistent SEO documents', async () => {
  const sitemap = await readFile('dist/sitemap.xml', 'utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  assert.ok(urls.length >= 9);
  assert.ok(!sitemap.includes('/email-signature'));
  const titles = new Set(), descriptions = new Set();
  for (const url of urls) {
    const path = new URL(url).pathname;
    const html = await readFile(path === '/' ? 'dist/index.html' : `dist${path}.html`, 'utf8');
    assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, `${path}: one visible primary heading`);
    assert.ok(!html.includes('Loading...'), `${path}: article content is available immediately`);
    assert.ok(!html.includes('noindex'), `${path}: indexable`);
    assert.equal([...html.matchAll(/rel="canonical"/g)].length, 1);
    assert.ok(html.includes(`rel="canonical" href="${url}"`));
    const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
    const description = html.match(/name="description" content="([^"]+)"/)?.[1];
    assert.ok(title && description);
    assert.ok(!titles.has(title), `${path}: unique title`); titles.add(title);
    assert.ok(!descriptions.has(description), `${path}: unique description`); descriptions.add(description);
    const json = html.match(/id="seo-schema" type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    assert.ok(json, `${path}: JSON-LD`);
    const schema = JSON.parse(json); assert.equal(schema['@context'], 'https://schema.org');
    assert.ok(html.includes('property="og:image"'));
    for (const m of html.matchAll(/(?:src|href)="(\/[^"?#]*)"/g)) {
      const asset = m[1];
      if (/\.(?:png|webp|svg|js|css)$/.test(asset)) assert.ok(await stat(`dist${asset}`).then(s => s.isFile()).catch(() => false), `${path}: existing ${asset}`);
    }
  }
  const article = await readFile('dist/blog/the-age-of-human-ai-collaboration.html', 'utf8');
  assert.ok(article.length > 15000, 'rendered full article');
  const homepage = await readFile('dist/index.html', 'utf8');
  assert.ok(homepage.includes('srcSet=') || homepage.includes('srcset='));
  assert.ok(homepage.includes('loading="lazy"'));
  assert.ok(!homepage.includes('src="/murad-mustafayev.png"'));
  assert.ok((await stat('dist/team/murad-mustafayev-640.webp')).size < 150000);
  const utility = await readFile('dist/email-signature.html', 'utf8');
  assert.ok(utility.includes('noindex, follow'));
});

test('static serving keeps robots/XML separate and unknown URLs return 404', async () => {
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml'], ['/llms.txt', 'text/plain']]) {
      const response = await fetch(base + path); assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-type').includes(type));
      assert.ok(!(await response.text()).includes('<div id="app">'));
    }
    for (const path of ['/missing-page', '/blog/missing-post', '/career/missing-job', '/missing.png']) {
      const response = await fetch(base + path); assert.equal(response.status, 404);
      assert.ok((await response.text()).includes('Page not found'));
    }
    const good = await fetch(base + '/ai-for-business'); assert.equal(good.status, 200);
    assert.equal(good.headers.get('x-content-type-options'), 'nosniff');
    const config = JSON.parse(await readFile('vercel.json', 'utf8'));
    assert.ok(!config.rewrites && !config.routes, 'no catch-all app rewrite');
    assert.equal(config.redirects[0].permanent, true);
    assert.equal(config.redirects[0].has[0].value, 'quicksort.fr');
  } finally { await new Promise(done => server.close(done)); }
});
