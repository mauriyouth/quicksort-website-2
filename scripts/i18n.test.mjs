import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pages, alternates } from '../dist-ssr/entry-server.js';
import { startServer } from './serve.mjs';

test('every public page has two translated, reciprocal, indexable language versions', async () => {
 const publicPages=pages.filter(p=>!p.noindex);
 assert.equal(publicPages.length,18);
 const docs=new Map();
 for(const p of publicPages){
  const html=await readFile(p.path==='/'?'dist/index.html':`dist${p.path}.html`,'utf8');docs.set(p.path,html);
  assert.ok(html.includes(`<html data-theme="dark" lang="${p.locale}" dir="${'ltr'}">`),p.path);
  const graph=JSON.parse(html.match(/id="seo-schema" type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
  assert.equal(graph.find(n=>n['@type']==='WebPage').inLanguage,p.locale);
  if(p.type==='BlogPosting')assert.equal(graph.find(n=>n['@type']==='BlogPosting').inLanguage,p.locale);
  const links=alternates(p);assert.equal(links.length,3);
  for(const link of links){
   assert.ok(html.includes(`hreflang="${link.lang}" href="${link.url}"`),p.path);
   const other=publicPages.find(q=>'https://www.quicksort.fr'+q.path===link.url);
   assert.ok(other,p.path);assert.deepEqual(alternates(other),links);
  }
  assert.ok(html.includes('class="language-switcher"'));
  assert.ok(!html.includes('hreflang="ar"'));
  assert.ok(!html.includes('lang="ar"'));
  assert.ok(html.includes('/theme-init.js'));
 }
 for(const en of publicPages.filter(p=>p.locale==='en')){
  for(const locale of ['fr']){
   const p=publicPages.find(p=>p.locale===locale && alternates(p)[0].url==='https://www.quicksort.fr'+en.path);
   assert.notEqual(p.title,en.title,p.path);assert.notEqual(p.description,en.description,p.path);
  }
 }
 for(const locale of ['fr']){
  const html=docs.get(`/${locale}/blog/the-age-of-human-ai-collaboration`);
  assert.ok((html.match(/<h3/g)||[]).length>=7,'all article sections retained');
 }
});

test('localized missing routes stay 404 and content negotiation does not redirect visitors',async()=>{
 const server=await startServer(0);const base=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const path of ['/fr/missing','/ar','/ar/blog/the-age-of-human-ai-collaboration','/ar/career/missing'])assert.equal((await fetch(base+path)).status,404);
  for(const lang of ['fr']){
   const r=await fetch(base+'/',{headers:{'Accept-Language':lang},redirect:'manual'});
   assert.equal(r.status,200);assert.ok((await r.text()).includes('lang="en"'));
  }
 }finally{await new Promise(done=>server.close(done));}
});

test('latest client logo assets and design-system remain available', async () => {
 for(const name of ['airbus','bnp-paribas','capgemini','club-med']){
  const source=await readFile(`public/client-logos/${name}.png`);
  const deployed=await readFile(`dist/client-logos/${name}.png`);
  assert.deepEqual(deployed,source,'original logo bytes retained');
  assert.ok(source.readUInt32BE(16)>=400,`${name}: high-resolution source retained`);
 }
 const design=await readFile('dist/design-system.html','utf8');
 assert.ok(design.includes('Design system'));
 assert.ok(design.includes('noindex, follow'));
 assert.ok(design.includes('/theme-init.js'));
 assert.ok(!(await readFile('dist/sitemap.xml','utf8')).includes('/design-system'));
 assert.ok((await readFile('dist/theme-init.js','utf8')).includes('qs-theme'));
});
