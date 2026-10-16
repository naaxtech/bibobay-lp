import manifest from "./activity-pack.manifest.json";
import { FREEBIE_PATH } from "./freebie-path";

/** A PDF in content/freebies, served only by the signed route (R140): one path segment, no dot segments, no protocol. */
export { FREEBIE_PATH };

/**
 * The free Bibo Bay Activity Pack (rulings R66-R69): a printable PDF in content/freebies, built by
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
 * The address an https download can be reached at from outside the site, and nothing for anything
 * unsafe. A repository file (FREEBIE_PATH) has no public address since R140: it is reached only
 * through the signed route (lib/leads/dependencies.ts), so it gives null here.
 */
export function absoluteFileUrl(fileUrl: string): string | null {
  if (FREEBIE_PATH.test(fileUrl)) return null;
  try {
    const url = new URL(fileUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}
