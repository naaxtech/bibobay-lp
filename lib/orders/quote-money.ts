/**
 * Money entry for the staff quote form (Task 8c, ruling R103). Staff type decimal text in the
 * currency's major unit ("1250.50"); the quote API stores whole minor units (125050). The
 * conversion is integer string arithmetic only: a float would turn 1.005 or 19.99 into the wrong
 * amount. No `server-only` import: the quote form (a client component) uses it.
 *
 * The ceiling is the API's (QUOTE_AMOUNT_MAX_MINOR in lib/orders/admin.ts, which is server-only
 * and so cannot be imported here); tests/admin/quote-money.test.ts pins the two to one number.
 */

/** Currencies the quote form offers, with the number of decimals of their minor unit. */
export const QUOTE_CURRENCIES = [
  { code: "PHP", exponent: 2 },
  { code: "USD", exponent: 2 },
  { code: "EUR", exponent: 2 },
  { code: "GBP", exponent: 2 },
  { code: "AUD", exponent: 2 },
  { code: "SGD", exponent: 2 },
  { code: "JPY", exponent: 0 },
] as const;

export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number]["code"];

/** Largest quote figure, in minor units (the quote API's limit). */
export const QUOTE_MAX_MINOR = 100_000_000;

/** The currency's decimals, or null for a code outside the list. */
export function currencyExponent(code: string): number | null {
  return QUOTE_CURRENCIES.find((currency) => currency.code === code)?.exponent ?? null;
}

export type MajorAmountRefusal = "required" | "invalid" | "negative" | "too_many_decimals" | "too_large";
export type MajorAmountResult = { ok: true; minor: number } | { ok: false; reason: MajorAmountRefusal };

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Decimal text in the major unit → whole minor units, or the reason it was refused. */
export function parseMajorAmount(text: string, currency: string): MajorAmountResult {
  const exponent = currencyExponent(currency);
  if (exponent === null) return { ok: false, reason: "invalid" };
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "required" };
  if (trimmed.startsWith("-")) return { ok: false, reason: DECIMAL.test(trimmed.slice(1)) ? "negative" : "invalid" };
  const match = DECIMAL.exec(trimmed);
  if (!match) return { ok: false, reason: "invalid" };
  const [, whole, fraction = ""] = match;
  if (fraction.length > exponent) return { ok: false, reason: "too_many_decimals" };
  const digits = (whole + fraction.padEnd(exponent, "0")).replace(/^0+/, "") || "0";
  // Nine digits hold the ceiling; longer text is rejected before it is ever turned into a number.
  if (digits.length > String(QUOTE_MAX_MINOR).length) return { ok: false, reason: "too_large" };
  const minor = Number(digits);
  return minor > QUOTE_MAX_MINOR ? { ok: false, reason: "too_large" } : { ok: true, minor };
}

/** A stored amount back as the text staff would type (125050 → "1250.50"); "" for anything else. */
export function formatMajorInput(minor: number | null, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === null || minor === null || !Number.isSafeInteger(minor) || minor < 0) return "";
  const digits = String(minor).padStart(exponent + 1, "0");
  return exponent === 0 ? digits : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** An amount in minor units for display: "$1,250.50", "¥1,500"; the code and plain figure for an unknown currency. */
export function formatMinor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === null) {
    const plain = formatMajorInput(minor, "USD") || String(minor);
    return currency ? `${currency} ${plain}` : plain;
  }
  return new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
}
