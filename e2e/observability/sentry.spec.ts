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
