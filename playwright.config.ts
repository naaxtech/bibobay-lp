import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
// A preview behind Vercel Deployment Protection needs the project's "Protection Bypass for Automation"
// secret on every request (docs/qa-checklist.md section 3). Never set it for a local or CI run.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const bypass = bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    extraHTTPHeaders: bypass,
    // A trace records request headers, so a run that carries the secret keeps none.
    trace: bypass ? "off" : "retain-on-failure",
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
