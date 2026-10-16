import { expect, test, type Locator } from "@playwright/test";

import { brandTokens } from "@/lib/brand/tokens";

type Rgb = [number, number, number];

const toRgb = (hex: string): Rgb => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as Rgb;

// Minimum share of the logo's opaque pixels each ink must cover once rendered.
const INK_SHARE = {
  teal: 0.05,
  yellow: 0.03,
  orange: 0.05,
  purple: 0.05,
  navy: 0.01,
  paper: 0.15,
} as const satisfies Partial<Record<keyof typeof brandTokens.color, number>>;

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
] as const;

/** Rasterise the rendered logo at device resolution and measure how much of each brand ink survives. */
async function inkShares(logo: Locator): Promise<Record<string, number>> {
  const inks = Object.fromEntries(Object.keys(INK_SHARE).map((name) => [name, toRgb(brandTokens.color[name as keyof typeof INK_SHARE])]));
  return logo.evaluate(async (image: HTMLImageElement, targets: Record<string, Rgb>) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.clientWidth * window.devicePixelRatio);
    canvas.height = Math.round(image.clientHeight * window.devicePixelRatio);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const counts: Record<string, number> = Object.fromEntries(Object.keys(targets).map((name) => [name, 0]));
    let opaque = 0;
    for (let index = 0; index < data.length; index += 4) {
      if ((data[index + 3] ?? 0) < 250) continue;
      opaque += 1;
      for (const [name, [r, g, b]] of Object.entries(targets)) {
        const distance =
          Math.abs((data[index] ?? 0) - r) + Math.abs((data[index + 1] ?? 0) - g) + Math.abs((data[index + 2] ?? 0) - b);
        if (distance < 24) counts[name] = (counts[name] ?? 0) + 1;
      }
    }
    return Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, count / Math.max(opaque, 1)]));
  }, inks);
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`BIBO logo on ${name}`, () => {
    test.use(use);

    test("renders the canonical sticker logo crisply inside the viewport", async ({ page }, testInfo) => {
      await page.goto("/");
      const logo = page.locator("[data-bibo-logo] img").first();
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute("src", "/bibo-logo.svg");
      await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

      const box = await logo.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(use.viewport.width);
      expect(box!.width).toBeGreaterThanOrEqual(120);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const shares = await inkShares(logo);
      for (const [ink, minimum] of Object.entries(INK_SHARE)) {
        expect(shares[ink], `${ink} coverage at ${name}`).toBeGreaterThanOrEqual(minimum);
      }

      const logoShot = testInfo.outputPath(`bibo-logo-${name}.png`);
      const pageShot = testInfo.outputPath(`home-${name}.png`);
      await logo.screenshot({ path: logoShot });
      await page.screenshot({ path: pageShot });
      await testInfo.attach(`bibo-logo-${name}`, { path: logoShot, contentType: "image/png" });
      await testInfo.attach(`home-${name}`, { path: pageShot, contentType: "image/png" });
    });
  });
}

test("collapses brand motion durations when reduced motion is requested", async ({ page }) => {
  // The CSS pipeline may rewrite 320ms as .32s, so compare the time value, not the text.
  const baseDurationMs = async () => {
    const value = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bibo-duration-base").trim(),
    );
    return value.endsWith("ms") ? parseFloat(value) : parseFloat(value) * 1000;
  };
  await page.goto("/");
  expect(await baseDurationMs()).toBe(brandTokens.motion.duration.base);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await baseDurationMs()).toBe(0);
});

test("serves the derived favicon and brand files as SVG", async ({ page, request }) => {
  await page.goto("/");
  const icon = await page.locator('link[rel="icon"]').first().getAttribute("href");
  expect(icon).toMatch(/^\/icon\.svg/);
  for (const path of [icon!, "/bibo-logo.svg", "/brand/bibo-mark.svg", "/brand/bibo-logo-monochrome.svg"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("image/svg+xml");
  }
});
