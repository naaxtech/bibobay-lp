import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

// The generator's manifest is the pack's record (lib/content/freebie.ts reads the same file).
const manifest = JSON.parse(readFileSync(join(process.cwd(), "lib/content/activity-pack.manifest.json"), "utf8")) as { file: string };
const ACTIVITY_PACK = { fileUrl: manifest.file };

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

const SUBSCRIBE = /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}\?sub_confirmation=1$/;

// R140 (overrides R66): the free activity pack is a real file served only through a signed route after an email signup; and every
// page call to action leads to YouTube, where Bibo Bay is watched (owner directive 2026-10-15).
for (const { name, use } of VIEWPORTS) {
  test.describe(`free activity pack and YouTube calls to action on ${name}`, () => {
    test.use(use);

    test("locks the pack behind the signup form, with its real page renders and no public file", async ({ page }) => {
      await page.goto("/#lead");
      const card = page.locator("#lead [data-freebie]");
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      const pages = card.locator("img");
      await expect(pages).toHaveCount(3);
      await expect.poll(() => pages.evaluateAll((images) => images.filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length)).toBe(0);
      await expect(card.getByText(/^PDF · \d+ pages · [\d.]+ MB$/)).toBeVisible();

      const unlock = card.getByRole("link", { name: /^Get the free pack/ });
      // Exactly "<label>: <title>": a block-level hidden span makes Chromium insert a space before the colon.
      const title = (await card.getByRole("heading", { level: 3 }).innerText()).trim();
      await expect(unlock).toHaveAccessibleName(`Get the free pack: ${title}`);
      await expect(unlock).toHaveAttribute("href", "#lead-form");
      // R140: the card holds no link to the file; only a signed route serves it.
      await expect(card.locator('a[href$=".pdf"]')).toHaveCount(0);
      // The card sits inside the viewport, not off its edge.
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(use.viewport.width);

      // The file is no longer public, and the signed route refuses anything without a valid token.
      expect((await page.request.get(ACTIVITY_PACK.fileUrl)).status()).toBe(404);
      expect((await page.request.get("/api/freebies/download")).status()).toBe(404);
      expect((await page.request.get("/api/freebies/download?t=abc")).status()).toBe(404);
      // Well-formed (passes the file-name and expiry shape check) but unsigned: the e2e dev server has
      // no LEAD_IP_HASH_SECRET, so the route answers 503 "not open yet"; a malformed token is 404 above.
      const wellFormed = `${Buffer.from(JSON.stringify({ f: ACTIVITY_PACK.fileUrl, e: 4102444800 })).toString("base64url")}.AAAA`;
      // With a signing secret in the spec's environment the shape is valid and the signature is not (404); without one the route is unconfigured (503).
      expect((await page.request.get(`/api/freebies/download?t=${wellFormed}`)).status()).toBe(process.env.LEAD_IP_HASH_SECRET ? 404 : 503);

      if (name === "desktop") {
        await unlock.click();
        await expect(page.locator("#lead-form")).toBeInViewport();
      }
    });

    test("draws YouTube's mark on the same line as each link's words, on the landing and 404 pages", async ({ page }) => {
      for (const path of ["/", "/no-such-page"]) {
        await page.goto(path);
        const misplaced = await page.evaluate(() =>
          Array.from(document.querySelectorAll<SVGElement>("a [data-youtube-mark]")).flatMap((mark) => {
            const link = mark.closest("a")!;
            const box = mark.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return []; // visually hidden labels (phones)
            const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
            const text = walker.nextNode();
            if (!text) return [`${link.href}: no words`];
            const range = document.createRange();
            range.selectNodeContents(text);
            const line = range.getClientRects()[0];
            if (!line) return [];
            const middle = box.top + box.height / 2;
            return middle >= line.top && middle <= line.bottom ? [] : [`${link.textContent?.trim()}: mark at ${Math.round(middle)}, words ${Math.round(line.top)}-${Math.round(line.bottom)}`];
          }),
        );
        expect(misplaced, path).toEqual([]);
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
