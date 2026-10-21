import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTACT_FORM_COPY, contactFieldErrorMessage } from "@/components/forms/contact-copy";
import { DELIVERY_CLAIM_PATTERN } from "@/lib/content/claims";
import { CONTACT_FIELD_ORDER, CONTACT_LIMITS, type ContactFieldErrorCode } from "@/lib/contact/fields";

const CODES: readonly ContactFieldErrorCode[] = ["required", "invalid", "too_short", "too_long"];

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("the contact form's chrome copy", () => {
  it("has a message for every field and every code, falling back to the field's first message", () => {
    for (const field of CONTACT_FIELD_ORDER) {
      const own = Object.values(CONTACT_FORM_COPY.errors[field]);
      expect(own.length, field).toBeGreaterThan(0);
      for (const code of CODES) {
        const message = contactFieldErrorMessage(field, code);
        expect(message.length, `${field}.${code}`).toBeGreaterThan(0);
        expect(own, `${field}.${code}`).toContain(message);
      }
    }
    expect(contactFieldErrorMessage("name", "too_short")).toBe(CONTACT_FORM_COPY.errors.name.required);
  });

  it("states the limits the browser enforces", () => {
    expect(CONTACT_FORM_COPY.errors.name.too_long).toContain(String(CONTACT_LIMITS.name));
    expect(CONTACT_FORM_COPY.errors.message.too_short).toContain(String(CONTACT_LIMITS.messageMin));
    expect(CONTACT_FORM_COPY.errors.message.too_long).toContain("3,000");
  });

  it("says nothing about the visitor's connection when rate-limited: the 429 may come from the per-client or the global bucket (R210)", () => {
    expect(CONTACT_FORM_COPY.outcome.rateLimited).toBe("A lot of messages are arriving just now. Please wait a few minutes and try again.");
    expect(CONTACT_FORM_COPY.outcome.rateLimited).not.toMatch(/\b(connection|from here|you have|your)\b/i);
    expect(CONTACT_FORM_COPY.outcome.rateLimited).not.toMatch(DELIVERY_CLAIM_PATTERN);
  });

  it("is imported by the browser spec, never copied into it, so the spec cannot expect stale wording (R210)", () => {
    const spec = readFileSync(resolve("e2e/contact/contact-form.spec.ts"), "utf8");
    expect(spec).toContain('import { CONTACT_FORM_COPY } from "@/components/forms/contact-copy";');
    for (const text of strings(CONTACT_FORM_COPY)) expect(spec, text).not.toContain(`"${text}"`);
  });

  it("makes no delivery claim in any chrome string", () => {
    for (const text of strings(CONTACT_FORM_COPY)) expect(text, text).not.toMatch(DELIVERY_CLAIM_PATTERN);
  });

  it("asks nothing about a child and says to leave child details out", () => {
    const asked = [CONTACT_FORM_COPY.name, CONTACT_FORM_COPY.email, CONTACT_FORM_COPY.topic, CONTACT_FORM_COPY.errors].flatMap(strings);
    for (const text of asked) expect(text, text).not.toMatch(/\b(child|children|kid|kids|age)\b/i);
    expect(CONTACT_FORM_COPY.message.hint).toMatch(/leave out any details about a child/i);
  });
});
