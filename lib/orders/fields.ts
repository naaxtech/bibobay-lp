/**
 * The order request's field rules, shared by the server schema (./schema.ts) and, in Task 7b, the
 * browser's order form.
 *
 * Deliberately free of Zod, like lib/leads/fields.ts: the order form can import these constants
 * without shipping a schema library. Every limit here is mirrored by the CHECK constraints and the
 * argument checks in supabase/migrations/0002_orders.sql; tests/orders/migration-policy.test.ts
 * fails if the two disagree.
 *
 * Spec §3 ruling 2: adult contact and delivery details only. Nothing here may grow a child's name,
 * birthday, photo, voice, health, school or location. Spec §10: no prices and no payment details.
 */
import type { LeadFieldErrorCode } from "@/lib/leads/fields";

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
