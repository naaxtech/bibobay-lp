/**
 * Every string on the staff pages (Task 8c), apart from the API answers in ./admin-copy.ts, which
 * the pages show as the API words them. The CMS has no staff copy, so these repository strings are
 * the source, as ORDER_COPY is for the order flow. Plain labels and sentences for staff, not
 * marketing copy.
 *
 * Truth rules (spec §3 ruling 3, §10; the same as ADMIN_COPY): nothing here says an email was
 * sent or delivered, or that a payment was taken: the page never knows either. A quote is "saved"
 * once stored and "queued" once its outbox row exists. tests/admin/page-copy.test.ts scans every
 * string for such claims. The order status names (new, confirmed, paid...) are labels staff move an
 * order between, not claims.
 *
 * The orders list, the order page and the order controls add their own sections to this object.
 */
export const PAGE_COPY = {
  frame: {
    /** The site's name in the staff header. */
    siteTitle: "BIBO Bay",
    /** The label beside it, so staff never mistake this for the public site. */
    staffLabel: "Staff",
    skipToContent: "Skip to content",
    /** The default document title and the template every staff page title is put into (%s is the page's own title). */
    titleDefault: "Staff",
    titleTemplate: "Staff | %s",
  },
  signOut: {
    label: "Sign out",
    signingOut: "Signing out",
    /** The sign-out request got no usable answer. The session may still be open. */
    failed: "Sign-out did not go through. You may still be signed in. Please try again.",
  },
  login: {
    pageTitle: "Sign in",
    heading: "Staff sign in",
    lead: "For BIBO Bay staff. Use the email address and password you were given.",
    formLabel: "Staff sign in",
    emailLabel: "Email address",
    passwordLabel: "Password",
    submit: "Sign in",
    sending: "Signing in",
    emailRequired: "Enter your email address.",
    passwordRequired: "Enter your password.",
    /** No usable answer from the sign-in request (offline, or the answer was not the API's). */
    notReached: "The sign-in request did not go through. Please check your connection and try again.",
    signedIn: "You are signed in.",
    /** Shown when the API gave no message of its own (same words as ADMIN_COPY, pinned by tests). */
    fallback: {
      checkDetails: "Please enter your email and your password.",
      refused: "That email and password did not sign you in to staff access.",
      forbidden: "You do not have access to this.",
      rateLimited: "There have been too many sign-in attempts. Please wait a few minutes and try again.",
      failed: "Something went wrong and nothing was changed. Please try again.",
      unavailable: "Staff sign-in cannot be checked right now. Nothing was changed. Please try again in a few minutes.",
    },
    noScript: "Staff pages need JavaScript. Please turn it on in your browser to sign in.",
  },
  notices: {
    unconfigured: {
      title: "Staff sign-in is not set up",
      /** Same words as ADMIN_COPY.api (pinned equal by tests/admin/page-copy.test.ts). Never import admin-copy.ts here: client code that did would put its server-only names in the browser bundle. */
      body: "Staff sign-in is not available on this website yet.",
    },
    unavailable: {
      title: "Staff pages cannot be reached right now",
      body: "Staff sign-in cannot be checked right now. Nothing was changed. Please try again in a few minutes.",
    },
  },
} as const;
