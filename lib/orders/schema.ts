import { z } from "zod";

import { isOrderPadProductId, type OrderPadLine } from "./pad";
import {
  COUNTRY_PATTERN,
  EMAIL_PATTERN,
  HONEYPOT_FIELD,
  MULTI_LINE_CONTROL,
  ORDER_FIELD_ORDER,
  ORDER_LIMITS,
  ORDER_PAD_MAX_LINES,
  ORDER_PAD_MAX_QUANTITY,
  ORDER_REFERENCE_PATTERN,
  PHONE_MIN_LENGTH,
  PHONE_PATTERN,
  POSTAL_CODE_PATTERN,
  SINGLE_LINE_CONTROL,
  TRACKING_TOKEN_PATTERN,
  normalizeEmail,
  type OrderField,
  type OrderFieldErrorCode,
  type OrderFieldErrors,
} from "./fields";

export {
  HONEYPOT_FIELD,
  ORDER_FIELD_ORDER,
  ORDER_LIMITS,
  isHoneypotFilled,
  type OrderField,
  type OrderFieldErrorCode,
  type OrderFieldErrors,
} from "./fields";

/**
 * The server's independent validation of an order request (spec §10 step 4). Strict: any key the
 * form does not send (a price, a product name, a consent version, a child's details) rejects the
 * whole request. Each line is a product id and a quantity, nothing more: names, SKUs, variants and
 * packs are reloaded from the CMS on the server (lib/orders/catalogue.ts), never read from here.
 */

/** A blank optional field counts as not given. */
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const missingOrInvalid = { error: (issue: { input?: unknown }) => (issue.input === undefined ? "required" : "invalid") };

/** A required one-line text field: trimmed, non-empty, bounded, no control characters. */
const requiredLine = (limit: number) =>
  z
    .string(missingOrInvalid)
    .trim()
    .min(1, { error: "required" })
    .max(limit, { error: "too_long" })
    .refine((value) => !SINGLE_LINE_CONTROL.test(value), { error: "invalid" });

/** An optional one-line text field; blank means not given. */
const optionalLine = (limit: number) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: "invalid" })
      .trim()
      .max(limit, { error: "too_long" })
      .refine((value) => !SINGLE_LINE_CONTROL.test(value), { error: "invalid" })
      .optional(),
  );

const email = z
  .string(missingOrInvalid)
  .trim()
  .toLowerCase()
  .min(1, { error: "required" })
  .max(ORDER_LIMITS.email, { error: "too_long" })
  .pipe(z.email({ pattern: EMAIL_PATTERN, error: "invalid" }));

const phone = z.preprocess(
  blankToUndefined,
  z
    .string({ error: "invalid" })
    .trim()
    .max(ORDER_LIMITS.phone, { error: "too_long" })
    .min(PHONE_MIN_LENGTH, { error: "invalid" })
    .regex(PHONE_PATTERN, { error: "invalid" })
    .optional(),
);

const postalCode = z.preprocess(
  blankToUndefined,
  z
    .string({ error: "invalid" })
    .trim()
    .max(ORDER_LIMITS.postalCode, { error: "too_long" })
    .regex(POSTAL_CODE_PATTERN, { error: "invalid" })
    .optional(),
);

const country = z
  .string(missingOrInvalid)
  .trim()
  .toUpperCase()
  .min(1, { error: "required" })
  .regex(COUNTRY_PATTERN, { error: "invalid" });

const notes = z.preprocess(
  blankToUndefined,
  z
    .string({ error: "invalid" })
    .trim()
    .max(ORDER_LIMITS.notes, { error: "too_long" })
    .refine((value) => !MULTI_LINE_CONTROL.test(value), { error: "invalid" })
    .optional(),
);

/** One order line: a published product id and a whole quantity. Any other key rejects it. */
const orderLine = z.strictObject({
  productId: z.string().refine(isOrderPadProductId),
  quantity: z.number().int().min(1).max(ORDER_PAD_MAX_QUANTITY),
});

const lines = z
  .array(orderLine, missingOrInvalid)
  .min(1, { error: "required" })
  .max(ORDER_PAD_MAX_LINES, { error: "too_long" })
  // The order pad merges repeats, so a product twice means a body the form never sends.
  .refine((entries) => new Set(entries.map((entry) => entry.productId)).size === entries.length, { error: "invalid" });

export const orderSubmissionSchema = z.strictObject({
  contactName: requiredLine(ORDER_LIMITS.contactName),
  email,
  phone,
  addressLine1: requiredLine(ORDER_LIMITS.addressLine),
  addressLine2: optionalLine(ORDER_LIMITS.addressLine),
  city: requiredLine(ORDER_LIMITS.city),
  region: optionalLine(ORDER_LIMITS.region),
  postalCode,
  country,
  notes,
  consent: z.literal(true, { error: "required" }),
  lines,
  /** The honeypot: only ever empty here; a filled one is turned away before validation. */
  [HONEYPOT_FIELD]: z.literal("").optional(),
});

export type OrderSubmission = z.output<typeof orderSubmissionSchema> & { lines: OrderPadLine[] };

/** Why a body was refused as a whole rather than field by field. */
export type OrderFormError = "invalid_body" | "unexpected_fields" | "invalid_metadata";

export type OrderValidationResult =
  | { ok: true; data: OrderSubmission }
  | { ok: false; fieldErrors: OrderFieldErrors; formError?: OrderFormError };

const FIELD_CODES = new Set<OrderFieldErrorCode>(["required", "invalid", "too_long"]);

/** Validates a parsed request body, reporting the first problem per field in the form's order. */
export function validateOrderSubmission(input: unknown): OrderValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, fieldErrors: {}, formError: "invalid_body" };
  const parsed = orderSubmissionSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };

  const found: OrderFieldErrors = {};
  let formError: OrderFormError | undefined;
  for (const issue of parsed.error.issues) {
    const [field] = issue.path;
    if (issue.code === "unrecognized_keys" && issue.path.length === 0) {
      formError = "unexpected_fields";
    } else if (typeof field === "string" && (ORDER_FIELD_ORDER as readonly string[]).includes(field)) {
      const key = field as OrderField;
      // Problems inside one line (a bad id, quantity or extra key) all read as the lines being invalid.
      const code = issue.path.length === 1 && FIELD_CODES.has(issue.message as OrderFieldErrorCode) ? (issue.message as OrderFieldErrorCode) : "invalid";
      found[key] ??= code;
    } else {
      formError ??= "invalid_metadata";
    }
  }
  const fieldErrors: OrderFieldErrors = {};
  for (const key of ORDER_FIELD_ORDER) if (found[key]) fieldErrors[key] = found[key];
  return formError ? { ok: false, fieldErrors, formError } : { ok: false, fieldErrors };
}

/** What a tracking request asks for: a private token, or a reference with its order's email. */
export type TrackingRequest = { kind: "token"; token: string } | { kind: "reference"; reference: string; email: string };

const trackingRequestSchema = z.union([
  z.strictObject({ token: z.string().regex(TRACKING_TOKEN_PATTERN) }),
  z.strictObject({
    reference: z.string().trim().toUpperCase().regex(ORDER_REFERENCE_PATTERN),
    email: z.string().max(ORDER_LIMITS.email + 64).transform(normalizeEmail).pipe(z.string().max(ORDER_LIMITS.email).regex(EMAIL_PATTERN)),
  }),
]);

/**
 * Reads a tracking request. Anything malformed is null, with no reason: the caller answers it
 * exactly like an order that was not found, so a lookup never says which part was wrong.
 */
export function parseTrackingRequest(input: unknown): TrackingRequest | null {
  const parsed = trackingRequestSchema.safeParse(input);
  if (!parsed.success) return null;
  return "token" in parsed.data
    ? { kind: "token", token: parsed.data.token }
    : { kind: "reference", reference: parsed.data.reference, email: parsed.data.email };
}
