import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { render, pages, alternates, getPageSeo, structuredData, SITE_URL, SOCIAL_IMAGE } = await import(pathToFileURL(resolve('dist-ssr/entry-server.js')).href);
const template = await readFile('dist/index.html', 'utf8');
await writeFile('dist/app-shell.html', template);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
for (const page of [...pages, getPageSeo('/404')]) {
  const url = SITE_URL + page.path;
  const tags = { 'description': page.description, 'robots': page.noindex ? 'noindex, follow' : 'index, follow', 'twitter:card': 'summary_large_image', 'twitter:title': page.title, 'twitter:description': page.description, 'twitter:image': SOCIAL_IMAGE };
  const og = { title: page.title, description: page.description, url, type: page.type === 'BlogPosting' ? 'article' : 'website', site_name: 'Quicksort', locale: ({en:'en_US',fr:'fr_FR'})[page.locale || 'en'], image: SOCIAL_IMAGE, 'image:width': '1200', 'image:height': '630', 'image:alt': 'Quicksort - Human + AI collaboration' };
  const schema = structuredData(page);
  const links = alternates(page).map(({lang, url}) => `<link rel="alternate" hreflang="${lang}" href="${escape(url)}">`).join('\n');
  const head = links + `\n<title>${escape(page.title)}</title>\n<link rel="canonical" href="${escape(url)}">\n` + Object.entries(tags).map(([name, content]) => `<meta name="${name}" content="${escape(content)}">`).join('\n') + '\n' + Object.entries(og).map(([name, content]) => `<meta property="og:${name}" content="${escape(content)}">`).join('\n') + (schema ? `\n<script id="seo-schema" type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>` : '');
  const html = template.replace(/<html[^>]*>/, `<html data-theme="dark" lang="${page.locale || 'en'}" dir="${'ltr'}">`).replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `${head}\n</head>`).replace('<div id="app"></div>', `<div id="app">${render(page.path)}</div>`);
  const file = page.path === '/' ? 'dist/index.html' : `dist${page.path}.html`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
const publicPages = pages.filter(page => !page.noindex);
await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages.map(page => `\n  <url><loc>${escape(SITE_URL + page.path)}</loc></url>`).join('')}\n</urlset>\n`);
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
await writeFile('dist/llms.txt', `# Quicksort\n\n> Enterprise AI engineering: agents, data systems, infrastructure and voice AI.\n\n${publicPages.map(page => `- [${page.name}](${SITE_URL + page.path}): ${page.description}`).join('\n')}\n\nContact: hello@quicksort.fr\n`);
console.log(`Prerendered ${pages.length} pages and a 404 document; generated sitemap, robots.txt and llms.txt.`);
