import { expect, test } from "@playwright/test";

import { COMMERCE_ON, NOT_FOUND_TITLE, ORDER_PAD_KEY, VIEWPORTS, guardApisAndStorage, shopLinks, storageReads } from "./shop-helpers";

/*
 * Task 7b, commerce off (the default; spec §10 "Server gating"). Part of the normal run: the shop
 * routes (and, Task 7c, the order, tracking and private order pages) answer the site's 404 page, no
 * page links to any of them, the sitemap never lists them, and no page reads the order pad from the
 * device. Skipped in the commerce-on run (E2E_COMMERCE=1), whose
 * server has commerce switched on.
 */

test.skip(COMMERCE_ON, "commerce is switched on for this run");
guardApisAndStorage();

for (const { name, use } of VIEWPORTS) {
  test.describe(`the shop while commerce is off, on ${name}`, () => {
    test.use(use);

    // Task 7c: the order page, the tracking page and every private order link too.
    for (const path of ["/shop", "/shop/anything", "/shop/tula-reef-plush", "/order", "/track", "/orders/anything", `/orders/${"0123456789abcdef".repeat(4)}`]) {
      test(`${path} answers 404 with the branded not-found page`, async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE })).toBeVisible();
        await expect(page.getByRole("contentinfo")).toBeVisible();
        await expect(page.getByRole("button", { name: /add to order/i })).toHaveCount(0);
        await expect(shopLinks(page)).toHaveCount(0);
      });
    }

    for (const path of ["/", "/privacy", "/terms", "/thank-you"]) {
      test(`${path} links nowhere in the shop and never reads the order pad`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("contentinfo")).toBeVisible();
        await expect(shopLinks(page)).toHaveCount(0);
        await expect(page.getByRole("contentinfo").getByRole("link", { name: /shop/i })).toHaveCount(0);
        // Task 7c: no way to the order or tracking pages either.
        await expect(page.locator('a[href="/order"], a[href="/track"], a[href^="/orders/"]')).toHaveCount(0);
        await expect(page.getByRole("contentinfo").getByRole("link", { name: /track/i })).toHaveCount(0);
        // Let the client finish hydrating before checking what it read.
        await page.waitForLoadState("load");
        expect(await storageReads(page)).not.toContain(ORDER_PAD_KEY);
      });
    }

    test("the mobile menu and desktop header offer no shop link", async ({ page }) => {
      await page.goto("/");
      const header = page.locator("header[data-site-header]");
      await expect(header).toBeVisible();
      if (use.viewport.width < 1024) {
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("dialog").getByRole("link", { name: /shop/i })).toHaveCount(0);
      } else {
        await expect(header.getByRole("navigation").getByRole("link", { name: /shop/i })).toHaveCount(0);
      }
      await expect(shopLinks(page)).toHaveCount(0);
    });
  });
}

for (const path of ["/", "/privacy", "/no-such-page"]) {
  test(`${path} downloads no order-pad code at all`, async ({ page }) => {
    const scripts: Array<Promise<string>> = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const bodies = await Promise.all(scripts);
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.filter((body) => body.includes(ORDER_PAD_KEY)).length, "scripts carrying the order pad").toBe(0);
  });
}

test("the sitemap never lists the shop, order or tracking pages", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(await response.text()).not.toMatch(/\/(?:shop|order|orders|track)\b/);
});
