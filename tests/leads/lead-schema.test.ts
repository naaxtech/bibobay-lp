import { describe, expect, it } from "vitest";

import {
  AGE_BANDS,
  HONEYPOT_FIELD,
  LEAD_LIMITS,
  isHoneypotFilled,
  leadSubmissionSchema,
  normalizeEmail,
  validateLeadSubmission,
} from "@/lib/leads/schema";

const VALID = { email: "Parent@Example.com", consent: true } as const;

function fieldErrors(input: unknown) {
  const result = validateLeadSubmission(input);
  if (result.ok) throw new Error("expected the submission to be rejected");
  return result.fieldErrors;
}

describe("adult email", () => {
  it("accepts an adult's email with consent, trimmed and lower-cased", () => {
    const result = validateLeadSubmission({ ...VALID, email: "  Parent@Example.COM " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe("parent@example.com");
  });

  it("normalises an email the same way everywhere it is compared", () => {
    expect(normalizeEmail("  Ana.Bay@Example.COM ")).toBe("ana.bay@example.com");
    expect(normalizeEmail("ana.bay@example.com")).toBe(normalizeEmail(" ANA.BAY@EXAMPLE.COM"));
  });

  it.each([
    ["missing", { consent: true }],
    ["empty", { email: "", consent: true }],
    ["blank", { email: "   ", consent: true }],
  ])("requires an email (%s)", (_label, input) => {
    expect(fieldErrors(input).email).toBe("required");
  });

  it.each(["not-an-email", "parent@", "@example.com", "parent example@example.com"])("rejects the malformed email %j", (email) => {
    expect(fieldErrors({ ...VALID, email }).email).toBe("invalid");
  });

  it("rejects an email longer than the 254 characters an address may have", () => {
    // Real DNS labels stop at 63 characters, so the longest valid address is built from several.
    const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    expect(email.length).toBe(LEAD_LIMITS.email);
    expect(validateLeadSubmission({ ...VALID, email }).ok).toBe(true);
    expect(fieldErrors({ ...VALID, email: `a${email}` }).email).toBe("too_long");
  });
});

describe("consent", () => {
  it.each([
    ["missing", undefined],
    ["unticked", false],
    ["the string \"true\"", "true"],
    ["the number 1", 1],
  ])("requires an explicit tick (%s)", (_label, consent) => {
    expect(fieldErrors({ email: VALID.email, consent }).consent).toBe("required");
  });

  it("reports every problem at once, so the form can list them together", () => {
    expect(fieldErrors({})).toEqual({ email: "required", consent: "required" });
  });
});

describe("optional details", () => {
  it("lists exactly the five broad age bands and nothing finer", () => {
    expect(AGE_BANDS).toEqual(["under-3", "3-5", "6-8", "9-12", "prefer-not-to-say"]);
  });

  it.each(AGE_BANDS)("accepts the age band %s", (ageBand) => {
    const result = validateLeadSubmission({ ...VALID, ageBand });
    expect(result.ok && result.data.ageBand).toBe(ageBand);
  });

  it("treats a blank age band or first name as not given", () => {
    const result = validateLeadSubmission({ ...VALID, ageBand: "", firstName: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ageBand).toBeUndefined();
      expect(result.data.firstName).toBeUndefined();
    }
  });

  it.each(["4", "newborn", "13-15", "2019-04-01"])("rejects the age %j, which is not a broad band", (ageBand) => {
    expect(fieldErrors({ ...VALID, ageBand }).ageBand).toBe("invalid");
  });

  it("keeps the adult's first name optional, trimmed and bounded", () => {
    const result = validateLeadSubmission({ ...VALID, firstName: "  Ana María " });
    expect(result.ok && result.data.firstName).toBe("Ana María");
    expect(validateLeadSubmission({ ...VALID, firstName: "a".repeat(LEAD_LIMITS.firstName) }).ok).toBe(true);
    expect(fieldErrors({ ...VALID, firstName: "a".repeat(LEAD_LIMITS.firstName + 1) }).firstName).toBe("too_long");
  });

  it.each(["<b>Ana</b>", "http://spam.example", "Ana www.spam.example", "Ana\u0000"])("rejects the first name %j, which carries a link, markup or control text", (firstName) => {
    expect(fieldErrors({ ...VALID, firstName }).firstName).toBe("invalid");
  });

  it("accepts bounded source, campaign tags and locale", () => {
    const result = validateLeadSubmission({
      ...VALID,
      source: "landing",
      locale: "en-AU",
      utm: { source: "newsletter", medium: "email", campaign: "founding-families", term: "bay", content: "hero" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe("landing");
      expect(result.data.locale).toBe("en-AU");
      expect(result.data.utm).toEqual({ source: "newsletter", medium: "email", campaign: "founding-families", term: "bay", content: "hero" });
    }
  });

  it.each([
    ["a campaign tag over the limit", { utm: { source: "x".repeat(LEAD_LIMITS.utm + 1) } }],
    ["an unknown campaign tag", { utm: { id: "123" } }],
    ["a campaign tag with a line break (M11)", { utm: { campaign: "spring\nsale" } }],
    ["a campaign tag with a NUL character (M11)", { utm: { source: "news\u0000letter" } }],
    ["a campaign tag with a DEL character (M11)", { utm: { medium: "email\u007f" } }],
    ["a campaign tag with an escape character (M11)", { utm: { content: "\u001b[31mhero" } }],
    ["a source that is not a slug", { source: "Landing Page!" }],
    ["a locale that is not a language tag", { locale: "en_AU; drop table" }],
    ["an over-long locale", { locale: `en-${"x".repeat(LEAD_LIMITS.locale)}` }],
  ])("rejects %s", (_label, extra) => {
    expect(validateLeadSubmission({ ...VALID, ...extra }).ok).toBe(false);
  });
});

describe("no child data and no unexpected input", () => {
  it.each([
    ["childName", "Mia"],
    ["childBirthday", "2021-02-03"],
    ["school", "Bay Primary"],
    ["photo", "data:image/png;base64,AAAA"],
    ["postcode", "2000"],
    ["consentVersion", "999"],
  ])("rejects a body carrying %s, which the form never collects", (field, value) => {
    const result = validateLeadSubmission({ ...VALID, [field]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toBe("unexpected_fields");
  });

  it.each([null, undefined, "parent@example.com", 42, [VALID]])("rejects the non-object body %j", (input) => {
    const result = validateLeadSubmission(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toBe("invalid_body");
  });

  it("is a strict Zod schema the server can reuse", () => {
    expect(leadSubmissionSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
    expect(leadSubmissionSchema.safeParse(VALID).success).toBe(true);
  });
});

describe("bot check token", () => {
  it("accepts a token of up to 2048 characters and exposes it apart from the record", () => {
    const result = validateLeadSubmission({ ...VALID, botCheckToken: "t".repeat(2048) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.botCheckToken).toBe("t".repeat(2048));
  });

  it("is optional", () => {
    const result = validateLeadSubmission(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.botCheckToken).toBeUndefined();
  });

  it("never appears in the validated data", () => {
    const result = validateLeadSubmission({ ...VALID, botCheckToken: "abc" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.data)).not.toContain("botCheckToken");
  });

  it.each([["a 2049-character token", "t".repeat(2049)], ["an empty token", ""], ["a number", 123]])("gives the generic 400 with no field errors for %s", (_label, token) => {
    const result = validateLeadSubmission({ ...VALID, botCheckToken: token });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toEqual({});
      expect(result.formError).toBe("invalid_metadata");
    }
  });
});

describe("honeypot", () => {
  it("names the field bots fill", () => {
    expect(HONEYPOT_FIELD).toBe("website");
  });

  it.each([
    [{ ...VALID, website: "http://spam.example" }, true],
    [{ ...VALID, website: "  x " }, true],
    [{ ...VALID, website: 1 }, true],
    [{ ...VALID, website: "" }, false],
    [VALID, false],
    [null, false],
    ["website", false],
  ])("detects a filled honeypot in %j: %s", (input, filled) => {
    expect(isHoneypotFilled(input)).toBe(filled);
  });

  it("accepts the empty honeypot a person leaves behind", () => {
    expect(validateLeadSubmission({ ...VALID, website: "" }).ok).toBe(true);
  });
});
