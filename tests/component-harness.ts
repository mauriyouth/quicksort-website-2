import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from '../apps/admin/node_modules/vite/dist/node/index.js';

export const fixtureSupabaseURL = 'https://hr-fixture.supabase.test';

/** Runs real components and the real Supabase client; tests intercept their network boundary. */
export async function startComponentHarness(entry: string) {
  const repo = resolve(process.cwd());
  const root = realpathSync(mkdtempSync('/tmp/quicksort-components-'));
  writeFileSync(join(root, 'index.html'), '<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  writeFileSync(join(root, 'clerk.tsx'), `
    export function useSession() { return { session: { getToken: async () => 'fixture-session' } }; }
    export function useClerk() { return { signOut: async () => {}, openUserProfile: () => {} }; }
    export function useUser() { return { isLoaded: true, user: { id: 'fixture-user' } }; }
    export function useAuth() { return { isLoaded: true, isSignedIn: true, getToken: async () => 'fixture-session' }; }
    export function SignIn() { return null; }
    export function ClerkProvider({ children }) { return children; }
  `);
  writeFileSync(join(root, 'entry.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { setSessionToken } from '@quicksort/hr-db';
    import '${repo}/packages/hr-ui/src/styles.css';
    import '${repo}/apps/admin/src/admin-theme.css';
    setSessionToken(async () => 'fixture-session');
    ${entry}
  `);
  const server = await createServer({
    configFile: false,
    root,
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(fixtureSupabaseURL),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('public-test-key'),
    },
    resolve: {
      alias: [
        { find: '@app', replacement: join(repo, 'apps/admin/src') },
        { find: '@clerk/react', replacement: join(root, 'clerk.tsx') },
        { find: /^@quicksort\/hr-db$/, replacement: join(repo, 'packages/hr-db/src/index.ts') },
        { find: '@quicksort/hr-ui', replacement: join(repo, 'packages/hr-ui/src') },
        { find: '@quicksort/design-system', replacement: join(repo, 'packages/design-system/src') },
        { find: 'react-dom', replacement: join(repo, 'apps/admin/node_modules/react-dom') },
        { find: 'react', replacement: join(repo, 'apps/admin/node_modules/react') },
      ],
    },
    esbuild: { jsx: 'automatic' },
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [repo, root] } },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) { await server.close(); rmSync(root, { recursive: true, force: true }); throw new Error('The component preview did not start.'); }
  return {
    url,
    async close() { await server.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
