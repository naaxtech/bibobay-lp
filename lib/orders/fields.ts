/**
 * The order request's field rules, shared by the server schema (./schema.ts) and the browser's order
 * form (components/forms/OrderForm.tsx, Task 7c), which checks fields with `checkOrderFields`.
 *
 * Deliberately free of Zod, like lib/leads/fields.ts: the order form can import these constants
 * without shipping a schema library. Every limit here is mirrored by the CHECK constraints and the
 * argument checks in supabase/migrations/0002_orders.sql; tests/orders/migration-policy.test.ts
 * fails if the two disagree.
 *
 * Spec §3 ruling 2: adult contact and delivery details only. Nothing here may grow a child's name,
 * birthday, photo, voice, health, school or location. Spec §10: no prices and no payment details.
 */
import { EMAIL_PATTERN, isSafeFirstName, type LeadFieldErrorCode } from "@/lib/leads/fields";

export { EMAIL_PATTERN, HONEYPOT_FIELD, isHoneypotFilled, normalizeEmail } from "@/lib/leads/fields";
export { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY } from "./constants";

/** Upper bounds, in characters, mirrored by migration 0002. */
export const ORDER_LIMITS = {
  contactName: 120,
  /** RFC 5321 path limit for a whole address. */
  email: 254,
  phone: 32,
  addressLine: 200,
  city: 100,
  region: 100,
  postalCode: 16,
  notes: 1000,
} as const;

/** Shortest phone number accepted, in characters. */
export const PHONE_MIN_LENGTH = 6;

/**
 * Bounds on what an order line snapshots from the CMS (spec §10 step 5), mirrored by migration
 * 0002's `order_items` checks and by the Studio's product validation (R80).
 */
export const ORDER_LINE_LIMITS = { name: 200, sku: 64, variant: 120, pack: 120 } as const;

/** Digits, spaces and the punctuation people write phone numbers with. */
export const PHONE_PATTERN = /^[0-9+() .-]+$/;
/** An ISO 3166-1 alpha-2 country code, upper case. */
export const COUNTRY_PATTERN = /^[A-Z]{2}$/;
/** Letters, digits, spaces and hyphens, starting with a letter or digit. */
export const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

/** The human-readable order reference the database issues: `BB-` and two groups of four hex digits. */
export const ORDER_REFERENCE_PATTERN = /^BB-[0-9A-F]{4}-[0-9A-F]{4}$/;
/** A private tracking token as the database issues it: 64 lower-case hex digits. Only its hash is stored. */
export const TRACKING_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Control characters: refused in every one-line field. */
// Control characters are exactly what this rejects.
export const SINGLE_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
/** Control characters other than tab, line feed and carriage return: refused in the notes. */
// Control characters are exactly what this rejects.
export const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Fix wave D-M3: the contact name opens the buyer's emails ("Hi <name>,"), sent from BIBO Bay's
 * verified sender to whatever address was typed, so it follows the signup first-name rule
 * (lib/leads/fields.ts): no markup (`<`, `>`), no link (`://`, `www.`), no control characters. The
 * schema (./schema.ts), the form's own check below and the email builders
 * (lib/email/order-emails.ts, as a second guard) all use this one test.
 */
export function isSafeContactName(value: string): boolean {
  return isSafeFirstName(value);
}

export type OrderFieldErrorCode = LeadFieldErrorCode;
export type OrderField =
  | "contactName"
  | "email"
  | "phone"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "region"
  | "postalCode"
  | "country"
  | "notes"
  | "consent"
  | "lines";
export type OrderFieldErrors = Partial<Record<OrderField, OrderFieldErrorCode>>;

/** The order the fields appear in the form, so an error summary lists problems top to bottom. */
export const ORDER_FIELD_ORDER: readonly OrderField[] = [
  "contactName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
  "notes",
  "consent",
  "lines",
];

/** What the order form holds for each field it shows. */
export interface OrderFieldValues {
  contactName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
  consent: boolean;
}

type Check = (value: string) => OrderFieldErrorCode | undefined;

/** A required one-line field: the server's trim, then required, too long, control characters. */
const requiredLine = (limit: number): Check => (value) => {
  const text = value.trim();
  if (!text) return "required";
  if (text.length > limit) return "too_long";
  return SINGLE_LINE_CONTROL.test(text) ? "invalid" : undefined;
};

/** An optional one-line field: blank means not given. */
const optionalLine = (limit: number): Check => (value) => (value.trim() ? requiredLine(limit)(value) : undefined);

/** The contact name: a required line, then the first-name rule (D-M3), in the server's order. */
const contactNameCheck: Check = (value) => requiredLine(ORDER_LIMITS.contactName)(value) ?? (isSafeContactName(value.trim()) ? undefined : "invalid");

/**
 * The browser's check of the order form, giving the same first problem per field as the server's
 * schema (./schema.ts): tests/orders/order-fields.test.ts compares the two case by case. `countries`
 * is what the form offers (ruling R85); the server refuses any other country the same way.
 */
export function checkOrderFields(values: OrderFieldValues, countries: readonly string[]): OrderFieldErrors {
  const email = values.email.trim().toLowerCase();
  const phone = values.phone.trim();
  const postalCode = values.postalCode.trim();
  const notes = values.notes.trim();
  const country = values.country.trim().toUpperCase();
  const found: OrderFieldErrors = {
    contactName: contactNameCheck(values.contactName),
    email: !email ? "required" : email.length > ORDER_LIMITS.email ? "too_long" : EMAIL_PATTERN.test(email) ? undefined : "invalid",
    phone: !phone ? undefined : phone.length > ORDER_LIMITS.phone ? "too_long" : phone.length < PHONE_MIN_LENGTH || !PHONE_PATTERN.test(phone) ? "invalid" : undefined,
    addressLine1: requiredLine(ORDER_LIMITS.addressLine)(values.addressLine1),
    addressLine2: optionalLine(ORDER_LIMITS.addressLine)(values.addressLine2),
    city: requiredLine(ORDER_LIMITS.city)(values.city),
    region: optionalLine(ORDER_LIMITS.region)(values.region),
    postalCode: !postalCode ? undefined : postalCode.length > ORDER_LIMITS.postalCode ? "too_long" : POSTAL_CODE_PATTERN.test(postalCode) ? undefined : "invalid",
    country: !country ? "required" : COUNTRY_PATTERN.test(country) && countries.includes(country) ? undefined : "invalid",
    notes: !notes ? undefined : notes.length > ORDER_LIMITS.notes ? "too_long" : MULTI_LINE_CONTROL.test(notes) ? "invalid" : undefined,
    consent: values.consent ? undefined : "required",
  };
  const errors: OrderFieldErrors = {};
  for (const field of ORDER_FIELD_ORDER) {
    const code = found[field];
    if (code) errors[field] = code;
  }
  return errors;
}

/**
 * Ruling R81: a new random key for one order attempt, made when the form opens and kept across
 * retries until the server answers, so a request sent twice is stored once. A version 4 UUID;
 * `crypto.randomUUID` where the browser has it, else built from `crypto.getRandomValues`.
 */
export function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
