import { describe, expect, it } from "vitest";

import { validateContactSubmission } from "@/lib/contact/schema";

import { CONTACT_FIELD_CASES } from "./field-cases";

/*
 * The server's independent validation (plan C5), checked against the browser's case table so the
 * two agree on every code (Review Focus 1).
 */
describe("validateContactSubmission", () => {
  it.each(CONTACT_FIELD_CASES)("the server agrees with the browser on $label", ({ values, errors }) => {
    const result = validateContactSubmission(values);
    if (Object.keys(errors).length === 0) {
      expect(result.ok).toBe(true);
    } else {
      expect(result).toEqual({ ok: false, fieldErrors: errors });
    }
  });

  it("refuses unknown keys as a whole", () => {
    const result = validateContactSubmission({ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent.", childName: "Sam" });
    expect(result).toEqual({ ok: false, fieldErrors: {}, formError: "unexpected_fields" });
  });

  it("refuses a body that is not an object", () => {
    for (const input of [null, "text", 5, ["a"]]) {
      expect(validateContactSubmission(input)).toEqual({ ok: false, fieldErrors: {}, formError: "invalid_body" });
    }
  });

  it("refuses a non-string field by its field code", () => {
    expect(validateContactSubmission({ name: 5, email: "ada@example.com", topic: "press", message: "Hello from a parent." })).toEqual({ ok: false, fieldErrors: { name: "invalid" } });
    expect(validateContactSubmission({ email: "ada@example.com", topic: "press", message: "Hello from a parent." })).toEqual({ ok: false, fieldErrors: { name: "required" } });
  });

  it("accepts an empty honeypot field and hands on the normalised record", () => {
    const result = validateContactSubmission({ name: " Ada ", email: "Ada@Example.com", topic: "press", message: "a\r\nbcdefghijk", website: "" });
    expect(result).toEqual({ ok: true, data: { name: "Ada", email: "ada@example.com", topic: "press", message: "a\nbcdefghijk" } });
  });

  it("accepts a 2048-character bot-check token and keeps it out of the record", () => {
    const result = validateContactSubmission({ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent.", botCheckToken: "t".repeat(2048) });
    expect(result).toEqual({ ok: true, data: { name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent." }, botCheckToken: "t".repeat(2048) });
  });

  it("exposes no token when none was sent", () => {
    const result = validateContactSubmission({ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent." });
    expect(result.ok && result.botCheckToken).toBeUndefined();
  });

  it.each([["2049 characters", "t".repeat(2049)], ["an empty string", ""], ["a number", 123]])("treats %s as metadata: the generic 400 with no field errors", (_label, token) => {
    const result = validateContactSubmission({ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent.", botCheckToken: token });
    expect(result).toEqual({ ok: false, fieldErrors: {}, formError: "unexpected_fields" });
  });
});
