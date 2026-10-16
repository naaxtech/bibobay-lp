/**
 * The consent-version token the site stores (lib/leads/dependencies.ts CONSENT_VERSION_PATTERN;
 * tests/content/studio-contract.test.ts fails if the two drift). The Studio has its own copy because
 * it is built and installed on its own.
 */
export const CONSENT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/;

/**
 * The order consent version check (R82, Task 7c review M5a): a version is required whenever the
 * order consent sentence is set, and it must be a short token. `true` when fine, else the message.
 */
export function orderConsentVersionProblem(value: unknown, copy: unknown): string | true {
  const version = typeof value === "string" ? value.trim() : "";
  if (!version) return typeof copy === "string" && copy.trim() ? "Set a version whenever the order consent sentence is set" : true;
  return CONSENT_VERSION.test(version) ? true : "Use a short token: letters, digits, . _ : - (at most 40 characters)";
}
