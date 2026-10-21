import { z } from "zod";

import { BOT_CHECK_TOKEN_FIELD, BOT_CHECK_TOKEN_MAX_LENGTH } from "@/lib/bot-check/fields";
import {
  AGE_BANDS,
  EMAIL_PATTERN,
  HONEYPOT_FIELD,
  LEAD_FIELD_ORDER,
  LEAD_LIMITS,
  LOCALE_PATTERN,
  SOURCE_PATTERN,
  UTM_KEYS,
  isSafeFirstName,
  type LeadField,
  type LeadFieldErrorCode,
  type LeadFieldErrors,
} from "./fields";

export {
  AGE_BANDS,
  HONEYPOT_FIELD,
  LEAD_LIMITS,
  isHoneypotFilled,
  normalizeEmail,
  type AgeBand,
  type LeadField,
  type LeadFieldErrorCode,
  type LeadFieldErrors,
  type UtmTags,
} from "./fields";

/** A blank optional field counts as not given. */
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const email = z
  .string({ error: (issue) => (issue.input === undefined ? "required" : "invalid") })
  .trim()
  .toLowerCase()
  .min(1, { error: "required" })
  .max(LEAD_LIMITS.email, { error: "too_long" })
  .pipe(z.email({ pattern: EMAIL_PATTERN, error: "invalid" }));

const firstName = z.preprocess(
  blankToUndefined,
  z
    .string({ error: "invalid" })
    .trim()
    .max(LEAD_LIMITS.firstName, { error: "too_long" })
    .refine(isSafeFirstName, { error: "invalid" })
    .optional(),
);

const ageBand = z.preprocess(blankToUndefined, z.enum(AGE_BANDS, { error: "invalid" }).optional());

/** Campaign tags carry no control characters: the browser drops such a tag (`utmFromSearch`), the server refuses it (review M11). */
// Control characters are exactly what this rejects.
const UTM_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const utmValue = z.string().trim().min(1).max(LEAD_LIMITS.utm).refine((value) => !UTM_CONTROL_PATTERN.test(value));

/**
 * The server's independent validation of a founding-family signup (spec §9.2). Strict: any key the
 * form does not send (a child's name, a forged consent version, ...) rejects the whole request.
 * Consent must be the boolean `true`; the consent copy version is set by the server, never read here.
 */
export const leadSubmissionSchema = z.strictObject({
  email,
  consent: z.literal(true, { error: "required" }),
  firstName,
  ageBand,
  source: z.string().regex(SOURCE_PATTERN).optional(),
  locale: z.string().max(LEAD_LIMITS.locale).regex(LOCALE_PATTERN).optional(),
  utm: z.strictObject(Object.fromEntries(UTM_KEYS.map((key) => [key, utmValue.optional()])) as Record<(typeof UTM_KEYS)[number], z.ZodOptional<typeof utmValue>>).optional(),
  /** The honeypot: only ever empty here; a filled one is turned away before validation. */
  [HONEYPOT_FIELD]: z.literal("").optional(),
  /** The bot-check token: metadata for the gate, never part of the record (R218). */
  [BOT_CHECK_TOKEN_FIELD]: z.string().min(1).max(BOT_CHECK_TOKEN_MAX_LENGTH).optional(),
});

export type LeadSubmission = Omit<z.output<typeof leadSubmissionSchema>, typeof BOT_CHECK_TOKEN_FIELD>;

/** Why a body was refused as a whole rather than field by field. */
export type LeadFormError = "invalid_body" | "unexpected_fields" | "invalid_metadata";

export type LeadValidationResult =
  | { ok: true; data: LeadSubmission; botCheckToken?: string }
  | { ok: false; fieldErrors: LeadFieldErrors; formError?: LeadFormError };

const FIELD_CODES = new Set<LeadFieldErrorCode>(["required", "invalid", "too_long"]);

/** Validates a parsed request body, reporting the first problem per visible field in the form's order. */
export function validateLeadSubmission(input: unknown): LeadValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, fieldErrors: {}, formError: "invalid_body" };
  const parsed = leadSubmissionSchema.safeParse(input);
  if (parsed.success) {
    const { [BOT_CHECK_TOKEN_FIELD]: botCheckToken, ...data } = parsed.data;
    return botCheckToken === undefined ? { ok: true, data } : { ok: true, data, botCheckToken };
  }

  const found: LeadFieldErrors = {};
  let formError: LeadFormError | undefined;
  for (const issue of parsed.error.issues) {
    const [field] = issue.path;
    if (issue.code === "unrecognized_keys" && issue.path.length === 0) {
      formError = "unexpected_fields";
    } else if (typeof field === "string" && (LEAD_FIELD_ORDER as readonly string[]).includes(field)) {
      const key = field as LeadField;
      const code = FIELD_CODES.has(issue.message as LeadFieldErrorCode) ? (issue.message as LeadFieldErrorCode) : "invalid";
      found[key] ??= code;
    } else {
      formError ??= "invalid_metadata";
    }
  }
  const fieldErrors: LeadFieldErrors = {};
  for (const key of LEAD_FIELD_ORDER) if (found[key]) fieldErrors[key] = found[key];
  return formError ? { ok: false, fieldErrors, formError } : { ok: false, fieldErrors };
}
