import { expect, test, type Page, type Route } from "@playwright/test";

import { ORDER_COPY, ORDER_STATUS_COPY } from "@/components/forms/order-copy";
import { COMMERCE_ON, ORDER_PAD_KEY, PRICE, VIEWPORTS, guardApisAndStorage, hydrated, tabTo } from "./shop-helpers";

/*
 * Task 7c, commerce on: the order page, the tracking page and a private order link in a real
 * browser. Skipped unless E2E_COMMERCE=1, which the controller sets only against the production
 * build of a scratch copy prepared by scripts/e2e/enable-commerce-fixture.mjs (commerce and
 * tracking on, the fixture catalogue, no Sanity project and no database):
 *
 *   node scripts/e2e/enable-commerce-fixture.mjs <copy>
 *   (in the copy) npm ci && npm run build && npx next start -p 3200
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 E2E_COMMERCE=1 npx playwright test e2e/shop
 *
 * Every /api call is answered here with page.route; the shared guard fails any other. Without a
 * database, /orders/<token> shows its "tracking unavailable" state, which is what it is tested for.
 */

test.skip(!COMMERCE_ON, "needs a server with the commerce fixture (E2E_COMMERCE=1)");
guardApisAndStorage();

const TULA = { id: "fixture-tula-reef-plush", name: "Tula Reef Plush" } as const;
const BOB = { id: "fixture-bob-bath-boat", name: "Bob Bath Boat" } as const;
const REFERENCE = "BB-7F3A-21C9";
const TOKEN = "5e0c7a91d2b84f63a1c9e07b3d58f2a46c1e9b70d3a2f85c4b6e1d09a7c3f258";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONSENT = "I am an adult, and I agree that BIBO Bay may use these details to answer this order request, send me a quote and deliver the order if I go ahead.";
const TRACKED = {
  reference: REFERENCE,
  status: "dispatched",
  submittedAt: "2026-10-14T09:30:00.000Z",
  statusChangedAt: "2026-10-15T16:05:00.000Z",
  lines: [
    { title: "Tula Reef Plush", variant: "Coral", pack: "Single", quantity: 2 },
    { title: "Bob Bath Boat", variant: null, pack: null, quantity: 1 },
  ],
} as const;

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
const stored = (extra: Record<string, unknown> = {}) => ({ ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN, ...extra });
const refused = (message: string, extra: Record<string, unknown> = {}) => ({ ok: false, persisted: false, acknowledgementQueued: false, message, ...extra });

/** Answers POST /api/orders with each answer in turn, recording every body sent. */
async function answerOrders(page: Page, answers: Array<[number, unknown]>) {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/orders", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const [status, body] = answers.shift() ?? [500, refused(ORDER_COPY.outcome.notConfirmed)];
    await json(route, status, body);
  });
  return bodies;
}

/** Adds products on the shop, then follows the header's "Review your order" link (a client-side move). */
async function orderFromShop(page: Page, adds: Array<{ id: string; name: string }> = [TULA, TULA, BOB]) {
  await page.goto("/shop");
  for (const product of adds) {
    const button = page.getByRole("main").getByRole("button", { name: `Add to order: ${product.name}`, exact: true });
    await hydrated(button);
    await button.click();
  }
  await expect.poll(async () => {
    const lines = (await storedPad(page))?.lines ?? [];
    return adds.every((product) => lines.some((line) => line.productId === product.id));
  }).toBe(true);
  await page.locator("header[data-site-header]").getByRole("link", { name: "Review your order" }).click();
  await expect(page).toHaveURL("/order");
  await expect(page.getByRole("heading", { level: 1, name: ORDER_COPY.page.title })).toBeVisible();
}

async function storedPad(page: Page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), ORDER_PAD_KEY);
  return raw === null ? null : (JSON.parse(raw) as { lines: Array<{ productId: string; quantity: number }> });
}

const orderForm = (page: Page) => page.getByRole("form", { name: ORDER_COPY.form.label });

/** Fills a valid order with the pointer (the keyboard test does it key by key). */
async function fillOrder(page: Page) {
  const form = orderForm(page);
  await hydrated(form.getByLabel(ORDER_COPY.form.contactName.label));
  await form.getByLabel(ORDER_COPY.form.contactName.label).fill("Marisol Okafor");
  await form.getByLabel(ORDER_COPY.form.email.label, { exact: true }).fill("parent@example.com");
  await form.getByLabel(ORDER_COPY.form.addressLine1.label, { exact: true }).fill("14 Lagoon Terrace");
  await form.getByLabel(ORDER_COPY.form.city.label).fill("Seaside");
  await form.getByLabel(ORDER_COPY.form.country.label, { exact: true }).selectOption("AU");
  await form.getByRole("checkbox", { name: CONSENT }).check();
}

const submit = (page: Page) => orderForm(page).getByRole("button", { name: ORDER_COPY.form.submit }).click();
const orderStatus = (page: Page) => orderForm(page).getByRole("status");

for (const { name, use } of VIEWPORTS) {
  test.describe(`ordering and tracking while commerce is on, on ${name}`, () => {
    test.use(use);

    test("the order page keeps the pad from the shop, names it from the server and drops what is no longer listed", async ({ page }) => {
      await page.goto("/shop");
      await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ lines: [{ productId: "fixture-gone-product", quantity: 1 }] })), ORDER_PAD_KEY);
      await orderFromShop(page);
      const pad = page.getByRole("region", { name: "Your order" });
      await expect(pad.locator(".order-pad__name")).toHaveText([TULA.name, BOB.name]);
      await expect(pad.locator(".order-pad__line", { hasText: TULA.name }).locator('input[type="number"]')).toHaveValue("2");
      await expect(pad.getByRole("button", { name: `Remove: ${BOB.name}` })).toHaveAccessibleName(`Remove: ${BOB.name}`);
      await expect.poll(async () => (await storedPad(page))?.lines.map((line) => line.productId)).toEqual([TULA.id, BOB.id]);
      const main = page.getByRole("main");
      for (const sentence of ORDER_COPY.page.payment) await expect(main.getByText(sentence)).toBeVisible();
      await expect(main.getByRole("link", { name: "Review your order" })).toHaveCount(0);
      expect(await main.innerText()).not.toMatch(PRICE);
      await expect(orderForm(page)).toHaveAccessibleName(ORDER_COPY.form.label);
      await expect(orderForm(page).getByRole("checkbox", { name: CONSENT })).not.toBeChecked();
      await expect(orderForm(page).getByLabel(ORDER_COPY.form.country.label, { exact: true })).toHaveValue("");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("an empty pad gets an honest empty state with the way back to the shop", async ({ page }) => {
      const response = await page.goto("/order");
      expect(response?.status()).toBe(200);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByText(ORDER_COPY.page.empty)).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: ORDER_COPY.page.backToShop })).toHaveAttribute("href", "/shop");
      await expect(orderForm(page)).toHaveCount(0);
    });

    test("works by keyboard alone; a stored order shows its reference and private link, sends ids and quantities only, and empties the pad", async ({ page }) => {
      const bodies = await answerOrders(page, [[200, stored()]]);
      await orderFromShop(page, [TULA, TULA]);
      const form = orderForm(page);
      const field = (label: string) => form.getByLabel(label, { exact: true });
      await hydrated(field(ORDER_COPY.form.contactName.label));
      for (const [label, text] of [
        [ORDER_COPY.form.contactName.label, "Marisol Okafor"],
        [ORDER_COPY.form.email.label, "parent@example.com"],
        [ORDER_COPY.form.addressLine1.label, "14 Lagoon Terrace"],
        [ORDER_COPY.form.city.label, "Seaside"],
      ] as const) {
        await tabTo(page, field(label));
        await page.keyboard.type(text);
      }
      await tabTo(page, field(ORDER_COPY.form.country.label));
      await page.keyboard.type("Australia");
      await expect(field(ORDER_COPY.form.country.label)).toHaveValue("AU");
      const consent = form.getByRole("checkbox", { name: CONSENT });
      await tabTo(page, consent);
      await page.keyboard.press("Space");
      await expect(consent).toBeChecked();
      const send = form.getByRole("button", { name: ORDER_COPY.form.submit });
      await tabTo(page, send);
      await page.keyboard.press("Enter");

      const heading = page.getByRole("heading", { name: ORDER_COPY.received.title });
      await expect(heading).toBeFocused();
      const main = page.getByRole("main");
      await expect(main.getByText(ORDER_COPY.outcome.received)).toBeVisible();
      await expect(main.getByText(REFERENCE, { exact: true })).toBeVisible();
      await expect(main.getByRole("link", { name: ORDER_COPY.received.privateLink })).toHaveAttribute("href", `/orders/${TOKEN}`);
      await expect(main.getByText(ORDER_COPY.received.privateNote)).toBeVisible();
      await expect(main.getByRole("link", { name: ORDER_COPY.received.trackLink })).toHaveAttribute("href", "/track");
      await expect.poll(() => storedPad(page)).toBeNull();

      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toEqual({
        contactName: "Marisol Okafor",
        email: "parent@example.com",
        addressLine1: "14 Lagoon Terrace",
        city: "Seaside",
        country: "AU",
        consent: true,
        lines: [{ productId: TULA.id, quantity: 2 }],
        submissionKey: expect.stringMatching(UUID),
        website: "",
      });
      // The exact body above already pins every key; on top, no product name and no money field
      // anywhere (the fixture's ids themselves contain "tula-reef", so match the name, not a word).
      expect(JSON.stringify(bodies[0])).not.toContain(TULA.name);
      expect(JSON.stringify(bodies[0])).not.toMatch(/price|amount|currency|subtotal/i);
    });

    test("field problems from the server move focus to the summary, which links each field", async ({ page }) => {
      await answerOrders(page, [[400, refused(ORDER_COPY.outcome.checkDetails, { fieldErrors: { email: "invalid", city: "too_long" } })]]);
      await orderFromShop(page, [BOB]);
      await fillOrder(page);
      await submit(page);
      const summary = orderForm(page).getByRole("group", { name: ORDER_COPY.form.errorSummaryTitle });
      await expect(summary).toBeFocused();
      await expect(summary).toHaveAccessibleName(ORDER_COPY.form.errorSummaryTitle);
      await expect(summary.getByRole("link")).toHaveText([ORDER_COPY.form.errors.email.invalid, ORDER_COPY.form.errors.city.too_long]);
      await summary.getByRole("link", { name: ORDER_COPY.form.errors.city.too_long }).click();
      await expect(orderForm(page).getByLabel(ORDER_COPY.form.city.label)).toBeFocused();
      await expect(orderForm(page).getByLabel(ORDER_COPY.form.email.label, { exact: true })).toHaveAttribute("aria-invalid", "true");
    });

    test("a product that cannot be ordered asks to review the order; a 429 asks to wait; both keep the pad and the form", async ({ page }) => {
      await answerOrders(page, [
        [400, refused(ORDER_COPY.outcome.productsUnavailable)],
        [429, refused(ORDER_COPY.outcome.rateLimited)],
      ]);
      await orderFromShop(page, [TULA]);
      await fillOrder(page);
      await submit(page);
      await expect(orderStatus(page)).toHaveText(ORDER_COPY.outcome.productsUnavailable);
      await submit(page);
      await expect(orderStatus(page)).toHaveText(ORDER_COPY.outcome.rateLimited);
      await expect(orderForm(page).getByLabel(ORDER_COPY.form.contactName.label)).toHaveValue("Marisol Okafor");
      expect((await storedPad(page))?.lines).toEqual([{ productId: TULA.id, quantity: 1 }]);
    });

    test("a retry after a failure sends the same submission key, and a repeat is answered as already received (R81)", async ({ page }) => {
      const bodies = await answerOrders(page, [
        [500, refused(ORDER_COPY.outcome.notConfirmed)],
        [200, { ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceived, reference: REFERENCE }],
      ]);
      await orderFromShop(page, [TULA]);
      await fillOrder(page);
      await submit(page);
      await expect(orderStatus(page)).toHaveText(ORDER_COPY.outcome.notConfirmed);
      await submit(page);
      await expect(page.getByRole("heading", { name: ORDER_COPY.received.title })).toBeFocused();
      expect(bodies).toHaveLength(2);
      expect(bodies[0]?.submissionKey).toMatch(UUID);
      expect(bodies[1]?.submissionKey).toBe(bodies[0]?.submissionKey);
      const main = page.getByRole("main");
      await expect(main.getByText(ORDER_COPY.outcome.alreadyReceived)).toBeVisible();
      await expect(main.getByText(REFERENCE, { exact: true })).toBeVisible();
      await expect(main.getByRole("link", { name: ORDER_COPY.received.privateLink })).toHaveCount(0);
    });

    test("/track shows a found order's status, and one generic line for a miss", async ({ page }) => {
      const answers: Array<[number, unknown]> = [
        [200, { ok: true, order: TRACKED }],
        [404, { ok: false, message: ORDER_COPY.tracking.notFound }],
      ];
      const bodies: unknown[] = [];
      await page.route("**/api/orders/track", async (route) => {
        bodies.push(route.request().postDataJSON());
        const [status, body] = answers.shift()!;
        await json(route, status, body);
      });
      const response = await page.goto("/track");
      expect(response?.status()).toBe(200);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      const form = page.getByRole("form", { name: ORDER_COPY.track.formLabel });
      await hydrated(form.getByLabel(ORDER_COPY.track.reference.label));
      await form.getByLabel(ORDER_COPY.track.reference.label).fill(REFERENCE.toLowerCase());
      await form.getByLabel(ORDER_COPY.track.email.label).fill("parent@example.com");
      await form.getByRole("button", { name: ORDER_COPY.track.submit }).click();

      const view = page.getByRole("region", { name: ORDER_STATUS_COPY.heading(REFERENCE) });
      await expect(view.getByRole("heading", { name: ORDER_STATUS_COPY.heading(REFERENCE) })).toBeFocused();
      await expect(view.getByText(`${ORDER_STATUS_COPY.currentLabel}: ${ORDER_STATUS_COPY.names.dispatched}`)).toBeVisible();
      await expect(view.getByRole("list", { name: ORDER_STATUS_COPY.progressLabel }).getByRole("listitem")).toHaveCount(5);
      await expect(view.locator('[aria-current="step"]')).toHaveText(ORDER_STATUS_COPY.names.dispatched);
      await expect(view.locator("time")).toHaveCount(2);
      await expect(view.locator("time").first()).toHaveAttribute("datetime", TRACKED.submittedAt);
      await expect(view.getByRole("list", { name: ORDER_STATUS_COPY.linesTitle }).getByRole("listitem")).toHaveCount(2);
      expect(await view.innerText()).not.toMatch(/@|Lagoon Terrace/);
      expect(bodies[0]).toEqual({ reference: REFERENCE, email: "parent@example.com" });

      await form.getByRole("button", { name: ORDER_COPY.track.submit }).click();
      await expect(form.getByRole("status")).toHaveText(ORDER_COPY.tracking.notFound);
      await expect(view).toHaveCount(0);
    });

    test("a private order link without a database shows the failure state, and is never kept, indexed or referred", async ({ page }) => {
      const response = await page.goto(`/orders/${TOKEN}`);
      expect(response?.status()).toBe(200);
      const headers = response!.headers();
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("heading", { level: 1, name: ORDER_COPY.orderLink.failureTitle })).toBeVisible();
      await expect(page.getByRole("main").getByText(ORDER_COPY.tracking.failed)).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: ORDER_COPY.orderLink.trackLink })).toHaveAttribute("href", "/track");
      expect(await page.locator("body").innerText()).not.toContain(TOKEN);
    });

    test("a malformed private link is a 404 that never says why", async ({ page }) => {
      const response = await page.goto("/orders/not-a-token");
      expect(response?.status()).toBe(404);
      expect(response!.headers()["referrer-policy"]).toBe("no-referrer");
      await expect(page.getByRole("heading", { level: 1, name: ORDER_COPY.orderLink.notFoundTitle })).toBeVisible();
      await expect(page.getByRole("main").getByText(ORDER_COPY.tracking.notFound)).toBeVisible();
    });

    test("the footer links the tracking page", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("contentinfo").getByRole("link", { name: ORDER_COPY.track.title, exact: true })).toHaveAttribute("href", "/track");
    });
  });
}

test("the sitemap never lists the order or tracking pages", async ({ request }) => {
  const body = await (await request.get("/sitemap.xml")).text();
  expect(body).not.toMatch(/\/(?:order|orders|track)(?:\/|<)/);
});
