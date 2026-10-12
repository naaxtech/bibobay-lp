/**
 * The founding-family signup's field rules, shared by the browser form and the server.
 *
 * Deliberately free of Zod: the form imports this module, and a schema library would ship on the
 * landing page for a handful of checks. The server validates independently with the Zod schema in
 * ./schema.ts, which is built from these same constants; tests/leads/lead-fields.test.ts fails if
 * the two ever disagree.
 *
 * Spec §3 ruling 2: only adult details plus an optional broad age band. Nothing here may grow a
 * child's name, birthday, photo, voice, health, school or location.
 */

/** Broad, optional child age bands (spec §9). The only child-related detail the form may ask for. */
export const AGE_BANDS = ["under-3", "3-5", "6-8", "9-12", "prefer-not-to-say"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Campaign tags the form may forward from the page URL (`utm_source` and so on). */
export const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmTags = Partial<Record<UtmKey, string>>;

/** The hidden field people never see and bots fill in. Any value in it rejects the request. */
export const HONEYPOT_FIELD = "website";

/** Upper bounds, mirrored by the CHECK constraints and argument checks in migration 0001. */
export const LEAD_LIMITS = {
  /** RFC 5321 path limit for a whole address. */
  email: 254,
  firstName: 80,
  utm: 100,
  locale: 35,
  source: 40,
} as const;

/**
 * Zod 4's own email pattern (node_modules/zod/v4/core/regexes.js `email`, zod 4.6.6), copied so the
 * browser can use it without loading Zod. The server passes this exact object to `z.email()`.
 */
export const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/** A BCP 47-shaped language tag such as `en` or `en-AU`. */
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/** Where on the site the signup came from, as a short slug. */
export const SOURCE_PATTERN = /^[a-z0-9-]{1,40}$/;

/** A first name carries no markup, no link and no control characters. */
// Control characters are exactly what this rejects.
const UNSAFE_NAME_PATTERN = /[<>]|:\/\/|\bwww\.|[\u0000-\u001f\u007f]/i;

export type LeadFieldErrorCode = "required" | "invalid" | "too_long";
export type LeadField = "email" | "firstName" | "ageBand" | "consent";
export type LeadFieldErrors = Partial<Record<LeadField, LeadFieldErrorCode>>;

/** The order fields appear in the form, so an error summary lists problems top to bottom. */
export const LEAD_FIELD_ORDER: readonly LeadField[] = ["email", "firstName", "ageBand", "consent"];

/** Trim and lower-case: the one form of an address that is stored and compared everywhere. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

export function isSafeFirstName(value: string): boolean {
  return !UNSAFE_NAME_PATTERN.test(value);
}

/** True when the honeypot holds anything at all (even whitespace, or a non-string). */
export function isHoneypotFilled(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = (input as Record<string, unknown>)[HONEYPOT_FIELD];
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.length > 0;
}

/** The raw values the form holds, before any trimming. */
export interface LeadFieldValues {
  email: string;
  firstName: string;
  ageBand: string;
  consent: boolean;
}

/**
 * The browser's immediate check, mirroring `leadSubmissionSchema` field by field and returning the
 * same error codes, so the server's answer and the form's own never contradict each other.
 */
export function checkLeadFields(values: LeadFieldValues): LeadFieldErrors {
  const errors: LeadFieldErrors = {};
  const email = normalizeEmail(values.email);
  if (!email) errors.email = "required";
  else if (email.length > LEAD_LIMITS.email) errors.email = "too_long";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "invalid";

  const firstName = values.firstName.trim();
  if (firstName.length > LEAD_LIMITS.firstName) errors.firstName = "too_long";
  else if (firstName && !isSafeFirstName(firstName)) errors.firstName = "invalid";

  const ageBand = values.ageBand.trim();
  if (ageBand && !isAgeBand(ageBand)) errors.ageBand = "invalid";

  if (values.consent !== true) errors.consent = "required";
  return errors;
}

/** Campaign tags from a query string, keeping only the known tags that fit the server's bounds. */
export function utmFromSearch(search: string): UtmTags | undefined {
  const params = new URLSearchParams(search);
  const tags: UtmTags = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`)?.trim();
    // A tag with control characters is dropped, not sent.
    if (value && value.length <= LEAD_LIMITS.utm && !/[\u0000-\u001f\u007f]/.test(value)) tags[key] = value;
  }
  return Object.keys(tags).length > 0 ? tags : undefined;
}

/** The browser's language tag, if it is one the server accepts. */
export function safeLocale(locale: string | undefined): string | undefined {
  return locale && locale.length <= LEAD_LIMITS.locale && LOCALE_PATTERN.test(locale) ? locale : undefined;
}
