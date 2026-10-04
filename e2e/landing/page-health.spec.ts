import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

for (const { name, use } of VIEWPORTS) {
  test.describe(`landing page health on ${name}`, () => {
    test.use(use);

    test("scrolls end to end with no console errors, failed requests or sideways overflow", async ({ page }) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        // The dev server's own HMR chatter is not the page's business.
        if (message.type() === "error" && !message.text().includes("/_next/hmr")) problems.push(message.text());
      });
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
      });

      await page.goto("/");
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(80);
      }
      // Give link prefetching (which starts as links enter the viewport) time to settle.
      await page.waitForLoadState("networkidle");

      expect(problems).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}
