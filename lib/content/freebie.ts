import manifest from "./activity-pack.manifest.json";
import { FREEBIE_PATH } from "./freebie-path";

/** A PDF this site serves from public/freebies: one path segment, no dot segments, no protocol. */
export { FREEBIE_PATH };

/**
 * The free Bibo Bay Activity Pack (rulings R66-R69): a printable PDF in public/freebies, built by
 * scripts/freebie/build_activity_pack.py from the site's own copy and the channel's stills. The
 * generator writes activity-pack.manifest.json; tests/freebie pins the file to it.
 */
export const ACTIVITY_PACK = {
  fileUrl: "/freebies/bibo-bay-activity-pack.pdf",
  pages: manifest.pages.length,
  bytes: manifest.bytes,
} as const;

export interface PackPreview {
  page: string;
  alt: string;
  /** Pre-sized WebP renders of the page, smallest first (no runtime image optimiser, R65). */
  variants: Array<{ src: string; width: number; height: number }>;
}

/** Page previews for the download card: the cover first. */
export function activityPackPreviews(): PackPreview[] {
  return manifest.previews;
}

/** True when a CMS download is the repository's own pack, so its previews and size describe it. */
export function isRepositoryPack(fileUrl: string | undefined): boolean {
  return fileUrl === ACTIVITY_PACK.fileUrl;
}

/**
 * The address a download can be reached at from outside the site (an email): https files as they
 * are, repository files against the site's verified origin, and nothing while that is unknown.
 */
export function absoluteFileUrl(fileUrl: string, origin: URL | null): string | null {
  if (FREEBIE_PATH.test(fileUrl)) return origin ? new URL(fileUrl, origin).toString() : null;
  try {
    const url = new URL(fileUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
