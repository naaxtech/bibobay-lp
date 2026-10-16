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
    /** Signed in, but the order data could not be read. */
    loadFailed: {
      title: "The orders could not be loaded",
      body: "Something went wrong while reading the orders. Nothing was changed. Please try again in a few minutes.",
    },
  },
  /** Order status names as staff know them (the customer-facing names live in ORDER_STATUS_COPY). */
  statusNames: {
    new: "New",
    confirmed: "Confirmed",
    paid: "Paid",
    dispatched: "Dispatched",
    closed: "Closed",
    cancelled: "Cancelled",
  },
  orders: {
    pageTitle: "Orders",
    heading: "Orders",
    lead: "The newest orders come first. Open an order to read it, save a quote or change its status.",
    filterLabel: "Filter by status",
    filterAll: "All",
    tableCaption: "Orders, newest first",
    columns: {
      reference: "Reference",
      status: "Status",
      submitted: "Submitted",
      statusChanged: "Status changed",
      contact: "Contact",
      country: "Country",
      quote: "Quote",
      quoteEmail: "Quote email",
    },
    values: { noQuote: "None", revision: "Revision", accepted: "Accepted by the mail service", notYet: "Not yet" },
    empty: "No orders have been requested yet.",
    emptyFiltered: "No orders have this status.",
    showAll: "Show all orders",
    limitNote: "Only the newest orders are listed here. Filter by status to narrow the list.",
  },
  detail: {
    pageTitle: "Order",
    notFoundPageTitle: "Order not found",
    notFoundTitle: "There is no order with this reference",
    notFoundBody: "Check the reference and try again.",
    backToOrders: "Back to orders",
    headingPrefix: "Order",
    statusLabel: "Status",
    sections: {
      contact: "Contact and delivery",
      notes: "Notes",
      consent: "Consent",
      lines: "Products",
      quote: "Current quote",
      emails: "Emails",
      events: "History",
      controls: "Order controls",
    },
    labels: {
      name: "Name",
      email: "Email address",
      phone: "Phone",
      address: "Address",
      city: "City",
      region: "Region",
      postalCode: "Postal code",
      country: "Country",
      submitted: "Submitted",
      statusChanged: "Status changed",
      consentVersion: "Consent version",
      consentGiven: "Consent given",
      trackingExpires: "Tracking link works until",
      trackingReplaced: "Tracking link replaced",
    },
    values: { notGiven: "Not given", none: "None" },
    noNotes: "No notes were added.",
    lineColumns: { product: "Product", sku: "SKU", variant: "Variant", pack: "Pack", quantity: "Quantity" },
    quote: {
      none: "No quote has been saved yet.",
      currency: "Currency",
      subtotal: "Subtotal",
      freight: "Freight",
      paymentLink: "Payment link",
      revision: "Revision",
      emailAccepted: "Quote email",
      values: { accepted: "Accepted by the mail service", notAccepted: "Not yet" },
    },
    emails: {
      none: "No emails are recorded for this order.",
      columns: { kind: "Email", revision: "Quote revision", status: "Status", attempts: "Attempts", lastAttempt: "Last attempt", nextAttempt: "Next attempt", lastError: "Last error code" },
      kinds: { acknowledgement: "Acknowledgement to the customer", staff_alert: "Alert to staff", quote: "Quote to the customer" },
      statuses: { pending: "Waiting", sending: "Being attempted", sent: "Accepted by the mail service", failed: "Failed", skipped: "Skipped" },
    },
    events: {
      none: "No history is recorded for this order.",
      actors: { customer: "Customer", staff: "Staff", system: "System" },
      statusChange: "Status",
      statusTo: "to",
    },
  },
  controls: {
    working: "Working.",
    /** Shown when the API gave no message of its own (same words as ADMIN_COPY, pinned by tests). */
    fallback: {
      forbidden: "You do not have access to this.",
      signedOut: "Please sign in to continue.",
      notFound: "There is no order with this reference.",
      checkDetails: "Please check the highlighted fields and try again. Nothing was changed.",
      stale: "This order changed since you opened it. Nothing was changed. Reload the order and try again.",
      failed: "Something went wrong and nothing was changed. Please try again.",
      unavailable: "Staff sign-in cannot be checked right now. Nothing was changed. Please try again in a few minutes.",
      notReached: "The request did not go through. Nothing was changed. Please check your connection and try again.",
      done: "Done.",
    },
    quote: {
      heading: "Quote",
      lead: "Save the figures first, then queue the saved revision for email. Saving sends nothing.",
      savedRevision: "Saved revision",
      noneSaved: "None yet",
      currencyLabel: "Currency",
      subtotalLabel: "Subtotal",
      freightLabel: "Freight",
      amountHint: "Write the amount in the currency's main unit, for example 1250.50.",
      paymentUrlLabel: "Payment link",
      paymentUrlHint: "The link the customer pays through. It must be on an allowed payment provider.",
      save: "Save quote",
      send: "Queue quote email",
      needsSave: "Save your changes before queueing the quote.",
      needsQuote: "Save a quote before queueing it.",
      notAllowed: "A quote can be saved and queued only while the order is new or confirmed.",
      errors: {
        required: "Enter a value.",
        invalid: "This value cannot be used.",
        negative: "The amount cannot be negative.",
        tooManyDecimals: "This currency does not take that many decimal places.",
        tooLarge: "The amount is too large.",
        currency: "Choose one of the listed currencies.",
        notHttps: "The link must start with https.",
        credentials: "The link must not contain a user name or password.",
        port: "The link must not name a port.",
        ipLiteral: "The link must use a website name, not a number.",
        tooLong: "The link is too long.",
        hostNotAllowed: "This website is not an allowed payment provider.",
        noAllowedHosts: "No payment providers are allowed yet.",
      },
    },
    status: {
      heading: "Status",
      lead: "Move the order on to its next step. A step cannot be undone.",
      advance: {
        confirmed: "Mark as confirmed",
        paid: "Mark as paid",
        dispatched: "Mark as dispatched",
        closed: "Mark as closed",
      },
      cancel: "Cancel order",
      finished: "This order is finished, so its status and quote can no longer change.",
    },
    cancelDialog: {
      title: "Cancel this order?",
      body: "A cancelled order cannot be reopened, and no quote can be saved for it afterwards.",
      confirm: "Cancel order",
      keep: "Keep order",
    },
    tracking: {
      heading: "Tracking link",
      lead: "A new link replaces the old one, which stops working at once.",
      create: "Replace tracking link",
      linkLabel: "New tracking link",
      copy: "Copy link",
      copied: "Link copied.",
      copyFailed: "The link could not be copied. Select it and copy it by hand.",
      worksUntil: "It works until",
    },
  },
} as const;
