import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const tailwindEntry = fileURLToPath(new URL('./src/index.css', import.meta.url));

// The admin pages are styled by ~11k lines of hand-written CSS (here and in
// packages/*) with global element rules (`button {}`, `h1 {}`, `select {}`).
// Unlayered CSS beats every cascade layer, so left as-is those rules would
// override the Tailwind utilities inside @quicksort-sas/ui components. Wrap
// every such file in `@layer legacy`, ordered between Tailwind's `base` and
// `components`: legacy still beats preflight, utilities beat legacy, and the
// relative order inside the legacy CSS is unchanged. The order is declared by
// an inline <style> at the top of index.html — the first stylesheet in the
// document fixes it, and in the bundle a hoisted legacy @import would
// otherwise declare `legacy` first.
function legacyCssLayer(): Plugin {
  return {
    name: 'quicksort-admin-legacy-css-layer',
    enforce: 'pre',
    transform(code, id) {
      const [file, query = ''] = id.split('?');
      if (!file.endsWith('.css') || /(^|&)(raw|url)\b/.test(query)) return;
      if (file === tailwindEntry || !file.startsWith(repoRoot) || file.includes('/node_modules/')) return;
      const imports: string[] = [];
      const body = code.replace(/^\s*@import\s+([^;]+);/gm, (_, target: string) => {
        imports.push(/^url\(\s*['"]?https?:/.test(target.trim()) ? `@import ${target};` : `@import ${target} layer(legacy);`);
        return '';
      });
      return { code: `${imports.join('\n')}\n@layer legacy {\n${body}\n}\n`, map: null };
    },
  };
}

// Serves the Vercel-style api/ routes during `vite dev` so the CV analyzer and
// candidate intake work locally exactly as they do when deployed. Each handler
// is loaded through Vite's SSR pipeline (TypeScript + workspace imports) and
// adapted to connect's req/res.
function apiRoutes(): Plugin {
  const routes: Record<string, string> = {
    '/api/hr-assist': '/api/hr-assist.ts',
    '/api/analyze': '/api/analyze.ts',
    '/api/parse-candidate': '/api/parse-candidate.ts',
    '/api/ai-settings': '/api/ai-settings.ts',
    '/api/ai-models': '/api/ai-models.ts',
    '/api/analysis-history': '/api/analysis-history.ts',
    '/api/sales-pipeline': '/api/sales-pipeline.ts',
    '/api/invoicing': '/api/invoicing.ts',
    '/api/bank-transactions': '/api/bank-transactions.ts',
    '/api/bank-transactions-cron': '/api/bank-transactions-cron.ts',
    '/api/google-drive': '/api/google-drive.ts',
    '/api/recruitment-cv': '/api/recruitment-cv.ts',
    '/api/documents': '/api/documents.ts',
    '/api/documents-extract': '/api/documents-extract.ts',
    '/api/signatures': '/api/signatures.ts',
    '/api/accounts': '/api/accounts.ts',
    '/api/impersonate': '/api/impersonate.ts',
  };
  return {
    name: 'quicksort-admin-api-routes',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const route = routes[path];
        if (!route) return next();
        try {
          const module = await server.ssrLoadModule(route);
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const raw = Buffer.concat(chunks).toString('utf8');
          const query = Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
          await module.default(
            { method: req.method, headers: req.headers, query, body: raw ? JSON.parse(raw) : undefined },
            {
              setHeader: (name, value) => void res.setHeader(name, value),
              status(code) { res.statusCode = code; return this as never; },
              json(body) {
                if (!res.hasHeader('content-type')) res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(body));
              },
              send(body) {
                res.end(body);
                return this as never;
              },
            },
          );
          if (!res.writableEnded) res.end();
        } catch (error) {
          server.config.logger.error(`API route ${path} failed: ${error}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'Unexpected server error.' }));
          } else {
            res.end();
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The api handlers read process.env (SUPABASE_URL, OPENAI_API_KEY, …) — mirror
  // the .env file into process.env in dev, as Vite only exposes it via import.meta.env.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return {
    plugins: [legacyCssLayer(), tailwindcss(), react(), apiRoutes()],
    // packages/* still resolve React 18 for the other apps; admin bundles one React 19.
    resolve: { dedupe: ['react', 'react-dom'] },
  };
});
