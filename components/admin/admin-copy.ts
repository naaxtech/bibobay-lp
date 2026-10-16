/**
 * Every message the staff API routes return (Task 8b), for the staff pages Task 8c builds on them.
 * The CMS has no staff copy, so these repository strings are the source, as ORDER_COPY
 * (components/forms/order-copy.ts) is for the order flow.
 *
 * Truth rules (spec §3 ruling 3, §10): a quote is "saved" only once the database stored it, and
 * "queued" only once its outbox row exists; nothing here says an email was sent or a payment taken,
 * because the API never knows that when it answers. tests/admin/admin-copy.test.ts scans these
 * strings for such claims.
 */
export const ADMIN_COPY = {
  api: {
    /** HTTP 403: a cross-site or non-JSON request, or a signed-in user who is not active staff (the same answer for both). */
    forbidden: "You do not have access to this.",
    /** HTTP 401: no staff session, or one that has ended. */
    signedOut: "Please sign in to continue.",
    /** HTTP 503: staff sign-in is not configured on this deployment. */
    unconfigured: "Staff sign-in is not available on this website yet.",
    /** HTTP 503: the sign-in service or the database did not answer. Nothing was changed. */
    unavailable: "Staff sign-in cannot be checked right now. Nothing was changed. Please try again in a few minutes.",
    /** HTTP 404. */
    notFound: "There is no order with this reference.",
    /** HTTP 400 with field problems. */
    checkDetails: "Please check the highlighted fields and try again. Nothing was changed.",
    /** HTTP 400: the request body could not be read. */
    badRequest: "The request could not be read. Nothing was changed.",
    /** HTTP 409: the order's status or quote changed since it was opened. */
    stale: "This order changed since you opened it. Nothing was changed. Reload the order and try again.",
    /** HTTP 409: not possible in the order's state (a quote after `confirmed`, or a send before any quote is saved). */
    notAllowed: "This order's current state does not allow that. Nothing was changed. A quote can be saved and sent only while the order is new or confirmed, and only after it is saved.",
    /** HTTP 500. */
    failed: "Something went wrong and nothing was changed. Please try again.",
  },
  session: {
    /** HTTP 200 after sign-in. */
    signedIn: "You are signed in.",
    /** HTTP 200 after sign-out. */
    signedOut: "You are signed out.",
    /** HTTP 401: wrong email or password, or an account without staff access. Never says which. */
    refused: "That email and password did not sign you in to staff access.",
    /** HTTP 400: a sign-in request without an email and a password. */
    checkDetails: "Please enter your email and your password.",
    /** HTTP 429. */
    rateLimited: "There have been too many sign-in attempts. Please wait a few minutes and try again.",
  },
  quote: {
    /** HTTP 200 after a save (R96: saving never notifies anyone). */
    saved: "Quote saved. Nothing has been sent to the customer: send it when it is ready.",
    /** HTTP 200 after a send: the email is queued; its delivery shows on the order once attempted. */
    queued: "Quote queued for email. Its delivery status shows on the order once the email has been attempted.",
    /** HTTP 200 for a revision that was already queued: nothing more was queued. */
    alreadyQueued: "This quote was already queued for email, so nothing more was queued.",
    /** HTTP 400 while PAYMENT_HOST_ALLOWLIST is empty (R97). */
    noPaymentHosts:
      "No quote can be saved yet: every quote needs a payment link, and the website has no allowed payment providers. The site owner sets them (PAYMENT_HOST_ALLOWLIST).",
  },
  status: {
    /** HTTP 200 after a status change. */
    changed: "Order status updated.",
  },
  trackingLink: {
    /** HTTP 200: the new private link is shown once; only a hash of it is kept. */
    rotated: "New tracking link created. Copy it now: it is shown only once. The previous link no longer works.",
  },
} as const;
