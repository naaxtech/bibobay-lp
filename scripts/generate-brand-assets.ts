import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { brandTokens } from "../lib/brand/tokens";

/**
 * public/bibo-logo.svg is the only hand-drawn logo file. Every other logo artefact is derived
 * from its geometry here; tests/brand/brand-assets.test.ts fails if a derived file drifts.
 * Regenerate after editing the canonical file: npm run brand:generate
 */
export const BRAND_ASSET_SOURCE = "public/bibo-logo.svg";
export const BRAND_ASSET_TARGETS = [
  "public/brand/bibo-mark.svg",
  "public/brand/bibo-logo-monochrome.svg",
  "app/icon.svg",
] as const;
export type BrandAssetTarget = (typeof BRAND_ASSET_TARGETS)[number];

/** Breathing room around the lockup in the square mark, as a share of the logo's width. */
const MARK_PADDING = 0.06;
/** The favicon keeps almost no margin so the letters stay legible at 16-32px. */
const ICON_PADDING = 0.02;

interface XmlElement {
  kind: "element";
  name: string;
  attributes: Map<string, string>;
  children: XmlNode[];
}
interface XmlText {
  kind: "text";
  value: string;
}
interface XmlComment {
  kind: "comment";
  value: string;
}
type XmlNode = XmlElement | XmlText | XmlComment;

const TAG =
  /<!--([\s\S]*?)-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Minimal parser for the canonical file: elements, double- or single-quoted attributes, text, comments. */
function parseSvg(source: string): XmlElement {
  const document: XmlElement = { kind: "element", name: "#document", attributes: new Map(), children: [] };
  const stack: XmlElement[] = [document];
  let cursor = 0;
  for (const match of source.matchAll(TAG)) {
    const parent = stack[stack.length - 1]!;
    const start = match.index ?? 0;
    const text = source.slice(cursor, start).trim();
    if (text) parent.children.push({ kind: "text", value: text });
    cursor = start + match[0].length;

    const [, comment, closing, name, attributeText, selfClosing] = match;
    if (comment !== undefined) {
      parent.children.push({ kind: "comment", value: comment });
    } else if (name && closing) {
      if (stack.pop()?.name !== name) throw new Error(`Unbalanced </${name}> in ${BRAND_ASSET_SOURCE}`);
    } else if (name) {
      const attributes = new Map(
        [...(attributeText ?? "").matchAll(ATTRIBUTE)].map(([, key, doubleQuoted, singleQuoted]) => [
          key!,
          doubleQuoted ?? singleQuoted ?? "",
        ]),
      );
      const element: XmlElement = { kind: "element", name, attributes, children: [] };
      parent.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  if (source.slice(cursor).trim()) throw new Error(`Unexpected trailing content in ${BRAND_ASSET_SOURCE}`);
  if (stack.length !== 1) throw new Error(`Unclosed <${stack[stack.length - 1]!.name}> in ${BRAND_ASSET_SOURCE}`);
  const roots = document.children.filter((node): node is XmlElement => node.kind === "element");
  if (roots.length !== 1 || roots[0]!.name !== "svg") throw new Error(`${BRAND_ASSET_SOURCE} must have one <svg> root`);
  return roots[0]!;
}

function serialize(element: XmlElement, depth = 0): string {
  const indent = "  ".repeat(depth);
  const attributes = [...element.attributes].map(([key, value]) => ` ${key}="${value}"`).join("");
  if (element.children.length === 0) return `${indent}<${element.name}${attributes}/>`;
  if (element.children.every((child) => child.kind === "text")) {
    const text = element.children.map((child) => (child as XmlText).value).join(" ");
    return `${indent}<${element.name}${attributes}>${text}</${element.name}>`;
  }
  const inner = element.children.map((child) => {
    if (child.kind === "element") return serialize(child, depth + 1);
    return child.kind === "comment" ? `${indent}  <!--${child.value}-->` : `${indent}  ${child.value}`;
  });
  return [`${indent}<${element.name}${attributes}>`, ...inner, `${indent}</${element.name}>`].join("\n");
}

const childElements = (node: XmlElement) => node.children.filter((child): child is XmlElement => child.kind === "element");

function findById(node: XmlElement, id: string): XmlElement | undefined {
  if (node.attributes.get("id") === id) return node;
  for (const child of childElements(node)) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

function requireById(svg: XmlElement, id: string): XmlElement {
  const found = findById(svg, id);
  if (!found) throw new Error(`${BRAND_ASSET_SOURCE} is missing #${id}`);
  return found;
}

function viewBoxOf(svg: XmlElement): [number, number, number, number] {
  const parts = (svg.attributes.get("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${BRAND_ASSET_SOURCE} needs a numeric viewBox`);
  }
  return parts as [number, number, number, number];
}

/** Same artwork on a square canvas centred on the canonical frame. */
function squareFrame(svg: XmlElement, padding: number): XmlElement {
  const framed = structuredClone(svg);
  const [x, y, width, height] = viewBoxOf(svg);
  const side = Math.round(Math.max(width, height) * (1 + 2 * padding));
  const left = Math.round(x + width / 2 - side / 2);
  const top = Math.round(y + height / 2 - side / 2);
  framed.attributes.set("viewBox", `${left} ${top} ${side} ${side}`);
  framed.attributes.set("width", String(side));
  framed.attributes.set("height", String(side));
  return framed;
}

/** Drops every filter and filter reference; geometry is untouched. */
function withoutShadows(svg: XmlElement): XmlElement {
  const strip = (node: XmlElement) => {
    node.attributes.delete("filter");
    node.children = node.children.filter((child) => !(child.kind === "element" && child.name === "filter"));
    childElements(node).forEach(strip);
  };
  strip(svg);
  svg.children = svg.children.filter((child) => !(child.kind === "element" && child.name === "defs" && child.children.length === 0));
  return svg;
}

/** Single-ink logo: the letterforms, sun, rays and smile in one colour. Paper stickers need a second tone. */
function monochrome(svg: XmlElement, ink: string): XmlElement {
  const inks = structuredClone(requireById(svg, "bibo-inks"));
  const stripFill = (node: XmlElement) => {
    node.attributes.delete("fill");
    childElements(node).forEach(stripFill);
  };
  stripFill(inks);
  inks.attributes.set("fill", ink);
  const title = childElements(svg).find((child) => child.name === "title");
  return {
    kind: "element",
    name: "svg",
    attributes: new Map(svg.attributes),
    children: [...(title ? [structuredClone(title)] : []), inks],
  };
}

/** Replaces the canonical file's editing note with a generated-file notice. */
function withNotice(svg: XmlElement, purpose: string): XmlElement {
  svg.children = svg.children.filter((child) => child.kind !== "comment");
  const titleIndex = svg.children.findIndex((child) => child.kind === "element" && child.name === "title");
  svg.children.splice(titleIndex + 1, 0, {
    kind: "comment",
    value: ` ${purpose} Generated from ${BRAND_ASSET_SOURCE} by scripts/generate-brand-assets.ts; do not edit by hand. `,
  });
  return svg;
}

export function deriveBrandAssets(canonicalSvg: string): Record<BrandAssetTarget, string> {
  const svg = parseSvg(canonicalSvg.replace(/\r\n/g, "\n"));
  requireById(svg, "bibo-diecuts");
  requireById(svg, "bibo-inks");
  const file = (node: XmlElement) => `${serialize(node)}\n`;
  return {
    "public/brand/bibo-mark.svg": file(
      withNotice(squareFrame(svg, MARK_PADDING), "Square BIBO mark for avatars, app icons and social images."),
    ),
    "public/brand/bibo-logo-monochrome.svg": file(
      withNotice(monochrome(svg, brandTokens.color.navy), "Single-ink BIBO logo for one-colour reproduction."),
    ),
    "app/icon.svg": file(
      withNotice(withoutShadows(squareFrame(svg, ICON_PADDING)), "Favicon: the square lockup without shadow blur."),
    ),
  };
}

// Importing this module (tests) never touches the filesystem; running it writes stale targets.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const derived = deriveBrandAssets(readFileSync(resolve(BRAND_ASSET_SOURCE), "utf8"));
  for (const target of BRAND_ASSET_TARGETS) {
    const path = resolve(target);
    const current = existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : undefined;
    if (current === derived[target]) {
      console.log(`Up to date: ${target}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, derived[target]);
    console.log(`Wrote ${target}`);
  }
}
