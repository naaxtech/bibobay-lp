import { expect, test } from "@playwright/test";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { VIEWPORTS, guardApisAndStorage, hydrated, tabTo } from "../shop/shop-helpers";

/*
 * Task 8c (ruling R106): the staff pages in a real browser, on the keyless production server with
 * no flag. Nothing here signs in for real: the sign-in answers come from page.route (the shared
 * guard fails any other /api call), and the signed-in pages are proven in Vitest. Covers the
 * sign-in page, the admin headers and noindex, and that no public page links to /admin.
 */
guardApisAndStorage();

const SESSION = "**/api/admin/session";
const answer = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

for (const { name, use } of VIEWPORTS) {
  test.describe(`the staff sign-in page on ${name}`, () => {
    test.use(use);

    test("answers with the admin headers and noindex, a Staff title and a skip link to the one main landmark", async ({ page }) => {
      const response = await page.goto("/admin/login");
      expect(response?.status()).toBe(200);
      const headers = response!.headers();
      // `next dev` replaces Cache-Control on every page; the production server sends the admin value.
      if (!process.env.PLAYWRIGHT_DEV_SERVER) expect(headers["cache-control"]).toContain("no-store");
      if (!process.env.PLAYWRIGHT_DEV_SERVER) expect(headers["cache-control"]).toContain("private");
      expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(headers["referrer-policy"]).toBe("no-referrer");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page).toHaveTitle(/^Staff\b/);
      await expect(page.getByRole("heading", { level: 1, name: PAGE_COPY.login.heading })).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("link", { name: PAGE_COPY.frame.skipToContent })).toHaveAttribute("href", "#main-content");
      await expect(page.getByRole("banner")).toContainText(PAGE_COPY.frame.staffLabel);
      // Signed out: no sign-out button, no way anywhere else on the site.
      await expect(page.getByRole("button", { name: PAGE_COPY.signOut.label })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^(?:shop|track|privacy|terms)/i })).toHaveCount(0);
    });

    test("fits the screen with large, labelled, visibly focusable controls", async ({ page }) => {
      await page.goto("/admin/login");
      const form = page.getByRole("form", { name: PAGE_COPY.login.formLabel });
      const email = form.getByLabel(PAGE_COPY.login.emailLabel);
      const password = form.getByLabel(PAGE_COPY.login.passwordLabel);
      const submit = form.getByRole("button", { name: PAGE_COPY.login.submit });
      await hydrated(form);
      await expect(submit).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      for (const control of [email, password, submit]) {
        const box = await control.boundingBox();
        expect(box!.height, "target height").toBeGreaterThanOrEqual(44);
      }
      await tabTo(page, email);
      for (const control of [email, password, submit]) {
        await tabTo(page, control);
        const ring = await control.evaluate((element) => {
          const style = getComputedStyle(element);
          return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
        });
        expect(ring.style).not.toBe("none");
        expect(ring.width).toBeGreaterThanOrEqual(2);
      }
    });

    test("posts the credentials as same-origin JSON and goes to the orders on 200", async ({ page }) => {
      const sent: Array<{ method: string; contentType: string | undefined; origin: string | undefined; body: unknown }> = [];
      await page.route(SESSION, async (route) => {
        const request = route.request();
        sent.push({ method: request.method(), contentType: request.headers()["content-type"], origin: request.headers()["origin"], body: request.postDataJSON() });
        await route.fulfill(answer(200, { ok: true, message: ADMIN_COPY.session.signedIn }));
      });
      await page.goto("/admin/login");
      const form = page.getByRole("form", { name: PAGE_COPY.login.formLabel });
      await hydrated(form);
      await form.getByLabel(PAGE_COPY.login.emailLabel).fill("staff@example.com");
      await form.getByLabel(PAGE_COPY.login.passwordLabel).fill("a long enough password");
      await form.getByRole("button", { name: PAGE_COPY.login.submit }).click();
      // Whatever the orders page shows on this server, the browser was sent there.
      await expect(page).toHaveURL(/\/admin\/orders$/);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ method: "POST", contentType: "application/json", body: { email: "staff@example.com", password: "a long enough password" } });
      expect(new URL(sent[0]!.origin ?? "").origin).toBe(new URL(page.url()).origin);
    });

    const refusals: Array<[number, string]> = [
      [400, ADMIN_COPY.session.checkDetails],
      [401, ADMIN_COPY.session.refused],
      [403, ADMIN_COPY.api.forbidden],
      [429, ADMIN_COPY.session.rateLimited],
      [503, ADMIN_COPY.api.unconfigured],
      [503, ADMIN_COPY.api.unavailable],
      [500, ADMIN_COPY.api.failed],
    ];
    for (const [status, message] of refusals) {
      test(`shows the API's message for ${status} (${message.slice(0, 32)}...) in the live region and stays on the page`, async ({ page }) => {
        await page.route(SESSION, (route) => route.fulfill(answer(status, { ok: false, message })));
        await page.goto("/admin/login");
        const form = page.getByRole("form", { name: PAGE_COPY.login.formLabel });
        await hydrated(form);
        await form.getByLabel(PAGE_COPY.login.emailLabel).fill("staff@example.com");
        await form.getByLabel(PAGE_COPY.login.passwordLabel).fill("a long enough password");
        await form.getByRole("button", { name: PAGE_COPY.login.submit }).click();
        await expect(form.getByRole("status")).toHaveText(message);
        await expect(form.getByRole("button", { name: PAGE_COPY.login.submit })).toBeEnabled();
        await expect(page).toHaveURL(/\/admin\/login$/);
      });
    }

    test("names an empty field and sends nothing", async ({ page }) => {
      await page.goto("/admin/login");
      const form = page.getByRole("form", { name: PAGE_COPY.login.formLabel });
      await hydrated(form);
      await form.getByRole("button", { name: PAGE_COPY.login.submit }).click();
      await expect(form.getByText(PAGE_COPY.login.emailRequired)).toBeVisible();
      await expect(form.getByText(PAGE_COPY.login.passwordRequired)).toBeVisible();
      await expect(form.getByLabel(PAGE_COPY.login.emailLabel)).toBeFocused();
      await expect(form.getByLabel(PAGE_COPY.login.emailLabel)).toHaveAttribute("aria-invalid", "true");
    });
  });
}

test.describe("no public page leads to the staff pages", () => {
  for (const path of ["/", "/privacy", "/terms", "/thank-you"]) {
    test(`${path} links nowhere under /admin`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.locator('a[href^="/admin"], a[href*="/admin/"]')).toHaveCount(0);
    });
  }

  test("the sitemap and robots file keep staff pages out", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    // A local server disallows everything; a production one lists /admin (tests/admin/admin-headers.test.ts).
    expect(robots).toMatch(/^Disallow:\s*\/(?:admin\b.*)?$/m);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain("/admin");
  });
});
