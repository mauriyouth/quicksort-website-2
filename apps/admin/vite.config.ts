import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serves the Vercel-style api/ routes during `vite dev` so the CV analyzer and
// candidate intake work locally exactly as they do when deployed. Each handler
// is loaded through Vite's SSR pipeline (TypeScript + workspace imports) and
// adapted to connect's req/res.
function apiRoutes(): Plugin {
  const routes: Record<string, string> = {
    '/api/analyze': '/api/analyze.ts',
    '/api/parse-candidate': '/api/parse-candidate.ts',
    '/api/ai-settings': '/api/ai-settings.ts',
    '/api/analysis-history': '/api/analysis-history.ts',
    '/api/sales-pipeline': '/api/sales-pipeline.ts',
    '/api/team-photo': '/api/team-photo.mjs',
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
  return { plugins: [react(), apiRoutes()] };
});
