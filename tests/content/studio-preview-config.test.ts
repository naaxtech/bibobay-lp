import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * P-I3: the Studio's Presentation tool must open the site through its draft-mode route, or the
 * preview shows published content. The Studio is a separate package whose config needs environment
 * variables to import, so the shape is pinned from its source (the Studio's own `typecheck` proves
 * the options exist in the installed Sanity types).
 */
const config = readFileSync("studio/sanity.config.ts", "utf8");
const readme = readFileSync("studio/README.md", "utf8");

describe("Studio Presentation preview wiring (P-I3)", () => {
  it("passes the origin and previewMode.enable, not a bare preview string", () => {
    expect(config).toMatch(/presentationTool\(\{ previewUrl: \{ origin: previewUrl, previewMode: \{ enable: DRAFT_MODE_ENABLE_PATH \} \}/);
    expect(config).not.toMatch(/presentationTool\(\{ previewUrl,/);
  });

  it("points at the draft-mode route the site really serves", () => {
    const path = /DRAFT_MODE_ENABLE_PATH = "([^"]+)"/.exec(config)?.[1];
    expect(path).toBe("/api/draft-mode/enable");
    expect(existsSync("app/api/draft-mode/enable/route.ts")).toBe(true);
  });

  it("is described in the Studio README: both ends of the setup", () => {
    expect(readme).toMatch(/previewMode\.enable/);
    expect(readme).toMatch(/SANITY_API_READ_TOKEN/);
    expect(readme).toMatch(/SANITY_STUDIO_ORIGIN/);
    expect(readme).not.toMatch(/must be wired separately/i);
  });
});
