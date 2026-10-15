import type { OrderStatus } from "@/lib/orders/constants";
import type { OrderField, OrderFieldErrorCode } from "@/lib/orders/fields";

/**
 * Every message the order and tracking API routes return (Task 7a), and the interface chrome of the
 * order page, the tracking page and the order status view (Task 7c). The CMS content contract has
 * no order copy beyond the order consent sentence (ruling R82), so these repository strings are the
 * source, as FORM_COPY (./form-copy.ts) is for the lead form's chrome.
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
    /**
     * HTTP 200 for a request sent again after its answer was lost (ruling R81): the first order is
     * stored and nothing new was. Shown with that order's reference. Its private link cannot be
     * shown again (only a hash of it is kept), so this points at tracking by reference and email.
     */
    alreadyReceived:
      "We already have this order request, so nothing new was added. Nothing has been charged. You can follow it on the tracking page with the order reference below and the email you used.",
    /** The same answer while tracking is switched off: no tracking page exists to point at. */
    alreadyReceivedUntracked:
      "We already have this order request, so nothing new was added. Nothing has been charged. Please keep the order reference below if you contact us about it.",
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

  /** The order page (/order). */
  page: {
    title: "Review your order",
    intro: "Check the products on your order, then tell us who you are and where it should go.",
    /** Spec §10 step 4: no payment is taken here, and how the quote and payment link arrive. */
    paymentTitle: "How paying works",
    payment: [
      "This is an order request, not a purchase. Nothing is charged on this website.",
      "We check availability and delivery to your address, then email you a quote with a secure payment link.",
      "Your order goes ahead only if you choose to pay through that link.",
    ],
    metaDescription: "Review your BIBO Bay order and send it as a request. Nothing is charged on this website.",
    /** An empty order pad: an honest state, with the way back to the shop. */
    empty: "Your order is empty. Add products in the shop, then come back here to send your request.",
    backToShop: "Back to the shop",
  },

  /** The order form (components/forms/OrderForm.tsx). */
  form: {
    /** Accessible name of the form landmark. */
    label: "Order request",
    contactTitle: "Your details",
    deliveryTitle: "Delivery address",
    contactName: { label: "Full name", hint: "The adult placing this order." },
    email: { label: "Email", hint: "Your quote and payment link come to this address." },
    phone: { label: "Phone (optional)", hint: "Only if a call or text about delivery would help." },
    addressLine1: { label: "Address" },
    addressLine2: { label: "Apartment, unit or building (optional)" },
    city: { label: "Town or city" },
    region: { label: "State, province or region (optional)" },
    postalCode: { label: "Postcode (optional)" },
    country: { label: "Country", placeholder: "Choose a country", hint: "We quote delivery for each order." },
    notes: { label: "Notes (optional)", hint: "Anything we should know about this order. Please leave out any details about a child." },
    privacyLink: "How we handle your details",
    submit: "Send order request",
    /** Said by the status line while the request is in flight. */
    sending: "Sending your order request…",
    errorSummaryTitle: "Please check these details",
    errors: {
      contactName: { required: "Enter your full name.", invalid: "Use letters and spaces only, on one line.", too_long: "Keep your name under 120 characters." },
      email: { required: "Enter your email.", invalid: "Enter an email like name@example.com.", too_long: "That email is too long." },
      phone: { invalid: "Enter a phone number of at least 6 digits, using digits, spaces and + ( ) . - only.", too_long: "Keep the phone number under 32 characters." },
      addressLine1: { required: "Enter the delivery address.", invalid: "Keep the address on one line.", too_long: "Keep the address under 200 characters." },
      addressLine2: { invalid: "Keep this line of the address on one line.", too_long: "Keep this line under 200 characters." },
      city: { required: "Enter the town or city.", invalid: "Keep the town or city on one line.", too_long: "Keep the town or city under 100 characters." },
      region: { invalid: "Keep the region on one line.", too_long: "Keep the region under 100 characters." },
      postalCode: { invalid: "Use letters, digits, spaces and hyphens only.", too_long: "Keep the postcode under 16 characters." },
      country: { required: "Choose the country for delivery.", invalid: "Choose one of the listed countries." },
      notes: { invalid: "Remove any unusual characters from the notes.", too_long: "Keep the notes under 1,000 characters." },
      consent: { required: "Tick the box to agree, so we can answer your order request." },
      lines: { required: "Your order is empty. Add products in the shop first.", invalid: "Please review your order and try again.", too_long: "Your order holds too many products. Remove some and try again." },
    } satisfies Record<OrderField, Partial<Record<OrderFieldErrorCode, string>>>,
    /** Shown only when JavaScript is off, where the form cannot submit. */
    noScript: "This form needs JavaScript. Turn it on in your browser to send your order request.",
    /** Label of the hidden honeypot field; people never see it. */
    honeypotLabel: "Leave this field empty",
  },

  /** What the order page shows once the server stored the request (HTTP 200). */
  received: {
    title: "Order request received",
    referenceLabel: "Order reference",
    privateLinkTitle: "Your private tracking link",
    privateLink: "Open your private tracking link",
    privateNote: "Keep this link private: anyone who has it can see this order's progress. Bookmark or copy it now, as it is shown only once.",
    trackNote: "You can also follow your order on the tracking page with the order reference and the email you used.",
    trackLink: "Go to the tracking page",
  },

  /** The tracking page (/track) and its form. */
  track: {
    title: "Track an order",
    intro: "Enter the order reference and the email you ordered with. If you kept your private tracking link, you can open that instead.",
    metaDescription: "Follow a BIBO Bay order request with its reference and email.",
    formLabel: "Find an order",
    reference: { label: "Order reference", hint: "It looks like BB-1A2B-3C4D." },
    email: { label: "Email", hint: "The email you used for the order." },
    submit: "Find my order",
    searching: "Looking for your order…",
    errorSummaryTitle: "Please check these details",
    errors: {
      reference: { required: "Enter the order reference.", invalid: "Enter a reference like BB-1A2B-3C4D." },
      email: { required: "Enter your email.", invalid: "Enter an email like name@example.com." },
    },
  },

  /** A private order link (/orders/<token>). */
  orderLink: {
    title: "Your order",
    notFoundTitle: "Order not found",
    failureTitle: "Order tracking unavailable",
    trackLink: "Find an order by its reference",
  },

} as const;

/**
 * The order status view shared by /track and /orders/<token> (Task 7c): no price, address or email.
 * Kept apart from ORDER_COPY because it names the `paid` status, which ORDER_COPY's scan forbids
 * (no message about placing or finding an order may claim a payment); its own scan in
 * tests/orders/order-status.test.tsx keeps the statuses before payment from claiming one.
 */
export const ORDER_STATUS_COPY = {
  heading: (reference: string) => `Order ${reference}`,
  currentLabel: "Status",
  progressLabel: "Order progress",
  names: {
    new: "Received",
    confirmed: "Confirmed",
    paid: "Payment confirmed",
    dispatched: "Dispatched",
    closed: "Completed",
    cancelled: "Cancelled",
  } satisfies Record<OrderStatus, string>,
  explanations: {
    new: "We have your order request and are checking availability. Nothing has been charged.",
    confirmed: "We have confirmed your order. Your quote and payment link come by email.",
    paid: "Your payment has come through, and we are preparing your order.",
    dispatched: "Your order has left us and is travelling to you.",
    closed: "This order is complete. Thank you for ordering from BIBO Bay.",
    cancelled: "This order was cancelled, so nothing more will happen with it. Contact us if you have a question.",
  } satisfies Record<OrderStatus, string>,
  submittedLabel: "Requested",
  updatedLabel: "Last update",
  linesTitle: "Products",
  variantLabel: "Variant",
  packLabel: "Pack",
  quantity: (quantity: number) => `Quantity: ${quantity}`,
} as const;

/** The message for one order field problem, falling back to the field's first message. */
export function orderFieldErrorMessage(field: OrderField, code: OrderFieldErrorCode): string {
  const messages: Partial<Record<OrderFieldErrorCode, string>> = ORDER_COPY.form.errors[field];
  return messages[code] ?? Object.values(messages)[0] ?? ORDER_COPY.outcome.checkDetails;
}
