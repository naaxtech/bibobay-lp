import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

// Ruling R58: the channel's own stills fill every empty art slot, served by this site as pre-sized
// static files (ruling R65), so a reader's browser asks no third party for anything.
for (const { name, use } of VIEWPORTS) {
  test.describe(`channel art on ${name}`, () => {
    test.use(use);

    test("loads every still from this site, sized for the screen, with no third-party request", async ({ page, baseURL }) => {
      const origin = new URL(baseURL!).origin;
      const offsite: string[] = [];
      const broken: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && url.origin !== origin) offsite.push(request.url());
      });
      page.on("response", (response) => {
        if (response.url().includes("/brand/art/") && response.status() !== 200) broken.push(`${response.status()} ${response.url()}`);
      });

      await page.goto("/");
      // Bring every lazy still into view once, then back to the top.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let top = 0; top < height; top += 600) await page.evaluate((y) => window.scrollTo(0, y), top);
      await page.evaluate(() => window.scrollTo(0, 0));

      const stills = page.locator("main img[src^='/brand/art/']");
      expect(await stills.count()).toBeGreaterThan(10);
      const visible = page.locator("main :is(.hero-postcard, .friend-stages, .storybooks, .pillar, .final-bay) img:visible");
      await expect.poll(() => visible.evaluateAll((images) => images.filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length)).toBe(0);

      // The opening still is the largest paint: fetched eagerly, never wider than the screen needs.
      const hero = page.locator(".hero-postcard img");
      await expect(hero).toHaveAttribute("fetchpriority", "high");
      const delivered = await hero.evaluate((image: HTMLImageElement) => image.naturalWidth);
      const shown = await hero.evaluate((image: HTMLImageElement) => image.clientWidth * window.devicePixelRatio);
      expect(delivered).toBeGreaterThanOrEqual(Math.floor(shown * 0.9));
      expect(delivered).toBeLessThanOrEqual(Math.max(shown * 2.6, 828));

      expect(broken).toEqual([]);
      expect(offsite).toEqual([]);
    });

    test("opens a video on YouTube in a new tab from its cover, and nowhere else plays", async ({ page }) => {
      await page.goto("/");
      const player = page.locator("#episodes [role='tabpanel']:not([inert])");
      const watch = player.getByRole("link", { name: /Watch on YouTube/ });
      await expect(watch).toHaveAttribute("href", /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      await expect(watch).toHaveAttribute("target", "_blank");
      await expect(watch).toHaveAttribute("rel", /noopener/);
      expect(await page.locator("iframe, video, audio").count()).toBe(0);
    });
  });
}
