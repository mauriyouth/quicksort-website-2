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
      command: "pnpm --filter @quicksort/candidate dev",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @quicksort/web dev --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
    },
  ],
});
