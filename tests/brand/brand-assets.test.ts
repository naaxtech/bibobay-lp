import { describe, expect, it, vi } from "vitest";

import { metadata } from "@/app/layout";
import { brandTokens } from "@/lib/brand/tokens";
import { BRAND_ASSET_SOURCE, BRAND_ASSET_TARGETS, deriveBrandAssets } from "@/scripts/generate-brand-assets";
import { paintedColours, readSvg, readText, viewBoxOf } from "./svg-geometry";

// Added when the root layout mounted the order pad (Task 7b); the pad now mounts in app/(commerce), so this
// mock is no longer needed. Kept, harmless: remove only with the owner's go-ahead (no-deletion rule).
vi.mock("server-only", () => ({}));

const LETTERS = ["b1", "i", "b2", "o"] as const;
/** The pieces around the letters on the channel mark: a star over the i and three sparkles off the O. */
const EXTRAS = ["star", "sparkle-1", "sparkle-2", "sparkle-3"] as const;

const dieCut = (doc: Document, piece: string) => doc.querySelector(`#bibo-diecuts > path[data-piece="${piece}"]`);
const pathData = (doc: Document) => Array.from(doc.querySelectorAll("path")).map((path) => path.getAttribute("d") ?? "");

describe("derived brand assets", () => {
  it("derive from public/bibo-logo.svg", () => {
    expect(BRAND_ASSET_SOURCE).toBe("public/bibo-logo.svg");
    expect([...BRAND_ASSET_TARGETS].sort()).toEqual([
      "app/icon.svg",
      "public/brand/bibo-logo-monochrome.svg",
      "public/brand/bibo-mark.svg",
    ]);
  });

  it("are exactly what the generator derives from the canonical file", () => {
    const derived = deriveBrandAssets(readText(BRAND_ASSET_SOURCE));
    expect(Object.keys(derived).sort()).toEqual([...BRAND_ASSET_TARGETS].sort());
    for (const target of BRAND_ASSET_TARGETS) {
      expect(readText(target), `${target} drifted from the canonical logo; run npm run brand:generate`).toBe(derived[target]);
    }
  });

  it("follow a change to the canonical geometry", () => {
    const canonical = readText(BRAND_ASSET_SOURCE);
    const moved = canonical.replace(/(id="bibo-diecut-b1"[^>]*\sd="M)([\d.]+)/, (_, head: string, x: string) => `${head}${Number(x) + 1}`);
    expect(moved).not.toBe(canonical);
    const derived = deriveBrandAssets(moved);
    for (const target of ["public/brand/bibo-mark.svg", "app/icon.svg"] as const) {
      expect(derived[target]).not.toBe(readText(target));
    }
  });

  it("reuse the canonical geometry verbatim instead of redrawing it", () => {
    const source = new Set(pathData(readSvg(BRAND_ASSET_SOURCE)));
    for (const target of BRAND_ASSET_TARGETS) {
      const paths = pathData(readSvg(target));
      expect(paths.length, `${target} has geometry`).toBeGreaterThan(0);
      for (const d of paths) expect(source.has(d), `${target} contains geometry that is not in the canonical file`).toBe(true);
    }
  });

  it("frame the full sticker lockup as a square mark", () => {
    const doc = readSvg("public/brand/bibo-mark.svg");
    const [, , w, h] = viewBoxOf(doc);
    expect(w).toBe(h);
    for (const piece of [...LETTERS, ...EXTRAS]) expect(dieCut(doc, piece), `mark keeps the ${piece} sticker`).not.toBeNull();
    expect(doc.querySelector("#bibo-star")).not.toBeNull();
    expect(doc.querySelectorAll("#bibo-sparkles > path")).toHaveLength(3);
    expect(doc.querySelectorAll('#bibo-inks [data-piece="smile"]')).toHaveLength(1);
  });

  it("print the monochrome logo in one ink with every letterform, the star, three sparkles and the smile", () => {
    const doc = readSvg("public/brand/bibo-logo-monochrome.svg");
    expect([...paintedColours(doc)]).toEqual([brandTokens.color.navy]);
    expect(doc.querySelectorAll("filter")).toHaveLength(0);
    for (const piece of LETTERS) {
      expect(doc.querySelector(`#bibo-inks > g[data-piece="${piece}"]`), `monochrome keeps ${piece}`).not.toBeNull();
    }
    expect(doc.querySelector("#bibo-star")).not.toBeNull();
    expect(doc.querySelectorAll("#bibo-sparkles > path")).toHaveLength(3);
    expect(doc.querySelectorAll('#bibo-inks [data-piece="smile"]')).toHaveLength(1);
  });

  it("simplify the app icon to a square without shadow blur, keeping all four stickers", () => {
    const doc = readSvg("app/icon.svg");
    const [, , w, h] = viewBoxOf(doc);
    expect(w).toBe(h);
    expect(doc.querySelectorAll("filter, [filter]")).toHaveLength(0);
    for (const piece of LETTERS) expect(dieCut(doc, piece), `icon keeps the ${piece} sticker`).not.toBeNull();
    expect(doc.querySelector("#bibo-star")).not.toBeNull();
    expect(doc.querySelectorAll("#bibo-sparkles > path")).toHaveLength(3);
  });

  it("let the generated app/icon.svg be the favicon instead of a hand-pointed icon", () => {
    expect(metadata.icons).toBeUndefined();
  });
});
