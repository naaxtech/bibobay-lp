import { expect, test, type APIResponse, type Page } from "@playwright/test";

/*
 * Task 12 (local pass), spec §16 "Unauthorized API and admin access rejection". Real requests to
 * the keyless production server: there is no staff project here, so a request that clears the
 * same-origin and JSON gate reaches "not configured" (503), and one that does not is refused (403)
 * before anything else is looked at. Nothing is mocked, and the shop-helpers API guard is not used
 * because these tests are about what the real routes answer. e2e/admin/admin-pages.spec.ts covers
 * the sign-in page itself.
 *
 * The browser tests use a second origin that exists only as a page.route stand-in; the only host
 * any test calls is the base URL.
 */

const SESSION = "/api/admin/session";
const REFERENCE = "BB-0000-0000";
const WRITE_PATHS = [SESSION, `/api/admin/orders/${REFERENCE}/quote`, `/api/admin/orders/${REFERENCE}/status`, `/api/admin/orders/${REFERENCE}/tracking-link`] as const;
const ORDER_ROUTES = WRITE_PATHS.slice(1);
// A different site that is also loopback (localhost vs 127.0.0.1), so Chromium does not add its own
// local-network permission step on top of the cross-site checks this spec is about.
const FOREIGN_ORIGIN = "http://localhost:3271";

const JSON_HEADERS = { "content-type": "application/json" };
const sameOrigin = { ...JSON_HEADERS, "sec-fetch-site": "same-origin" };
const crossSite = { ...JSON_HEADERS, "sec-fetch-site": "cross-site" };
const sameSite = { ...JSON_HEADERS, "sec-fetch-site": "same-site" };

const named = (path: string) => path.replace(REFERENCE, "<reference>");

/** Every staff API answer, whatever its status, is private, unindexed and sends no referrer. */
function expectAdminHeaders(response: APIResponse, label: string) {
  const headers = response.headers();
  expect(headers["cache-control"], `${label}: cache-control`).toBe("private, no-store");
  expect(headers["x-robots-tag"], `${label}: x-robots-tag`).toBe("noindex, nofollow");
  expect(headers["referrer-policy"], `${label}: referrer-policy`).toBe("no-referrer");
  expect(headers["set-cookie"], `${label}: no cookie is set on a refusal`).toBeUndefined();
}

async function expectNoDetail(response: APIResponse, label: string) {
  const text = await response.text();
  expect(text, label).not.toMatch(/supabase|sanity|stack|\bat \w|\.ts\b|[A-Za-z]:[\\/]|https?:\/\//i);
  expect(JSON.parse(text), label).toMatchObject({ ok: false });
}

test.describe("the staff APIs refuse a request that is not from this site's own pages", () => {
  for (const path of WRITE_PATHS) {
    test(`POST ${named(path)} is 403 cross-site, same-site, with no Fetch Metadata or Origin, and for a non-JSON body`, async ({ request }) => {
      const attempts: Array<[string, Record<string, string>]> = [
        ["cross-site", crossSite],
        ["same-site (a sibling subdomain is not this site)", sameSite],
        ["no Sec-Fetch-Site and no Origin", JSON_HEADERS],
        ["a foreign Origin without Fetch Metadata", { ...JSON_HEADERS, origin: FOREIGN_ORIGIN }],
        ["same-origin but a form body", { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" }],
        ["same-origin but text/plain", { "content-type": "text/plain", "sec-fetch-site": "same-origin" }],
        ["same-origin with no content type", { "sec-fetch-site": "same-origin" }],
      ];
      for (const [label, headers] of attempts) {
        const response = await request.post(path, { headers, data: label.includes("form") ? "a=1" : "{}" });
        expect(response.status(), label).toBe(403);
        expectAdminHeaders(response, label);
        await expectNoDetail(response, label);
      }
    });

    test(`POST ${named(path)} from this site with JSON reaches "not configured" (503), not a 5xx crash`, async ({ request }) => {
      const response = await request.post(path, { headers: sameOrigin, data: "{}" });
      expect(response.status()).toBe(503);
      expectAdminHeaders(response, path);
      await expectNoDetail(response, path);
    });

    test(`${named(path)}: Fetch Metadata wins over a matching Origin header`, async ({ request, baseURL }) => {
      const response = await request.post(path, { headers: { ...crossSite, origin: new URL(baseURL ?? "http://127.0.0.1:3000").origin }, data: "{}" });
      expect(response.status()).toBe(403);
    });
  }

  test("the order routes accept only POST: GET, PUT, PATCH and DELETE are 405 with the admin headers", async ({ request }) => {
    for (const path of ORDER_ROUTES) {
      for (const method of ["get", "put", "patch", "delete"] as const) {
        const response = await request[method](path, { headers: sameOrigin });
        expect(response.status(), `${method.toUpperCase()} ${named(path)}`).toBe(405);
        expectAdminHeaders(response, `${method.toUpperCase()} ${named(path)}`);
      }
    }
  });

  test("DELETE /api/admin/session (sign-out) is refused cross-site and without Fetch Metadata", async ({ request }) => {
    const attempts: Array<Record<string, string>> = [crossSite, sameSite, {}, { origin: FOREIGN_ORIGIN }];
    for (const headers of attempts) {
      const response = await request.delete(SESSION, { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(403);
      expectAdminHeaders(response, "sign-out");
    }
  });

  test("DELETE /api/admin/session from this site with JSON reaches \"not configured\" (503) here", async ({ request }) => {
    const response = await request.delete(SESSION, { headers: sameOrigin, data: "{}" });
    expect(response.status()).toBe(503);
    expectAdminHeaders(response, "sign-out");
  });

  test("GET /api/admin/session is 405", async ({ request }) => {
    const response = await request.get(SESSION);
    expect(response.status()).toBe(405);
    expectAdminHeaders(response, "GET session");
  });

  test("an oversized or malformed JSON body from this site is a client error or 503, never a crash", async ({ request }) => {
    for (const data of ["{not json", `{"email":"${"a".repeat(40_000)}"}`, "null", "[]"]) {
      const response = await request.post(SESSION, { headers: sameOrigin, data });
      expect([400, 413, 503], `body ${data.slice(0, 12)}`).toContain(response.status());
      expectAdminHeaders(response, `body ${data.slice(0, 12)}`);
    }
  });

  test("no cross-origin permission is ever granted: the preflight carries no Access-Control-Allow header", async ({ request }) => {
    for (const path of WRITE_PATHS) {
      const response = await request.fetch(path, {
        method: "OPTIONS",
        headers: { origin: FOREIGN_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type", "sec-fetch-site": "cross-site" },
      });
      const allowed = Object.keys(response.headers()).filter((name) => name.startsWith("access-control-allow-"));
      expect(allowed, named(path)).toEqual([]);
    }
  });

  test("the order-submission and tracking APIs are not staff routes: they answer without any session and set no cookie", async ({ request }) => {
    for (const path of ["/api/orders", "/api/orders/track"]) {
      const response = await request.post(path, { headers: sameOrigin, data: "{}" });
      expect(response.status(), path).toBeLessThan(500);
      expect(response.headers()["set-cookie"], path).toBeUndefined();
    }
  });
});

/** Opens a page on a second origin that exists only as a route stand-in. */
async function openForeignPage(page: Page) {
  await page.route(`${FOREIGN_ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>other site</title><p>other site</p>" }));
  await page.goto(`${FOREIGN_ORIGIN}/`);
}

test.describe("a page on another site cannot use a staff's browser against the staff APIs", () => {
  test("a JSON fetch is stopped by the browser (no CORS approval), so no write reaches the server", async ({ page, baseURL }) => {
    const target = new URL(SESSION, baseURL).toString();
    const writes: string[] = [];
    page.on("response", (response) => {
      if (response.url() === target && response.request().method() !== "OPTIONS") writes.push(`${response.request().method()} ${response.status()}`);
    });
    await openForeignPage(page);
    const outcome = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.example", password: "x".repeat(12) }) });
        return { reachedServer: true, status: response.status };
      } catch {
        return { reachedServer: false, status: 0 };
      }
    }, target);
    expect(outcome).toEqual({ reachedServer: false, status: 0 });
    expect(writes).toEqual([]);
  });

  test("a form-style simple request from another site is never accepted: stopped in the browser or refused with 403", async ({ page, baseURL }) => {
    // Recent Chromium also asks permission before a page on another site reaches a loopback server, and
    // denies it here, so the request may never leave the browser. If it does leave (a deployed base URL),
    // the server must have answered 403. The 403 itself is proven request-by-request in the tests above.
    const target = new URL(SESSION, baseURL).toString();
    const answers: number[] = [];
    page.on("response", (response) => {
      if (response.url() === target && response.request().method() === "POST") answers.push(response.status());
    });
    await openForeignPage(page);
    const outcome = await page.evaluate(
      (url) => fetch(url, { method: "POST", mode: "no-cors", credentials: "include", headers: { "content-type": "text/plain" }, body: "{\"email\":\"a@b.example\"}" }).then(() => "sent", () => "blocked"),
      target,
    );
    if (outcome === "sent") await expect.poll(() => answers.length, { message: "the request was sent but no answer came back" }).toBe(1);
    expect(answers.filter((status) => status !== 403)).toEqual([]);
  });

  test("the same JSON POST from this site's own page is not refused for its origin (503: not configured here)", async ({ page }) => {
    await page.goto("/admin/login");
    const outcome = await page.evaluate(async (path) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return { status: response.status, noStore: response.headers.get("cache-control") };
    }, SESSION);
    expect(outcome).toEqual({ status: 503, noStore: "private, no-store" });
  });
});

test.describe("what keeps the staff surface out of public view", () => {
  test("robots.txt disallows /admin and /api/ for every crawler", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    const groups = text.split(/\n\s*\n/).filter((group) => /user-agent/i.test(group));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const disallowed = Array.from(group.matchAll(/^Disallow:\s*(\S*)/gim), (match) => match[1]);
      // A server with no verified production URL disallows everything; a production one lists both paths.
      const blocksAll = disallowed.includes("/");
      expect(blocksAll || (disallowed.includes("/admin") && disallowed.includes("/api/")), group).toBe(true);
      const allowed = Array.from(group.matchAll(/^Allow:\s*(\S*)/gim), (match) => match[1] ?? "").filter((rule) => rule.startsWith("/admin") || rule.startsWith("/api"));
      expect(allowed, "an Allow rule for staff paths").toEqual([]);
    }
  });

  test("sitemap.xml lists no /admin or /api path", async ({ request }) => {
    const text = await (await request.get("/sitemap.xml")).text();
    expect(text).not.toMatch(/\/admin|\/api\//);
  });

  for (const path of ["/", "/privacy", "/terms", "/thank-you", "/no-such-page"]) {
    test(`${path} links nowhere under /admin or /api`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.locator('a[href*="/admin"], a[href*="/api/"], link[href*="/admin"]')).toHaveCount(0);
      expect((await page.content()).toLowerCase()).not.toContain("/api/admin");
    });
  }

  test("the staff pages are noindex wherever they answer, including when the orders pages are absent", async ({ request }) => {
    for (const path of ["/admin/login", "/admin/orders", `/admin/orders/${REFERENCE}`]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), named(path)).toBeLessThan(500);
      const headers = response.headers();
      expect(headers["x-robots-tag"], named(path)).toBe("noindex, nofollow");
      expect(headers["referrer-policy"], named(path)).toBe("no-referrer");
    }
  });

  test("a signed-out visit to /admin/orders shows no order data", async ({ page }) => {
    const response = await page.goto("/admin/orders");
    // The orders pages are Task 8c part 2: until they exist the site's 404 answers; once they do, a
    // signed-out visitor is sent to sign in or told it is not set up. Never a 5xx, never a table.
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByText(/BB-[0-9A-Z]{4}-[0-9A-Z]{4}/)).toHaveCount(0);
  });
});
