/**
 * Words that promise a message was emailed or delivered (C7, R192). The contact form saves a
 * message; it does not tell the sender anything was sent. A CMS success message that matches is
 * replaced with the repository's (normalizeContactPage), and the Studio refuses it at the field
 * (studio/schemaTypes/contact.ts keeps its own copy; tests/content/studio-contract.test.ts fails
 * if the two drift). Browser-safe: no server-only import.
 */
export const DELIVERY_CLAIM_PATTERN = /\b(sent|emailed|deliver(ed|y)?|inbox|check your (email|mail)|we('ve| have) emailed)\b/i;
