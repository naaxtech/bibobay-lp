import "server-only";

import { basename, join } from "node:path";

import { FREEBIE_PATH } from "@/lib/content/freebie-path";

/** Where the free downloads live in the repository (ruling R140): outside `public/`, so never a public address. */
export const FREEBIE_CONTENT_DIR = "content/freebies";

/**
 * The repository file for a `/freebies/<name>.pdf` url, or null for anything else. The pattern is
 * checked before any path is built, and the join is against `<cwd>/content`, so the result is always
 * a file directly under content/freebies.
 */
export function freebieFilePath(fileUrl: string, cwd: string = process.cwd()): string | null {
  if (!FREEBIE_PATH.test(fileUrl)) return null;
  return join(cwd, FREEBIE_CONTENT_DIR, basename(fileUrl));
}
