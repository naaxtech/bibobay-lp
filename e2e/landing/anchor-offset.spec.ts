import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

// Anchors should land just below the sticky header: never under it, never far beneath it.
const MAX_GAP_PX = 32;

/** Pixels between the bottom of the sticky site header and the top of the anchored section. */
function gapBelowHeader(page: Page, id: string) {
  return page.evaluate((target) => {
    const header = document.querySelector("[data-site-header]");
    const section = document.getElementById(target);
    if (!header || !section) throw new Error(`missing header or #${target}`);
    return Math.round(section.getBoundingClientRect().top - header.getBoundingClientRect().bottom);
  }, id);
}

async function expectLandedBelowHeader(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  await expect.poll(() => gapBelowHeader(page, id), { message: `#${id} must clear the sticky header` }).toBeGreaterThanOrEqual(0);
  expect(await gapBelowHeader(page, id)).toBeLessThanOrEqual(MAX_GAP_PX);
  const header = await page.getByRole("banner").boundingBox();
  expect(header?.y, "the header stays pinned to the top").toBe(0);
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`in-page anchors on ${name}`, () => {
    test.use(use);

    test("land just below the sticky header", async ({ page }) => {
      await page.goto("/");

      await page.getByRole("link", { name: "Meet Tula, Bob & Lumi" }).click();
      await expectLandedBelowHeader(page, "characters");

      if (name === "mobile") {
        // The menu needs hydration; on a cold dev server a first tap can land before React does.
        await expect(async () => {
          await page.getByRole("button", { name: "Menu" }).click();
          await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 });
        }).toPass();
      }
      await page.getByRole("link", { name: "Watch", exact: true }).click();
      await expectLandedBelowHeader(page, "episodes");

      await page.goto("/#faq");
      await expectLandedBelowHeader(page, "faq");
    });
  });
}
