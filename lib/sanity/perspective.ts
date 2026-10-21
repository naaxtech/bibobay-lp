import { validateApiPerspective } from "@sanity/client";
import { perspectiveCookieName } from "@sanity/preview-url-secret/constants";

/*
 * The perspective a Studio preview reads with (ruling R162). Presentation's switch picks drafts,
 * published, or a release stack (`rSummer1,drafts`); the enable route and the switch's server
 * action store it in this cookie, and draft-mode reads use it. Anything else reads as drafts.
 */

/** `sanity-preview-perspective`, the name Sanity's toolkits use. */
export const PERSPECTIVE_COOKIE = perspectiveCookieName;

/**
 * Set next to cookies written `Partitioned` inside the Presentation iframe (R163), so later writes
 * (the perspective switch, leaving draft mode) target the partitioned copies. Same name as next-sanity's.
 */
export const PARTITIONED_COOKIE = "sanity-preview-partitioned";

export type PreviewPerspective = "drafts" | "published" | string[];

/** Release ids and the two named perspectives: letters, digits, `_` and `-` only, so a value can never break a cookie. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A valid perspective, or null. `raw` (drafts and published side by side) is never a preview's view. */
export function parsePreviewPerspective(value: unknown): PreviewPerspective | null {
  const candidate = typeof value === "string" ? (value.includes(",") ? value.split(",") : value) : value;
  const names = Array.isArray(candidate) ? candidate : [candidate];
  if (names.length === 0 || names.length > 10 || !names.every((name) => typeof name === "string" && NAME.test(name))) return null;
  try {
    validateApiPerspective(candidate);
  } catch {
    return null;
  }
  if (candidate === "drafts" || candidate === "published") return candidate;
  if (Array.isArray(candidate)) return candidate as string[];
  return null;
}

/** The perspective to read with: the stored one when it is valid, else drafts. */
export function sanitizePreviewPerspective(value: unknown): PreviewPerspective {
  return parsePreviewPerspective(value) ?? "drafts";
}

/** The cookie form of a perspective. */
export const perspectiveCookieValue = (perspective: PreviewPerspective): string => (Array.isArray(perspective) ? perspective.join(",") : perspective);
