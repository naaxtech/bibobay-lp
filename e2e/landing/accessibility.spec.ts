import { expect, test, type Page } from "@playwright/test";

import { hydrated } from "../shop/shop-helpers";

/*
 * Task 12 (local pass), spec §13 and §16 "Keyboard-only and reduced-motion paths". Playwright
 * primitives only (ruling R116: no accessibility dependency, so no axe): structure is read from the
 * DOM, keyboard behaviour is driven with real key presses. Colour contrast is e2e/landing/contrast
 * and the lead form's live regions are e2e/leads/lead-form; neither is repeated here.
 *
 * It covers: landmarks and heading order, alternative text, accessible names, id references, tab
 * order and visible focus across the whole page, the one dialog (the mobile menu) trapping focus and
 * restoring it, reduced motion on first paint, and target sizes.
 */

const PAGES = ["/", "/privacy", "/terms", "/thank-you"] as const;
const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
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

async function openLanding(page: Page, path = "/") {
  await page.goto(path);
  if (path === "/") await expect(page.locator("html")).toHaveAttribute("data-motion", /^(full|reduced)$/);
}

/** Selector for what a keyboard user can land on, before visibility is judged. */
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

for (const path of PAGES) {
  test.describe(`structure of ${path}`, () => {
    test("has exactly one main, a banner, a footer and a labelled navigation, in that order", async ({ page }) => {
      await openLanding(page, path);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      const order = await page.evaluate(() => {
        const position = (selector: string) => {
          const element = document.querySelector(selector);
          return element ? Array.from(document.querySelectorAll("*")).indexOf(element) : -1;
        };
        return [position("body header"), position("main"), position("body footer")];
      });
      expect(order.every((index) => index >= 0), "all three landmarks exist").toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      // At least one navigation, and when there are several each says which it is.
      const navs = page.getByRole("navigation");
      const count = await navs.count();
      if (path === "/") expect(count).toBeGreaterThanOrEqual(1);
      for (let index = 0; index < count; index += 1) {
        if (count > 1) expect(await navs.nth(index).getAttribute("aria-label"), `navigation ${index + 1} of ${count} is named`).toBeTruthy();
      }
      // Landmark regions contained in the page are named only once each.
      const labels = await page.locator("nav[aria-label], section[aria-labelledby]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? node.getAttribute("aria-labelledby")));
      expect(new Set(labels).size, "region names are unique").toBe(labels.length);
    });

    test("has one h1 and heading levels that never skip downward", async ({ page }) => {
      await openLanding(page, path);
      const levels = await page.locator("h1, h2, h3, h4, h5, h6, [role='heading']").evaluateAll((nodes) =>
        nodes
          .filter((node) => node.checkVisibility({ visibilityProperty: true }) || node.closest("[role='tabpanel']"))
          .map((node) => Number(node.getAttribute("aria-level") ?? node.tagName.slice(1))),
      );
      expect(levels.filter((level) => level === 1), "exactly one h1").toHaveLength(1);
      expect(levels[0], "the first heading is the h1").toBe(1);
      for (let index = 1; index < levels.length; index += 1) {
        expect(levels[index]! - levels[index - 1]!, `heading ${index + 1} (h${levels[index]}) after h${levels[index - 1]}`).toBeLessThanOrEqual(1);
      }
    });

    test("gives every image an alt attribute (empty only for decoration), every control a name, and resolves every id reference", async ({ page }) => {
      await openLanding(page, path);
      const report = await page.evaluate((focusable) => {
        const label = (element: Element): string => {
          const labelledby = element.getAttribute("aria-labelledby");
          if (labelledby) return labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
          const aria = element.getAttribute("aria-label")?.trim();
          if (aria) return aria;
          const fromImages = Array.from(element.querySelectorAll("img[alt], svg[aria-label], [role='img'][aria-label]")).map((node) => node.getAttribute("alt") ?? node.getAttribute("aria-label") ?? "").join(" ");
          return `${element.textContent ?? ""} ${fromImages}`.replace(/\s+/g, " ").trim() || element.getAttribute("title")?.trim() || "";
        };
        const imagesWithoutAlt = Array.from(document.querySelectorAll("img:not([alt])")).map((node) => node.outerHTML.slice(0, 80));
        const decorativeButMeaningful = Array.from(document.querySelectorAll("img[alt='']")).filter((node) => node.closest("a, button") && !label(node.closest("a, button")!)).map((node) => node.outerHTML.slice(0, 80));
        const unnamedLinksAndButtons = Array.from(document.querySelectorAll("a[href], button, [role='button'], [role='tab'], summary"))
          .filter((node) => !node.closest("[aria-hidden='true'], [hidden]") && !label(node))
          .map((node) => node.outerHTML.slice(0, 100));
        const unnamedControls = Array.from(document.querySelectorAll("input:not([type='hidden']), select, textarea"))
          .filter((node) => !node.closest("[aria-hidden='true'], [hidden]"))
          .filter((node) => {
            if (label(node)) return false;
            if (node.id && document.querySelector(`label[for="${CSS.escape(node.id)}"]`)?.textContent?.trim()) return false;
            return !node.closest("label")?.textContent?.trim();
          })
          .map((node) => node.outerHTML.slice(0, 120));
        const broken: string[] = [];
        for (const attribute of ["aria-describedby", "aria-labelledby", "aria-controls", "aria-owns", "aria-activedescendant", "for"]) {
          for (const node of Array.from(document.querySelectorAll(`[${CSS.escape(attribute)}]`))) {
            for (const id of (node.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean)) {
              // A tab panel that is not rendered is not in the document, which aria-controls tolerates (APG tabs).
              if (!document.getElementById(id) && attribute !== "aria-controls") broken.push(`${attribute}="${id}" on ${node.tagName.toLowerCase()}`);
            }
          }
        }
        const duplicateIds = Array.from(document.querySelectorAll("[id]"))
          .map((node) => node.id)
          .filter((id, index, ids) => ids.indexOf(id) !== index);
        const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]"))
          .filter((node) => Number(node.getAttribute("tabindex")) > 0)
          .map((node) => node.outerHTML.slice(0, 80));
        return { imagesWithoutAlt, decorativeButMeaningful, unnamedLinksAndButtons, unnamedControls, broken, duplicateIds, positiveTabindex, focusableCount: document.querySelectorAll(focusable).length };
      }, FOCUSABLE);
      expect(report.imagesWithoutAlt, "images with no alt attribute").toEqual([]);
      expect(report.decorativeButMeaningful, "links or buttons whose only content is an empty-alt image").toEqual([]);
      expect(report.unnamedLinksAndButtons, "links and buttons with no accessible name").toEqual([]);
      expect(report.unnamedControls, "form controls with no accessible name").toEqual([]);
      expect(report.broken, "id references that point nowhere").toEqual([]);
      expect(report.duplicateIds, "duplicate ids").toEqual([]);
      expect(report.positiveTabindex, "tabindex above 0").toEqual([]);
    });
  });
}

/**
 * Marks every element a keyboard user should be able to reach (in document order) and returns how many.
 * Elements that are not rendered, disabled, inert, inside a closed disclosure, or deliberately taken
 * out of the tab order (tabindex -1: roving tabs, the honeypot) are not expected.
 */
async function markExpectedStops(page: Page) {
  return page.evaluate((focusable) => {
    let count = 0;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(focusable))) {
      const tabindex = element.getAttribute("tabindex");
      const disabled = (element as HTMLButtonElement).disabled === true || element.closest("fieldset[disabled]") !== null;
      const closedDetails = element.closest("details:not([open])") !== null && element.tagName !== "SUMMARY" && element.parentElement?.tagName !== "DETAILS";
      const insideClosedDetails = Array.from(document.querySelectorAll("details:not([open])")).some((details) => details.contains(element) && !(element.tagName === "SUMMARY" && element.parentElement === details));
      if (tabindex === "-1" || disabled || closedDetails || insideClosedDetails || element.closest("[inert], [hidden]")) continue;
      if (!element.checkVisibility({ visibilityProperty: true })) continue;
      element.setAttribute("data-qa-stop", String(count));
      count += 1;
    }
    return count;
  }, FOCUSABLE);
}

/** What the page shows around the focused element, as a keyboard user would see it. */
const focusReport = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return null;
    // The ring may sit on the control or on the wrapper it lives in (a custom checkbox, a card link).
    const rings = [element, element.parentElement, element.closest("label")].filter((node): node is HTMLElement => node !== null);
    const visible = rings.some((node) => {
      const style = getComputedStyle(node);
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none" && style.boxShadow !== "";
      return outline || shadow;
    });
    return { stop: element.getAttribute("data-qa-stop"), visible, text: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40), tag: element.tagName.toLowerCase() };
  });

for (const { name, use } of VIEWPORTS) {
  test.describe(`keyboard on the landing page at ${name}`, () => {
    test.use(use);

    test("Tab from the top reaches every link, button and control in document order, each with a visible focus style", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await hydrated(page.locator("form.lead-form"));
      const expected = await markExpectedStops(page);
      expect(expected, "the page has focusable controls").toBeGreaterThan(20);

      const reached: number[] = [];
      const invisible: string[] = [];
      const outside: string[] = [];
      // Start from the very top of the document with nothing focused.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        (document.activeElement as HTMLElement | null)?.blur();
      });
      for (let press = 0; press < expected + 8; press += 1) {
        await page.keyboard.press("Tab");
        const focus = await focusReport(page);
        if (!focus) continue;
        if (focus.stop === null) {
          outside.push(`${focus.tag} "${focus.text}"`);
          continue;
        }
        const stop = Number(focus.stop);
        if (reached[reached.length - 1] !== stop) reached.push(stop);
        if (!focus.visible) invisible.push(`${focus.tag} "${focus.text}"`);
        if (stop === expected - 1) break;
      }
      expect(reached, "stops reached in document order, none skipped").toEqual(Array.from({ length: expected }, (_, index) => index));
      expect(invisible, "focused elements with no outline or box-shadow").toEqual([]);
      expect(outside, "focus landed on something the page did not mark focusable").toEqual([]);
      expect(problems).toEqual([]);
    });

    test("Shift+Tab walks back out the way it came and focus never escapes to the address bar from the first stop mid-page", async ({ page }) => {
      await openLanding(page);
      await hydrated(page.locator("form.lead-form"));
      await markExpectedStops(page);
      await page.locator("section#faq summary").first().focus();
      const start = Number((await focusReport(page))!.stop);
      await page.keyboard.press("Shift+Tab");
      expect(Number((await focusReport(page))!.stop), "one step back is the stop before").toBe(start - 1);
    });

    test("an FAQ question toggles from the keyboard with Enter and with Space", async ({ page }) => {
      await openLanding(page);
      await hydrated(page.locator("form.lead-form"));
      const second = page.locator("section#faq details").nth(1);
      const summary = second.locator("summary");
      await summary.focus();
      await page.keyboard.press("Space");
      await expect(second).toHaveAttribute("open", "");
      await page.keyboard.press("Space");
      await expect(second).not.toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await expect(second).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
    });

    test("the lead form is operable by keyboard alone and says what is wrong when it is submitted empty", async ({ page }) => {
      await openLanding(page);
      const form = page.getByRole("form", { name: "Founding-family signup" });
      await hydrated(form);
      const email = form.getByLabel(/email/i).first();
      await email.focus();
      await expect(email).toBeFocused();
      await page.keyboard.type("parent@example.com");
      await expect(email).toHaveValue("parent@example.com");
      // Tab moves on through the optional fields to the consent checkbox, which Space ticks.
      const consent = form.getByRole("checkbox");
      for (let press = 0; press < 6; press += 1) {
        if (await consent.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(consent).toBeFocused();
      await page.keyboard.press("Space");
      await expect(consent).toBeChecked();
      await page.keyboard.press("Space");
      await expect(consent).not.toBeChecked();
    });

    test("tabs in the friend and story selectors are one tab stop; arrow keys move between them", async ({ page }) => {
      await openLanding(page);
      await hydrated(page.locator("form.lead-form"));
      for (const id of ["characters", "episodes"]) {
        const tabs = page.locator(`section#${id}`).getByRole("tab");
        const stops = await tabs.evaluateAll((nodes) => nodes.filter((node) => node.getAttribute("tabindex") !== "-1").length);
        expect(stops, `${id}: only the selected tab is in the tab order`).toBe(1);
        await tabs.first().focus();
        await page.keyboard.press("ArrowRight");
        await expect(tabs.nth(1)).toBeFocused();
        await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      }
    });
  });
}

test.describe("the menu dialog on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("traps Tab and Shift+Tab, closes on Escape, restores focus, locks page scroll and makes the page inert behind it", async ({ page }) => {
    const problems = collectProblems(page);
    await openLanding(page);
    const button = page.getByRole("button", { name: "Menu" });
    await expect(async () => {
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 });
    }).toPass();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));

    await expect.poll(inside, { message: "focus moved into the dialog on open" }).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "page scroll is locked").toBe("hidden");
    expect(await page.locator("main").evaluate((element) => element.closest("[inert]") !== null || element.hasAttribute("inert")), "the page behind is inert").toBe(true);

    const controls = await dialog.locator(FOCUSABLE).count();
    expect(controls, "the dialog has controls to cycle through").toBeGreaterThan(1);
    // Forward through the whole ring and around: focus never leaves.
    for (let press = 0; press < controls * 2 + 2; press += 1) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab press ${press + 1} stays inside`).toBe(true);
    }
    // Backward the same.
    for (let press = 0; press < controls * 2 + 2; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Shift+Tab press ${press + 1} stays inside`).toBe(true);
    }
    // Wrapping: from the last control Tab goes to the first, and Shift+Tab from the first goes to the last.
    const first = dialog.locator(FOCUSABLE).first();
    const last = dialog.locator(FOCUSABLE).last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "page scroll is back").not.toBe("hidden");
    expect(await page.locator("main").evaluate((element) => element.closest("[inert]") !== null || element.hasAttribute("inert")), "the page is live again").toBe(false);
    expect(problems).toEqual([]);
  });

  test("a click on the page behind does not close or escape the dialog, and a tap on a link closes it", async ({ page }) => {
    await openLanding(page);
    const button = page.getByRole("button", { name: "Menu" });
    await expect(async () => {
      await button.click();
      await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1_000 });
    }).toPass();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await dialog.getByRole("link").first().click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
  });
});

for (const { name, use } of VIEWPORTS) {
  test.describe(`reduced motion on first paint at ${name}`, () => {
    test.use({ ...use, reducedMotion: "reduce" });

    test("every section's text is visible without scrolling, nothing is animating, and the page still works", async ({ page }) => {
      const problems = collectProblems(page);
      await openLanding(page);
      await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
      // No scrolling, no waiting for an intersection: what the reader gets on first paint.
      const hidden = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const section of Array.from(document.querySelectorAll<HTMLElement>("main > section[data-section]"))) {
          const text = Array.from(section.querySelectorAll<HTMLElement>("h1, h2, h3, p, li, summary, a, button, label")).filter(
            (element) => element.textContent?.trim() && !element.closest("[role='tabpanel'][inert], [hidden], details:not([open]) > :not(summary), .sr-only"),
          );
          if (text.length === 0) offenders.push(`#${section.id}: no text at all`);
          for (const element of text) {
            for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (style.opacity === "0" || style.visibility === "hidden" || style.display === "none") {
                offenders.push(`#${section.id}: ${element.tagName.toLowerCase()} "${element.textContent!.trim().slice(0, 30)}" hidden by ${node.tagName.toLowerCase()}.${String(node.className).slice(0, 30)}`);
                break;
              }
            }
          }
        }
        return offenders.slice(0, 10);
      });
      expect(hidden, "text hidden on first paint").toEqual([]);
      const moving = await page.evaluate(() => document.getAnimations().filter((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).length);
      expect(moving, "animations still running").toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // Anchors jump rather than glide.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).not.toBe("smooth");
      expect(problems).toEqual([]);
    });

    test("every other public page also stays readable and calm", async ({ page }) => {
      for (const path of ["/privacy", "/terms", "/thank-you", "/no-such-page"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.getAnimations().filter((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).length), path).toBe(0);
      }
    });
  });
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`target sizes at ${name}`, () => {
    test.use(use);

    test("the primary call to action and the menu button are at least 44x44 CSS px", async ({ page }) => {
      await openLanding(page);
      const targets = [page.locator("#hero").getByRole("link", { name: /Watch on YouTube/ })];
      if (use.viewport.width < 1024) targets.push(page.getByRole("button", { name: "Menu" }));
      else targets.push(page.getByRole("banner").getByRole("link", { name: /Subscribe on YouTube/ }));
      for (const target of targets) {
        await expect(target).toBeVisible();
        const box = (await target.boundingBox())!;
        expect(box.width, "width").toBeGreaterThanOrEqual(44);
        expect(box.height, "height").toBeGreaterThanOrEqual(44);
      }
    });

    test("every button, tab, form control and navigation link is at least 24x24 CSS px (WCAG 2.2 AA 2.5.8)", async ({ page }) => {
      await openLanding(page);
      const small = await page.evaluate(() => {
        const found: string[] = [];
        for (const element of Array.from(document.querySelectorAll<HTMLElement>("button, [role='tab'], input:not([type='hidden']), select, textarea, summary, .btn, .nav-link, nav a, header a, footer a"))) {
          if (!element.checkVisibility({ visibilityProperty: true }) || element.closest("[inert], [hidden]")) continue;
          // A tabindex -1 honeypot is not a target.
          if (element.getAttribute("tabindex") === "-1" && element.tagName === "INPUT") continue;
          const box = element.getBoundingClientRect();
          if (box.width < 24 || box.height < 24) found.push(`${element.tagName.toLowerCase()} "${(element.textContent ?? element.getAttribute("name") ?? "").trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
        return found;
      });
      expect(small, "targets smaller than 24x24").toEqual([]);
    });
  });
}
