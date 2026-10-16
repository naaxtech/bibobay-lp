import { describe, expect, it } from "vitest";

import { checkLeadFields, safeLocale, utmFromSearch, type LeadFieldValues } from "@/lib/leads/fields";
import { validateLeadSubmission } from "@/lib/leads/schema";

/**
 * The browser's quick check and the server's Zod schema must agree on every field, or the form
 * would let through what the server refuses (or block what it accepts).
 */
const CASES: LeadFieldValues[] = [
  { email: "", firstName: "", ageBand: "", consent: false },
  { email: "parent@example.com", firstName: "", ageBand: "", consent: true },
  { email: "  Parent@Example.COM ", firstName: " Ana ", ageBand: "3-5", consent: true },
  { email: "parent@", firstName: "", ageBand: "", consent: true },
  { email: "parent example@example.com", firstName: "", ageBand: "", consent: true },
  { email: "a@b.c", firstName: "", ageBand: "", consent: true },
  { email: `${"a".repeat(250)}@b.co`, firstName: "", ageBand: "", consent: true },
  { email: "parent@example.com", firstName: "a".repeat(81), ageBand: "", consent: true },
  { email: "parent@example.com", firstName: "<b>x</b>", ageBand: "", consent: true },
  { email: "parent@example.com", firstName: "see www.spam.example", ageBand: "", consent: true },
  { email: "parent@example.com", firstName: "", ageBand: "13-15", consent: true },
  { email: "parent@example.com", firstName: "", ageBand: "prefer-not-to-say", consent: false },
  { email: "   ", firstName: "   ", ageBand: "  ", consent: true },
];

describe("client and server validation agree", () => {
  it.each(CASES)("gives the same verdict for %j", (values) => {
    const client = checkLeadFields(values);
    const server = validateLeadSubmission({
      email: values.email,
      consent: values.consent,
      ...(values.firstName ? { firstName: values.firstName } : {}),
      ...(values.ageBand ? { ageBand: values.ageBand } : {}),
    });
    expect(server.ok ? {} : server.fieldErrors).toEqual(client);
  });
});

describe("page metadata the form forwards", () => {
  it("keeps only known, bounded campaign tags", () => {
    expect(utmFromSearch("?utm_source=news&utm_campaign=founding&utm_id=9&ref=x")).toEqual({ source: "news", campaign: "founding" });
    expect(utmFromSearch(`?utm_source=${"x".repeat(101)}`)).toBeUndefined();
    expect(utmFromSearch("")).toBeUndefined();
  });

  it("forwards only a well-formed language tag", () => {
    expect(safeLocale("en-AU")).toBe("en-AU");
    expect(safeLocale("en_AU")).toBeUndefined();
    expect(safeLocale(undefined)).toBeUndefined();
  });
});
