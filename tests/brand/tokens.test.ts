import { describe, expect, it } from "vitest";

import RootLayout from "@/app/layout";
import { brandCssVariables, brandReducedMotionCssVariables, brandTokens } from "@/lib/brand/tokens";
import { inheritedAttribute, paintedColours, readSvg, readText } from "./svg-geometry";

type ColourName = keyof typeof brandTokens.color;

const css = readText("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

function declarations(block: string): Map<string, string> {
  return new Map(
    block
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string];
      }),
  );
}

const rootBlock = () => declarations(/^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "");
const reducedMotionRootBlock = () =>
  declarations(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function clampBounds(value: string): [number, number] {
  const fixed = /^([\d.]+)rem$/.exec(value);
  if (fixed) return [Number(fixed[1]), Number(fixed[1])];
  const fluid = /^clamp\(([\d.]+)rem, [^,]+, ([\d.]+)rem\)$/.exec(value);
  if (!fluid) throw new Error(`Not a rem size or rem clamp(): ${value}`);
  return [Number(fluid[1]), Number(fluid[2])];
}

/** Split a box-shadow list on top-level commas. */
function shadowLayers(value: string): string[] {
  const layers: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      layers.push(current.trim());
      current = "";
    } else current += char;
  }
  return [...layers, current.trim()];
}

const TEXT_PAIRS: Array<[ColourName, ColourName]> = [
  ["navy", "cream"], ["navy", "paper"], ["navy", "sand"],
  ["navySoft", "cream"], ["navySoft", "paper"], ["navySoft", "sand"],
  ["tealInk", "cream"], ["tealInk", "paper"], ["tealInk", "sand"],
  ["orangeInk", "cream"], ["orangeInk", "paper"], ["orangeInk", "sand"],
  ["purpleInk", "cream"], ["purpleInk", "paper"], ["purpleInk", "sand"],
  ["cream", "navy"], ["paper", "navy"], ["yellow", "navy"], ["paper", "tealInk"],
];

describe("brand palette", () => {
  it("is the palette the canonical logo is painted with", () => {
    const doc = readSvg("public/bibo-logo.svg");
    const fill = (selector: string) => inheritedAttribute(doc.querySelector(selector)!, "fill")?.toLowerCase();
    expect(fill('#bibo-inks > g[data-piece="b1"]')).toBe(brandTokens.color.teal);
    expect(fill('#bibo-inks > g[data-piece="i"]')).toBe(brandTokens.color.yellow);
    expect(fill('#bibo-inks > g[data-piece="b2"]')).toBe(brandTokens.color.orange);
    expect(fill('#bibo-inks > g[data-piece="o"]')).toBe(brandTokens.color.purple);
    expect(fill('#bibo-inks [data-piece="smile"]')).toBe(brandTokens.color.navy);
    expect(fill("#bibo-star")).toBe(brandTokens.color.amber);
    expect(fill("#bibo-sparkles > path")).toBe(brandTokens.color.teal);
    expect(fill("#bibo-diecuts > path")).toBe(brandTokens.color.paper);
    const palette = new Set<string>(Object.values(brandTokens.color));
    expect([...paintedColours(doc)].filter((colour) => !palette.has(colour))).toEqual([]);
  });

  it("uses the Bibo Bay channel's own inks and reef colours (ruling R55)", () => {
    // Sampled from the channel mark (900 px avatar) and banner on 2026-10-15.
    expect(brandTokens.color).toMatchObject({
      cream: "#fffbf8",
      teal: "#349da1",
      yellow: "#fdbb1f",
      amber: "#fcac21",
      orange: "#f06b32",
      purple: "#9467aa",
      navy: "#283b63",
    });
    // The sunlit reef: deep water at the top, azure, the light shafts, warm sand, the pink badge, Lumi's lilac.
    for (const name of ["oceanDeep", "ocean", "lagoon", "sandWarm", "coral", "lilac", "kelp"] as const) {
      expect(brandTokens.color[name], name).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(brandTokens.color.ocean).toBe("#0a8ef8");
  });

  it("writes every colour as lowercase six-digit hex", () => {
    for (const [name, value] of Object.entries(brandTokens.color)) expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(TEXT_PAIRS)("sets %s text on %s at WCAG AA contrast", (text, surface) => {
    expect(contrast(brandTokens.color[text], brandTokens.color[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps focus indicators at 3:1 against every surface they appear on", () => {
    for (const surface of ["cream", "paper", "sand"] as const) {
      expect(contrast(brandTokens.focus.color, brandTokens.color[surface])).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(brandTokens.focus.colorOnDark, brandTokens.color.navy)).toBeGreaterThanOrEqual(3);
  });
});

describe("type, space and surface tokens", () => {
  it("has exactly seven fluid type steps that stay readable", () => {
    expect(Object.keys(brandTokens.typeScale)).toEqual(["display", "h1", "h2", "h3", "lead", "body", "small"]);
    const maxima: number[] = [];
    for (const [name, step] of Object.entries(brandTokens.typeScale)) {
      const [min, max] = clampBounds(step.size);
      expect(min, name).toBeLessThanOrEqual(max);
      expect(Number(step.leading), name).toBeGreaterThanOrEqual(1);
      expect(Number(step.leading), name).toBeLessThanOrEqual(1.7);
      maxima.push(max);
    }
    expect(maxima).toEqual([...maxima].sort((a, b) => b - a));
    expect(new Set(maxima).size).toBe(maxima.length);
    expect(clampBounds(brandTokens.typeScale.body.size)[0]).toBeGreaterThanOrEqual(1);
    expect(clampBounds(brandTokens.typeScale.small.size)[0]).toBeGreaterThanOrEqual(0.875);
  });

  it("falls back to system faces when the web fonts are unavailable", () => {
    expect(brandTokens.font.display).toMatch(/^var\(--font-fredoka, "Fredoka"\), /);
    expect(brandTokens.font.display).toContain("ui-rounded");
    expect(brandTokens.font.display).toMatch(/sans-serif$/);
    expect(brandTokens.font.body).toMatch(/^var\(--font-plus-jakarta, "Plus Jakarta Sans"\), /);
    expect(brandTokens.font.body).toContain("system-ui");
    expect(brandTokens.font.body).toMatch(/sans-serif$/);
  });

  it("loads Fredoka and Plus Jakarta Sans onto the root element", () => {
    const html = RootLayout({ children: null });
    const classes = String(html.props.className ?? "").split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["--font-fredoka", "--font-plus-jakarta"]));
  });

  it("keeps a 16px mobile gutter and roomy sections", () => {
    expect(clampBounds(brandTokens.space.gutter)[0]).toBeGreaterThanOrEqual(1);
    expect(clampBounds(brandTokens.space.section)[0]).toBeGreaterThanOrEqual(3);
    for (const [name, value] of Object.entries(brandTokens.space)) expect(() => clampBounds(value), name).not.toThrow();
  });

  it("casts paper and felt shadows down and to the right", () => {
    for (const [name, value] of Object.entries(brandTokens.shadow)) {
      for (const layer of shadowLayers(value).filter((part) => !part.startsWith("inset"))) {
        const [x, y] = layer.split(/\s+/).map((part) => parseFloat(part));
        expect(x, `${name}: ${layer}`).toBeGreaterThanOrEqual(0);
        expect(y, `${name}: ${layer}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("motion tokens", () => {
  it("keeps tactile press feedback under 180 ms", () => {
    expect(brandTokens.motion.duration.press).toBeLessThan(180);
  });

  it("drops every duration to 0ms when reduced motion is requested", () => {
    const durationNames = Object.keys(brandCssVariables).filter((name) => name.startsWith("--bibo-duration-"));
    expect(durationNames).toHaveLength(Object.keys(brandTokens.motion.duration).length);
    expect(brandReducedMotionCssVariables).toEqual(Object.fromEntries(durationNames.map((name) => [name, "0ms"])));
    const reduced = reducedMotionRootBlock();
    for (const name of durationNames) expect(reduced.get(name), name).toBe("0ms");
  });

  it("neutralises animation and transition time globally under reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,[^{]*\{[^}]*animation-duration:\s*0\.01ms !important/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,[^{]*\{[^}]*transition-duration:\s*0\.01ms !important/);
  });
});

describe("CSS custom properties", () => {
  it("expose every typed token on :root with the identical value", () => {
    const root = rootBlock();
    const entries = Object.entries(brandCssVariables);
    expect(entries.length).toBeGreaterThan(40);
    for (const [name, value] of entries) expect(root.get(name), name).toBe(value);
  });

  it("declare no --bibo- property that the typed tokens do not know", () => {
    const known = new Set(Object.keys(brandCssVariables));
    expect([...rootBlock().keys()].filter((name) => name.startsWith("--bibo-") && !known.has(name))).toEqual([]);
  });

  it("map every brand colour to a Tailwind utility", () => {
    for (const name of Object.keys(brandTokens.color)) {
      const kebab = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(css).toContain(`--color-bibo-${kebab}: var(--bibo-color-${kebab});`);
    }
  });

  it("draws a visible focus ring from the focus tokens", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*var\(--bibo-focus-width\) solid var\(--bibo-focus-color\)/);
    expect(parseFloat(brandTokens.focus.width)).toBeGreaterThanOrEqual(2);
  });
});

describe("stylesheets after the palette change (rebrand review M5)", () => {
  it("draws no colour from the old palette", async () => {
    const { readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const sheets = execFileSync("git", ["ls-files", "app", "components"], { encoding: "utf8" }).split(/\r?\n/).filter((file) => file.endsWith(".css") || file.endsWith(".tsx"));
    for (const file of sheets) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const old of ["13294b", "f8f3e9"]) expect(text.includes(old), `${file} still uses #${old}`).toBe(false);
    }
  });
});
