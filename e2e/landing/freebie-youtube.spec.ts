import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// The generator's manifest is the pack's record (lib/content/freebie.ts reads the same file).
const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/content/activity-pack.manifest.json"), "utf8")) as { file: string; bytes: number };
const ACTIVITY_PACK = { fileUrl: manifest.file, bytes: manifest.bytes };

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

const SUBSCRIBE = /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}\?sub_confirmation=1$/;

// R66: the free activity pack is a real file this site serves, offered without a sign-up; and every
// page call to action leads to YouTube, where Bibo Bay is watched (owner directive 2026-10-15).
for (const { name, use } of VIEWPORTS) {
  test.describe(`free activity pack and YouTube calls to action on ${name}`, () => {
    test.use(use);

    test("offers the pack with its real page renders, and the file downloads as the stated PDF", async ({ page }) => {
      await page.goto("/#lead");
      const card = page.locator("#lead [data-freebie]");
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      const pages = card.locator("img");
      await expect(pages).toHaveCount(3);
      await expect.poll(() => pages.evaluateAll((images) => images.filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length)).toBe(0);
      await expect(card.getByText(/^PDF · \d+ pages · [\d.]+ MB$/)).toBeVisible();

      const download = card.getByRole("link", { name: /^Download the free pack/ });
      await expect(download).toHaveAttribute("href", ACTIVITY_PACK.fileUrl);
      // The card sits inside the viewport, not off its edge.
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(use.viewport.width);

      const response = await page.request.get(ACTIVITY_PACK.fileUrl);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      const body = await response.body();
      expect(body.length).toBe(ACTIVITY_PACK.bytes);
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

      if (name === "desktop") {
        const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
        expect(file.suggestedFilename()).toBe("bibo-bay-activity-pack.pdf");
      }
    });

    test("puts the channel's subscribe link in the header, one tap away on every screen", async ({ page }) => {
      await page.goto("/");
      const header = page.getByRole("banner");
      if (name === "desktop") {
        const subscribe = header.getByRole("link", { name: /Subscribe on YouTube/ });
        await expect(subscribe).toBeVisible();
        await expect(subscribe).toHaveAttribute("href", SUBSCRIBE);
        await expect(subscribe).toHaveAttribute("target", "_blank");
        // Logo, three links and the button fit the bar without wrapping.
        const bar = (await header.boundingBox())!;
        expect(bar.height).toBeLessThanOrEqual(96);
      } else {
        await header.getByRole("button", { name: "Menu" }).click();
        const menu = page.getByRole("dialog", { name: "Menu" });
        await expect(menu.getByRole("link", { name: /Subscribe on YouTube/ })).toHaveAttribute("href", SUBSCRIBE);
        await expect(menu.getByRole("link", { name: "Free activity pack" })).toHaveAttribute("href", "#lead");
      }
      for (const id of ["episodes", "finalCta"]) {
        await expect(page.locator(`#${id}`).getByRole("link", { name: /Subscribe on YouTube/ })).toHaveAttribute("href", SUBSCRIBE);
      }
    });
  });
}

test.describe("header at the smallest desktop width", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("keeps the logo, links and subscribe button on one line", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    const subscribe = header.getByRole("link", { name: /Subscribe on YouTube/ });
    await expect(subscribe).toBeVisible();
    const links = header.getByRole("navigation", { name: "Main" }).getByRole("link");
    const tops = await links.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
    const button = (await subscribe.boundingBox())!;
    expect(new Set(tops).size).toBe(1);
    expect(button.x + button.width).toBeLessThanOrEqual(1024);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });
});
