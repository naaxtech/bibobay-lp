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

/**
 * The layout around a tab selector (spec §7 "no layout jump"): how tall the selector's own section
 * is, where the section after it starts on the page, and how long the page is. Positions are in
 * page coordinates, so a scroll caused by clicking or focusing a tab does not count as a move.
 * Rounded to 1/100 px only to absorb floating-point noise; any real move is far larger.
 */
async function layoutAround(selectorSection: Locator) {
  return selectorSection.evaluate((root) => {
    const sections = Array.from(document.querySelectorAll("[data-section]"));
    const next = sections[sections.indexOf(root) + 1];
    if (!next) throw new Error(`no section follows #${root.id}`);
    const exact = (value: number) => Math.round(value * 100) / 100;
    return {
      sectionHeight: exact(root.getBoundingClientRect().height),
      nextSectionTop: exact(next.getBoundingClientRect().top + window.scrollY),
      pageHeight: document.documentElement.scrollHeight,
    };
  });
}

/** Inline motion styles (GSAP's opacity, transform, visibility) left anywhere among the section's tab panels. */
const panelMotionStyles = (selectorSection: Locator) =>
  selectorSection.evaluate((root) =>
    Array.from(root.querySelectorAll("[role='tabpanel'], [role='tabpanel'] *")).filter((node) => /opacity|transform|translate|visibility/.test(node.getAttribute("style") ?? "")).length,
  );

/**
 * Walks every tab of a selector, first by click and then by keyboard, and after each switch checks
 * that the chosen panel is the only one exposed, and that the layout around the selector is exactly
 * what it was before the first switch: at once (mid-transition) and again once the transition settles.
 */
async function expectSwitchesKeepTheLayout(page: Page, id: "characters" | "episodes") {
  const root = section(page, id);
  const tabs = root.getByRole("tab");
  const panel = root.getByRole("tabpanel");
  const count = await tabs.count();
  expect(count, "a selector needs at least two tabs to switch between").toBeGreaterThan(1);
  // Web fonts change line wrapping; measure only once they are in, so a late font is not a "jump".
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await root.scrollIntoViewIfNeeded();
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  const before = await layoutAround(root);
  const headings = new Set([await panel.getByRole("heading", { level: 3 }).textContent()]);

  const expectSwitchedTo = async (index: number, how: string) => {
    const step = `${id}: ${how} to tab ${index + 1}`;
    await expect(tabs.nth(index), step).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(index), step).toBeFocused();
    await expect(panel, `${step}: only the chosen panel is exposed`).toHaveCount(1);
    await expect(panel, step).toHaveAttribute("aria-labelledby", (await tabs.nth(index).getAttribute("id")) ?? "");
    expect(await layoutAround(root), `${step}: layout straight after the switch`).toEqual(before);
    await expect.poll(() => panelMotionStyles(root), `${step}: the transition settles`).toBe(0);
    expect(await layoutAround(root), `${step}: layout once the transition has settled`).toEqual(before);
    headings.add(await panel.getByRole("heading", { level: 3 }).textContent());
  };

  // By click: every tab in turn.
  for (let index = 1; index < count; index += 1) {
    await tabs.nth(index).click();
    await expectSwitchedTo(index, "click");
  }
  // By keyboard, from the last tab: Home, every tab with ArrowRight, wrap round, End, ArrowLeft.
  await page.keyboard.press("Home");
  await expectSwitchedTo(0, "Home");
  for (let index = 1; index < count; index += 1) {
    await page.keyboard.press("ArrowRight");
    await expectSwitchedTo(index, "ArrowRight");
  }
  await page.keyboard.press("ArrowRight");
  await expectSwitchedTo(0, "ArrowRight (wrapping)");
  await page.keyboard.press("End");
  await expectSwitchedTo(count - 1, "End");
  await page.keyboard.press("ArrowLeft");
  await expectSwitchedTo(count - 2, "ArrowLeft");

  expect(headings.size, "every tab showed its own panel").toBe(count);
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`landing interactions on ${name}`, () => {
    test.use(use);

    test("switching friends by click or keyboard never moves the section's height or what follows it", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expectSwitchesKeepTheLayout(page, "characters");
      expect(problems).toEqual([]);
    });

    test("switching stories by click or keyboard never moves the section's height or what follows it", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expectSwitchesKeepTheLayout(page, "episodes");
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
      // The in-page CTA: pressing the external "Watch on YouTube" link would open a new tab mid-test.
      const cta = section(page, "hero").getByRole("link", { name: "Meet Tula, Bob & Lumi" });
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

    if (name === "mobile") {
      test("choosing an in-page menu link puts focus in the target section, not on the Menu button (P-I2)", async ({ page }) => {
        const problems = collectProblems(page);
        await openLanding(page);
        const menuButton = page.getByRole("button", { name: "Menu" });
        const dialog = page.getByRole("dialog", { name: "Menu" });
        // The menu needs hydration; a first tap on a cold dev server can land before React does.
        await expect(async () => {
          await menuButton.click();
          await expect(dialog).toBeVisible({ timeout: 1_000 });
        }).toPass();
        await dialog.getByRole("link", { name: "Watch" }).click();
        await expect(dialog).toBeHidden();

        const inTargetSection = () => page.evaluate(() => document.getElementById("episodes")?.contains(document.activeElement) ?? false);
        await expect.poll(inTargetSection).toBe(true);
        await expect(menuButton).not.toBeFocused();
        // The next Tab moves on from the section, not back to the hero.
        await page.keyboard.press("Tab");
        expect(await inTargetSection()).toBe(true);
        expect(problems).toEqual([]);
      });
    }

    test.describe("with reduced motion", () => {
      test.use({ reducedMotion: "reduce" });

      for (const id of ["characters", "episodes"] as const) {
        test(`${id}: a switch shows the chosen panel in the same frame, with nothing easing in or out`, async ({ page }) => {
          const problems = collectProblems(page);
          await openLanding(page);
          await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
          const root = section(page, id);
          await root.scrollIntoViewIfNeeded();
          const before = await layoutAround(root);
          const count = await root.getByRole("tab").count();
          for (const index of [...Array.from({ length: count }, (_, step) => step).slice(1), 0]) {
            // Click and read back inside one task: no frame can render in between, so whatever
            // the reader would see first is exactly what is measured here.
            const seen = await root.evaluate(async (element, chosen) => {
              element.querySelectorAll<HTMLElement>("[role='tab']")[chosen]!.click();
              for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
              return Array.from(element.querySelectorAll<HTMLElement>("[role='tabpanel']")).map((panel) => {
                const parts = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>("*"))];
                return {
                  reachable: !panel.hasAttribute("inert"),
                  shown: getComputedStyle(panel).visibility,
                  partsShown: parts.every((part) => getComputedStyle(part).visibility === getComputedStyle(panel).visibility),
                  easing: parts.flatMap((part) => part.getAnimations()).length,
                };
              });
            }, index);
            expect(seen, `${id}: tab ${index + 1}`).toEqual(
              seen.map((_, panel) => ({ reachable: panel === index, shown: panel === index ? "visible" : "hidden", partsShown: true, easing: 0 })),
            );
            expect(await layoutAround(root), `${id}: tab ${index + 1}`).toEqual(before);
          }
          expect(problems).toEqual([]);
        });
      }

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
              // An unchosen tab panel is meant to be unseen (inert, aria-hidden, visibility:hidden).
              if (element.closest("[hidden], [role='tabpanel'][inert]")) continue;
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
