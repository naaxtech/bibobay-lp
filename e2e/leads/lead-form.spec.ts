import { expect, test, type Page, type Request, type Route } from "@playwright/test";

/*
 * The founding-family form in a real browser (Task 5; spec §9, §13).
 *
 * The dev server runs without Supabase, so a real submission reaches the real route and gets the
 * truthful 503. The success path cannot be produced without a database, so it is served by
 * `page.route`, which proves the form shows success only for `persisted: true`.
 */

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

// Repository fallback copy (lib/content/fallback.ts); the e2e server has no Sanity project.
const SUCCESS = "You joined the founding-family list.";
const ERROR = "We could not save your request. Please try again.";
const BUTTON = "Join the list";

const leadForm = (page: Page) => page.getByRole("form", { name: "Founding-family signup" });
const emailField = (page: Page) => leadForm(page).getByRole("textbox", { name: "Email", exact: true });
const consentBox = (page: Page) => leadForm(page).getByRole("checkbox");
const submitButton = (page: Page) => leadForm(page).locator('button[type="submit"]');
const statusLine = (page: Page) => leadForm(page).getByRole("status");

/** Every request the page makes to the lead route. */
function watchLeadRequests(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/leads") requests.push(request);
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

    test("an empty submit lists the problems, focuses the summary and sends nothing", async ({ page }) => {
      const requests = watchLeadRequests(page);
      await openForm(page);
      await submitButton(page).click();

      const summary = leadForm(page).locator(".lead-form__summary");
      await expect(summary).toBeFocused();
      await expect(summary.getByRole("heading", { name: "Please check the form" })).toBeVisible();
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

      await expect(leadForm(page).locator(".lead-form__summary").getByRole("link")).toHaveText(["Tick the box to agree to BIBO Bay updates."]);
      await expect(emailField(page)).not.toHaveAttribute("aria-invalid", "true");
      expect(requests).toEqual([]);
    });

    test("a keyboard-only submission without Supabase shows the CMS error, never success", async ({ page }) => {
      await openForm(page);
      await emailField(page).focus();
      await page.keyboard.type("parent@example.com");
      await consentBox(page).focus();
      await page.keyboard.press("Space");
      await expect(consentBox(page)).toBeChecked();

      const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/leads");
      await emailField(page).focus();
      await page.keyboard.press("Enter");
      const reply = await response;

      expect(reply.status()).toBe(503);
      expect(await reply.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ERROR });
      await expect(statusLine(page)).toHaveText(ERROR);
      await expect(leadForm(page)).not.toContainText(SUCCESS);
      // Nothing was stored, so the details stay for another try.
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

      reply = { ok: true, persisted: true, acknowledgementQueued: true, message: SUCCESS };
      await submitButton(page).click();
      await expect(statusLine(page)).toHaveText(SUCCESS);
      await expect(emailField(page)).toHaveValue("");
      await expect(consentBox(page)).not.toBeChecked();

      // Adult details only; the honeypot travels empty.
      expect(bodies[1]).toMatchObject({ email: "Parent@Example.com", firstName: "Sam", ageBand: "3-5", consent: true, source: "landing", website: "" });
      expect(Object.keys(bodies[1] as object).sort()).toEqual(expect.arrayContaining(["ageBand", "consent", "email", "firstName", "source", "website"]));
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
