import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";

/*
 * The founding-family form in a real browser (Task 5; spec §9, §13).
 *
 * Ruling R39: no test here ever sends a request to the real `/api/leads`. Whatever server the suite
 * runs against (a dev server, a reused one, or PLAYWRIGHT_BASE_URL pointing at a configured
 * preview), a real request could store a lead and send an acknowledgement. Every test that submits
 * serves the route's answer with `page.route`; a context-level guard catches any request a test
 * did not route, aborts it before it leaves the browser, and fails the test. The real route's
 * contract is covered by tests/leads/lead-route.test.ts (vitest, with Supabase and Resend mocked).
 */

// Fixed so the body assertion can name every key the form sends, including the locale.
test.use({ locale: "en-AU" });

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

// Repository fallback copy (lib/content/fallback.ts); the e2e server has no Sanity project.
const SUCCESS = "You joined the founding-family list.";
const ERROR = "We could not save your request. Please try again.";
const BUTTON = "Join the list";
const SUMMARY_TITLE = "Please check the form";

/** The route's exact 503 body while storage is not configured (app/api/leads/route.ts, lib/leads/submit.ts). */
const UNCONFIGURED_503 = { ok: false, persisted: false, acknowledgementQueued: false, message: ERROR };

/** Every key the form may send: adult details, page metadata and the empty honeypot. */
const ALLOWED_BODY_KEYS = ["ageBand", "consent", "email", "firstName", "locale", "source", "utm", "website"];

const leadForm = (page: Page) => page.getByRole("form", { name: "Founding-family signup" });
const emailField = (page: Page) => leadForm(page).getByRole("textbox", { name: "Email", exact: true });
const consentBox = (page: Page) => leadForm(page).getByRole("checkbox");
const submitButton = (page: Page) => leadForm(page).locator('button[type="submit"]');
const statusLine = (page: Page) => leadForm(page).getByRole("status");
/** Found through the accessibility tree: a named group, so its name is announced when it takes focus (review M5). */
const errorSummary = (page: Page) => leadForm(page).getByRole("group", { name: SUMMARY_TITLE });

const isLeadRoute = (url: URL) => url.pathname.replace(/\/+$/, "") === "/api/leads";

/**
 * Ruling R39 guard. Context routes run only when no page route handled the request, so this sees
 * exactly the lead requests a test did not route. It aborts them (nothing reaches any server) and
 * records them for the after-each check.
 */
const unroutedLeadRequests = new WeakMap<BrowserContext, string[]>();

test.beforeEach(async ({ context }) => {
  const unrouted: string[] = [];
  unroutedLeadRequests.set(context, unrouted);
  await context.route(isLeadRoute, async (route) => {
    unrouted.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ context }) => {
  expect(unroutedLeadRequests.get(context), "a lead request was not routed by the test (ruling R39)").toEqual([]);
});

/** Every request the page makes to the lead route. */
function watchLeadRequests(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (isLeadRoute(new URL(request.url()))) requests.push(request);
  });
  return requests;
}

/** Opens the page at the lead section and waits until the form has hydrated (its button enables). */
async function openForm(page: Page) {
  await page.goto("/#lead");
  await expect(submitButton(page)).toBeEnabled();
}

const answer = (route: Route, status: number, body: Record<string, unknown>) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Review M6: once a request completes, keyboard focus is somewhere in the form, never lost to <body>. */
async function expectFocusKept(page: Page) {
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(false);
}

test("the R39 guard aborts an unrouted lead request before it reaches any server", async ({ page, context }) => {
  await page.goto("/#lead");
  const outcome = await page.evaluate(async () => {
    try {
      await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return "reached a server";
    } catch {
      return "aborted";
    }
  });
  expect(outcome).toBe("aborted");
  const unrouted = unroutedLeadRequests.get(context)!;
  expect(unrouted).toEqual([expect.stringMatching(/^POST http:\/\/[^/]+\/api\/leads$/)]);
  // Seen and blocked as intended; clear it so this test's own after-each check passes.
  unrouted.length = 0;
});

for (const { name, use } of VIEWPORTS) {
  test.describe(`founding-family form on ${name}`, () => {
    test.use(use);

    test("loading and scrolling the page never calls the lead route", async ({ page }) => {
      const requests = watchLeadRequests(page);
      await openForm(page);
      await leadForm(page).scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      expect(requests).toEqual([]);
    });

    test("an empty submit lists the problems, focuses the named summary and sends nothing", async ({ page }) => {
      const requests = watchLeadRequests(page);
      await openForm(page);
      await submitButton(page).click();

      const summary = errorSummary(page);
      await expect(summary).toBeFocused();
      await expect(summary).toHaveRole("group");
      await expect(summary).toHaveAccessibleName(SUMMARY_TITLE);
      await expect(summary.getByRole("heading", { name: SUMMARY_TITLE })).toBeVisible();
      await expect(summary.getByRole("link")).toHaveText(["Enter your email.", "Tick the box to agree to BIBO Bay updates."]);
      await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
      await expect(emailField(page)).toHaveAccessibleDescription(/Enter your email\./);
      await expect(consentBox(page)).toHaveAttribute("aria-invalid", "true");

      // Each summary link takes focus to its field.
      await summary.getByRole("link", { name: "Enter your email." }).click();
      await expect(emailField(page)).toBeFocused();
      expect(requests).toEqual([]);
    });

    test("consent is required even with a valid email", async ({ page }) => {
      const requests = watchLeadRequests(page);
      await openForm(page);
      await emailField(page).fill("parent@example.com");
      await submitButton(page).click();

      await expect(errorSummary(page).getByRole("link")).toHaveText(["Tick the box to agree to BIBO Bay updates."]);
      await expect(emailField(page)).not.toHaveAttribute("aria-invalid", "true");
      expect(requests).toEqual([]);
    });

    test("a keyboard-only submission answered with the unconfigured 503 shows the CMS error, never success", async ({ page }) => {
      // The route's exact 503 contract, served here (ruling R39); lead-route.test.ts proves the real route answers it.
      await page.route("**/api/leads", (route) => answer(route, 503, UNCONFIGURED_503));
      await openForm(page);
      await emailField(page).focus();
      await page.keyboard.type("parent@example.com");
      await consentBox(page).focus();
      await page.keyboard.press("Space");
      await expect(consentBox(page)).toBeChecked();

      const response = page.waitForResponse((res) => isLeadRoute(new URL(res.url())));
      await emailField(page).focus();
      await page.keyboard.press("Enter");
      const reply = await response;

      expect(reply.status()).toBe(503);
      expect(await reply.json()).toEqual(UNCONFIGURED_503);
      await expect(statusLine(page)).toHaveText(ERROR);
      await expect(leadForm(page)).not.toContainText(SUCCESS);
      // Nothing was stored, so the details stay for another try, and focus stays where it was (M6).
      await expect(emailField(page)).toHaveValue("parent@example.com");
      await expect(emailField(page)).toBeFocused();
      await expectFocusKept(page);
    });

    test("a 503 that says signups are not open yet shows the API's message, never success (P-I1)", async ({ page }) => {
      // The route's 503 while no removal channel exists (Ruling R125), served here (ruling R39).
      const closed = "Signups are not open yet. Please check back soon.";
      await page.route("**/api/leads", (route) => answer(route, 503, { ok: false, persisted: false, acknowledgementQueued: false, message: closed }));
      await openForm(page);
      await emailField(page).fill("parent@example.com");
      await consentBox(page).check();
      await submitButton(page).click();

      await expect(statusLine(page)).toHaveText(closed);
      await expect(leadForm(page)).not.toContainText(SUCCESS);
      await expect(emailField(page)).toHaveValue("parent@example.com");
    });

    test("shows success only when the server reports the signup stored", async ({ page }) => {
      let reply: Record<string, unknown> = { ok: true, persisted: false, acknowledgementQueued: false, message: SUCCESS };
      const bodies: unknown[] = [];
      await page.route("**/api/leads", async (route) => {
        bodies.push(route.request().postDataJSON());
        await answer(route, 200, reply);
      });
      await openForm(page);

      // A 200 that does not say `persisted: true` is not a success.
      await emailField(page).fill("Parent@Example.com");
      await leadForm(page).getByLabel("Your first name (optional)").fill("Sam");
      await leadForm(page).getByLabel("Child's age range (optional)").selectOption("3-5");
      await consentBox(page).check();
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(ERROR);
      // Review M6: focus comes back to the button, ready for another try.
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);

      reply = { ok: true, persisted: true, acknowledgementQueued: true, message: SUCCESS };
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(SUCCESS);
      await expect(emailField(page)).toHaveValue("");
      await expect(consentBox(page)).not.toBeChecked();
      // Review M6 and Task 5 N4: a focused live region is announced twice, so the live region alone
      // announces the success once and the keyboard user stays on the button.
      await expect(statusLine(page)).not.toBeFocused();
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);

      // Adult details and page metadata only, every key on the allow-list (review M7); the honeypot travels empty.
      const body = bodies[1] as Record<string, unknown>;
      expect(body).toEqual({ email: "Parent@Example.com", firstName: "Sam", ageBand: "3-5", consent: true, source: "landing", locale: "en-AU", website: "" });
      expect(Object.keys(body).filter((key) => !ALLOWED_BODY_KEYS.includes(key))).toEqual([]);
    });

    test("is busy while saving, without the button or the status line changing size", async ({ page }) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/leads", async (route) => {
        await held;
        await answer(route, 429, { ok: false, persisted: false, acknowledgementQueued: false, message: "rate limited" });
      });
      await openForm(page);
      await emailField(page).fill("parent@example.com");
      await consentBox(page).check();

      const box = async () => ({ button: await submitButton(page).boundingBox(), status: await statusLine(page).boundingBox() });
      const before = await box();
      await submitButton(page).click();

      await expect(submitButton(page)).toBeDisabled();
      await expect(submitButton(page)).toHaveAttribute("aria-busy", "true");
      await expect(submitButton(page)).toHaveAccessibleName(BUTTON);
      await expect(statusLine(page)).toHaveText("Saving…");
      const during = await box();
      release();

      await expect(statusLine(page)).toHaveText("There have been several signups from this connection. Please wait a few minutes and try again.");
      await expect(submitButton(page)).toBeEnabled();
      await expect(submitButton(page)).toHaveAccessibleName(BUTTON);
      // Review M6: disabling the focused button dropped focus to <body>; it comes back to the button.
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);
      const after = await box();

      for (const state of [during, after]) {
        expect(state.button?.width).toBeCloseTo(before.button!.width, 0);
        expect(state.button?.height).toBeCloseTo(before.button!.height, 0);
        expect(state.status?.height).toBeCloseTo(before.status!.height, 0);
      }
    });

    test("keeps the honeypot out of reach of keyboard and assistive technology", async ({ page }) => {
      await openForm(page);
      const trap = leadForm(page).locator('input[name="website"]');
      await expect(trap).toHaveAttribute("tabindex", "-1");
      await expect(trap).toHaveValue("");
      await expect(leadForm(page).getByRole("textbox", { name: "Leave this field empty" })).toHaveCount(0);

      // Tabbing through the whole form never lands on it.
      await emailField(page).focus();
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("name"))).not.toBe("website");
      }
    });
  });
}
