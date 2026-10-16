/**
 * Where the repository's own free downloads live: /freebies/<lower-case-name>.pdf, nothing else
 * (no traversal, encoding, query or other folder). Shared by the CMS normalizer, the email link and
 * the analytics click classifier, which must agree on what counts as the pack.
 */
export const FREEBIE_PATH = /^\/freebies\/[a-z0-9][a-z0-9-]*\.pdf$/;

/**
 * The signed-download route (ruling R140, 2026-10-16): the pack is never a public file; it is
 * served only through this route, with a token the signup answer and the acknowledgement carry.
 */
export const DOWNLOAD_ROUTE = "/api/freebies/download";
