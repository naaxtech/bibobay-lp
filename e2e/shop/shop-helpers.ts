import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

/*
 * Shared by the shop's browser tests (Task 7b). Nothing here may reach a real API: a context guard
 * aborts every same-origin /api request a test did not answer with page.route, and the test then
 * fails (the rule the lead-form tests follow, ruling R39).
 */

export const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

/** Set by the controller only against a scratch copy prepared by scripts/e2e/enable-commerce-fixture.mjs. */
export const COMMERCE_ON = process.env.E2E_COMMERCE === "1";

/** lib/orders/constants.ts ORDER_PAD_STORAGE_KEY. */
export const ORDER_PAD_KEY = "orderpad.v1";
/** app/not-found.tsx heading (components/legal/legal-copy.ts NOT_FOUND_COPY.title). */
export const NOT_FOUND_TITLE = "This page is not here";
/** The settings fallback's shop label (lib/content/fallback.ts navigation.commerceLabel); the e2e server has no Sanity project. */
export const SHOP_LABEL = "Shop";

/** Every link to the shop or a product page, wherever it sits. */
export const shopLinks = (page: Page) => page.locator('a[href="/shop"], a[href^="/shop/"], a[href^="/shop?"]');

const unroutedApiCalls = new WeakMap<BrowserContext, string[]>();

/** Installs the API guard and a record of which local-storage keys the page reads. */
export function guardApisAndStorage() {
  test.beforeEach(async ({ context, baseURL }) => {
    const calls: string[] = [];
    unroutedApiCalls.set(context, calls);
    const origin = new URL(baseURL ?? "http://127.0.0.1:3000").origin;
    // Context routes run only for requests no page route answered.
    await context.route(
      (url) => url.origin === origin && url.pathname.startsWith("/api/"),
      async (route) => {
        calls.push(`${route.request().method()} ${route.request().url()}`);
        await route.abort("blockedbyclient");
      },
    );
    await context.addInitScript(() => {
      const reads: string[] = [];
      (window as unknown as { __storageReads?: string[] }).__storageReads = reads;
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (this: Storage, key: string) {
        reads.push(key);
        return getItem.call(this, key);
      };
    });
  });

  test.afterEach(async ({ context }) => {
    expect(unroutedApiCalls.get(context), "an /api request was not answered by the test").toEqual([]);
  });
}

export const storageReads = (page: Page) => page.evaluate(() => (window as unknown as { __storageReads?: string[] }).__storageReads ?? []);

/** Waits until React has hydrated the element (React marks the DOM nodes it owns). */
export async function hydrated(target: Locator) {
  await expect
    .poll(() => target.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber$"))), { message: "the element never hydrated" })
    .toBe(true);
}

/** Presses Tab until the target has focus; fails if it never does. */
export async function tabTo(page: Page, target: Locator, limit = 80) {
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the target in ${limit} presses`);
}

/** A price in any form a shop might print one: a currency sign or code next to a number. */
export const PRICE = /(?:[$€£¥₱]|\b(?:USD|AUD|NZD|EUR|GBP|PHP|SGD)\b)\s?\d/;
