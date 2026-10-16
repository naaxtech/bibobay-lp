import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/*
 * Task 9 page health under the real Content-Security-Policy (ruling R34): every public page loads,
 * hydrates and runs its motion layer with no console error and no CSP violation, and the lead form
 * still submits. Like e2e/leads, nothing here reaches the real /api/leads (ruling R39): every lead
 * request is answered by page.route, and a context guard fails the test on any unrouted one.
 *
 * Run it against the dev server (the default webServer) and against a production build:
 *   npm run build && npx next start -p 3200   then   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 E2E_PRODUCTION=1 npx playwright test e2e/security
 */

const PAGES = ["/", "/privacy", "/terms", "/thank-you"] as const;
const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;
const PRODUCTION = process.env.E2E_PRODUCTION === "1";

const isLeadRoute = (url: URL) => url.pathname.replace(/\/+$/, "") === "/api/leads";
const unrouted = new WeakMap<BrowserContext, string[]>();

test.beforeEach(async ({ context }) => {
  const calls: string[] = [];
  unrouted.set(context, calls);
  await context.route(isLeadRoute, async (route) => {
    calls.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });
  // Records CSP violations the page reports, before any page script runs (init scripts are not subject to the CSP).
  await context.addInitScript(() => {
    const store: string[] = [];
    (window as unknown as { __cspViolations?: string[] }).__cspViolations = store;
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"} (${event.sourceFile}:${event.lineNumber})`);
    });
  });
});

test.afterEach(async ({ context }) => {
  expect(unrouted.get(context), "a lead request was not routed by the test (ruling R39)").toEqual([]);
});

/** Console errors (CSP refusals are logged as errors too), uncaught exceptions and failed responses. */
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/hmr")) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);

for (const { name, use } of VIEWPORTS) {
  test.describe(`pages under the content security policy on ${name}`, () => {
    test.use(use);

    for (const path of PAGES) {
      test(`${path} loads with a nonce policy, runs its motion layer, and logs no error or violation`, async ({ page }) => {
        const problems = collectProblems(page);
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);

        const policy = (await response?.headerValue("content-security-policy")) ?? "";
        expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
        expect(policy).toContain("object-src 'none'");
        expect(policy).toContain("frame-ancestors 'self'");
        if (PRODUCTION) expect(policy).not.toContain("unsafe-eval");
        expect(await response?.headerValue("x-content-type-options")).toBe("nosniff");
        expect(await response?.headerValue("referrer-policy")).toBe("strict-origin-when-cross-origin");
        expect(await response?.headerValue("cross-origin-opener-policy")).toBe("same-origin");
        expect(await response?.headerValue("x-powered-by")).toBeNull();

        // Hydrated, and the GSAP layer chose full motion (Playwright does not ask for reduced motion).
        await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 600) {
          await page.mouse.wheel(0, 600);
          await page.waitForTimeout(60);
        }
        await page.waitForLoadState("networkidle");

        expect(await cspViolations(page)).toEqual([]);
        expect(problems).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      });
    }

    test("the lead form submits under the policy (to a mocked route) and shows the stored result", async ({ page }) => {
      const problems = collectProblems(page);
      const bodies: unknown[] = [];
      await page.route("**/api/leads", async (route) => {
        bodies.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, persisted: true, acknowledgementQueued: true, message: "stored" }) });
      });
      await page.goto("/#lead");
      const form = page.getByRole("form", { name: "Founding-family signup" });
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      await form.getByRole("textbox", { name: "Email", exact: true }).fill("parent@example.com");
      await form.getByRole("checkbox").check();
      await form.locator('button[type="submit"]').click();
      await expect(form.getByRole("status")).toHaveText("You joined the founding-family list.");
      expect(bodies).toHaveLength(1);
      expect(await cspViolations(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test.describe("security plumbing", () => {
  test("each document gets a fresh nonce, so pages are rendered per request", async ({ request }) => {
    const nonce = async () => /'nonce-([^']+)'/.exec((await request.get("/")).headers()["content-security-policy"] ?? "")?.[1];
    const [a, b] = [await nonce(), await nonce()];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test("the scripts in the HTML carry the request's nonce", async ({ request }) => {
    const response = await request.get("/privacy");
    const nonce = /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1];
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    const executable = scripts.filter((tag) => !/type="application\/ld\+json"/.test(tag));
    expect(executable.length).toBeGreaterThan(0);
    for (const tag of executable) expect(tag, tag).toContain(`nonce="${nonce}"`);
  });

  test("API responses are JSON-only: a deny-all policy and no cache", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(Object.keys(await response.json()).sort()).toEqual(["status", "time", "version"]);
  });

  test("readiness reports 503 with booleans only while nothing is configured", async ({ request }) => {
    const response = await request.get("/api/readiness");
    expect(response.status()).toBe(503);
    const body = await response.json();
    for (const value of Object.values(body)) expect(typeof value).toBe("boolean");
  });

  test("robots.txt keeps every non-production server out of search engines", async ({ request }) => {
    test.skip(PRODUCTION && process.env.VERCEL_ENV === "production", "only a real production deployment is indexable");
    const text = await (await request.get("/robots.txt")).text();
    expect(text).toMatch(/User-Agent: \*\s+Disallow: \//i);
  });

  test("the legal pages are noindex while they show fallback text", async ({ page }) => {
    for (const path of ["/privacy", "/terms", "/thank-you"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });

  test("/studio is a 404 until a Studio URL is configured", async ({ request }) => {
    const response = await request.get("/studio", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  });

  test("draft mode cannot be switched on without a valid secret, and never redirects off-site", async ({ request }) => {
    const response = await request.get("/api/draft-mode/enable?sanity-preview-secret=guess&sanity-preview-pathname=//evil.example", { maxRedirects: 0 });
    expect([401, 503]).toContain(response.status());
    expect(response.headers()["location"]).toBeUndefined();
    expect(response.headers()["set-cookie"] ?? "").not.toContain("__prerender_bypass");
  });

  test("the revalidation webhook refuses an unsigned request", async ({ request }) => {
    const response = await request.post("/api/revalidate", { data: { _type: "landingPage" } });
    // 503 while SANITY_REVALIDATE_SECRET is unset (this server); 401 once it is.
    expect([401, 503]).toContain(response.status());
    expect(await response.text()).not.toContain("landingPage");
  });
});
