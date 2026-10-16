import { createRequire } from "node:module";

import { expect, test, type Page } from "@playwright/test";

import { hydrated } from "../shop/shop-helpers";
import { PERSON_UA, named, storageKeys, watch } from "./support";

/**
 * Ruling R144: visit statistics are opt-in. The consent notice (components/analytics/ConsentNotice.tsx)
 * appears only when PostHog is configured, counts nothing until "yes", and stores only the answer.
 * The keyless part runs everywhere (the CI job runs the whole e2e directory without a PostHog key);
 * the keyed part needs E2E_ANALYTICS=1 and a production build made with a placeholder project key and
 * NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com, as in analytics.spec.ts.
 */
const KEYED = process.env.E2E_ANALYTICS === "1";
const TITLE = "Can we count your visit?";
const ACCEPT = "Yes, count my visit";
const DECLINE = "No, do not count me";

const notice = (page: Page) => page.getByRole("region", { name: TITLE });
const lead = (page: Page) => page.locator("form.lead-form");

/** Marker for "PostHog code is on this page": the installed posthog-js version string, which its bundle carries. */
const POSTHOG_MARKER = (createRequire(import.meta.url)("posthog-js/package.json") as { version: string }).version;

/** Records the body of every script the page loads. `bodies()` waits for the reads still in flight. */
function recordScripts(page: Page) {
  const pending: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script") return;
    pending.push(response.text().catch(() => ""));
  });
  return { bodies: () => Promise.all(pending) };
}

const carriesPostHog = (bodies: string[]) => bodies.some((body) => body.includes(POSTHOG_MARKER));

test.describe("consent notice without a PostHog key", () => {
  test.skip(KEYED, "keyless deployments only; the keyed build is covered below");

  test("shows no notice and no analytics control, and stores nothing", async ({ page }) => {
    await page.goto("/");
    await hydrated(lead(page));
    await expect(page.locator("[data-consent-notice]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Analytics choices" })).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });
});

test.describe("consent notice (opt-in visit statistics)", () => {
  test.skip(!KEYED, "needs a production build with placeholder PostHog values (docs/observability.md)");
  test.use({ viewport: { width: 1440, height: 900 }, userAgent: PERSON_UA });

  test("first visit: the notice asks, and nothing is sent or stored", async ({ page, context }) => {
    const { requests } = await watch(context);
    const scripts = recordScripts(page);
    await page.goto("/");

    const region = notice(page);
    await expect(region).toBeVisible();
    await expect(region.getByRole("heading", { name: TITLE })).toBeVisible();
    await expect(region.getByRole("button", { name: ACCEPT })).toBeVisible();
    await expect(region.getByRole("button", { name: DECLINE })).toBeVisible();
    await expect(region.getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy");

    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    expect(await storageKeys(page)).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    // R152: no PostHog code has even been downloaded.
    expect(carriesPostHog(await scripts.bodies())).toBe(false);
  });

  test("no: nothing is counted, the notice is gone, and it stays gone after a reload", async ({ page, context }) => {
    const { requests } = await watch(context);
    const scripts = recordScripts(page);
    await page.goto("/");
    await notice(page).getByRole("button", { name: DECLINE }).click();

    await expect(notice(page)).toHaveCount(0);
    // Ruling R153: focus moves to the skip link. A mouse answer must not reveal it (`:focus-visible` does
    // not match after a click), so the link stays above the viewport.
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();
    const hiddenBox = await skip.boundingBox();
    expect(hiddenBox, "skip link has a box").not.toBeNull();
    expect(hiddenBox!.y + hiddenBox!.height).toBeLessThanOrEqual(0);
    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    expect(await storageKeys(page)).toEqual(["bibo.analytics.v1"]);

    await page.reload();
    await hydrated(lead(page));
    await expect(page.getByRole("button", { name: "Analytics choices" })).toBeVisible();
    await page.locator("#lead").scrollIntoViewIfNeeded();
    await page.waitForTimeout(4_000);
    await expect(notice(page)).toHaveCount(0);
    expect(requests).toHaveLength(0);
    expect(carriesPostHog(await scripts.bodies())).toBe(false);
  });

  test("yes: the visit is counted, the notice is gone, and it stays gone after a reload", async ({ page, context }) => {
    const { events } = await watch(context);
    const scripts = recordScripts(page);
    await page.goto("/");
    await notice(page).getByRole("button", { name: ACCEPT }).click();

    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(notice(page)).toHaveCount(0);
    // Positive control for the probe in the tests above: after "yes" PostHog's code does arrive.
    expect(carriesPostHog(await scripts.bodies())).toBe(true);

    const before = named(events, "$pageview").length;
    await page.reload();
    await hydrated(lead(page));
    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect(notice(page)).toHaveCount(0);
  });

  test("an answer in one tab removes the notice in another without a reload", async ({ context }) => {
    await watch(context);
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto("/");
    await second.goto("/");
    await expect(notice(first)).toBeVisible();
    await expect(notice(second)).toBeVisible();

    await notice(first).getByRole("button", { name: DECLINE }).click();
    await expect(notice(first)).toHaveCount(0);
    await expect(notice(second)).toHaveCount(0, { timeout: 15_000 });
  });

  test("keyboard: Tab reaches the notice before the header, and Enter on no answers it", async ({ page, context }) => {
    await watch(context);
    await page.goto("/");
    await expect(notice(page)).toBeVisible();

    const accept = notice(page).getByRole("button", { name: ACCEPT });
    let reached = false;
    // The notice is early in the document; at most a skip link may come first.
    for (let presses = 0; presses < 3 && !reached; presses += 1) {
      await page.keyboard.press("Tab");
      const inHeader = await page.evaluate(() => Boolean(document.activeElement?.closest("header")));
      expect(inHeader, "a header link was focused before the notice").toBe(false);
      reached = await accept.evaluate((element) => element === document.activeElement);
    }
    expect(reached, "Yes button not reached within three Tab presses").toBe(true);

    await page.keyboard.press("Tab");
    await expect(notice(page).getByRole("button", { name: DECLINE })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(notice(page)).toHaveCount(0);
    // Ruling R153 with a keyboard answer: the skip link takes focus and is revealed (`:focus-visible` matches).
    const skip = page.locator("a.skip-link");
    await expect(skip).toBeFocused();
    await expect.poll(async () => (await skip.boundingBox())?.y ?? -1, { message: "the skip link slides into view" }).toBeGreaterThanOrEqual(0);
  });

  test("staff pages render no notice", async ({ page, context }) => {
    const { requests } = await watch(context);
    await page.goto("/admin/login");
    await hydrated(page.locator("form.admin-form"));
    // Re-review N4: the notice would appear only on the re-render after hydration, so give the client a
    // "nothing arrives" window before judging its absence.
    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    await expect(page.locator("[data-consent-notice]")).toHaveCount(0);
  });

  test("the footer dialog for an unanswered visitor says statistics are off, and turning them on counts", async ({ page, context }) => {
    const { events } = await watch(context);
    await page.goto("/");
    await expect(notice(page)).toBeVisible();

    await page.getByRole("button", { name: "Analytics choices" }).click();
    const dialog = page.getByRole("dialog", { name: "Analytics choices" });
    await expect(dialog.getByRole("status")).toHaveText("Visit statistics are off for this browser.");
    await dialog.getByRole("button", { name: "Turn statistics on" }).click();

    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(dialog.getByRole("status")).toHaveText("Visit statistics are on for this browser.");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe("consent notice on a phone", () => {
  test.skip(!KEYED, "needs a production build with placeholder PostHog values (docs/observability.md)");
  test.use({ viewport: { width: 390, height: 844 }, userAgent: PERSON_UA });

  test("is readable: both buttons are on screen and it does not cover the header", async ({ page, context }) => {
    await watch(context);
    await page.goto("/");
    const region = notice(page);
    await expect(region).toBeVisible();

    const viewport = page.viewportSize()!;
    for (const name of [ACCEPT, DECLINE]) {
      const box = await region.getByRole("button", { name }).boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, name).toBeGreaterThanOrEqual(0);
      expect(box!.y, name).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height, name).toBeLessThanOrEqual(viewport.height);
    }

    const noticeBox = (await region.boundingBox())!;
    const headerBox = (await page.locator("header").first().boundingBox())!;
    const overlaps =
      noticeBox.x < headerBox.x + headerBox.width &&
      noticeBox.x + noticeBox.width > headerBox.x &&
      noticeBox.y < headerBox.y + headerBox.height &&
      noticeBox.y + noticeBox.height > headerBox.y;
    expect(overlaps, "the notice overlaps the header").toBe(false);
  });
});
