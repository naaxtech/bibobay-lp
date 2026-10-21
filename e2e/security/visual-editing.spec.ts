import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Ruling R161: the Studio's Visual Editing code (overlays, Sanity UI, styled-components) is its own
 * chunk, requested only by a draft-mode page inside the Studio's Presentation tool. A visitor never
 * downloads it. Marker: a Presentation message type the library's bundle carries.
 */
const MARKER = "presentation/navigate";

const require = createRequire(import.meta.url);
const libraryDist = join(dirname(require.resolve("@sanity/visual-editing/package.json")), "dist");

/** Records the body of every script the page loads. `bodies()` waits for the reads still in flight. */
function recordScripts(page: Page) {
  const pending: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() !== "script") return;
    pending.push(response.text().catch(() => ""));
  });
  return { bodies: () => Promise.all(pending) };
}

test("the marker is really in the Visual Editing library, so its absence below means something", () => {
  const files = readdirSync(libraryDist).filter((name) => name.endsWith(".js"));
  expect(files.some((name) => readFileSync(join(libraryDist, name), "utf8").includes(MARKER))).toBe(true);
});

for (const path of ["/", "/privacy", "/terms", "/thank-you"]) {
  test(`${path} downloads no Visual Editing code`, async ({ page }) => {
    const scripts = recordScripts(page);
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const bodies = await scripts.bodies();
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((body) => body.includes(MARKER))).toBe(false);
  });
}
