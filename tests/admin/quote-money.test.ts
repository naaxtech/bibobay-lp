import { describe, expect, it, vi } from "vitest";

import { QUOTE_AMOUNT_MAX_MINOR } from "@/lib/orders/admin";
import { QUOTE_CURRENCIES, QUOTE_MAX_MINOR, currencyExponent, formatMajorInput, formatMinor, parseMajorAmount } from "@/lib/orders/quote-money";

vi.mock("server-only", () => ({}));

/*
 * Task 8c, ruling R103: staff type a quote in the currency's major unit; conversion to the minor
 * units the API stores is integer string arithmetic, never a float.
 */
describe("QUOTE_CURRENCIES", () => {
  it("is the fixed list: two decimals everywhere but the yen", () => {
    expect(QUOTE_CURRENCIES.map(({ code, exponent }) => `${code}:${exponent}`)).toEqual(["PHP:2", "USD:2", "EUR:2", "GBP:2", "AUD:2", "SGD:2", "JPY:0"]);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("PHP")).toBe(2);
  });

  it("uses the same ceiling as the quote API", () => {
    expect(QUOTE_MAX_MINOR).toBe(QUOTE_AMOUNT_MAX_MINOR);
  });
});

describe("parseMajorAmount", () => {
  const minor = (text: string, currency = "PHP") => parseMajorAmount(text, currency);

  it("converts whole and decimal amounts exactly", () => {
    expect(minor("1250")).toEqual({ ok: true, minor: 125000 });
    expect(minor("1250.5")).toEqual({ ok: true, minor: 125050 });
    expect(minor("1250.50")).toEqual({ ok: true, minor: 125050 });
    expect(minor("0.07")).toEqual({ ok: true, minor: 7 });
    expect(minor("0")).toEqual({ ok: true, minor: 0 });
    expect(minor("0.00")).toEqual({ ok: true, minor: 0 });
    expect(minor("  12.30  ")).toEqual({ ok: true, minor: 1230 });
    expect(minor("0001.10")).toEqual({ ok: true, minor: 110 });
  });

  it("is exact where floating point is not (0.1 + 0.2 style amounts, 1.005, 19.99)", () => {
    expect(minor("19.99")).toEqual({ ok: true, minor: 1999 });
    expect(minor("1.15")).toEqual({ ok: true, minor: 115 });
    expect(minor("1000000.00")).toEqual({ ok: true, minor: 100_000_000 });
  });

  it("takes no decimals for yen", () => {
    expect(minor("1500", "JPY")).toEqual({ ok: true, minor: 1500 });
    expect(minor("1500.5", "JPY")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(minor("1500.00", "JPY")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(minor("100000000", "JPY")).toEqual({ ok: true, minor: 100_000_000 });
    expect(minor("100000001", "JPY")).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses empty text", () => {
    expect(minor("")).toEqual({ ok: false, reason: "required" });
    expect(minor("   ")).toEqual({ ok: false, reason: "required" });
  });

  it("refuses more decimals than the currency has, even when they are zeros", () => {
    expect(minor("1.005")).toEqual({ ok: false, reason: "too_many_decimals" });
    expect(minor("1.000")).toEqual({ ok: false, reason: "too_many_decimals" });
  });

  it("refuses negatives", () => {
    expect(minor("-1")).toEqual({ ok: false, reason: "negative" });
    expect(minor("-0.50")).toEqual({ ok: false, reason: "negative" });
    expect(minor("-0")).toEqual({ ok: false, reason: "negative" });
  });

  it("refuses anything above the ceiling, however many digits", () => {
    expect(minor("1000000.01")).toEqual({ ok: false, reason: "too_large" });
    expect(minor("1000001")).toEqual({ ok: false, reason: "too_large" });
    expect(minor("99999999999999999999999999")).toEqual({ ok: false, reason: "too_large" });
    expect(minor("9".repeat(400))).toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses text that is not a plain decimal number", () => {
    for (const text of ["abc", "1,250.00", "1 250", "1.", ".5", "1e3", "0x10", "+5", "1.2.3", "NaN", "Infinity", "１２", "5 PHP", "1\n2", "--1", "- 1"]) {
      expect(minor(text), text).toEqual({ ok: false, reason: expect.stringMatching(/^(?:invalid|negative)$/) });
    }
    expect(minor("1,250.00")).toEqual({ ok: false, reason: "invalid" });
    expect(minor(".5")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a currency outside the list", () => {
    expect(parseMajorAmount("10", "XXX")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMajorAmount("10", "php")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("formatMajorInput", () => {
  it("writes minor units back as the text a person typed", () => {
    expect(formatMajorInput(125050, "PHP")).toBe("1250.50");
    expect(formatMajorInput(7, "PHP")).toBe("0.07");
    expect(formatMajorInput(0, "PHP")).toBe("0.00");
    expect(formatMajorInput(100_000_000, "PHP")).toBe("1000000.00");
    expect(formatMajorInput(1500, "JPY")).toBe("1500");
    expect(formatMajorInput(0, "JPY")).toBe("0");
  });

  it("round-trips through parseMajorAmount", () => {
    for (const [value, currency] of [[1, "USD"], [99, "EUR"], [100, "GBP"], [123456789 % 100_000_001, "AUD"], [100_000_000, "SGD"], [1500, "JPY"]] as const) {
      expect(parseMajorAmount(formatMajorInput(value, currency), currency)).toEqual({ ok: true, minor: value });
    }
  });

  it("gives empty text for a figure that is not a stored amount", () => {
    expect(formatMajorInput(null, "PHP")).toBe("");
    expect(formatMajorInput(-5, "PHP")).toBe("");
    expect(formatMajorInput(1.5, "PHP")).toBe("");
    expect(formatMajorInput(5, "XXX")).toBe("");
  });
});

describe("formatMinor", () => {
  it("shows minor units as money in the currency", () => {
    expect(formatMinor(125050, "PHP")).toMatch(/1,250\.50/);
    expect(formatMinor(125050, "USD")).toBe("$1,250.50");
    expect(formatMinor(1500, "JPY")).toMatch(/1,500/);
    expect(formatMinor(1500, "JPY")).not.toMatch(/\./);
    expect(formatMinor(0, "EUR")).toBe("€0.00");
  });

  it("falls back to the code and the plain figure for a currency it does not know", () => {
    expect(formatMinor(12345, "XXX")).toBe("XXX 123.45");
    expect(formatMinor(12345, "")).toBe("123.45");
  });
});
