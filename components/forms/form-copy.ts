import type { AgeBand, LeadField, LeadFieldErrorCode } from "@/lib/leads/fields";

/**
 * Interface chrome for the founding-family form that the Sanity content contract does not carry
 * (ruling R12, as components/landing/ui-copy.ts): field labels, hints, validation messages and
 * status words. The CMS owns the button label, consent sentence, success and error messages.
 *
 * Truth rules (spec §3 ruling 3): nothing here may say an email was sent or delivered, or promise a
 * download. tests/leads/lead-copy.test.tsx scans every string below for such claims.
 * Child data rule (spec §3 ruling 2): the only child-related prompt is the optional, broad age range.
 */
export const FORM_COPY = {
  /** Accessible name of the form landmark. */
  formLabel: "Founding-family signup",
  email: { label: "Email", hint: "For BIBO Bay updates only." },
  firstName: { label: "Your first name (optional)" },
  ageBand: {
    label: "Child's age range (optional)",
    hint: "A broad range is all we ask. Skip it if you prefer.",
    placeholder: "Choose a range",
  },
  ageBands: {
    "under-3": "Under 3",
    "3-5": "3 to 5",
    "6-8": "6 to 8",
    "9-12": "9 to 12",
    "prefer-not-to-say": "Prefer not to say",
  } satisfies Record<AgeBand, string>,
  privacyLink: "How we handle your details",
  /** Said by the status line while the request is in flight: the server is saving, nothing more. */
  sending: "Saving…",
  errorSummaryTitle: "Please check the form",
  errors: {
    email: {
      required: "Enter your email.",
      invalid: "Enter an email like name@example.com.",
      too_long: "That email is too long.",
    },
    firstName: {
      invalid: "Use your first name only, without links or the characters < and >.",
      too_long: "Keep your first name under 80 characters.",
    },
    ageBand: { invalid: "Choose one of the listed age ranges." },
    consent: { required: "Tick the box to agree to BIBO Bay updates." },
  } satisfies Record<LeadField, Partial<Record<LeadFieldErrorCode, string>>>,
  outcome: {
    /** Server answer for HTTP 429, shown as is. */
    rateLimited: "There have been several signups from this connection. Please wait a few minutes and try again.",
    /** Server answer for HTTP 400 with field errors; the form shows its own summary instead. */
    checkDetails: "Please check the highlighted fields and try again.",
  },
  /** Lead-in to the download button; shown only after the server confirms the signup was stored (R140). */
  downloadReady: "Your download is ready:",
  /** Shown only when JavaScript is off, where the form cannot submit. */
  noScript: "This form needs JavaScript. Turn it on in your browser to join the list.",
  /** Label of the hidden honeypot field; people never see it. */
  honeypotLabel: "Leave this field empty",
} as const;

/** The message for one field problem, falling back to the field's first message. */
export function fieldErrorMessage(field: LeadField, code: LeadFieldErrorCode): string {
  const messages: Partial<Record<LeadFieldErrorCode, string>> = FORM_COPY.errors[field];
  return messages[code] ?? Object.values(messages)[0] ?? FORM_COPY.outcome.checkDetails;
}
