import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";

import { CONTACT_FORM_COPY } from "@/components/forms/contact-copy";
import { BOT_CHECK_MESSAGES, BOT_CHECK_TOKEN_FIELD, TURNSTILE_ORIGIN } from "@/lib/bot-check/fields";

/*
 * The bot check (Cloudflare Turnstile, R214 to R223) in a real browser.
 *
 * Runs only with E2E_BOT_CHECK=1, against a production build and server started with Cloudflare's
 * published always-pass TEST keys (site key 1x00000000000000000000AA, secret
 * 1x0000000000000000000000000000000AA) and the e2e-contact placeholder environment, so /contact shows
 * its form. The CI job is e2e-bot-check. Test site keys yield the token XXXX.DUMMY.TOKEN.XXXX.
 *
 * Like e2e/leads and e2e/contact (R39): no test sends a form request to the real /api/leads or
 * /api/contact from the browser. Every submit is answered by page.route, and a context guard aborts
 * and fails on any unrouted one. The one test that calls the real contact route uses the request
 * fixture, which the placeholder Supabase cannot answer past the bot check.
 */

const ENABLED = process.env.E2E_BOT_CHECK === "1";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const API_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js`;
const TURNSTILE_HOST = new URL(TURNSTILE_ORIGIN).hostname;

test.skip(!ENABLED, "needs E2E_BOT_CHECK=1 and a server built and started with the Cloudflare Turnstile test keys");

const isFormRoute = (url: URL) => ["/api/contact", "/api/leads"].includes(url.pathname.replace(/\/+$/, ""));
const unrouted = new WeakMap<BrowserContext, string[]>();

test.beforeEach(async ({ context }) => {
  const calls: string[] = [];
  unrouted.set(context, calls);
  await context.route(isFormRoute, async (route) => {
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
  expect(unrouted.get(context), "a form request was not routed by the test (R39)").toEqual([]);
});

const contactForm = (page: Page) => page.getByRole("form", { name: CONTACT_FORM_COPY.formLabel });
const contactName = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.name.label });
const contactEmail = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.email.label });
const contactTopic = (page: Page) => contactForm(page).getByRole("combobox", { name: CONTACT_FORM_COPY.topic.label });
const contactMessage = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.message.label });
const contactSubmit = (page: Page) => contactForm(page).locator('button[type="submit"]');
const contactStatus = (page: Page) => contactForm(page).getByRole("status");

const leadForm = (page: Page) => page.getByRole("form", { name: "Founding-family signup" });
const leadEmail = (page: Page) => leadForm(page).getByRole("textbox", { name: "Email", exact: true });
const leadConsent = (page: Page) => leadForm(page).getByRole("checkbox");
const leadSubmit = (page: Page) => leadForm(page).locator('button[type="submit"]');
const leadStatus = (page: Page) => leadForm(page).getByRole("status");

/*
 * Turnstile draws its iframe inside a closed shadow root, so no CSS locator or querySelector sees it.
 * Playwright's frame tree does list it.
 */
const challengeFrames = (page: Page) => page.frames().filter((frame) => frame.url().startsWith(TURNSTILE_ORIGIN));

const answer = (route: Route, status: number, body: Record<string, unknown>) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

interface TurnstileResponse {
  turnstile?: { getResponse?: () => string | undefined };
}

/** Counts calls to `window.turnstile.reset`, which the forms make after every request that carried a token (R218). */
interface TurnstileProbe {
  turnstile: { reset: (...args: unknown[]) => void };
  __turnstileResets?: number;
}

async function countResets(page: Page) {
  await page.evaluate(() => {
    const probe = window as unknown as TurnstileProbe;
    const original = probe.turnstile.reset.bind(probe.turnstile);
    probe.__turnstileResets = 0;
    probe.turnstile.reset = (...args: unknown[]) => {
      probe.__turnstileResets = (probe.__turnstileResets ?? 0) + 1;
      original(...args);
    };
  });
}

const resetCount = (page: Page) => page.evaluate(() => (window as unknown as TurnstileProbe).__turnstileResets ?? 0);
const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);

/** Call after the intent that loads the widget (R217): waits for its frame, then for the test key's token. */
async function waitForWidget(page: Page) {
  await expect.poll(() => challengeFrames(page).length > 0, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as TurnstileResponse).turnstile?.getResponse?.() ?? null), { timeout: 15_000 }).toBe(DUMMY_TOKEN);
}

test("no Cloudflare request on page view", async ({ page }) => {
  const cloudflare: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === TURNSTILE_HOST) cloudflare.push(request.url());
  });
  for (const path of ["/", "/contact"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
  }
  expect(cloudflare).toEqual([]);
});

test("widget loads on intent with no CSP violation", async ({ page }) => {
  test.setTimeout(60_000);
  const scripts: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(API_SCRIPT)) scripts.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/contact");
  await expect(contactSubmit(page)).toBeEnabled();
  expect(scripts).toEqual([]);

  await contactName(page).focus();
  await waitForWidget(page);
  expect(scripts).toHaveLength(1);

  // Focusing another field must not load or render a second widget.
  await contactEmail(page).focus();
  await page.waitForTimeout(1000);
  expect(scripts).toHaveLength(1);
  expect(challengeFrames(page)).toHaveLength(1);

  expect(await cspViolations(page)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("the check sets no cookie and sends nothing typed to Cloudflare", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  // Recording starts before the first keystroke, so every Cloudflare request from then on is covered,
  // including those made from inside Cloudflare's own frame (Playwright reports them on the page).
  const sentinel = `bibobay-sentinel-${Math.random().toString(36).slice(2, 10)}`;
  const cloudflare: { url: string; postData: string }[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === TURNSTILE_HOST) cloudflare.push({ url: request.url(), postData: request.postData() ?? "" });
  });
  await page.goto("/contact");
  await expect(contactSubmit(page)).toBeEnabled();

  await contactName(page).fill(sentinel);
  await contactMessage(page).fill(`message ${sentinel}`);
  await waitForWidget(page);
  await page.waitForTimeout(1000);

  expect(cloudflare.length).toBeGreaterThan(0);
  expect(cloudflare.filter((entry) => entry.url.includes(sentinel) || entry.postData.includes(sentinel))).toEqual([]);
  expect(await page.context().cookies(baseURL)).toEqual([]);
});

test("contact body carries a fresh token each attempt", async ({ page }) => {
  test.setTimeout(60_000);
  const bodies: Record<string, unknown>[] = [];
  const resetsAtRequest: number[] = [];
  let attempt = 0;
  await page.route("**/api/contact", async (route) => {
    attempt += 1;
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    resetsAtRequest.push(await resetCount(page));
    if (attempt === 1) await answer(route, 429, { ok: false, persisted: false, message: "Too many messages just now." });
    else await answer(route, 200, { ok: true, persisted: true, message: "Message received." });
  });
  await page.goto("/contact");
  await expect(contactSubmit(page)).toBeEnabled();

  await contactName(page).fill("Ada Parent");
  await contactEmail(page).fill("ada@example.com");
  await contactTopic(page).selectOption("press");
  await contactMessage(page).fill("Hello from a parent.");
  await waitForWidget(page);
  await countResets(page);

  await contactSubmit(page).click();
  await expect(contactStatus(page)).toHaveText(CONTACT_FORM_COPY.outcome.rateLimited);
  await expect(contactSubmit(page)).toBeEnabled();
  // The dummy token is always the same string, so the reset count, not the token value, is the proof of a fresh token.
  // The first token was spent by the 429, so the form reset the widget for the retry.
  await expect.poll(() => resetCount(page)).toBe(1);

  await contactSubmit(page).click();
  await expect(contactStatus(page)).toHaveText("Thank you. We have received your message.");
  await expect.poll(() => resetCount(page)).toBe(2);

  expect(bodies).toHaveLength(2);
  for (const body of bodies) expect(body[BOT_CHECK_TOKEN_FIELD]).toBe(DUMMY_TOKEN);
  // The second request left only after the first one's reset, never before it.
  expect(resetsAtRequest).toEqual([0, 1]);
});

test("lead body carries the token", async ({ page }) => {
  test.setTimeout(60_000);
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/leads", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await answer(route, 200, { ok: true, persisted: true, acknowledgementQueued: true, message: "You joined the founding-family list." });
  });
  await page.goto("/#lead");
  await expect(leadSubmit(page)).toBeEnabled();

  await leadEmail(page).fill("parent@example.com");
  await leadConsent(page).check();
  await waitForWidget(page);
  await countResets(page);

  await leadSubmit(page).click();
  await expect(leadStatus(page)).toHaveText("You joined the founding-family list.");
  await expect.poll(() => resetCount(page)).toBe(1);

  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.[BOT_CHECK_TOKEN_FIELD]).toBe(DUMMY_TOKEN);
});

// This test calls Cloudflare's real siteverify with the published test secret (the server verifies
// the dummy token there), so it needs network access. The placeholder Supabase behind the contact
// route cannot store anything, so a request that passes the bot check ends later, at a non-403 status.
test("server refuses without a token", async ({ request }) => {
  const body = { name: "Ada Parent", email: "ada@example.com", topic: "press", message: "Hello from a parent.", website: "" };

  const refused = await request.post("/api/contact", { data: body });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { message: string }).message).toBe(BOT_CHECK_MESSAGES.refused);

  const passed = await request.post("/api/contact", { data: { ...body, [BOT_CHECK_TOKEN_FIELD]: DUMMY_TOKEN } });
  expect(passed.status()).not.toBe(403);
  // Siteverify accepted the token: the answer is neither bot-check message. It ends at the placeholder
  // Supabase limiter, which fails closed with the route's generic 503 text (lib/contact/submit.ts CONTACT_API_MESSAGES.error).
  const message = ((await passed.json()) as { message: string }).message;
  expect(message).not.toBe(BOT_CHECK_MESSAGES.refused);
  expect(message).not.toBe(BOT_CHECK_MESSAGES.unavailable);
  expect(passed.status()).toBe(503);
  expect(message).toBe("The message could not be saved. Please try again.");
});
