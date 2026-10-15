/**
 * Every message the order and tracking API routes return (Task 7a). The CMS content contract has
 * no order copy yet, so these repository strings are the source, as FORM_COPY (./form-copy.ts) is
 * for the lead form's interface chrome; Task 7b's order and tracking forms add their labels here.
 *
 * Truth rules (spec §3 ruling 3, §10): an order request is "received" only once the database
 * stored it; nothing here may say an email was sent, show a price, or suggest a payment was taken
 * (none ever is). tests/orders/order-submit.test.ts scans every string below for such claims.
 */
export const ORDER_COPY = {
  outcome: {
    /** HTTP 200: the order and its lines are stored. Shown with the order reference. */
    received:
      "Thank you, we have your order request. Nothing has been charged. We will check availability and contact you by email with a quote and a payment link.",
    /** HTTP 400 with field errors; the form shows its own summary instead. */
    checkDetails: "Please check the highlighted fields and try again.",
    /** HTTP 400: a product is unknown, sold out or no longer listed. Never names which one. */
    productsUnavailable: "Some products on your order cannot be ordered right now. Please review your order and try again.",
    /** HTTP 429. */
    rateLimited: "There have been several order requests from this connection. Please wait a while and try again.",
    /** HTTP 400 for a malformed request, and 500: the order could not be confirmed. */
    notConfirmed: "We could not confirm your order request. Nothing has been charged. Please try again in a few minutes.",
    /** HTTP 503: storage, the rate limiter or the catalogue is unavailable, so nothing was stored. */
    busy: "We cannot take order requests right now. Nothing has been charged. Please try again later.",
    /** HTTP 404 while ordering is switched off. */
    unavailable: "Ordering is not available on this website.",
  },
  tracking: {
    /** HTTP 404 for every miss: unknown, expired, malformed, or a reference with the wrong email. */
    notFound: "We could not find an order with those details. Check the order reference and the email you ordered with, or the link you were given.",
    /** HTTP 429. */
    rateLimited: "There have been several lookups from this connection. Please wait a few minutes and try again.",
    /** HTTP 400 for a malformed request, 500 and 503. */
    failed: "Order tracking is not available right now. Please try again later.",
    /** HTTP 404 while tracking is switched off. */
    unavailable: "Order tracking is not available on this website.",
  },
} as const;
