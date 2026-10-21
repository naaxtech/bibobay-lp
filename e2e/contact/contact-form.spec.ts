import { expect, test, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";

import { CONTACT_FORM_COPY } from "@/components/forms/contact-copy";

/*
 * The contact page and form in a real browser (R158, R161, R167).
 *
 * Like e2e/leads (ruling R39): no test here ever sends a request to the real `/api/contact`.
 * Whatever server the suite runs against, a real request could store a message and send a staff
 * alert. Every test that submits serves the route's answer with `page.route`; a context-level guard
 * catches any request a test did not route, aborts it before it leaves the browser, and fails the
 * test. The real route's contract is covered by tests/contact/contact-route.test.ts (vitest).
 *
 * Two modes. Keyless (the default): the server has no Supabase or Resend settings, so /contact
 * shows the closed notice. With E2E_CONTACT_OPEN=1 the server was started with the placeholder
 * service environment (Supabase URL, service key, hash secret, Resend key and sender, staff
 * address), so the form is open; those tests are skipped otherwise. Only this directory runs
 * against such a server: the placeholders reach nothing real.
 */

const CONTACT_OPEN = process.env.E2E_CONTACT_OPEN === "1";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

// The CMS copy is the repository fallback's (lib/content/fallback.ts; the e2e server has no Sanity
// project). It stays literal here because that module imports a JSON manifest, which the specs read
// from disk rather than import. The form's chrome is imported from the code that renders it (R184).
const SUCCESS = "Thank you. We have received your message.";
const ERROR = "We could not save your message. Please try again.";
const CLOSED = "The contact form is not open yet, so no message can be saved from this page. Please check back soon.";
const HEADING = "Contact us";
const BUTTON = "Send message";
const FOOTER_LINK = "Contact us";
const { errorSummaryTitle: SUMMARY_TITLE, sending: SENDING, outcome: { rateLimited: RATE_LIMITED }, errors } = CONTACT_FORM_COPY;

/** Every key the form sends: the four fields and the empty honeypot. */
const BODY_KEYS = ["email", "message", "name", "topic", "website"];

const contactForm = (page: Page) => page.getByRole("form", { name: CONTACT_FORM_COPY.formLabel });
const nameField = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.name.label });
const emailField = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.email.label });
const topicField = (page: Page) => contactForm(page).getByRole("combobox", { name: CONTACT_FORM_COPY.topic.label });
const messageField = (page: Page) => contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.message.label });
const submitButton = (page: Page) => contactForm(page).locator('button[type="submit"]');
/** The consent notice has its own status line, so this is found inside the form only. */
const statusLine = (page: Page) => contactForm(page).getByRole("status");
const errorSummary = (page: Page) => contactForm(page).getByRole("group", { name: SUMMARY_TITLE });
const footerContactLink = (page: Page) => page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: FOOTER_LINK });

const isContactRoute = (url: URL) => url.pathname.replace(/\/+$/, "") === "/api/contact";

/**
 * The R39 guard. Context routes run only when no page route handled the request, so this sees
 * exactly the contact requests a test did not route. It aborts them (nothing reaches any server)
 * and records them for the after-each check.
 */
const unroutedRequests = new WeakMap<BrowserContext, string[]>();

test.beforeEach(async ({ context }) => {
  const unrouted: string[] = [];
  unroutedRequests.set(context, unrouted);
  await context.route(isContactRoute, async (route) => {
    unrouted.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ context }) => {
  expect(unroutedRequests.get(context), "a contact request was not routed by the test (R39, R167)").toEqual([]);
});

/** Every request the page makes to the contact route. */
function watchContactRequests(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (isContactRoute(new URL(request.url()))) requests.push(request);
  });
  return requests;
}

/** Opens /contact and waits until the form has hydrated (its button enables). */
async function openForm(page: Page) {
  await page.goto("/contact");
  await expect(submitButton(page)).toBeEnabled();
}

const answer = (route: Route, status: number, body: Record<string, unknown>) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fillValid(page: Page) {
  await nameField(page).fill("  Ada Parent ");
  await emailField(page).fill(" Ada@Example.com ");
  await topicField(page).selectOption("press");
  await messageField(page).fill("Hello from a parent.\r\nA second line.  ");
}

/** Once a request completes, keyboard focus is somewhere in the form, never lost to <body>. */
async function expectFocusKept(page: Page) {
  expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(false);
}

test.describe("keyless: the form is closed", () => {
  test.skip(CONTACT_OPEN, "this server has the contact form open");

  test("/contact shows the closed notice, no form and no Contact us footer link", async ({ page }) => {
    await page.goto("/contact");
    await expect(page.getByRole("heading", { level: 1, name: HEADING })).toBeVisible();
    await expect(page.getByText(CLOSED)).toBeVisible();
    await expect(page.getByRole("form", { name: CONTACT_FORM_COPY.formLabel })).toHaveCount(0);
    await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
    await expect(footerContactLink(page)).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("loading /contact never calls /api/contact", async ({ page }) => {
    const requests = watchContactRequests(page);
    await page.goto("/contact");
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual([]);
  });

  test("the home page has no Contact us footer link either", async ({ page }) => {
    await page.goto("/");
    await expect(footerContactLink(page)).toHaveCount(0);
  });
});

test("the R39 guard aborts an unrouted contact request before it reaches any server", async ({ page, context }) => {
  await page.goto("/contact");
  const outcome = await page.evaluate(async () => {
    try {
      await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return "reached a server";
    } catch {
      return "aborted";
    }
  });
  expect(outcome).toBe("aborted");
  const unrouted = unroutedRequests.get(context)!;
  expect(unrouted).toEqual([expect.stringMatching(/^POST http:\/\/[^/]+\/api\/contact$/)]);
  // Seen and blocked as intended; clear it so this test's own after-each check passes.
  unrouted.length = 0;
});

for (const { name, use } of VIEWPORTS) {
  test.describe(`contact form on ${name}`, () => {
    test.skip(!CONTACT_OPEN, "needs E2E_CONTACT_OPEN=1 and a server started with the placeholder service environment");
    test.use(use);

    test("has labelled fields, the privacy link under the button and exactly one role=status", async ({ page }) => {
      await openForm(page);
      await expect(page.getByRole("heading", { level: 1, name: HEADING })).toBeVisible();
      for (const field of [nameField(page), emailField(page), topicField(page), messageField(page)]) await expect(field).toBeVisible();
      await expect(emailField(page)).toHaveAttribute("type", "email");
      await expect(emailField(page)).toHaveAccessibleDescription(CONTACT_FORM_COPY.email.hint);
      await expect(contactForm(page).getByRole("status")).toHaveCount(1);
      await expect(contactForm(page).locator('[role="status"]')).toHaveCount(1);

      const privacy = contactForm(page).getByRole("link", { name: CONTACT_FORM_COPY.privacyLink });
      await expect(privacy).toHaveAttribute("href", "/privacy");
      const button = await submitButton(page).boundingBox();
      const link = await privacy.boundingBox();
      expect(link!.y).toBeGreaterThan(button!.y + button!.height - 1);
    });

    test("an empty submit lists the problems, focuses the named summary and sends nothing", async ({ page }) => {
      const requests = watchContactRequests(page);
      await openForm(page);
      await submitButton(page).click();

      const summary = errorSummary(page);
      await expect(summary).toBeFocused();
      await expect(summary).toHaveAccessibleName(SUMMARY_TITLE);
      await expect(summary.getByRole("link")).toHaveText([errors.name.required, errors.email.required, errors.topic.required, errors.message.required]);
      await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
      await expect(messageField(page)).toHaveAccessibleDescription(/Write your message\./);

      await summary.getByRole("link", { name: errors.email.required }).click();
      await expect(emailField(page)).toBeFocused();
      expect(requests).toEqual([]);
    });

    test("shows success only for a routed 200 persisted answer, and the form clears", async ({ page }) => {
      let reply: Record<string, unknown> = { ok: true, persisted: false, message: "Message received." };
      await page.route("**/api/contact", (route) => answer(route, 200, reply));
      await openForm(page);
      await fillValid(page);

      // A 200 that does not say `persisted: true` is not a success.
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(ERROR);
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);

      reply = { ok: true, persisted: true, message: "Message received." };
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(SUCCESS);
      await expect(nameField(page)).toHaveValue("");
      await expect(emailField(page)).toHaveValue("");
      await expect(messageField(page)).toHaveValue("");
      // The live region alone announces the outcome once; the keyboard user stays on the button.
      await expect(statusLine(page)).not.toBeFocused();
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);
    });

    test("a routed 503 closed answer shows the CMS closed message", async ({ page }) => {
      await page.route("**/api/contact", (route) => answer(route, 503, { ok: false, persisted: false, closed: true, message: "The contact form is not open, so nothing was saved." }));
      await openForm(page);
      await fillValid(page);
      await submitButton(page).click();

      await expect(statusLine(page)).toHaveText(CLOSED);
      await expect(contactForm(page)).not.toContainText(SUCCESS);
      await expect(nameField(page)).toHaveValue("  Ada Parent ");
    });

    test("routed 429 and 500 answers show their copy, never success", async ({ page }) => {
      let next: { status: number; body: Record<string, unknown> } = { status: 429, body: { ok: false, persisted: false, message: "Too many messages just now." } };
      await page.route("**/api/contact", (route) => answer(route, next.status, next.body));
      await openForm(page);
      await fillValid(page);

      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(RATE_LIMITED);
      await expect(contactForm(page)).not.toContainText(SUCCESS);

      next = { status: 500, body: { ok: false, persisted: false, message: "The message could not be saved. Please try again." } };
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(ERROR);
      await expect(contactForm(page)).not.toContainText(SUCCESS);
      await expect(messageField(page)).not.toHaveValue("");
    });

    test("is busy while saving, with no change in the button's or the status line's size", async ({ page }) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const requests: string[] = [];
      await page.route("**/api/contact", async (route) => {
        requests.push(route.request().method());
        await held;
        await answer(route, 429, { ok: false, persisted: false, message: "Too many messages just now." });
      });
      await openForm(page);
      await fillValid(page);

      const box = async () => ({ button: await submitButton(page).boundingBox(), status: await statusLine(page).boundingBox() });
      const before = await box();
      await submitButton(page).click();

      await expect(submitButton(page)).toBeDisabled();
      await expect(submitButton(page)).toHaveAttribute("aria-busy", "true");
      await expect(submitButton(page)).toHaveAccessibleName(BUTTON);
      await expect(statusLine(page)).toHaveText(SENDING);
      const during = await box();
      expect(requests).toEqual(["POST"]);
      release();

      await expect(statusLine(page)).toHaveText(RATE_LIMITED);
      await expect(submitButton(page)).toBeEnabled();
      await expect(submitButton(page)).toBeFocused();
      const after = await box();

      for (const state of [during, after]) {
        expect(state.button?.width).toBeCloseTo(before.button!.width, 0);
        expect(state.button?.height).toBeCloseTo(before.button!.height, 0);
        expect(state.status?.height).toBeCloseTo(before.status!.height, 0);
      }
    });

    test("sends exactly name, email, topic, message and website", async ({ page }) => {
      const bodies: unknown[] = [];
      await page.route("**/api/contact", async (route) => {
        bodies.push(route.request().postDataJSON());
        await answer(route, 200, { ok: true, persisted: true, message: "Message received." });
      });
      await openForm(page);
      await fillValid(page);
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(SUCCESS);

      expect(bodies).toHaveLength(1);
      const body = bodies[0] as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(BODY_KEYS);
      expect(body).toEqual({ name: "Ada Parent", email: "ada@example.com", topic: "press", message: "Hello from a parent.\nA second line.", website: "" });
    });

    test("a keyboard-only submission works", async ({ page }) => {
      const bodies: unknown[] = [];
      await page.route("**/api/contact", async (route) => {
        bodies.push(route.request().postDataJSON());
        await answer(route, 200, { ok: true, persisted: true, message: "Message received." });
      });
      await openForm(page);
      await nameField(page).focus();
      await page.keyboard.type("Ada Parent");
      await page.keyboard.press("Tab");
      await page.keyboard.type("ada@example.com");
      await page.keyboard.press("Tab");
      await expect(topicField(page)).toBeFocused();
      await page.keyboard.type("Press");
      await expect(topicField(page)).toHaveValue("press");
      await page.keyboard.press("Tab");
      await page.keyboard.type("Hello from a parent.");
      await page.keyboard.press("Tab");
      await expect(submitButton(page)).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(statusLine(page)).toHaveText(SUCCESS);
      expect(bodies).toHaveLength(1);
      await expect(submitButton(page)).toBeFocused();
      await expectFocusKept(page);
    });

    test("keeps the honeypot out of reach of keyboard and assistive technology", async ({ page }) => {
      await openForm(page);
      const trap = contactForm(page).locator('input[name="website"]');
      await expect(trap).toHaveAttribute("tabindex", "-1");
      await expect(trap).toHaveValue("");
      await expect(contactForm(page).getByRole("textbox", { name: CONTACT_FORM_COPY.honeypotLabel })).toHaveCount(0);

      await nameField(page).focus();
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("name"))).not.toBe("website");
      }
    });

    test("the footer on / and /privacy links to /contact", async ({ page }) => {
      for (const path of ["/", "/privacy"]) {
        await page.goto(path);
        await expect(footerContactLink(page)).toHaveAttribute("href", "/contact");
      }
      await page.goto("/contact");
      await expect(footerContactLink(page)).toHaveAttribute("href", "/contact");
    });
  });
}
