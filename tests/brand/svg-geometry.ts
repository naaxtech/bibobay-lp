import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Axis-aligned bounds of path data, including Bezier control points (a conservative hull). */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const TOKEN = /[MmLlHhVvCcSsQqTtZzAa]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const COMMAND = /^[A-Za-z]$/;

/** Read a repository file as text with Windows line endings normalised. */
export function readText(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8").replace(/\r\n/g, "\n");
}

export function parseSvg(markup: string): Document {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`SVG does not parse: ${error.textContent ?? ""}`);
  return doc;
}

export function readSvg(relativePath: string): Document {
  return parseSvg(readText(relativePath));
}

export function pathBounds(d: string): Bounds {
  const tokens = d.match(TOKEN) ?? [];
  const xs: number[] = [];
  const ys: number[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const next = (): number => {
    const token = tokens[index++];
    if (token === undefined || COMMAND.test(token)) throw new Error(`Malformed path data near token ${index}`);
    return Number(token);
  };
  const point = (relative: boolean): [number, number] => {
    const px = next() + (relative ? x : 0);
    const py = next() + (relative ? y : 0);
    xs.push(px);
    ys.push(py);
    return [px, py];
  };

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (COMMAND.test(token)) {
      command = token;
      index += 1;
      if (command === "Z" || command === "z") {
        x = startX;
        y = startY;
        continue;
      }
    } else if (!command) {
      throw new Error("Path data must start with a command");
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
        [x, y] = point(relative);
        [startX, startY] = [x, y];
        command = relative ? "l" : "L";
        break;
      case "L":
      case "T":
        [x, y] = point(relative);
        break;
      case "H":
        x = next() + (relative ? x : 0);
        xs.push(x);
        ys.push(y);
        break;
      case "V":
        y = next() + (relative ? y : 0);
        xs.push(x);
        ys.push(y);
        break;
      case "C": {
        point(relative);
        point(relative);
        [x, y] = point(relative);
        break;
      }
      case "S":
      case "Q": {
        point(relative);
        [x, y] = point(relative);
        break;
      }
      default:
        throw new Error(`Unsupported path command ${command}`);
    }
  }
  if (xs.length === 0) throw new Error("Path data has no points");
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function subpathCount(d: string): number {
  return (d.match(/[Mm]/g) ?? []).length;
}

export function unionBounds(list: readonly Bounds[]): Bounds {
  if (list.length === 0) throw new Error("No bounds to combine");
  return {
    minX: Math.min(...list.map((b) => b.minX)),
    minY: Math.min(...list.map((b) => b.minY)),
    maxX: Math.max(...list.map((b) => b.maxX)),
    maxY: Math.max(...list.map((b) => b.maxY)),
  };
}

/** Bounds of every path inside an element (or of the element itself when it is a path). */
export function elementBounds(element: Element): Bounds {
  const paths = element.tagName === "path" ? [element] : Array.from(element.querySelectorAll("path"));
  return unionBounds(paths.map((path) => pathBounds(path.getAttribute("d") ?? "")));
}

export const width = (b: Bounds) => b.maxX - b.minX;
export const height = (b: Bounds) => b.maxY - b.minY;
export const centre = (b: Bounds): [number, number] => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

export function contains(outer: Bounds, inner: Bounds, tolerance = 0): boolean {
  return (
    inner.minX >= outer.minX - tolerance &&
    inner.minY >= outer.minY - tolerance &&
    inner.maxX <= outer.maxX + tolerance &&
    inner.maxY <= outer.maxY + tolerance
  );
}

export function containsPoint(outer: Bounds, [px, py]: [number, number]): boolean {
  return px >= outer.minX && px <= outer.maxX && py >= outer.minY && py <= outer.maxY;
}

/** Presentation attribute resolved through ancestors, as SVG inheritance does. */
export function inheritedAttribute(element: Element, name: string): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = node.getAttribute(name);
    if (value !== null) return value;
  }
  return null;
}

export function viewBoxOf(doc: Document): [number, number, number, number] {
  const parts = (doc.documentElement.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("SVG has no usable viewBox");
  return parts as [number, number, number, number];
}

/** Every literal colour painted by the document, outside masks (fill, stroke, flood and stop colours). */
export function paintedColours(doc: Document): Set<string> {
  const colours = new Set<string>();
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (element.closest("mask")) continue;
    for (const name of ["fill", "stroke", "flood-color", "stop-color"]) {
      const value = element.getAttribute(name)?.trim().toLowerCase();
      if (value && value !== "none" && !value.startsWith("url(")) colours.add(value);
    }
  }
  return colours;
}
