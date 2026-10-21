/*
 * Stega: the invisible click-to-edit payload Sanity appends to strings when the Studio's
 * Presentation tool previews the site (ruling R160). It only ever reaches draft-mode reads
 * (lib/sanity/client.ts, R159); published content never carries it.
 *
 * Text keeps its payload, because that is what makes it clickable in the preview. Every value the
 * site decides with (ids, enums, URLs, addresses, codes, colours) is cleaned first.
 *
 * Dependency-free on purpose: client components (the friends section) use it too, and importing
 * @sanity/client/stega there would ship the Sanity client to every visitor. The character set is
 * @vercel/stega's (VERCEL_STEGA_REGEX, used by @sanity/client's stegaClean), and
 * tests/content/stega.test.ts pins this copy against the library's own cleaner.
 */

const STEGA_RUN = /[\u200B\u200C\u200D\u2060-\u2063\uFEFF\u{1D173}-\u{1D17A}]{4,}/gu;

/** The string without any payload. */
export function stegaCleanText(value: string): string {
  return value.replace(STEGA_RUN, "");
}

/** Any value with every string in it cleaned: arrays and plain objects deeply; class instances (URL, Date) untouched. */
export function cleanStega<T>(value: T): T {
  if (typeof value === "string") return stegaCleanText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => cleanStega(entry)) as T;
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cleanStega(entry)])) as T;
  }
  return value;
}

/** A string cleaned for a decision; anything else unchanged. */
export function plain(value: unknown): unknown {
  return typeof value === "string" ? stegaCleanText(value) : value;
}

/**
 * Display text: trimmed, with its payload kept at the end. A plain `trim()` would keep the payload
 * too, but sees a field an editor emptied as non-empty (the payload is all that is left), so the
 * page would show nothing where the published site shows its fallback; and it leaves whitespace
 * stranded in front of the payload.
 */
export function stegaText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const text = stegaCleanText(value);
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  // Sanity appends the payload; anything else (a hand-made run inside the text) is dropped, not misplaced.
  const payload = value.startsWith(text) ? value.slice(text.length) : "";
  return trimmed + payload;
}

/**
 * Text and its payload apart, for text the site splits for display (ruling R170): the pieces are
 * cut from the clean text and the payload is rendered once, beside them, on the element that should
 * be clickable as a whole.
 */
export function stegaSplit(value: string): { text: string; payload: string } {
  const text = stegaCleanText(value);
  return { text, payload: value.startsWith(text) ? value.slice(text.length) : "" };
}
