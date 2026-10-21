import { EMAIL_PATTERN, LEAD_LIMITS, isSafeFirstName, normalizeEmail } from "@/lib/leads/fields";

/**
 * The contact form's field rules, shared by the browser form and the server (rulings R158-R162).
 *
 * Deliberately free of Zod, like lib/leads/fields.ts: the form imports this module. The server
 * validates independently with the Zod schema in ./schema.ts, built from these same constants, and
 * tests/contact/field-cases.ts holds the one table of cases both must agree on.
 *
 * Grown-ups only (R162): a name, an email address, a topic and a message. Nothing here may grow an
 * age field, a child's name or any other child detail.
 */

export const CONTACT_PATH = "/contact";
export const CONTACT_API_PATH = "/api/contact";

/** What a message is about (R162). The order is the order of the form's list. */
export const CONTACT_TOPICS = ["general", "partnerships", "press", "shop-order", "privacy"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

/** UI chrome (R12), shared by the form's list and the staff alert's subject. */
export const CONTACT_TOPIC_LABELS = {
  general: "A general question",
  partnerships: "Partnerships",
  press: "Press and media",
  "shop-order": "Shop and orders",
  privacy: "Privacy and your details",
} satisfies Record<ContactTopic, string>;

/** Bounds in characters (code points), mirrored by the CHECK constraints of migration 0008. */
export const CONTACT_LIMITS = {
  name: 80,
  /** The same address limit as a signup. */
  email: LEAD_LIMITS.email,
  messageMin: 10,
  messageMax: 3000,
} as const;

/** The same hidden field as the signup form; any value in it rejects the request. */
export { HONEYPOT_FIELD } from "@/lib/leads/fields";

export type ContactField = "name" | "email" | "topic" | "message";
export type ContactFieldErrorCode = "required" | "invalid" | "too_short" | "too_long";
export type ContactFieldErrors = Partial<Record<ContactField, ContactFieldErrorCode>>;

/** The order fields appear in the form, so an error summary lists problems top to bottom. */
export const CONTACT_FIELD_ORDER: readonly ContactField[] = ["name", "email", "topic", "message"];

/** The raw values the form holds, before any trimming. */
export interface ContactFieldValues {
  name: string;
  email: string;
  topic: string;
  message: string;
}

/** The JSON body POST /api/contact answers with; `closed` only while the form is not open (R161). */
export interface ContactApiBody {
  ok: boolean;
  persisted: boolean;
  message: string;
  fieldErrors?: ContactFieldErrors;
  closed?: true;
}

/** A message may hold line breaks and tabs, and no other control character. */
// Control characters are exactly what this rejects.
const UNSAFE_MESSAGE_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/**
 * Length in code points, which is what Postgres `char_length` counts: an emoji is one character
 * here and in the database, though it is two UTF-16 units in `String.length`.
 */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/** CRLF and lone CR become LF, then the ends are trimmed: the one form a message is counted and stored in. */
export function normalizeMessage(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function isContactTopic(value: unknown): value is ContactTopic {
  return typeof value === "string" && (CONTACT_TOPICS as readonly string[]).includes(value);
}

export function isSafeMessage(value: string): boolean {
  return !UNSAFE_MESSAGE_PATTERN.test(value);
}

/**
 * The browser's immediate check, giving the first problem per field (required, too short, too
 * long, invalid) with the same codes as the server's schema, so the two never contradict each other.
 */
export function checkContactFields(values: ContactFieldValues): ContactFieldErrors {
  const errors: ContactFieldErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = "required";
  else if (characterCount(name) > CONTACT_LIMITS.name) errors.name = "too_long";
  else if (!isSafeFirstName(name)) errors.name = "invalid";

  const email = normalizeEmail(values.email);
  if (!email) errors.email = "required";
  else if (email.length > CONTACT_LIMITS.email) errors.email = "too_long";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "invalid";

  const topic = values.topic.trim();
  if (!topic) errors.topic = "required";
  else if (!isContactTopic(topic)) errors.topic = "invalid";

  const message = normalizeMessage(values.message);
  const length = characterCount(message);
  if (!message) errors.message = "required";
  else if (length < CONTACT_LIMITS.messageMin) errors.message = "too_short";
  else if (length > CONTACT_LIMITS.messageMax) errors.message = "too_long";
  else if (!isSafeMessage(message)) errors.message = "invalid";
  return errors;
}
