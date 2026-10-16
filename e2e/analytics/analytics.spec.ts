import { expect, test } from "@playwright/test";

import { hydrated } from "../shop/shop-helpers";
import { PERSON_UA, named, storageKeys, watch } from "./support";

/**
 * Rulings R70 and R144: cookieless visit statistics, opt-in, proven in a browser. Nothing is counted
 * until the visitor accepts the consent notice; the only thing stored on the device is that answer.
 * Skipped unless E2E_ANALYTICS=1, and run against a production build made with a placeholder project
 * key and NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com. Playwright answers that host and YouTube
 * itself: no request leaves the machine. The notice itself is covered in consent.spec.ts.
 */
test.skip(process.env.E2E_ANALYTICS !== "1", "needs a production build with placeholder PostHog values (docs/observability.md)");

test.describe("visit statistics (cookieless PostHog)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, userAgent: PERSON_UA });

  test("counts the visit, where it came from and what the visitor chose, storing only the visitor's answer on the device", async ({ page, context, baseURL }) => {
    const { requests, events } = await watch(context);
    await page.goto("/?utm_source=youtube&utm_medium=video&utm_campaign=launch&gclid=abc123&email=parent%40example.com");
    // R144: nothing is counted until the visitor says yes.
    await page.getByRole("button", { name: "Yes, count my visit" }).click();

    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
    const view = named(events, "$pageview")[0]!;
    expect(view.properties.$current_url).toBe(`${new URL(baseURL!).origin}/?utm_source=youtube&utm_medium=video&utm_campaign=launch`);
    expect(view.properties).toMatchObject({ utm_source: "youtube", utm_medium: "video", utm_campaign: "launch" });
    expect(view.properties).not.toHaveProperty("gclid");
    expect(JSON.stringify(view)).not.toContain("parent");

    const video = page.locator("#episodes [role='tabpanel']:not([inert]) a[href*='youtube.com/watch']");
    const [popup] = await Promise.all([page.waitForEvent("popup"), video.click()]);
    await popup.close();
    // R140: the pack is offered only after a stored signup. Answer the signup as the server would, with a
    // signed link carrying a fake token, then click it: the click is counted by its pathname alone.
    await page.route("**/api/leads", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, persisted: true, acknowledgementQueued: false, message: "You joined the founding-family list.", download: { url: "/api/freebies/download?t=e2e-fake-token", title: "Bibo Bay Activity Pack" } }),
      });
    });
    // The dev/preview server has no signing key, so answer the link here; the click only needs to be harmless.
    await page.route("**/api/freebies/download**", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" }));
    const signup = page.getByRole("form", { name: "Founding-family signup" });
    await signup.scrollIntoViewIfNeeded();
    await expect(signup.locator('button[type="submit"]')).toBeEnabled();
    await signup.getByRole("textbox", { name: "Email", exact: true }).fill("parent@example.com");
    await signup.getByRole("checkbox").check();
    await signup.locator('button[type="submit"]').click();
    const pack = page.locator("#lead-form a[download]");
    await expect(pack).toHaveAccessibleName(/^Download the free pack/);
    await expect(pack).toHaveAttribute("href", "/api/freebies/download?t=e2e-fake-token");
    await pack.click();

    await expect.poll(() => named(events, "youtube_clicked").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => named(events, "freebie_downloaded").length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(named(events, "youtube_clicked")[0]!.properties).toMatchObject({ kind: "video", section: "episodes" });
    expect(named(events, "freebie_downloaded")[0]!.properties).toMatchObject({ file: "/api/freebies/download", section: "lead" });
    // The signed token never reaches analytics.
    expect(JSON.stringify(named(events, "freebie_downloaded"))).not.toContain("e2e-fake-token");
    expect(JSON.stringify(events)).not.toContain("e2e-fake-token");
    await expect.poll(() => named(events, "section_viewed").map((event) => event.properties.section)).toContain("lead");

    // Only ingestion requests: no scripts, flags or remote configuration fetched from PostHog.
    for (const request of requests) expect(request.method(), request.url()).toBe("POST");
    // Cookieless: no cookies, and the only thing in storage is the visitor's own answer.
    expect((await context.cookies()).map((cookie) => cookie.name)).toEqual([]);
    expect(await storageKeys(page)).toEqual(["bibo.analytics.v1"]);
    // Only allow-listed events left the browser.
    const allowed = new Set(["$pageview", "$pageleave", "youtube_clicked", "freebie_downloaded", "cta_clicked", "section_viewed", "tab_selected", "faq_opened", "menu_opened", "lead_submitted"]);
    for (const event of events) expect(allowed.has(event.event), event.event).toBe(true);
  });

  test("a PostHog toolbar link changes nothing on the device (re-review M2)", async ({ page, context }) => {
    const { requests, events } = await watch(context);
    const state = Buffer.from(JSON.stringify({ action: "ph_authorize", token: "phc_PlaceholderKey0123456789abcdefABCDEF" })).toString("base64");
    const hashes = [`#__posthog=${state}`, `#state=${encodeURIComponent(JSON.stringify({ action: "ph_authorize" }))}`];

    // An unanswered visitor: nothing is loaded, so nothing touches the link, the device or the network.
    await page.goto(`/${hashes[0]}`);
    await hydrated(page.locator("form.lead-form"));
    await expect(page.getByRole("region", { name: "Can we count your visit?" })).toBeVisible();
    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    expect(await page.evaluate(() => window.location.hash)).toBe(hashes[0]);
    expect(await storageKeys(page)).toEqual([]);

    // After "yes" PostHog starts and the site removes the toolbar state from the address.
    await page.getByRole("button", { name: "Yes, count my visit" }).click();
    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.location.hash), { timeout: 15_000 }).toBe("");
    expect(await storageKeys(page)).toEqual(["bibo.analytics.v1"]);

    // The answer is now stored: each full load counts, strips the hash and stores nothing more.
    for (const hash of hashes) {
      const sent = events.length;
      // A full load each time: going from "/" to "/#..." alone would only move to an anchor.
      await page.goto("about:blank");
      await page.goto(`/${hash}`);
      await expect.poll(() => named(events.slice(sent), "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.location.hash)).toBe("");
      expect(await storageKeys(page)).toEqual(["bibo.analytics.v1"]);
    }
  });

  test("sends nothing for a browser with Global Privacy Control", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: PERSON_UA });
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    const { requests } = await watch(context);
    const page = await context.newPage();
    await page.goto("/");
    await hydrated(page.locator("form.lead-form"));
    await expect(page.locator("[data-consent-notice]")).toHaveCount(0);
    await page.locator("#lead").scrollIntoViewIfNeeded();
    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    await expect(page.locator("[data-consent-notice]")).toHaveCount(0);
    await context.close();
  });

  test("stops at once, across client-side navigation and after a reload, once the visitor turns statistics off", async ({ page, context }) => {
    const { requests, events } = await watch(context);
    await page.goto("/");
    await page.getByRole("button", { name: "Yes, count my visit" }).click();
    await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Analytics choices" }).click();
    const dialog = page.getByRole("dialog", { name: "Analytics choices" });
    await dialog.getByRole("button", { name: "Turn statistics off" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Visit statistics are off for this browser.");
    await dialog.getByRole("button", { name: "Close" }).click();
    // Let PostHog flush what was captured before the switch, then nothing more may leave.
    await page.waitForTimeout(4_000);
    const sentBefore = events.length;
    // Review C1: PostHog ignores its own opt-out in cookieless mode, so its page view for a
    // client-side navigation must be dropped by the site's before_send.
    await page.locator("footer").getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.waitForTimeout(4_000);
    expect(events.slice(sentBefore).map((event) => event.event)).toEqual([]);
    expect(events.filter((event) => String(event.properties.$current_url ?? "").endsWith("/privacy"))).toEqual([]);
    const before = requests.length;
    await page.goto("/");
    await page.reload();
    await page.locator("#lead").scrollIntoViewIfNeeded();
    await page.waitForTimeout(4_000);
    expect(requests.length).toBe(before);
    expect(await storageKeys(page)).toEqual(["bibo.analytics.v1"]);
  });
});
