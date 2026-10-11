import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

/** Console errors and uncaught exceptions, minus the dev server's own HMR chatter. */
function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("/_next/hmr")) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

/** Opens the page and waits until React has hydrated and the motion layer has started (or chosen not to). */
async function openLanding(page: Page) {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", /^(full|reduced)$/);
}

const section = (page: Page, id: string) => page.locator(`section#${id}`);

/** The tab list's height and the page's scroll height must not change when the selection does. */
async function geometry(tablistSection: Locator) {
  return tablistSection.evaluate((root) => ({
    sectionHeight: Math.round(root.getBoundingClientRect().height),
    pageHeight: document.documentElement.scrollHeight,
  }));
}

async function expectTabsDriveTheStage(page: Page, id: "characters" | "episodes") {
  const root = section(page, id);
  const tabs = root.getByRole("tab");
  const panel = root.getByRole("tabpanel");
  await root.scrollIntoViewIfNeeded();
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  const firstHeading = await panel.getByRole("heading", { level: 3 }).textContent();
  const before = await geometry(root);

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(panel).toHaveCount(1);
  const secondHeading = await panel.getByRole("heading", { level: 3 }).textContent();
  expect(secondHeading).not.toBe(firstHeading);
  await expect(panel).toHaveAttribute("aria-labelledby", (await tabs.nth(1).getAttribute("id")) ?? "");

  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("heading", { level: 3 })).toHaveText(firstHeading ?? "");

  // Every transition has finished and nothing moved the layout around it. CSS transitions show in
  // getAnimations(); GSAP tweens do not, but leave inline opacity/transform until they finish and clear.
  await expect.poll(() => panel.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
  await expect
    .poll(() => panel.evaluate((element) => [element, ...element.querySelectorAll("*")].filter((node) => /opacity|transform/.test(node.getAttribute("style") ?? "")).length))
    .toBe(0);
  await expect.poll(() => geometry(root)).toEqual(before);
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`landing interactions on ${name}`, () => {
    test.use(use);

    test("friend tabs change the stage by click and arrow keys without a layout jump", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expectTabsDriveTheStage(page, "characters");
      expect(problems).toEqual([]);
    });

    test("story tabs change the open storybook by click and arrow keys without a layout jump", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expectTabsDriveTheStage(page, "episodes");
      expect(problems).toEqual([]);
    });

    test("an FAQ answer opens and closes from its question", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      const items = section(page, "faq").locator("details");
      await expect(items.first()).toHaveAttribute("open", "");
      const second = items.nth(1);
      const answer = second.locator(".faq-item__answer");
      await expect(answer).toBeHidden();

      await second.locator("summary").click();
      await expect(second).toHaveAttribute("open", "");
      await expect(answer).toBeVisible();

      await second.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(second).not.toHaveAttribute("open", "");
      await expect(answer).toBeHidden();
      expect(problems).toEqual([]);
    });

    test("a primary CTA gives tactile press feedback in under 180 ms and springs back", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
      const cta = section(page, "hero").getByRole("link", { name: "Meet the Bay friends" });
      const box = await cta.boundingBox();
      if (!box) throw new Error("hero CTA is not laid out");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

      const pressedAt = Date.now();
      await page.mouse.down();
      await expect
        .poll(() => cta.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a), { intervals: [16] })
        .toBeLessThan(1);
      await expect
        .poll(() => cta.evaluate((element) => Number(getComputedStyle(element).getPropertyValue("--btn-press") || 1)), { intervals: [16] })
        .toBeLessThanOrEqual(0.97);
      expect(Date.now() - pressedAt, "the press lands well inside a beat").toBeLessThan(600);

      // Leave the link without releasing on it, so the press is cancelled rather than followed.
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await expect.poll(() => cta.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
      await expect.poll(() => cta.evaluate((element) => element.style.getPropertyValue("--btn-press"))).toBe("");
      expect(problems).toEqual([]);
    });

    if (name === "mobile") {
      test("the menu opens, closes with Escape and returns focus to the Menu button", async ({ page }) => {
        const problems = collectProblems(page);
        await openLanding(page);
        const menuButton = page.getByRole("button", { name: "Menu" });
        await menuButton.click();
        const dialog = page.getByRole("dialog", { name: "Menu" });
        await expect(dialog).toBeVisible();
        await expect(menuButton).toHaveAttribute("aria-expanded", "true");
        await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(menuButton).toBeFocused();
        await expect(menuButton).toHaveAttribute("aria-expanded", "false");
        expect(problems).toEqual([]);
      });
    }

    test.describe("with reduced motion", () => {
      test.use({ reducedMotion: "reduce" });

      test("every section stays visible and unmoved after a full scroll, and nothing animates", async ({ page }) => {
        const problems = collectProblems(page);
        await openLanding(page);
        await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 500) {
          await page.mouse.wheel(0, 500);
          await page.waitForTimeout(40);
        }
        await section(page, "characters").getByRole("tab").nth(1).click();
        await section(page, "episodes").getByRole("tab").nth(1).click();

        const report = await page.evaluate(() => {
          const offenders: string[] = [];
          const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
          for (const root of sections) {
            for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement | SVGElement>("*"))]) {
              if (element.closest("[hidden]")) continue;
              const style = getComputedStyle(element);
              const inline = element.getAttribute("style") ?? "";
              if (style.opacity === "0" || style.visibility === "hidden") offenders.push(`hidden: ${element.outerHTML.slice(0, 60)}`);
              if (/opacity|transform|translate|stroke-dash/.test(inline)) offenders.push(`inline motion: ${element.outerHTML.slice(0, 60)}`);
              if (element.matches("[data-bay-layer]") && element.hasAttribute("transform")) offenders.push(`moved layer: ${element.outerHTML.slice(0, 60)}`);
            }
          }
          // Reduced motion collapses every CSS transition to 0.01 ms (globals.css); one caught in the
          // frame it starts is not motion. Anything longer is.
          const moving = document.getAnimations().filter((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1);
          return { sections: sections.length, offenders, moving: moving.length };
        });
        expect(report.sections).toBeGreaterThanOrEqual(10);
        expect(report.offenders).toEqual([]);
        expect(report.moving).toBe(0);
        await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
        expect(problems).toEqual([]);
      });
    });
  });
}
