import { gunzipSync } from "node:zlib";

import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";

/**
 * Ruling R70: cookieless visit statistics, proven in a browser. Skipped unless E2E_ANALYTICS=1, and
 * run against a production build made with a placeholder project key and
 * NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com. Playwright answers that host and YouTube itself:
 * no request leaves the machine.
 */
const HOST = "https://ph.example.com";
test.skip(process.env.E2E_ANALYTICS !== "1", "needs a production build with placeholder PostHog values (docs/observability.md)");

interface SentEvent {
  event: string;
  properties: Record<string, unknown>;
}

/** PostHog posts JSON, gzip (compression=gzip-js) or base64 form data; read whichever it sent. */
function eventsIn(request: Request): SentEvent[] {
  const url = new URL(request.url());
  const raw = request.postDataBuffer();
  if (!raw) return [];
  let text: string;
  if (url.searchParams.get("compression") === "gzip-js" || (raw[0] === 0x1f && raw[1] === 0x8b)) text = gunzipSync(raw).toString("utf8");
  else {
    text = raw.toString("utf8");
    if (text.startsWith("data=")) text = Buffer.from(decodeURIComponent(text.slice(5)), "base64").toString("utf8");
  }
  const body = JSON.parse(text) as unknown;
  const list = Array.isArray(body) ? body : (body as { batch?: unknown[] }).batch ?? [body];
  return list as SentEvent[];
}

/**
 * PostHog drops events from automated browsers (navigator.webdriver, "HeadlessChrome"): bots are
 * not counted. These tests stand in for a person's browser so the events are sent.
 */
const PERSON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function watch(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ brands: [{ brand: "Chromium", version: "140" }, { brand: "Google Chrome", version: "140" }], mobile: false, platform: "Windows" }) });
  });
  const requests: Request[] = [];
  const events: SentEvent[] = [];
  await context.route(`${HOST}/**`, async (route) => {
    requests.push(route.request());
    if (route.request().method() === "POST") events.push(...eventsIn(route.request()));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: 1 }) });
  });
  await context.route(/^https:\/\/(www\.)?youtube\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube</title>" }));
  return { requests, events };
}

const named = (events: SentEvent[], name: string) => events.filter((event) => event.event === name);

async function storageKeys(page: Page) {
  return page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
}

test.describe("visit statistics (cookieless PostHog)", () => {
  test.use({ viewport: { width: 1440, height: 900 }, userAgent: PERSON_UA });

  test("counts the visit, where it came from and what the visitor chose, storing nothing on the device", async ({ page, context, baseURL }) => {
    const { requests, events } = await watch(context);
    await page.goto("/?utm_source=youtube&utm_medium=video&utm_campaign=launch&gclid=abc123&email=parent%40example.com");

    await expect.poll(() => named(events, "$pageview").length, { timeout: 15_000 }).toBeGreaterThan(0);
    const view = named(events, "$pageview")[0]!;
    expect(view.properties.$current_url).toBe(`${new URL(baseURL!).origin}/?utm_source=youtube&utm_medium=video&utm_campaign=launch`);
    expect(view.properties).toMatchObject({ utm_source: "youtube", utm_medium: "video", utm_campaign: "launch" });
    expect(view.properties).not.toHaveProperty("gclid");
    expect(JSON.stringify(view)).not.toContain("parent");

    const video = page.locator("#episodes [role='tabpanel']:not([inert]) a[href*='youtube.com/watch']");
    const [popup] = await Promise.all([page.waitForEvent("popup"), video.click()]);
    await popup.close();
    const pack = page.locator("#lead [data-freebie] a[download]");
    await pack.scrollIntoViewIfNeeded();
    await Promise.all([page.waitForEvent("download"), pack.click()]);

    await expect.poll(() => named(events, "youtube_clicked").length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => named(events, "freebie_downloaded").length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(named(events, "youtube_clicked")[0]!.properties).toMatchObject({ kind: "video", section: "episodes" });
    expect(named(events, "freebie_downloaded")[0]!.properties).toMatchObject({ file: "/freebies/bibo-bay-activity-pack.pdf", section: "lead" });
    await expect.poll(() => named(events, "section_viewed").map((event) => event.properties.section)).toContain("lead");

    // Only ingestion requests: no scripts, flags or remote configuration fetched from PostHog.
    for (const request of requests) expect(request.method(), request.url()).toBe("POST");
    // Cookieless: nothing in cookies or storage.
    expect((await context.cookies()).map((cookie) => cookie.name)).toEqual([]);
    expect(await storageKeys(page)).toEqual([]);
    // Only allow-listed events left the browser.
    const allowed = new Set(["$pageview", "$pageleave", "youtube_clicked", "freebie_downloaded", "cta_clicked", "section_viewed", "tab_selected", "faq_opened", "menu_opened", "lead_submitted"]);
    for (const event of events) expect(allowed.has(event.event), event.event).toBe(true);
  });

  test("sends nothing for a browser with Global Privacy Control", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: PERSON_UA });
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }));
    const { requests } = await watch(context);
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("#lead").scrollIntoViewIfNeeded();
    await page.waitForTimeout(4_000);
    expect(requests).toHaveLength(0);
    await context.close();
  });

  test("stops at once, across client-side navigation and after a reload, once the visitor turns statistics off", async ({ page, context }) => {
    const { requests, events } = await watch(context);
    await page.goto("/");
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
