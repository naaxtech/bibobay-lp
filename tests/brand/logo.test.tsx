import { readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  centre,
  contains,
  containsPoint,
  elementBounds,
  height,
  inheritedAttribute,
  parseSvg,
  pathBounds,
  readSvg,
  readText,
  subpathCount,
  unionBounds,
  viewBoxOf,
  width,
} from "./svg-geometry";

// Structural contract for the one canonical logo file. It parses the SVG on disk and imports
// no production module, so it fails on the geometry itself rather than on a missing file.

const CANONICAL = "public/bibo-logo.svg";
const LETTERS = ["b1", "i", "b2", "o"] as const;
const RAYS = ["ray-left", "ray-top", "ray-right"] as const;

const canonical = () => readSvg(CANONICAL);
const dieCut = (doc: Document, piece: string) => doc.querySelector(`#bibo-diecuts > path[data-piece="${piece}"]`);
const letter = (doc: Document, piece: string) => doc.querySelector(`#bibo-inks > g[data-piece="${piece}"]`);
const fillOf = (element: Element | null) => (element ? inheritedAttribute(element, "fill")?.toLowerCase() : undefined);

function shadowFilterOf(doc: Document, element: Element) {
  const id = /^url\(#([\w-]+)\)$/.exec(element.getAttribute("filter") ?? "")?.[1];
  return id ? doc.querySelector(`filter#${id} feDropShadow`) : null;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as [number, number, number];
}

describe("canonical BIBO logo", () => {
  it("names itself BIBO through its own title", () => {
    const svg = canonical().documentElement;
    expect(svg.getAttribute("role")).toBe("img");
    const titleId = svg.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(svg.querySelector(`title[id="${titleId}"]`)?.textContent).toBe("BIBO");
  });

  it("contains no white silhouette shared by more than one letter", () => {
    const doc = canonical();
    const [, , viewWidth] = viewBoxOf(doc);
    const whitePaths = Array.from(doc.querySelectorAll("path")).filter((path) => /^#f{3}(?:f{3})?$/.test(fillOf(path) ?? ""));
    for (const path of whitePaths) {
      expect(width(pathBounds(path.getAttribute("d") ?? ""))).toBeLessThan(viewWidth * 0.4);
    }
    expect(whitePaths.length).toBeGreaterThanOrEqual(LETTERS.length);
  });

  it("cuts each of the four letters on its own white die-cut sticker", () => {
    const doc = canonical();
    const cuts = LETTERS.map((piece) => dieCut(doc, piece));
    cuts.forEach((cut, index) => {
      expect(cut, `die-cut for ${LETTERS[index]}`).not.toBeNull();
      expect(fillOf(cut)).toBe("#ffffff");
      const d = cut!.getAttribute("d") ?? "";
      expect(subpathCount(d), "one closed contour per sticker").toBe(1);
      expect(d.trim().toUpperCase().endsWith("Z")).toBe(true);
    });
    expect(new Set(cuts.map((cut) => cut?.getAttribute("d"))).size).toBe(LETTERS.length);
  });

  it("gives every sticker its own soft down-right paper shadow", () => {
    const doc = canonical();
    for (const piece of [...LETTERS, ...RAYS]) {
      const cut = dieCut(doc, piece);
      expect(cut, `die-cut for ${piece}`).not.toBeNull();
      const shadow = shadowFilterOf(doc, cut!);
      expect(shadow, `paper shadow on ${piece}`).not.toBeNull();
      expect(Number(shadow!.getAttribute("dx"))).toBeGreaterThan(0);
      expect(Number(shadow!.getAttribute("dy"))).toBeGreaterThan(0);
      expect(Number(shadow!.getAttribute("stdDeviation"))).toBeGreaterThan(0);
    }
  });

  it("fits each sticker around its own letter and no other", () => {
    const doc = canonical();
    const groups = LETTERS.map((piece) => letter(doc, piece));
    groups.forEach((group, index) => expect(group, `letter group ${LETTERS[index]}`).not.toBeNull());
    const inks = Object.fromEntries(LETTERS.map((piece, index) => [piece, elementBounds(groups[index]!)]));
    const word = unionBounds(Object.values(inks));
    for (const piece of LETTERS) {
      const cut = pathBounds(dieCut(doc, piece)?.getAttribute("d") ?? "");
      expect(contains(cut, inks[piece]!, 1), `${piece} sticker covers its letter`).toBe(true);
      expect(width(cut)).toBeLessThan(width(word) * 0.4);
      for (const other of LETTERS.filter((candidate) => candidate !== piece)) {
        expect(containsPoint(cut, centre(inks[other]!)), `${piece} sticker reaches into ${other}`).toBe(false);
      }
    }
  });

  it("paints the letters as four separately coloured groups with open counters", () => {
    const doc = canonical();
    const groups = LETTERS.map((piece) => letter(doc, piece));
    groups.forEach((group, index) => expect(group, `letter group ${LETTERS[index]}`).not.toBeNull());
    expect(new Set(groups.map((group) => group?.getAttribute("fill")?.toLowerCase())).size).toBe(4);

    const contours = { b1: 3, b2: 3, o: 2 } as const;
    for (const [piece, expected] of Object.entries(contours)) {
      const path = letter(doc, piece)!.querySelector("path")!;
      expect(subpathCount(path.getAttribute("d") ?? ""), `${piece} outer contour plus counters`).toBe(expected);
      expect(inheritedAttribute(path, "fill-rule")).toBe("evenodd");
    }
    expect(letter(doc, "i")!.querySelector("#bibo-i-stem")).not.toBeNull();
    expect(letter(doc, "i")!.querySelector("#bibo-sun")).not.toBeNull();
  });

  it("crowns the i with a sun dot and exactly three rays, each on its own backing", () => {
    const doc = canonical();
    const sunElement = doc.querySelector("#bibo-sun");
    expect(sunElement).not.toBeNull();
    const sun = elementBounds(sunElement!);
    const rays = Array.from(doc.querySelectorAll("#bibo-sun-rays > path"));
    expect(rays.map((ray) => ray.getAttribute("data-piece"))).toEqual([...RAYS]);

    const [left, top, right] = rays.map((ray) => pathBounds(ray.getAttribute("d") ?? ""));
    for (const ray of [left!, top!, right!]) expect(centre(ray)[1]).toBeLessThan(sun.minY);
    expect(centre(left!)[0]).toBeLessThan(centre(sun)[0]);
    expect(centre(right!)[0]).toBeGreaterThan(centre(sun)[0]);
    // Bounds include Bezier control points, which widen the rounded caps; diagonals stay near square.
    expect(height(top!)).toBeGreaterThan(width(top!) * 1.5);
    for (const diagonal of [left!, right!]) {
      expect(Math.min(width(diagonal), height(diagonal)) / Math.max(width(diagonal), height(diagonal))).toBeGreaterThan(0.5);
    }

    // Left ray warm amber, upright ray in the second B's coral-orange, right ray in the first B's teal.
    const [leftFill, topFill, rightFill] = rays.map((ray) => fillOf(ray));
    expect(new Set([leftFill, topFill, rightFill]).size).toBe(3);
    expect(topFill).toBe(fillOf(letter(doc, "b2")));
    expect(rightFill).toBe(fillOf(letter(doc, "b1")));
    expect(leftFill).not.toBe(fillOf(sunElement));

    for (const piece of RAYS) {
      const backing = dieCut(doc, piece);
      expect(backing, `backing for ${piece}`).not.toBeNull();
      const ray = pathBounds(doc.querySelector(`#bibo-sun-rays > path[data-piece="${piece}"]`)?.getAttribute("d") ?? "");
      expect(contains(pathBounds(backing!.getAttribute("d") ?? ""), ray, 1)).toBe(true);
    }
  });

  it("draws one shallow navy smile under the i and the second B", () => {
    const doc = canonical();
    const smiles = doc.querySelectorAll('#bibo-inks [data-piece="smile"]');
    expect(smiles).toHaveLength(1);
    const [r, g, b] = rgb(fillOf(smiles[0]!) ?? "#ffffff");
    expect(b).toBeGreaterThan(r);
    expect(r + g + b).toBeLessThan(160);

    const smile = elementBounds(smiles[0]!);
    const stem = elementBounds(doc.querySelector("#bibo-i-stem")!);
    expect(smile.minX).toBeGreaterThan(centre(elementBounds(letter(doc, "b1")!))[0]);
    expect(smile.maxX).toBeLessThan(centre(elementBounds(letter(doc, "o")!))[0]);
    expect(smile.minY).toBeGreaterThan(Math.max(stem.maxY, elementBounds(letter(doc, "b2")!).maxY));
    expect(width(smile)).toBeGreaterThan(height(smile) * 3);
  });

  it("keeps the hand-cut irregular baselines and tops", () => {
    const doc = canonical();
    const shapes = [
      letter(doc, "b1"),
      doc.querySelector("#bibo-i-stem"),
      letter(doc, "b2"),
      letter(doc, "o"),
    ].map((element) => {
      expect(element).not.toBeNull();
      return elementBounds(element!);
    });
    const tallest = Math.max(...shapes.map(height));
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(shapes.map((shape) => shape.maxY))).toBeGreaterThan(tallest * 0.03);
    expect(spread(shapes.map((shape) => shape.minY))).toBeGreaterThan(tallest * 0.03);
  });
});

describe("single logo geometry source", () => {
  const ACTIVE_SOURCE = ["app", "components", "lib", "scripts"];
  const TEXT_FILES = new Set([".ts", ".tsx", ".css", ".js", ".mjs", ".json", ".md", ".svg"]);
  const DERIVED = ["public/brand/bibo-mark.svg", "public/brand/bibo-logo-monochrome.svg", "app/icon.svg"];

  function walk(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? walk(path) : [path.replaceAll("\\", "/")];
    });
  }

  it("keeps the BiboLogo component free of copied path data", () => {
    const source = readText("components/brand/BiboLogo.tsx");
    expect(source).toContain("/bibo-logo.svg");
    expect(source).not.toMatch(/<path|<svg|\bd=|viewBox/);
  });

  it("never inlines the canonical paths anywhere in the application source", () => {
    const fingerprints = Array.from(canonical().querySelectorAll("path")).map((path) => (path.getAttribute("d") ?? "").slice(0, 48));
    const offenders = ACTIVE_SOURCE.flatMap(walk)
      .filter((file) => TEXT_FILES.has(extname(file)) && !DERIVED.includes(file))
      .filter((file) => {
        // Read each file once, not once per fingerprint: the scan grows with the source tree.
        const text = readText(file);
        return fingerprints.some((fingerprint) => text.includes(fingerprint));
      });
    expect(offenders).toEqual([]);
  });

  it("publishes the canonical file and every derived artefact as parseable SVG", () => {
    for (const file of [CANONICAL, ...DERIVED]) {
      expect(() => parseSvg(readText(file)), file).not.toThrow();
    }
  });
});
