import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

/*
 * Task 12 (local pass), spec §16 "Desktop 1440x900, tablet, and mobile 390x844" and "Navigation
 * anchors and mobile menu". Three viewports, one landing page: no sideways overflow at rest or
 * after scrolling, the first screen carries the headline and the primary call to action, the
 * navigation works the way that width promises (inline links at desktop, the Menu dialog below it),
 * and every section the page renders can be reached and seen. e2e/landing/page-health.spec.ts
 * covers console and network health at 390 and 1440; interactions and anchor-offset cover the
 * selectors and where an anchor lands, so none of that is repeated here.
 *
 * One full-page screenshot per viewport is written as evidence under SHOTS_DIR (ruling R118): they
 * are listed in the QA report by file name, never committed, never compared against a baseline.
 */

const SHOTS_DIR = process.env.QA_SCREENSHOT_DIR ?? path.join(tmpdir(), "bibobay-qa-screenshots");

const VIEWPORTS = [
  { name: "desktop", file: "landing-desktop-1440x900.png", use: { viewport: { width: 1440, height: 900 } }, inlineNav: true },
  { name: "tablet", file: "landing-tablet-820x1180.png", use: { viewport: { width: 820, height: 1180 }, hasTouch: true }, inlineNav: false },
  { name: "mobile", file: "landing-mobile-390x844.png", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, inlineNav: false },
] as const;

/** Console errors and uncaught exceptions. */
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/hmr")) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

/** Opens the landing page once React has hydrated and the motion layer has chosen. */
async function openLanding(page: Page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", /^(full|reduced)$/);
}

const overflowOf = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const { name, file, use, inlineNav } of VIEWPORTS) {
  test.describe(`the landing page at ${name} (${use.viewport.width}x${use.viewport.height})`, () => {
    test.use(use);

    test("has no sideways overflow at rest, after a full scroll, or with the menu open", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      expect(await overflowOf(page), "at rest").toBeLessThanOrEqual(0);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) {
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(40);
      }
      expect(await overflowOf(page), "after scrolling the whole page").toBeLessThanOrEqual(0);
      if (!inlineNav) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
        expect(await overflowOf(page), "with the menu open").toBeLessThanOrEqual(0);
      }
      expect(problems).toEqual([]);
    });

    test("shows the headline and the primary call to action on the first screen, unclipped", async ({ page }) => {
      await openLanding(page);
      const viewport = page.viewportSize()!;
      const headline = page.getByRole("heading", { level: 1 });
      const cta = page.locator("#hero").getByRole("link", { name: /Watch on YouTube/ });
      for (const [label, target] of [
        ["headline", headline],
        ["primary call to action", cta],
      ] as const) {
        await expect(target, label).toBeVisible();
        const box = await target.boundingBox();
        expect(box, `${label} is laid out`).not.toBeNull();
        expect(box!.y, `${label} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height, `${label} ends inside the first viewport`).toBeLessThanOrEqual(viewport.height);
        expect(box!.x, `${label} is not clipped on the left`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${label} is not clipped on the right`).toBeLessThanOrEqual(viewport.width);
      }
      // The sticky header does not cover either.
      const header = (await page.getByRole("banner").boundingBox())!;
      expect((await headline.boundingBox())!.y, "headline clears the sticky header").toBeGreaterThanOrEqual(header.y + header.height);
    });

    if (inlineNav) {
      test("shows the section links inline, with no Menu button, and each link lands on its section", async ({ page }) => {
        await openLanding(page);
        await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
        const nav = page.getByRole("navigation", { name: "Main" });
        await expect(nav).toBeVisible();
        for (const [label, id] of [
          ["Meet the friends", "characters"],
          ["Watch", "episodes"],
          ["Free activity pack", "lead"],
        ] as const) {
          await nav.getByRole("link", { name: label, exact: true }).click();
          await expect(page).toHaveURL(new RegExp(`#${id}$`));
          await expect(page.locator(`section#${id}`)).toBeInViewport();
        }
      });
    } else {
      test("offers the Menu button instead of inline links; the menu opens, lists the sections, and each link works", async ({ page }) => {
        await openLanding(page);
        await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
        const button = page.getByRole("button", { name: "Menu" });
        for (const [label, id] of [
          ["Meet the friends", "characters"],
          ["Watch", "episodes"],
          ["Free activity pack", "lead"],
        ] as const) {
          // Opening needs hydration; a first tap can land before React does.
          await expect(async () => {
            await button.click();
            await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 });
          }).toPass();
          const dialog = page.getByRole("dialog", { name: "Menu" });
          await dialog.getByRole("link", { name: label, exact: true }).click();
          await expect(dialog).toBeHidden();
          await expect(page).toHaveURL(new RegExp(`#${id}$`));
          await expect(page.locator(`section#${id}`)).toBeInViewport();
          await expect(button).toHaveAttribute("aria-expanded", "false");
        }
      });

      test("closes the menu from its own close control and gives the page back", async ({ page }) => {
        await openLanding(page);
        const button = page.getByRole("button", { name: "Menu" });
        await expect(async () => {
          await button.click();
          await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 });
        }).toPass();
        const dialog = page.getByRole("dialog", { name: "Menu" });
        await dialog.getByRole("button", { name: /close/i }).click();
        await expect(dialog).toBeHidden();
        await expect(button).toBeFocused();
        // The page scrolls again and is no longer inert.
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
        await expect(page.locator("main")).not.toHaveAttribute("inert", "");
      });
    }

    test("lets every rendered section be reached and seen, in the order the page lists them", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      const ids = await page.locator("main > section[data-section]").evaluateAll((sections) => sections.map((section) => section.id));
      // The fallback content renders eleven sections (testimonials stay hidden until verified).
      expect(ids).toEqual(["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "lead", "faq", "finalCta"]);
      let previousTop = -Infinity;
      for (const id of ids) {
        const section = page.locator(`section#${id}`);
        await section.scrollIntoViewIfNeeded();
        await expect(section, id).toBeInViewport();
        const box = (await section.boundingBox())!;
        expect(box.height, `${id} has height`).toBeGreaterThan(40);
        expect(box.width, `${id} fills the width`).toBeGreaterThan(page.viewportSize()!.width * 0.9);
        const top = await section.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
        expect(top, `${id} follows the previous section`).toBeGreaterThanOrEqual(previousTop);
        previousTop = top;
        const heading = section.locator("h1, h2").first();
        await expect(heading, `${id} has a visible heading`).toBeVisible();
        expect((await heading.textContent())?.trim().length ?? 0, `${id} heading text`).toBeGreaterThan(2);
      }
      // The footer closes the page and is reachable last.
      await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
      await expect(page.getByRole("contentinfo")).toBeInViewport();
      expect(problems).toEqual([]);
    });

    test("keeps text readable: no body text below 14px and no element wider than its section", async ({ page }) => {
      await openLanding(page);
      const report = await page.evaluate(() => {
        const small: string[] = [];
        const wide: string[] = [];
        const limit = document.documentElement.clientWidth;
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("main p, main li, main summary, main label"))) {
          if (!element.textContent?.trim() || element.closest("[hidden], [inert], .sr-only")) continue;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") continue;
          if (parseFloat(style.fontSize) < 14) small.push(`${element.tagName.toLowerCase()} ${parseFloat(style.fontSize)}px "${element.textContent.trim().slice(0, 30)}"`);
        }
        for (const section of Array.from(document.querySelectorAll<HTMLElement>("main > section"))) {
          if (section.getBoundingClientRect().width > limit + 1) wide.push(section.id);
        }
        return { small: small.slice(0, 8), wide };
      });
      expect(report.small, "text under 14px").toEqual([]);
      expect(report.wide, "sections wider than the screen").toEqual([]);
    });

    test("writes a full-page screenshot as evidence", async ({ page }) => {
      await openLanding(page);
      // Walk the page once so lazy images and scroll-driven reveals have run, then return to the top.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 600) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(60);
      }
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      mkdirSync(SHOTS_DIR, { recursive: true });
      const shot = await page.screenshot({ path: path.join(SHOTS_DIR, file), fullPage: true });
      expect(shot.length, "a non-trivial image").toBeGreaterThan(20_000);
    });
  });
}

test.describe("reflow at 320 CSS px (WCAG 2.2 AA 1.4.10; spec §13 and the §16 overflow bullet)", () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

  for (const route of ["/privacy", "/terms", "/thank-you", "/no-such-page", "/admin/login"]) {
    test(`${route} needs no sideways scroll`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    });
  }

  test("the landing page needs no sideways scroll", async ({ page }) => {
    await openLanding(page);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 700) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(30);
    }
    expect(await overflowOf(page), "sideways overflow in CSS px").toBeLessThanOrEqual(0);
  });
});
