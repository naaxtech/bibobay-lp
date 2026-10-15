import { expect, test, type Request } from "@playwright/test";

/**
 * Task 10M-a: browser error reports, proven in a browser. Skipped unless E2E_SENTRY=1, and run
 * against a production build made with a placeholder NEXT_PUBLIC_SENTRY_DSN on
 * o0.ingest.example.com. Playwright answers that host itself: no request leaves the machine.
 */
const INGEST = "https://o0.ingest.example.com";
test.skip(process.env.E2E_SENTRY !== "1", "needs a production build with a placeholder Sentry DSN (docs/observability.md)");

/** Sentry envelopes are newline-delimited JSON: a header, then item header / payload pairs. */
function eventsIn(request: Request): Array<Record<string, unknown>> {
  const lines = (request.postData() ?? "").split("\n").filter(Boolean);
  const events: Array<Record<string, unknown>> = [];
  for (let index = 1; index < lines.length - 1; index += 1) {
    const header = JSON.parse(lines[index]!) as { type?: string };
    if (header.type === "event") events.push(JSON.parse(lines[index + 1]!) as Record<string, unknown>);
  }
  return events;
}

/** Every item of every envelope: its type and its payload text. */
function itemsIn(request: Request): Array<{ type: string; text: string }> {
  const lines = (request.postData() ?? "").split("\n").filter(Boolean);
  const items: Array<{ type: string; text: string }> = [];
  for (let index = 1; index < lines.length - 1; index += 2) {
    const header = JSON.parse(lines[index]!) as { type?: string };
    items.push({ type: header.type ?? "", text: lines[index + 1]! });
  }
  return items;
}

// Ruling R86 (Task 7b re-review): SDK 11 streams traces as spans, which no scrubber of ours sees.
// Error reports only: nothing but events (and the SDK's own client reports) may leave the page,
// and no item may carry a private order token, a query value or an email address.
test("sends error reports only, and no item carries a token, a query or an email", async ({ page }) => {
  const TOKEN = "3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2";
  // A Vercel build always has a release (withSentryConfig takes the commit), and only then does the
  // SDK send sessions (re-review 2 N1). This build has none, so give it one, as Vercel would.
  await page.addInitScript(() => {
    (window as unknown as { _sentryRelease: { id: string } })._sentryRelease = { id: "e2e-release" };
  });
  const requests: Request[] = [];
  await page.route(`${INGEST}/**`, async (route) => {
    requests.push(route.request());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/?email=parent%40example.com&utm_source=newsletter");
  await page.waitForTimeout(2_000);
  await page.goto(`/orders/${TOKEN}?qv=QSECRET`);
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("Order page failed");
    }, 0);
  });
  await expect.poll(() => requests.flatMap(eventsIn).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1_000);
  const items = requests.flatMap(itemsIn);
  expect([...new Set(items.map((item) => item.type))].filter((type) => !["event", "client_report"].includes(type))).toEqual([]);
  const text = items.map((item) => item.text).join("\n");
  for (const secret of [TOKEN, "QSECRET", "parent@example.com", "parent%40example.com", "newsletter"]) expect(text, secret).not.toContain(secret);
});

test("reports a browser error without the address's query, any email address or the visitor", async ({ page }) => {
  const requests: Request[] = [];
  await page.route(`${INGEST}/**`, async (route) => {
    requests.push(route.request());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/?email=parent%40example.com&utm_source=newsletter");
  // The SDK loads as its own chunk after start-up; give it a moment, then fail in a later task.
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("Lead for parent@example.com failed");
    }, 0);
  });
  await expect.poll(() => requests.flatMap(eventsIn).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const [event] = requests.flatMap(eventsIn);
  const text = JSON.stringify(event);
  expect(text).toContain("Lead for [email] failed");
  expect(text).not.toContain("parent@example.com");
  expect(text).not.toContain("parent%40example.com");
  expect(text).not.toContain("newsletter");
  expect(event).not.toHaveProperty("user");
  expect((event as { request?: { url?: string } }).request?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
});
