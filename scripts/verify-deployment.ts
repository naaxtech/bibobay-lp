import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveSecretRules } from "./lib/bundle-secrets";
import { classifyBrowserRun, DeploymentNetworkError, displayUrl, exitCodeFor, formatTable, parseArgs, redactQueries, runFetchChecks, USAGE, type BrowserObservation, type CheckResult, type CliOptions } from "./lib/deployment-checks";
import { bypassFetch, bypassSecretFrom, carriesBypass } from "./lib/protection-bypass";
import { ALLOWED_PUBLIC_NAMES, isAllowedPublicName } from "./verify-env";

/*
 * npm run verify:deployment -- <url> [--browser] [--require-ready] [--production] [--expect-heading <text>] [--min-text <n>]
 *
 * Checks a running deployment (ruling R44): the home page answers 200 with a real title and visible
 * content, every same-origin script, stylesheet and icon it references answers 200 with a sane type,
 * the security headers are present, /api/health is ok, /api/readiness is reported, robots.txt
 * answers, a non-production URL carries a noindex signal (and --production carries none), and the
 * server-rendered HTML and RSC payload of every page hold no secret: the bundle scan's rules
 * (scripts/lib/bundle-secrets.ts) run over what the site actually sends, because every page is
 * rendered per request and so is absent from the build output verify:bundle scans. Secret values
 * come from this machine's environment and .env files, as for verify:bundle. Redirects are followed
 * only within the requested origin. Rules: scripts/lib/deployment-checks.ts.
 *
 * --browser also loads the page in Chromium through @playwright/test (a dev dependency; run
 * `npx playwright install chromium` once) and fails on console errors, uncaught errors, CSP
 * violations and same-origin responses >= 400. The lead form is never submitted: any request to
 * /api/leads is blocked and reported as a failure.
 *
 * A deployment behind Vercel Deployment Protection (every new preview) is reached with the project's
 * "Protection Bypass for Automation" secret in VERCEL_AUTOMATION_BYPASS_SECRET. It is sent as the
 * `x-vercel-protection-bypass` header on EVERY request to the named origin, fetches and Chromium
 * alike (a query-string token would be dropped from each follow-up URL), to no other host, and is
 * never printed (scripts/lib/protection-bypass.ts).
 *
 * Exit codes: 0 pass, 1 a check failed, 2 usage or network error.
 */

async function browserChecks(options: CliOptions): Promise<CheckResult[]> {
  let chromium: typeof import("@playwright/test").chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    throw new DeploymentNetworkError("--browser needs the @playwright/test dev dependency (npm ci)");
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new DeploymentNetworkError(`Chromium could not start (run \`npx playwright install chromium\`): ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  const observation: BrowserObservation = { origin: options.url.origin, consoleErrors: [], pageErrors: [], cspViolations: [], responses: [], headingVisible: false, leadRequests: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const secret = bypassSecretFrom(process.env);
    if (secret) {
      await context.route(
        (url) => carriesBypass(url.href, options.url.origin),
        (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-protection-bypass": secret } }),
      );
    }
    // Verification must never write a lead: block and record any request to the lead route.
    await context.route((url) => url.pathname.replace(/\/+$/, "") === "/api/leads", async (route) => {
      observation.leadRequests.push(`${route.request().method()} ${displayUrl(new URL(route.request().url()))}`);
      await route.abort("blockedbyclient");
    });
    // Init scripts run before page scripts and are not subject to the page's CSP.
    await context.addInitScript(() => {
      const store: string[] = [];
      (window as unknown as { __cspViolations?: string[] }).__cspViolations = store;
      document.addEventListener("securitypolicyviolation", (event) => {
        store.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`);
      });
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") observation.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => observation.pageErrors.push(error.message));
    page.on("response", (response) => observation.responses.push({ url: response.url(), status: response.status() }));

    let response;
    try {
      response = await page.goto(options.url.href, { waitUntil: "load", timeout: 45_000 });
    } catch (error) {
      throw new DeploymentNetworkError(`Chromium could not load ${displayUrl(options.url)}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
    if (!response) throw new DeploymentNetworkError(`Chromium got no response for ${displayUrl(options.url)}`);
    // Scroll end to end so lazy images, reveals and link prefetches all fire.
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(60);
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    observation.headingVisible = await page.locator("h1").first().isVisible().catch(() => false);
    if (!observation.headingVisible) {
      // The hero may be hidden in the CMS; the page then carries a visually hidden <h1>.
      observation.headingVisible = (await page.locator("h1").count()) > 0 && (await page.locator("main").first().isVisible().catch(() => false));
    }
    observation.cspViolations = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);
    await context.close();
  } finally {
    await browser.close();
  }
  return classifyBrowserRun(observation);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  // Scan for the values this machine (or CI job) holds, read the same way verify:bundle reads them.
  nextEnv.loadEnvConfig(process.cwd(), false);
  const scanRules = deriveSecretRules({ envExample: readFileSync(resolve(".env.example"), "utf8"), allowedPublicNames: ALLOWED_PUBLIC_NAMES, isAllowedPublicName, env: process.env });
  const results: CheckResult[] = [];
  const secret = bypassSecretFrom(process.env);
  try {
    results.push(
      ...(await runFetchChecks(options.url, {
        ...(secret ? { fetch: bypassFetch(fetch, options.url.origin, secret) } : {}),
        requireReady: options.requireReady,
        production: options.production,
        scanRules,
        ...(options.expectHeading ? { expectHeading: options.expectHeading } : {}),
        ...(options.minTextLength !== undefined ? { minTextLength: options.minTextLength } : {}),
      })),
    );
    if (options.browser) results.push(...(await browserChecks(options)));
  } catch (error) {
    if (results.length > 0) console.log(formatTable(results));
    console.error(redactQueries(error instanceof Error ? error.message : String(error)));
    return 2;
  }
  console.log(`Deployment checks for ${displayUrl(options.url)}${options.browser ? " (fetch + browser)" : " (fetch)"}; ${scanRules.secretValues.length} configured secret values scanned for`);
  console.log(formatTable(results));
  return exitCodeFor(results);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(redactQueries(error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  },
);
