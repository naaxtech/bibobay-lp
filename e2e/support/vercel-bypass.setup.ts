import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { request, type FullConfig } from "@playwright/test";

import { bypassCookieUrl, bypassStorageStatePath, selectBypassCookies } from "./vercel-bypass";

/*
 * Playwright global setup (residual fixer, item 4). Without VERCEL_AUTOMATION_BYPASS_SECRET it does
 * nothing, so a local or CI run is unchanged. With it, one request to the deployment asks for
 * Vercel's bypass cookie, and the cookies set for that host are saved as the storage state the
 * config hands to every browser context. The secret is spent here and never printed.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) return;
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("The protection bypass needs a baseURL (PLAYWRIGHT_BASE_URL).");

  const context = await request.newContext();
  try {
    await context.get(bypassCookieUrl(baseURL, secret));
    const state = await context.storageState();
    const cookies = selectBypassCookies(state.cookies, baseURL);
    if (cookies.length === 0) {
      throw new Error("The deployment set no bypass cookie: check VERCEL_AUTOMATION_BYPASS_SECRET and that Protection Bypass for Automation is enabled.");
    }
    const path = bypassStorageStatePath();
    // Not recursive: fails if the folder already exists, so nothing pre-created by someone else is reused.
    await mkdir(dirname(path), { recursive: false, mode: 0o700 });
    await writeFile(path, JSON.stringify({ cookies, origins: [] }), { encoding: "utf8", mode: 0o600 });
  } finally {
    await context.dispose();
  }
}
