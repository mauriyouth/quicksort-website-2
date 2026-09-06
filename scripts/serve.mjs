// Preview the generated static pages with production-like statuses and headers.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
export async function startServer(port = 4173) {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      for (const { key, value } of config.headers[0].headers) res.setHeader(key, value.replace('; upgrade-insecure-requests', ''));
      if (path.length > 1 && path.endsWith('/')) { res.writeHead(308, { Location: path.replace(/\/+$/, '') + url.search }); return res.end(); }
      if (path.endsWith('.html') && path !== '/404.html') { res.writeHead(308, { Location: path === '/index.html' ? '/' : path.slice(0, -5) + url.search }); return res.end(); }
      const safe = resolve(root, '.' + path);
      if (safe !== root && !safe.startsWith(root + sep)) { res.writeHead(400); return res.end(); }
      const candidates = path === '/' ? [resolve(root, 'index.html')] : [safe, safe + '.html'];
      let file;
      for (const candidate of candidates) if (await stat(candidate).then(s => s.isFile()).catch(() => false)) { file = candidate; break; }
      const status = file && path !== '/404' && path !== '/404.html' ? 200 : 404;
      file ??= resolve(root, '404.html');
      res.writeHead(status, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(500); res.end('Preview error'); }
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startServer(Number(process.env.PORT || 4173));
  console.log(`SEO preview: http://127.0.0.1:${server.address().port}`);
}
