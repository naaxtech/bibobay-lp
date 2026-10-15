import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
] as const;

interface Reading {
  where: string;
  text: string;
  ratio: number;
  need: number;
}

/**
 * Every visible text run in `scope`, with its contrast against the colour it is painted on: the
 * backgrounds behind it composited up to the first opaque one. A sea section's gradient is read at
 * the text's own height; an inline highlighter gradient (half the line's height) is not a ground.
 * Text over a photograph is skipped (it always sits on its own pill).
 */
function readContrast(page: Page, scope: string): Promise<Reading[]> {
  return page.evaluate((selector) => {
    type Rgba = [number, number, number, number];
    const probe = document.createElement("canvas").getContext("2d")!;
    const rgba = (css: string): Rgba | null => {
      if (!css || css === "transparent") return null;
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba;
    const luminance = (c: Rgba) => {
      const channel = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
    };
    const contrast = (a: Rgba, b: Rgba) => {
      const [x, y] = [luminance(a), luminance(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const gradientStops = (image: string) => [...image.matchAll(/(rgba?\([^)]+\)|color\([^)]+\)|#[0-9a-f]{3,8})/gi)].map((match) => rgba(match[1]!)).filter(Boolean) as Rgba[];

    const readings: Reading[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(`${selector} *`)) {
      if (element.closest("[aria-hidden='true'], .sr-only, svg, [hidden], [inert]")) continue;
      if (![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())) continue;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || !box.width || !box.height) continue;
      const layers: Rgba[] = [];
      let ground: Rgba | null = null;
      let overPhoto = false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const own = getComputedStyle(node);
        const fill = rgba(own.backgroundColor);
        const image = own.backgroundImage;
        if (node.querySelector(":scope > img") && node !== element && !fill) overPhoto = true;
        if (node.matches(".landing-section") && image.startsWith("linear-gradient") && (!fill || fill[3] < 1)) {
          const stops = gradientStops(image);
          const area = node.getBoundingClientRect();
          const t = Math.min(1, Math.max(0, (box.top + box.height / 2 - area.top) / area.height));
          if (stops.length >= 2) ground = [0, 1, 2].map((i) => stops[0]![i]! + (stops.at(-1)![i]! - stops[0]![i]!) * t).concat(1) as Rgba;
          if (ground) break;
        }
        if (fill && fill[3] > 0) {
          layers.push(fill);
          if (fill[3] >= 1) break;
        }
      }
      if (overPhoto && layers.length === 0) continue;
      let behind: Rgba = ground ?? [255, 255, 255, 1];
      for (const layer of layers.reverse()) behind = over(layer, behind);
      const ink = rgba(style.color)!;
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      readings.push({
        where: `${element.closest("section")?.id ?? element.closest("header, footer")?.tagName.toLowerCase()} .${String(element.className).split(" ")[0]}`,
        text: element.textContent!.trim().slice(0, 40),
        ratio: Number(contrast(ink[3] < 1 ? over(ink, behind) : ink, behind).toFixed(2)),
        need: large ? 3 : 4.5,
      });
    }
    return readings;
  }, scope);
}

const failing = (readings: Reading[]) => readings.filter((reading) => reading.ratio < reading.need).map((r) => `${r.where} "${r.text}" ${r.ratio}:1 < ${r.need}:1`);

for (const { name, use } of VIEWPORTS) {
  test.describe(`text contrast on ${name}`, () => {
    test.use({ ...use, reducedMotion: "reduce" });

    test("every visible text run meets WCAG AA against what it is painted on", async ({ page }) => {
      await page.goto("/");
      const readings = await readContrast(page, "body");
      expect(readings.length).toBeGreaterThan(100);
      expect(failing(readings)).toEqual([]);
    });

    test("light surfaces keep light-ground ink when an editor puts their section in the deep sea (rebrand review I1)", async ({ page }) => {
      await page.goto("/");
      // What the CMS can produce: the friends section on the navy ground, and a story kept as a concept.
      await page.evaluate(() => {
        const friends = document.getElementById("characters")!;
        friends.dataset.ground = "navy";
        friends.dataset.surface = "navy";
        const cover = document.querySelector("#episodes [role='tabpanel']:not([inert]) .storybook__cover")!;
        const stamp = document.createElement("p");
        stamp.className = "paper-stamp storybook__stamp";
        stamp.textContent = "Story concept";
        cover.append(stamp);
      });
      const readings = [...(await readContrast(page, "#characters .friend-stage:not([inert])")), ...(await readContrast(page, "#episodes .storybook:not([inert])"))];
      expect(readings.map((reading) => reading.text)).toEqual(expect.arrayContaining(["Explores", "Featuring", "Story concept"]));
      expect(failing(readings)).toEqual([]);
    });

    test("a keyboard user sees a clear ring on the video's way out, inside its card (rebrand review I2)", async ({ page }) => {
      await page.goto("/");
      await page.locator("#episodes [role='tab'][aria-selected='true']").focus();
      const watch = page.locator("#episodes [role='tabpanel']:not([inert]) a.storybook__watch");
      for (let press = 0; press < 4 && !(await watch.evaluate((link) => link === document.activeElement)); press += 1) await page.keyboard.press("Tab");
      await expect(watch).toBeFocused();
      expect(await watch.evaluate((link) => link.matches(":focus-visible"))).toBe(true);
      // What is actually painted, not what the style says: the cover's picture covers anything drawn
      // beneath it. Midway down the left edge, inside the card's clip: a navy line, then a white band.
      const shot = (await watch.screenshot({ animations: "disabled" })).toString("base64");
      const [edge, band] = await page.evaluate(async (png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        [canvas.width, canvas.height] = [image.width, image.height];
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const at = (x: number) => Array.from(context.getImageData(x, Math.round(image.height / 2), 1, 1).data.slice(0, 3));
        return [at(1), at(5)];
      }, shot);
      const near = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 24);
      expect(near(edge!, [40, 59, 99]), `edge pixel ${edge}`).toBe(true);
      expect(near(band!, [255, 255, 255]), `band pixel ${band}`).toBe(true);
    });
  });
}

/**
 * The colour change a keyboard focus ring makes at `point` (page coordinates): the contrast between
 * the pixel there before and after the element takes focus. WCAG 2.4.11/1.4.11 want at least 3:1.
 */
async function ringChange(page: Page, focus: () => Promise<void>, point: { x: number; y: number }) {
  const sample = async () => {
    const clip = { x: Math.max(0, Math.round(point.x) - 1), y: Math.max(0, Math.round(point.y) - 1), width: 3, height: 3 };
    const png = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
    return page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [image.width, image.height];
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(1, 1, 1, 1).data.slice(0, 3));
    }, png);
  };
  const before = await sample();
  await focus();
  const after = await sample();
  const luminance = (c: number[]) => {
    const channel = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel(c[0]!) + 0.7152 * channel(c[1]!) + 0.0722 * channel(c[2]!);
  };
  const [x, y] = [luminance(before), luminance(after)];
  return { before, after, ratio: Number(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2)) };
}

/** Tab from the page top until `target` has keyboard focus. */
async function tabTo(page: Page, target: string) {
  const locator = page.locator(target);
  for (let press = 0; press < 80 && !(await locator.evaluate((element) => element === document.activeElement)); press += 1) await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
}

for (const { name, use } of VIEWPORTS) {
  test.describe(`focus rings on the deep-sea ground on ${name} (rebrand re-review N1)`, () => {
    test.use({ ...use, reducedMotion: "reduce" });

    const STOPS = [
      ["the chosen video tab", "#episodes [role='tab'][aria-selected='true']"],
      ["the open video panel", "#episodes [role='tabpanel']:not([inert])"],
    ] as const;

    for (const [label, selector] of STOPS) {
      test(`shows a ring with at least 3:1 change on ${label}`, async ({ page }) => {
        await page.goto("/");
        const element = page.locator(selector);
        await element.scrollIntoViewIfNeeded();
        const box = (await element.boundingBox())!;
        // Just outside the element's left edge, halfway down: where the 3px ring sits 3px out.
        const point = { x: box.x - 4.5, y: box.y + box.height / 2 };
        const change = await ringChange(page, () => tabTo(page, selector), point);
        expect(change.ratio, `${label}: ${change.before} -> ${change.after}`).toBeGreaterThanOrEqual(3);
      });
    }

    test("keeps the rings visible when an editor puts the friends on the deep-sea ground", async ({ page }) => {
      await page.goto("/");
      await page.evaluate(() => {
        const friends = document.getElementById("characters")!;
        friends.dataset.ground = "navy";
        friends.dataset.surface = "navy";
      });
      for (const selector of ["#characters [role='tab'][aria-selected='true']", "#characters [role='tabpanel']:not([inert])"]) {
        await page.locator("body").focus();
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.click(1, 1);
        const element = page.locator(selector);
        await element.scrollIntoViewIfNeeded();
        const box = (await element.boundingBox())!;
        const point = { x: box.x - 4.5, y: box.y + box.height / 2 };
        const change = await ringChange(page, async () => {
          await page.locator("#characters [role='tab'][aria-selected='true']").focus();
          if (selector.includes("tabpanel")) await tabTo(page, selector);
        }, point);
        expect(change.ratio, `${selector}: ${change.before} -> ${change.after}`).toBeGreaterThanOrEqual(3);
      }
    });
  });
}
