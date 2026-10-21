/**
 * The delivery-claim pattern the site applies to the contact success message
 * (lib/content/claims.ts DELIVERY_CLAIM_PATTERN; tests/content/studio-contract.test.ts fails if the
 * two drift). The Studio has its own copy because it is built and installed on its own.
 */
export const DELIVERY_CLAIM_PATTERN = /\b(sent|emailed|deliver(ed|y)?|inbox|check your (email|mail)|we('ve| have) emailed)\b/i;

/**
 * The contact success message check (R192): the form saves a message and never says it was
 * emailed or delivered. `true` when fine, else the message the editor sees.
 */
export function deliveryClaimProblem(value: unknown): string | true {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) return true;
  return DELIVERY_CLAIM_PATTERN.test(message) ? "Say the message was received. Do not say it was sent, emailed or delivered, or that anyone should check their inbox." : true;
}
