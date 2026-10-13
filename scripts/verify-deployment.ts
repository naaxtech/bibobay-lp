import { classifyBrowserRun, DeploymentNetworkError, exitCodeFor, formatTable, parseArgs, runFetchChecks, USAGE, type BrowserObservation, type CheckResult, type CliOptions } from "./lib/deployment-checks";

/*
 * npm run verify:deployment -- <url> [--browser] [--require-ready] [--production] [--expect-heading <text>] [--min-text <n>]
 *
 * Checks a running deployment (ruling R44): the home page answers 200 with a real title and visible
 * content, every same-origin script, stylesheet and icon it references answers 200 with a sane type,
 * the security headers are present, /api/health is ok, /api/readiness is reported, robots.txt
 * answers, and a non-production URL carries a noindex signal. Rules: scripts/lib/deployment-checks.ts.
 *
 * --browser also loads the page in Chromium through @playwright/test (a dev dependency; run
 * `npx playwright install chromium` once) and fails on console errors, uncaught errors, CSP
 * violations and same-origin responses >= 400. The lead form is never submitted: any request to
 * /api/leads is blocked and reported as a failure.
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
    // Verification must never write a lead: block and record any request to the lead route.
    await context.route((url) => url.pathname.replace(/\/+$/, "") === "/api/leads", async (route) => {
      observation.leadRequests.push(`${route.request().method()} ${route.request().url()}`);
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
      throw new DeploymentNetworkError(`Chromium could not load ${options.url.href}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
    if (!response) throw new DeploymentNetworkError(`Chromium got no response for ${options.url.href}`);
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
  const results: CheckResult[] = [];
  try {
    results.push(
      ...(await runFetchChecks(options.url, {
        requireReady: options.requireReady,
        production: options.production,
        ...(options.expectHeading ? { expectHeading: options.expectHeading } : {}),
        ...(options.minTextLength !== undefined ? { minTextLength: options.minTextLength } : {}),
      })),
    );
    if (options.browser) results.push(...(await browserChecks(options)));
  } catch (error) {
    if (results.length > 0) console.log(formatTable(results));
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  console.log(`Deployment checks for ${options.url.href}${options.browser ? " (fetch + browser)" : " (fetch)"}`);
  console.log(formatTable(results));
  return exitCodeFor(results);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  },
);
