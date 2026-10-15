import { describe, expect, it } from "vitest";

import { ISO_COUNTRY_CODES } from "@/lib/orders/countries";
import { checkOrderFields, newSubmissionKey, type OrderFieldValues } from "@/lib/orders/fields";
import { validateOrderSubmission } from "@/lib/orders/schema";

/*
 * Task 7c: the order form's own check (lib/orders/fields.ts, no Zod in the browser) must give the
 * same field codes as the server's schema, so the form and the server never contradict each other.
 */
const BASE: OrderFieldValues = {
  contactName: "Sam Rivers",
  email: "parent@example.com",
  phone: "",
  addressLine1: "12 Harbour Road",
  addressLine2: "",
  city: "Seaside",
  region: "",
  postalCode: "",
  country: "AU",
  notes: "",
  consent: true,
};

const server = (values: OrderFieldValues) => {
  const result = validateOrderSubmission({ ...values, lines: [{ productId: "product-tula", quantity: 1 }], submissionKey: "6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60" });
  return result.ok ? {} : result.fieldErrors;
};

const CASES: Array<[string, Partial<OrderFieldValues>]> = [
  ["a valid request", {}],
  ["every optional field filled", { phone: "+61 2 5550 1234", addressLine2: "Unit 4", region: "NSW", postalCode: "2000", notes: "Line one\nLine two" }],
  ["nothing typed", { contactName: "", email: "", addressLine1: "", city: "", country: "", consent: false }],
  ["only spaces", { contactName: "   ", email: "  ", addressLine1: " ", city: " ", country: " " }],
  ["an email that is not one", { email: "not-an-email" }],
  ["an email with capitals and spaces", { email: "  Parent@Example.COM " }],
  ["an email too long", { email: `${"a".repeat(250)}@example.com` }],
  ["a long name", { contactName: "n".repeat(121) }],
  ["a long name with a control character", { contactName: `${"n".repeat(121)}\u0007` }],
  ["a name with a line break", { contactName: "Sam\nRivers" }],
  ["a short phone number", { phone: "12345" }],
  ["a phone number in words", { phone: "call me maybe" }],
  ["a long phone number", { phone: "1".repeat(33) }],
  ["long address lines", { addressLine1: "a".repeat(201), addressLine2: "b".repeat(201) }],
  ["an address with a tab", { addressLine1: "12\tHarbour Road" }],
  ["a long city and region", { city: "c".repeat(101), region: "r".repeat(101) }],
  ["a postcode with symbols", { postalCode: "20#00" }],
  ["a postcode starting with a space", { postalCode: " 2000" }],
  ["a long postcode", { postalCode: "1".repeat(17) }],
  ["a country name instead of a code", { country: "Australia" }],
  ["a lower-case country code", { country: "au" }],
  ["long notes", { notes: "n".repeat(1001) }],
  ["notes with a bell character", { notes: "ring\u0007" }],
  ["notes with tabs and line breaks", { notes: "a\tb\r\nc" }],
  ["no consent", { consent: false }],
];

describe("the order form's own check", () => {
  it.each(CASES)("agrees with the server on %s", (_case, edit) => {
    const values = { ...BASE, ...edit };
    expect(checkOrderFields(values, ISO_COUNTRY_CODES)).toEqual(server(values));
  });

  it("refuses a country the form does not offer, like the server with a CMS list (R85)", () => {
    expect(checkOrderFields({ ...BASE, country: "PH" }, ["AU", "NZ"])).toEqual({ country: "invalid" });
    expect(checkOrderFields({ ...BASE, country: "NZ" }, ["AU", "NZ"])).toEqual({});
  });

  it("lists problems in the form's order", () => {
    expect(Object.keys(checkOrderFields({ ...BASE, consent: false, city: "", contactName: "" }, ISO_COUNTRY_CODES))).toEqual(["contactName", "city", "consent"]);
  });
});

describe("the submission key (R81)", () => {
  it("is a fresh version 4 UUID each time, which the server accepts", () => {
    const first = newSubmissionKey();
    const second = newSubmissionKey();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    expect(validateOrderSubmission({ ...BASE, lines: [{ productId: "product-tula", quantity: 1 }], submissionKey: first }).ok).toBe(true);
  });

  it("is still made where crypto.randomUUID is missing (an older browser)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newSubmissionKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
