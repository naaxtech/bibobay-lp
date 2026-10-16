import { defineConfig, devices } from "@playwright/test";

import { bypassStorageStatePath } from "./e2e/support/vercel-bypass";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
// A preview behind Vercel Deployment Protection needs the project's "Protection Bypass for Automation"
// secret (docs/qa-checklist.md section 3). It is spent once, in the global setup, which saves Vercel's
// host-scoped bypass cookie as a storage state in the OS temp folder; no header goes to any other host.
// Never set it for a local or CI run.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/support/vercel-bypass.setup.ts",
  use: {
    baseURL,
    storageState: bypassSecret ? bypassStorageStatePath() : undefined,
    // A trace records cookies and request headers, so a run that carries the bypass keeps none.
    trace: bypassSecret ? "off" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
