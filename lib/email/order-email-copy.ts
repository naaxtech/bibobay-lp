/**
 * Every visible string of the order emails (Task 8a; spec §12): the buyer acknowledgement, the staff
 * order alert and the quote. The CMS has no email copy, so these repository strings are the source,
 * as ORDER_COPY (components/forms/order-copy.ts) is for the order pages.
 *
 * Truth rules (spec §3, §10; rulings R89-R90): nothing here says a payment was taken (none ever is
 * on this website) or promises a delivery date; the acknowledgement names no price; no email ever
 * carries the private tracking link (only its hash is stored, and links in email leak through
 * forwarding); no child data. tests/outbox/order-emails.test.ts checks the rendered emails.
 */
export const ORDER_EMAIL_COPY = {
  brand: "BIBO Bay",
  greeting: (name: string) => `Hi ${name},`,
  /** "2 × Tula plush (Large, Single)": quantity, title, then the variant and pack when present. */
  line: (quantity: number, title: string, details: readonly string[]) => `${quantity} × ${title}${details.length > 0 ? ` (${details.join(", ")})` : ""}`,
  referenceLabel: "Order reference",
  acknowledgement: {
    subject: (reference: string) => `We have your BIBO Bay order request ${reference}`,
    intro: "Thank you for your order request. We have it, with the products below.",
    noPayment: "Nothing has been charged: no payment is taken on the BIBO Bay website.",
    linesHeading: "Your order request",
    nextSteps: "We will check availability and email you a quote with a link to pay. Nothing is charged unless you choose to pay through that link.",
    /** Only while order tracking is switched on (R89): the page, never the private link. */
    trackAt: (url: string) => `You can follow your order at ${url} with the order reference and this email address.`,
    trackAtLead: "You can follow your order at",
    trackAtTail: "with the order reference and this email address.",
    /** Tracking is on but the site's address is not verified yet, so no link can be given. */
    trackOnSite: "You can follow your order on the Track an order page of the BIBO Bay website with the order reference and this email address.",
    keepReference: "Please keep the order reference if you contact us about this order.",
  },
  staffAlert: {
    /** Generic on purpose: no customer name or address in inbox previews and logs. */
    subject: "New BIBO Bay order request",
    intro: "A new order request arrived. Nothing has been charged, and it is waiting for a quote.",
    labels: {
      reference: "Order reference",
      contactName: "Name",
      /** Nothing on the order form proves the buyer owns the address they typed. */
      email: "Email (as typed, not verified)",
    },
    linesHeading: "Products",
    detailsStored: "The delivery address, phone number and notes are stored with the order and left out of this email.",
  },
  quote: {
    subject: (reference: string) => `Your BIBO Bay quote for order ${reference}`,
    intro: "Thank you for waiting. Here is the quote for your order request.",
    linesHeading: "Your order",
    labels: { subtotal: "Products", freight: "Delivery", total: "Total" },
    payLead: "If you would like to go ahead, please pay through this link:",
    payLinkText: "Pay for your order",
    noObligation: "Nothing is charged unless you pay through the link. If you have a question about the quote, reply to this email.",
  },
} as const;
