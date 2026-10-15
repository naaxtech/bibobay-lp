import { expect, test, type Page } from "@playwright/test";

import { COMMERCE_ON, NOT_FOUND_TITLE, ORDER_PAD_KEY, PRICE, SHOP_LABEL, VIEWPORTS, guardApisAndStorage, hydrated, tabTo } from "./shop-helpers";

/*
 * Task 7b, commerce on: the catalogue and product pages in a real browser. Skipped unless
 * E2E_COMMERCE=1, which the controller sets only against the production build of a scratch copy
 * prepared by scripts/e2e/enable-commerce-fixture.mjs (commerce and tracking on, the fixture
 * catalogue below, no Sanity project):
 *
 *   node scripts/e2e/enable-commerce-fixture.mjs <copy>
 *   (in the copy) npm ci && npm run build && npx next start -p 3200
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 E2E_COMMERCE=1 npx playwright test e2e/shop
 *
 * Nothing here sends an order (e2e/shop/order-flow.spec.ts covers the order and tracking pages,
 * Task 7c), and the API guard fails any /api call.
 */

test.skip(!COMMERCE_ON, "needs a server with the commerce fixture (E2E_COMMERCE=1)");
guardApisAndStorage();

/** The fixture catalogue (scripts/e2e/enable-commerce-fixture.mjs). */
const FIXTURE = {
  listed: ["Tula Reef Plush", "Bob Bath Boat", "Bay Activity Cards"],
  groups: ["Plush friends", "Bath time", "More from the shop"],
  soldOut: { name: "Lumi Night Light", slug: "lumi-night-light" },
  draftSlug: "coral-sticker-sheet",
  tula: { id: "fixture-tula-reef-plush", slug: "tula-reef-plush", facts: [["Product code", "BB-PL-001"], ["Variant", "Coral"], ["Pack", "Single"]] as const, notice: "Made to order" },
} as const;

/** components/landing/ui-copy.ts orderPad / shop copy. */
const COPY = {
  add: "Add to order",
  added: "Added to your order.",
  addedAgain: (quantity: number) => `Added to your order: ${quantity} now.`,
  review: "Review your order",
  soldOut: "Sold out",
  details: "Details",
  backToShop: "Back to the shop",
} as const;

const addButton = (page: Page, product: string) => page.getByRole("main").getByRole("button", { name: `${COPY.add}: ${product}` });
// `has` is matched inside each .add-to-order, so it names the button alone (not via <main>, which is outside it).
const statusFor = (page: Page, product: string) =>
  page.getByRole("main").locator(".add-to-order").filter({ has: page.getByRole("button", { name: `${COPY.add}: ${product}`, exact: true }) }).getByRole("status");

/** Console errors, uncaught exceptions, CSP refusals and failed responses while a test runs. */
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
  });
  return problems;
}

async function storedPad(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), ORDER_PAD_KEY);
  return raw === null ? null : (JSON.parse(raw) as { lines: Array<Record<string, unknown>> });
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`the shop while commerce is on, on ${name}`, () => {
    test.use(use);

    test("the catalogue lists the listed products by category, with no price anywhere", async ({ page }) => {
      const problems = collectProblems(page);
      const response = await page.goto("/shop");
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${SHOP_LABEL} | BIBO Bay`);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: SHOP_LABEL })).toBeVisible();
      await expect(main.getByRole("heading", { level: 2 })).toHaveText([...FIXTURE.groups]);
      for (const product of FIXTURE.listed) {
        await expect(main.getByRole("heading", { level: 3, name: product })).toBeVisible();
        await expect(main.getByRole("link", { name: product, exact: true })).toHaveAttribute("href", /^\/shop\/[a-z0-9-]+$/);
        await expect(addButton(page, product)).toBeVisible();
      }
      await expect(main.getByText(FIXTURE.soldOut.name)).toHaveCount(0);
      await expect(main.getByText("Coral Sticker Sheet")).toHaveCount(0);

      // No price, offer or currency: not in the words, the markup or structured data.
      expect(await main.innerText()).not.toMatch(PRICE);
      await expect(page.locator('[itemprop="price"], [itemprop="priceCurrency"], [data-price]')).toHaveCount(0);
      for (const json of await page.locator('script[type="application/ld+json"]').allTextContents()) expect(json).not.toMatch(/price|offer|currency/i);

      // The way to review the order, in the header (the order page, e2e/shop/order-flow.spec.ts).
      await expect(page.locator("header[data-site-header]").getByRole("link", { name: COPY.review })).toHaveAttribute("href", "/order");
      // Nothing runs off the side of a phone.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(problems).toEqual([]);
    });

    test("adding announces each add politely and keeps only product and quantity on the device", async ({ page }) => {
      await page.goto("/shop");
      const button = addButton(page, "Tula Reef Plush");
      await hydrated(button);
      const status = statusFor(page, "Tula Reef Plush");
      await expect(status).toHaveText("");
      await button.click();
      await expect(status).toHaveText(COPY.added);
      await button.click();
      await expect(status).toHaveText(COPY.addedAgain(2));
      expect(await storedPad(page)).toEqual({ lines: [{ productId: FIXTURE.tula.id, quantity: 2 }] });
    });

    test("the product page shows its details, codes and notice, and adds to the same order", async ({ page }) => {
      const problems = collectProblems(page);
      await page.goto("/shop");
      await page.getByRole("main").getByRole("link", { name: "Tula Reef Plush", exact: true }).click();
      await expect(page).toHaveURL(`/shop/${FIXTURE.tula.slug}`);
      await expect(page).toHaveTitle("Tula Reef Plush | BIBO Bay");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: "Tula Reef Plush" })).toBeVisible();
      await expect(main.getByText("Plush friends")).toBeVisible();
      for (const [label, value] of FIXTURE.tula.facts) {
        await expect(main.locator("dt", { hasText: label })).toBeVisible();
        await expect(main.locator("dd", { hasText: value })).toBeVisible();
      }
      await expect(main.getByRole("region", { name: FIXTURE.tula.notice }).getByRole("heading", { name: FIXTURE.tula.notice })).toBeVisible();
      await expect(main.getByRole("complementary")).toHaveCount(0);
      await expect(main.getByRole("heading", { level: 2, name: COPY.details })).toBeVisible();
      await expect(main.getByRole("heading", { level: 3, name: "Care" })).toBeVisible();
      expect(await main.innerText()).not.toMatch(PRICE);

      const button = addButton(page, "Tula Reef Plush");
      await hydrated(button);
      await button.click();
      await expect(statusFor(page, "Tula Reef Plush")).toHaveText(COPY.added);
      await main.getByRole("link", { name: COPY.backToShop }).click();
      await expect(page).toHaveURL("/shop");
      expect(await storedPad(page)).toEqual({ lines: [{ productId: FIXTURE.tula.id, quantity: 1 }] });
      expect(problems).toEqual([]);
    });

    test("a sold-out product keeps its page, says so, and cannot be added", async ({ page }) => {
      const response = await page.goto(`/shop/${FIXTURE.soldOut.slug}`);
      expect(response?.status()).toBe(200);
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: FIXTURE.soldOut.name })).toBeVisible();
      await expect(main.getByText(COPY.soldOut, { exact: true })).toBeVisible();
      await expect(main.getByRole("button", { name: new RegExp(COPY.add) })).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });

    for (const slug of [FIXTURE.draftSlug, "no-such-product"]) {
      test(`/shop/${slug} answers 404 with the branded not-found page`, async ({ page }) => {
        const response = await page.goto(`/shop/${slug}`);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND_TITLE })).toBeVisible();
      });
    }

    test("works by keyboard alone: add, open the product, add again", async ({ page }) => {
      await page.goto("/shop");
      const button = addButton(page, "Bob Bath Boat");
      await hydrated(button);
      await tabTo(page, button);
      await expect(button).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(statusFor(page, "Bob Bath Boat")).toHaveText(COPY.added);

      const link = page.getByRole("main").getByRole("link", { name: "Bob Bath Boat", exact: true });
      await page.keyboard.press("Shift+Tab");
      await expect(link).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL("/shop/bob-bath-boat");

      const again = addButton(page, "Bob Bath Boat");
      await hydrated(again);
      await tabTo(page, again);
      await page.keyboard.press("Space");
      await expect(statusFor(page, "Bob Bath Boat")).toHaveText(COPY.addedAgain(2));
    });

    test("the header and footer link to the shop, under the CMS label", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("contentinfo").getByRole("link", { name: SHOP_LABEL, exact: true })).toHaveAttribute("href", "/shop");
      if (use.viewport.width < 1024) {
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.getByRole("dialog").getByRole("link", { name: SHOP_LABEL, exact: true })).toHaveAttribute("href", "/shop");
      } else {
        await expect(page.locator("header[data-site-header]").getByRole("navigation").getByRole("link", { name: SHOP_LABEL, exact: true })).toBeVisible();
      }
    });

    test("the fallback privacy text describes order requests and never says nothing is sold", async ({ page }) => {
      await page.goto("/privacy");
      const main = page.getByRole("main");
      await expect(main.getByText("We never ask for payment card or bank details", { exact: false })).toBeVisible();
      expect(await main.innerText()).not.toMatch(/nothing is sold/i);
    });
  });
}

test("the sitemap matches robots.txt: empty when the deployment is not indexable, else the shop and its listed products", async ({ request }) => {
  const body = await (await request.get("/sitemap.xml")).text();
  const robots = await (await request.get("/robots.txt")).text();
  // Ruling R35: a non-production server disallows everything and publishes an empty sitemap. The
  // listing itself is unit-tested (tests/shop/sitemap.test.ts); this pins what the server serves.
  const indexable = !/^Disallow:\s*\/\s*$/m.test(robots);
  if (indexable) {
    expect(body).toMatch(/\/shop<\/loc>/);
    for (const slug of ["tula-reef-plush", "bob-bath-boat", "bay-activity-cards"]) expect(body).toContain(`/shop/${slug}</loc>`);
  } else {
    expect(body).not.toMatch(/<loc>/);
  }
  expect(body).not.toContain(FIXTURE.soldOut.slug);
  expect(body).not.toContain(FIXTURE.draftSlug);
});
