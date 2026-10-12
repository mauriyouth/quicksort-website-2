import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 45000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  },
  webServer: [
    {
      command: "pnpm --filter @quicksort/admin dev",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @quicksort/web dev --host 127.0.0.1 --port 5183 --strictPort",
      url: "http://127.0.0.1:5183",
      env: {
        VITE_SUPABASE_URL: "https://hr-fixture.supabase.test",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      },
      reuseExistingServer: false,
    },
  ],
});
