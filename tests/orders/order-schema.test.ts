import { describe, expect, it } from "vitest";

import { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY } from "@/lib/orders/constants";
import {
  HONEYPOT_FIELD,
  ORDER_FIELD_ORDER,
  ORDER_LIMITS,
  isHoneypotFilled,
  orderSubmissionSchema,
  parseTrackingRequest,
  validateOrderSubmission,
} from "@/lib/orders/schema";

/*
 * The server's independent validation of an order request (spec §10 step 4, §3 rulings 2 and 3):
 * adult contact and delivery details only, every text field bounded, consent required, and the
 * order lines carry product ids and quantities only. Names, SKUs and anything priced come from
 * the CMS on the server (lib/orders/catalogue.ts), never from this body.
 */

const LINE = { productId: "product-tula-plush", quantity: 2 };
/** R81: the form's key for one order attempt, made once and kept across retries. */
const KEY = "6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60";
const VALID = {
  contactName: "  Sam Rivers ",
  email: " Parent@Example.COM ",
  phone: "+61 2 5550 1234",
  addressLine1: "12 Harbour Road",
  addressLine2: "",
  city: "Seaside",
  region: "NSW",
  postalCode: "2000",
  country: "au",
  notes: "Please leave at the door.\nThank you.",
  consent: true,
  lines: [LINE],
  submissionKey: KEY,
  [HONEYPOT_FIELD]: "",
};

const errorsOf = (input: unknown) => {
  const result = validateOrderSubmission(input);
  return result.ok ? {} : result.fieldErrors;
};

describe("a valid order request", () => {
  it("is accepted and normalised: trimmed text, lower-case email, upper-case country, blank optionals dropped", () => {
    const result = validateOrderSubmission(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      contactName: "Sam Rivers",
      email: "parent@example.com",
      phone: "+61 2 5550 1234",
      addressLine1: "12 Harbour Road",
      city: "Seaside",
      region: "NSW",
      postalCode: "2000",
      country: "AU",
      notes: "Please leave at the door.\nThank you.",
      consent: true,
      lines: [LINE],
      submissionKey: KEY,
      [HONEYPOT_FIELD]: "",
    });
  });

  it("needs only a name, email, first address line, city, country, consent, one line and the submission key", () => {
    const { phone, addressLine2, region, postalCode, notes, website, ...required } = VALID;
    void phone; void addressLine2; void region; void postalCode; void notes; void website;
    expect(validateOrderSubmission(required).ok).toBe(true);
  });
});

describe("the submission key (R81)", () => {
  it("is required: a body without one is refused as a whole, never as a field the visitor can fix", () => {
    const { submissionKey, ...rest } = VALID;
    void submissionKey;
    expect(validateOrderSubmission(rest)).toEqual({ ok: false, fieldErrors: {}, formError: "invalid_metadata" });
  });

  it.each([["a short string", "abc"], ["a number", 42], ["a UUID with a space", ` ${KEY}`], ["a non-UUID of the right length", "z".repeat(36)], ["null", null]])("refuses %s", (_case, submissionKey) => {
    expect(validateOrderSubmission({ ...VALID, submissionKey })).toEqual({ ok: false, fieldErrors: {}, formError: "invalid_metadata" });
  });

  it("accepts the UUIDs crypto.randomUUID makes", () => {
    expect(validateOrderSubmission({ ...VALID, submissionKey: crypto.randomUUID() }).ok).toBe(true);
  });
});

describe("consent", () => {
  it.each([["missing", undefined], ["false", false], ["the string true", "true"], ["1", 1]])("is required as a literal true (%s)", (_case, consent) => {
    expect(errorsOf({ ...VALID, consent })).toEqual({ consent: "required" });
  });

  it("never takes a consent version from the browser", () => {
    const result = validateOrderSubmission({ ...VALID, consentVersion: "0" });
    expect(result).toMatchObject({ ok: false, formError: "unexpected_fields" });
  });
});

describe("required adult contact and delivery fields", () => {
  it.each(["contactName", "email", "addressLine1", "city", "country"] as const)("%s is required", (field) => {
    expect(errorsOf({ ...VALID, [field]: "   " })).toEqual({ [field]: "required" });
    const { [field]: removed, ...rest } = VALID;
    void removed;
    expect(errorsOf(rest)).toEqual({ [field]: "required" });
  });

  it("refuses an email that is not an address", () => {
    expect(errorsOf({ ...VALID, email: "not-an-email" })).toEqual({ email: "invalid" });
  });

  it("accepts only a two-letter country code", () => {
    expect(errorsOf({ ...VALID, country: "Australia" })).toEqual({ country: "invalid" });
    expect(errorsOf({ ...VALID, country: "A1" })).toEqual({ country: "invalid" });
  });

  it("accepts only digits, spaces and + ( ) . - in a phone number", () => {
    expect(errorsOf({ ...VALID, phone: "call me maybe" })).toEqual({ phone: "invalid" });
  });
});

describe("bounded text fields", () => {
  it.each([
    ["contactName", ORDER_LIMITS.contactName],
    ["addressLine1", ORDER_LIMITS.addressLine],
    ["addressLine2", ORDER_LIMITS.addressLine],
    ["city", ORDER_LIMITS.city],
    ["region", ORDER_LIMITS.region],
    ["notes", ORDER_LIMITS.notes],
  ] as const)("%s refuses more than its limit", (field, limit) => {
    expect(validateOrderSubmission({ ...VALID, [field]: "a".repeat(limit) }).ok).toBe(true);
    expect(errorsOf({ ...VALID, [field]: "a".repeat(limit + 1) })).toEqual({ [field]: "too_long" });
  });

  it("bounds the email, phone and postal code too", () => {
    expect(errorsOf({ ...VALID, email: `${"a".repeat(250)}@example.com` })).toEqual({ email: "too_long" });
    expect(errorsOf({ ...VALID, phone: "1".repeat(ORDER_LIMITS.phone + 1) })).toEqual({ phone: "too_long" });
    expect(errorsOf({ ...VALID, postalCode: "1".repeat(ORDER_LIMITS.postalCode + 1) })).toEqual({ postalCode: "too_long" });
  });

  it("keeps the limits the database enforces", () => {
    expect(ORDER_LIMITS).toEqual({ contactName: 120, email: 254, phone: 32, addressLine: 200, city: 100, region: 100, postalCode: 16, notes: 1000 });
  });

  it("refuses control characters in one-line fields, and allows line breaks only in the notes", () => {
    expect(errorsOf({ ...VALID, addressLine1: "12 Harbour\nRoad" })).toEqual({ addressLine1: "invalid" });
    expect(errorsOf({ ...VALID, contactName: "Sam\u0007" })).toEqual({ contactName: "invalid" });
    expect(errorsOf({ ...VALID, notes: "Ring twice\u0000" })).toEqual({ notes: "invalid" });
    expect(validateOrderSubmission({ ...VALID, notes: "Line one\r\nLine two\tend" }).ok).toBe(true);
  });
});

describe("the contact name (fix wave D-M3: the signup first-name rule)", () => {
  it.each([
    ["a link", "Your parcel is held, pay at https://evil.example"],
    ["a scheme-less link", "Sam pay at evil.example://x"],
    ["a www address", "Sam see www.evil.example"],
    ["markup", "Sam <b>Rivers</b>"],
    ["a lone angle bracket", "Sam > Rivers"],
  ])("refuses %s: the name opens buyer emails (\"Hi <name>,\")", (_case, contactName) => {
    expect(errorsOf({ ...VALID, contactName })).toEqual({ contactName: "invalid" });
  });

  it.each(["Ana-María O'Neil", "Dr. Sam Rivers Jr.", "李小龍", "Jo (Tide)", "Wwwendy Rivers"])("accepts a real name: %s", (contactName) => {
    expect(validateOrderSubmission({ ...VALID, contactName }).ok).toBe(true);
  });

  it("still reports a name that is too long as too long first", () => {
    expect(errorsOf({ ...VALID, contactName: `https://evil.example/${"n".repeat(120)}` })).toEqual({ contactName: "too_long" });
  });
});

describe("order lines: product ids and quantities only", () => {
  it("needs at least one line", () => {
    expect(errorsOf({ ...VALID, lines: [] })).toEqual({ lines: "required" });
    const { lines, ...rest } = VALID;
    void lines;
    expect(errorsOf(rest)).toEqual({ lines: "required" });
  });

  it("holds at most the order pad's line limit, the same one the database enforces", () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => ({ productId: `product-${index}`, quantity: 1 }));
    expect(ORDER_PAD_MAX_LINES).toBe(40);
    expect(validateOrderSubmission({ ...VALID, lines: lines(ORDER_PAD_MAX_LINES) }).ok).toBe(true);
    expect(errorsOf({ ...VALID, lines: lines(ORDER_PAD_MAX_LINES + 1) })).toEqual({ lines: "too_long" });
  });

  it.each([0, -1, 1.5, ORDER_PAD_MAX_QUANTITY + 1, "2", null])("refuses the quantity %s", (quantity) => {
    expect(errorsOf({ ...VALID, lines: [{ productId: LINE.productId, quantity }] })).toEqual({ lines: "invalid" });
  });

  it("accepts the largest quantity one order may hold", () => {
    expect(validateOrderSubmission({ ...VALID, lines: [{ productId: LINE.productId, quantity: ORDER_PAD_MAX_QUANTITY }] }).ok).toBe(true);
  });

  it.each(["drafts.product-tula", "versions.r1.product-tula", "../product", "", "a b", "x".repeat(129)])("refuses the product id %j", (productId) => {
    expect(errorsOf({ ...VALID, lines: [{ productId, quantity: 1 }] })).toEqual({ lines: "invalid" });
  });

  it("refuses the same product twice (the order pad merges them; a duplicate means a forged body)", () => {
    expect(errorsOf({ ...VALID, lines: [LINE, LINE] })).toEqual({ lines: "invalid" });
  });

  it("refuses client-supplied product names, SKUs or prices on a line", () => {
    for (const extra of [{ name: "Forged name" }, { sku: "FORGED" }, { price: 0 }, { unitPrice: 1 }]) {
      expect(errorsOf({ ...VALID, lines: [{ ...LINE, ...extra }] })).toEqual({ lines: "invalid" });
    }
  });
});

describe("no prices, no payment details, no child data", () => {
  it("has no field for a price, total, currency or payment detail", () => {
    const keys = Object.keys(orderSubmissionSchema.shape);
    expect(keys.filter((key) => /price|total|currency|amount|card|cvc|cvv|iban|payment|pay/i.test(key))).toEqual([]);
  });

  it.each([
    ["a price", { price: 10 }],
    ["a total", { total: "10.00" }],
    ["a card number", { cardNumber: "4242424242424242" }],
    ["a child's name", { childName: "Mia" }],
    ["a child's birthday", { childBirthday: "2022-01-01" }],
  ])("rejects a body that carries %s", (_case, extra) => {
    expect(validateOrderSubmission({ ...VALID, ...extra })).toMatchObject({ ok: false, formError: "unexpected_fields" });
  });

  it("asks only for adult contact and delivery fields", () => {
    expect([...ORDER_FIELD_ORDER]).toEqual(["contactName", "email", "phone", "addressLine1", "addressLine2", "city", "region", "postalCode", "country", "notes", "consent", "lines"]);
  });
});

describe("request shape and honeypot", () => {
  it.each([null, "text", 42, [VALID]])("refuses a body that is not an object (%j)", (input) => {
    expect(validateOrderSubmission(input)).toEqual({ ok: false, fieldErrors: {}, formError: "invalid_body" });
  });

  it("treats any value in the hidden field as a bot", () => {
    expect(isHoneypotFilled({ ...VALID, [HONEYPOT_FIELD]: "https://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ ...VALID, [HONEYPOT_FIELD]: " " })).toBe(true);
    expect(isHoneypotFilled(VALID)).toBe(false);
  });

  it("reports field problems in the form's order", () => {
    const result = validateOrderSubmission({ lines: [], consent: false, email: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors)).toEqual(["contactName", "email", "addressLine1", "city", "country", "consent", "lines"]);
  });
});

describe("tracking requests", () => {
  const TOKEN = "a".repeat(64);

  it("reads a private tracking token", () => {
    expect(parseTrackingRequest({ token: TOKEN })).toEqual({ kind: "token", token: TOKEN });
  });

  it("reads a reference plus the email the order was placed with, normalised", () => {
    expect(parseTrackingRequest({ reference: " bb-1a2b-3c4d ", email: " Parent@Example.com " })).toEqual({ kind: "reference", reference: "BB-1A2B-3C4D", email: "parent@example.com" });
  });

  it.each([
    ["a reference alone", { reference: "BB-1A2B-3C4D" }],
    ["an email alone", { email: "parent@example.com" }],
    ["a short token", { token: "abc" }],
    ["an upper-case token", { token: "A".repeat(64) }],
    ["a token and a reference", { token: TOKEN, reference: "BB-1A2B-3C4D", email: "parent@example.com" }],
    ["a malformed reference", { reference: "ORDER-1", email: "parent@example.com" }],
    ["a malformed email", { reference: "BB-1A2B-3C4D", email: "parent" }],
    ["an extra key", { token: TOKEN, include: "address" }],
    ["not an object", "BB-1A2B-3C4D"],
  ])("refuses %s, with no detail about why", (_case, input) => {
    expect(parseTrackingRequest(input)).toBeNull();
  });
});
