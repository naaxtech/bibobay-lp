import { gunzipSync } from "node:zlib";

import type { BrowserContext, Page, Request } from "@playwright/test";

/** Shared by analytics.spec.ts and consent.spec.ts. Playwright answers this host itself: no request leaves the machine. */
export const HOST = "https://ph.example.com";

export interface SentEvent {
  event: string;
  properties: Record<string, unknown>;
}

/** PostHog posts JSON, gzip (compression=gzip-js) or base64 form data; read whichever it sent. */
export function eventsIn(request: Request): SentEvent[] {
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
export const PERSON_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function watch(context: BrowserContext) {
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

export const named = (events: SentEvent[], name: string) => events.filter((event) => event.event === name);

export async function storageKeys(page: Page) {
  return page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
}
