import type { ContactFieldErrors, ContactFieldValues } from "@/lib/contact/fields";

/**
 * The contact form's field rules as one table of cases, shared by the browser check
 * (tests/contact/contact-fields.test.ts) and the server schema's test, so the two cannot disagree
 * (plan C1, Review Focus 1). Lengths count code points after CRLF and CR become LF and the value is
 * trimmed, which is what Postgres `char_length` counts in migration 0008.
 */
const BASE: ContactFieldValues = { name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent." };

const withValues = (values: Partial<ContactFieldValues>): ContactFieldValues => ({ ...BASE, ...values });

export const CONTACT_FIELD_CASES: ReadonlyArray<{ label: string; values: ContactFieldValues; errors: ContactFieldErrors }> = [
  { label: "a complete message passes", values: BASE, errors: {} },
  { label: "every field empty is required, in field order", values: { name: "", email: "", topic: "", message: "" }, errors: { name: "required", email: "required", topic: "required", message: "required" } },

  { label: "name: blank after trimming is required", values: withValues({ name: "   " }), errors: { name: "required" } },
  { label: "name: 80 characters passes", values: withValues({ name: "a".repeat(80) }), errors: {} },
  { label: "name: 81 characters is too long", values: withValues({ name: "a".repeat(81) }), errors: { name: "too_long" } },
  { label: "name: markup is invalid", values: withValues({ name: "Ada <b>" }), errors: { name: "invalid" } },
  { label: "name: a link is invalid", values: withValues({ name: "see https://x.example" }), errors: { name: "invalid" } },
  { label: "name: a line break (header injection) is invalid", values: withValues({ name: "Ada\nBcc: x" }), errors: { name: "invalid" } },

  { label: "email: empty is required", values: withValues({ email: "" }), errors: { email: "required" } },
  { label: "email: trimmed and lower-cased before the check", values: withValues({ email: "  Ada@Example.COM " }), errors: {} },
  { label: "email: 255 characters is too long", values: withValues({ email: `${"a".repeat(243)}@example.com` }), errors: { email: "too_long" } },
  { label: "email: not an address is invalid", values: withValues({ email: "ada@" }), errors: { email: "invalid" } },

  { label: "topic: empty is required", values: withValues({ topic: "" }), errors: { topic: "required" } },
  { label: "topic: one outside the list is invalid", values: withValues({ topic: "other" }), errors: { topic: "invalid" } },
  { label: "topic: shop-order passes", values: withValues({ topic: "shop-order" }), errors: {} },

  { label: "message: empty is required", values: withValues({ message: "" }), errors: { message: "required" } },
  { label: "message: blank after trimming is required", values: withValues({ message: " \r\n\t " }), errors: { message: "required" } },
  { label: "message: 5 characters after CRLF and trimming is too short", values: withValues({ message: "  short \r\n" }), errors: { message: "too_short" } },
  { label: "message: 10 emoji (20 UTF-16 units) passes", values: withValues({ message: "🐢".repeat(10) }), errors: {} },
  { label: "message: 9 emoji (18 UTF-16 units) is too short", values: withValues({ message: "🐢".repeat(9) }), errors: { message: "too_short" } },
  { label: "message: 3000 characters passes", values: withValues({ message: "a".repeat(3000) }), errors: {} },
  { label: "message: 3000 emoji passes", values: withValues({ message: "🐢".repeat(3000) }), errors: {} },
  { label: "message: 3001 characters is too long", values: withValues({ message: "a".repeat(3001) }), errors: { message: "too_long" } },
  { label: "message: 3001 emoji is too long", values: withValues({ message: "🐢".repeat(3001) }), errors: { message: "too_long" } },
  { label: "message: 3000 characters once CRLF is LF passes", values: withValues({ message: `${"a".repeat(1499)}\r\n${"a".repeat(1500)}` }), errors: {} },
  { label: "message: a bell character is invalid", values: withValues({ message: "hello\u0007there!!" }), errors: { message: "invalid" } },
  { label: "message: line breaks and tabs pass", values: withValues({ message: "line one\nline two\tok" }), errors: {} },
  { label: "message: a lone CR is a line break and passes", values: withValues({ message: "line one\rline two" }), errors: {} },
];
