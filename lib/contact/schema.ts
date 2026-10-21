import { z } from "zod";

import { BOT_CHECK_TOKEN_FIELD, BOT_CHECK_TOKEN_MAX_LENGTH } from "@/lib/bot-check/fields";
import { EMAIL_PATTERN, isSafeFirstName, normalizeEmail } from "@/lib/leads/fields";
import type { ContactRecordInput } from "./types";
import {
  CONTACT_FIELD_ORDER,
  CONTACT_LIMITS,
  CONTACT_TOPICS,
  HONEYPOT_FIELD,
  characterCount,
  isSafeMessage,
  normalizeMessage,
  type ContactField,
  type ContactFieldErrorCode,
  type ContactFieldErrors,
} from "./fields";

/** A field the body did not carry is "required"; one of the wrong type is "invalid". */
const stringField = { error: (issue: { input?: unknown }) => (issue.input === undefined ? "required" : "invalid") };

const name = z
  .string(stringField)
  .trim()
  .min(1, { error: "required" })
  .refine((value) => characterCount(value) <= CONTACT_LIMITS.name, { error: "too_long" })
  .refine(isSafeFirstName, { error: "invalid" });

const email = z
  .string(stringField)
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .min(1, { error: "required" })
      .max(CONTACT_LIMITS.email, { error: "too_long" })
      .pipe(z.email({ pattern: EMAIL_PATTERN, error: "invalid" })),
  );

const topic = z
  .string(stringField)
  .trim()
  .min(1, { error: "required" })
  .pipe(z.enum(CONTACT_TOPICS, { error: "invalid" }));

/** Counted after CRLF becomes LF and the ends are trimmed, in code points: what the database's `char_length` sees. */
const message = z
  .string(stringField)
  .transform(normalizeMessage)
  .pipe(
    z
      .string()
      .min(1, { error: "required" })
      .refine((value) => characterCount(value) >= CONTACT_LIMITS.messageMin, { error: "too_short" })
      .refine((value) => characterCount(value) <= CONTACT_LIMITS.messageMax, { error: "too_long" })
      .refine(isSafeMessage, { error: "invalid" }),
  );

/**
 * The server's independent validation of a contact message (plan C5). Strict: any key the form does
 * not send (a child's name, an age) rejects the whole request. The honeypot is only ever empty
 * here; a filled one is turned away before validation.
 */
const contactSubmissionSchema = z.strictObject({
  name,
  email,
  topic,
  message,
  [HONEYPOT_FIELD]: z.literal("").optional(),
  [BOT_CHECK_TOKEN_FIELD]: z.string().min(1).max(BOT_CHECK_TOKEN_MAX_LENGTH).optional(),
});

/** Why a body was refused as a whole rather than field by field. */
export type ContactFormError = "invalid_body" | "unexpected_fields";

export type ContactValidationResult =
  | { ok: true; data: ContactRecordInput; botCheckToken?: string }
  | { ok: false; fieldErrors: ContactFieldErrors; formError?: ContactFormError };

const FIELD_CODES = new Set<ContactFieldErrorCode>(["required", "invalid", "too_short", "too_long"]);

/** Validates a parsed request body, reporting the first problem per visible field in the form's order. */
export function validateContactSubmission(input: unknown): ContactValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, fieldErrors: {}, formError: "invalid_body" };
  const parsed = contactSubmissionSchema.safeParse(input);
  if (parsed.success) {
    const { name: validName, email: validEmail, topic: validTopic, message: validMessage } = parsed.data;
    // The record carries exactly the four fields; the token travels beside it, never inside it.
    const record = { name: validName, email: validEmail, topic: validTopic, message: validMessage };
    const token = parsed.data[BOT_CHECK_TOKEN_FIELD];
    return token === undefined ? { ok: true, data: record } : { ok: true, data: record, botCheckToken: token };
  }

  const found: ContactFieldErrors = {};
  let formError: ContactFormError | undefined;
  for (const issue of parsed.error.issues) {
    const [field] = issue.path;
    if (issue.code === "unrecognized_keys" && issue.path.length === 0) {
      formError = "unexpected_fields";
    } else if (typeof field === "string" && (CONTACT_FIELD_ORDER as readonly string[]).includes(field)) {
      const code = FIELD_CODES.has(issue.message as ContactFieldErrorCode) ? (issue.message as ContactFieldErrorCode) : "invalid";
      found[field as ContactField] ??= code;
    } else {
      formError ??= "unexpected_fields";
    }
  }
  const fieldErrors: ContactFieldErrors = {};
  for (const key of CONTACT_FIELD_ORDER) if (found[key]) fieldErrors[key] = found[key];
  return formError ? { ok: false, fieldErrors, formError } : { ok: false, fieldErrors };
}
