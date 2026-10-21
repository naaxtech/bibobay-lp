import type { ContentSourceMap } from "@sanity/client";
import { stegaEncodeSourceMap } from "@sanity/client/stega";

/*
 * Stega the way Sanity's Presentation tool produces it (ruling R160): the real encoder from
 * @sanity/client, fed a Content Source Map that maps every string leaf back to one document.
 */

export const TEST_STUDIO_URL = "https://bibobay.sanity.studio";

type Segment = string | number;

const jsonPath = (path: readonly Segment[]) => `$${path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `['${segment}']`)).join("")}`;

function stringLeaves(value: unknown, path: Segment[] = [], out: Segment[][] = []): Segment[][] {
  if (typeof value === "string") out.push(path);
  else if (Array.isArray(value)) value.forEach((entry, index) => stringLeaves(entry, [...path, index], out));
  else if (value !== null && typeof value === "object") for (const [key, entry] of Object.entries(value)) stringLeaves(entry, [...path, key], out);
  return out;
}

/**
 * Encodes every string a query result could carry a payload in: all of them except values under a
 * `_` key (`_id`, `_type`, `_key`, `_ref`), which Sanity never encodes. That is stricter than
 * Sanity's default filter, which also skips URLs, dates, ids, slugs, `seo` and a list of key names,
 * so code that survives this survives any filter.
 */
export function encodeAllStrings<T>(result: T, document: { _id: string; _type: string } = { _id: "landingPage", _type: "landingPage" }): T {
  const leaves = stringLeaves(result).filter((path) => !path.some((segment) => typeof segment === "string" && segment.startsWith("_")));
  const paths = leaves.map(jsonPath);
  const csm = {
    documents: [document],
    paths,
    mappings: Object.fromEntries(paths.map((path, index) => [path, { type: "value", source: { type: "documentValue", document: 0, path: index } }])),
  } as unknown as ContentSourceMap;
  return stegaEncodeSourceMap(result, csm, { enabled: true, studioUrl: TEST_STUDIO_URL, filter: () => true });
}

/** One encoded string, for focused cases. */
export const encodeString = (value: string): string => encodeAllStrings({ value }).value;

/** Any of the invisible characters a stega payload is written in. */
export const STEGA_CHARACTER = /[\u200B\u200C\u200D\u2060-\u2063\uFEFF]|\u{1D173}|\u{1D174}|\u{1D175}|\u{1D176}|\u{1D177}|\u{1D178}|\u{1D179}|\u{1D17A}/u;
