import type { ContactField, ContactFieldErrorCode } from "@/lib/contact/fields";

/**
 * Interface chrome for the contact form that the Sanity content contract does not carry (ruling
 * R12, as lead form copy in ./form-copy.ts): field labels, hints, validation messages and status
 * words. The CMS owns the button label and the success, error and closed messages.
 *
 * Truth rules: nothing here may say a message was emailed, sent or delivered; the staff alert is
 * an internal step the sender cannot see. tests/contact/contact-copy.test.ts scans every string.
 * Child data rule: the form is for grown-ups, so it asks nothing about a child and its hint says
 * to leave child details out.
 */
export const CONTACT_FORM_COPY = {
  /** Accessible name of the form landmark. */
  formLabel: "Contact BIBO Bay",
  name: { label: "Your name" },
  email: { label: "Your email", hint: "We use it only to reply to you." },
  topic: { label: "What is it about?", placeholder: "Choose a topic" },
  message: { label: "Your message", hint: "Please leave out any details about a child. Between 10 and 3,000 characters." },
  privacyLink: "How we handle your details",
  /** Said by the status line while the request is in flight: the server is saving, nothing more. */
  sending: "Saving your message…",
  errorSummaryTitle: "Please check the form",
  errors: {
    name: {
      required: "Enter your name.",
      invalid: "Use your name only, without links or the characters < and >.",
      too_long: "Keep your name under 80 characters.",
    },
    email: {
      required: "Enter your email.",
      invalid: "Enter an email like name@example.com.",
      too_long: "That email is too long.",
    },
    topic: {
      required: "Choose what your message is about.",
      invalid: "Choose what your message is about.",
    },
    message: {
      required: "Write your message.",
      too_short: "Write at least 10 characters.",
      too_long: "Keep your message under 3,000 characters.",
      invalid: "Remove the unusual characters from your message.",
    },
  } satisfies Record<ContactField, Partial<Record<ContactFieldErrorCode, string>>>,
  outcome: {
    /**
     * Shown for HTTP 429, in place of the server's informational text. R184: the 429 may come from
     * the per-client or the global bucket, so it says nothing about the visitor's own connection.
     */
    rateLimited: "A lot of messages are arriving just now. Please wait a few minutes and try again.",
  },
  /** Shown only when JavaScript is off, where the form cannot submit. */
  noScript: "This form needs JavaScript. Turn it on in your browser to send a message.",
  /** Label of the hidden honeypot field; people never see it. */
  honeypotLabel: "Leave this field empty",
} as const;

/** The message for one field problem, falling back to the field's first message. */
export function contactFieldErrorMessage(field: ContactField, code: ContactFieldErrorCode): string {
  const messages: Partial<Record<ContactFieldErrorCode, string>> = CONTACT_FORM_COPY.errors[field];
  return messages[code] ?? Object.values(messages)[0] ?? CONTACT_FORM_COPY.errors.message.required;
}
