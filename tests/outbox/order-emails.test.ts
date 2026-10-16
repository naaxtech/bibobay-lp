import { describe, expect, it } from "vitest";

import { ORDER_EMAIL_COPY } from "@/lib/email/order-email-copy";
import { buildOrderAcknowledgement, buildQuoteEmail, buildStaffOrderAlert, formatMinorUnits, type OrderEmailLine } from "@/lib/email/order-emails";

/*
 * Order emails (Task 8a; spec §12, rulings R89-R90). Plain escaped HTML plus a text part, like the
 * signup emails, with every visible string from ORDER_EMAIL_COPY. Truth rules: the acknowledgement
 * carries no price and says nothing has been charged; the private tracking link is never in an
 * email (R89); the quote shows only https payment links.
 */
const LINES: OrderEmailLine[] = [
  { title: "Tula plush", variant: "Large", pack: "Single", quantity: 2 },
  { title: "Bob & friends book", variant: null, pack: null, quantity: 1 },
];
const REFERENCE = "BB-1A2B-3C4D";
const TOKEN = "ab".repeat(32);
/** Words and symbols that would put a price in an email that must not carry one. */
const PRICE = /[$€£¥₱]|\b(AUD|USD|PHP|EUR|price|subtotal|total|cost)\b|\d+\.\d{2}/i;
const visible = (email: { subject: string; html: string; text: string }) => [email.subject, email.html, email.text].join("\n");

describe("buyer acknowledgement", () => {
  const tracked = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "Sam Rivers", lines: LINES, tracking: { url: "https://bibobay.example/track" } });
  const untracked = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "Sam Rivers", lines: LINES, tracking: null });

  it("names the order reference and the lines, and says nothing has been charged", () => {
    expect(tracked.subject).toBe(ORDER_EMAIL_COPY.acknowledgement.subject(REFERENCE));
    for (const email of [tracked, untracked]) {
      expect(email.text).toContain(REFERENCE);
      expect(email.html).toContain(REFERENCE);
      expect(email.text).toContain("2 × Tula plush (Large, Single)");
      expect(email.text).toContain("1 × Bob & friends book");
      expect(email.html).toContain("1 × Bob &amp; friends book");
      expect(email.text).toContain(ORDER_EMAIL_COPY.acknowledgement.noPayment);
      expect(email.text).toContain(ORDER_EMAIL_COPY.acknowledgement.nextSteps);
    }
  });

  it("carries no price at all", () => {
    expect(visible(tracked)).not.toMatch(PRICE);
    expect(visible(untracked)).not.toMatch(PRICE);
  });

  it("points at /track with the reference and email only while tracking is on, never with the private link (R89)", () => {
    expect(tracked.text).toContain(ORDER_EMAIL_COPY.acknowledgement.trackAt("https://bibobay.example/track"));
    expect(tracked.html).toContain('href="https://bibobay.example/track"');
    expect(visible(untracked)).not.toMatch(/track/i);
    for (const email of [tracked, untracked]) {
      expect(visible(email)).not.toContain(TOKEN);
      expect(visible(email)).not.toMatch(/\/orders\//);
    }
  });

  it("names the tracking page without a link while the site's address is not verified", () => {
    const email = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "Sam", lines: LINES, tracking: { url: null } });
    expect(email.text).toContain(ORDER_EMAIL_COPY.acknowledgement.trackOnSite);
    expect(email.html).not.toContain("href=");
  });

  it("refuses a tracking address that is not https", () => {
    const email = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "Sam", lines: LINES, tracking: { url: "http://bibobay.example/track" } });
    expect(email.text).toContain(ORDER_EMAIL_COPY.acknowledgement.trackOnSite);
    expect(visible(email)).not.toContain("http://");
  });

  it("escapes what the buyer typed", () => {
    const email = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "Sam & Jo", lines: [{ title: "<img src=x>", variant: null, pack: null, quantity: 1 }], tracking: null });
    expect(email.html).toContain("Hi Sam &amp; Jo,");
    expect(email.html).not.toContain("<img src=x>");
    expect(email.html).toContain("&lt;img src=x&gt;");
  });

  it("leaves out a name with markup altogether (fix wave D-M3; tests/email/order-greeting.test.ts)", () => {
    const email = buildOrderAcknowledgement({ reference: REFERENCE, contactName: "<b>Sam</b>", lines: LINES, tracking: null });
    expect(email.html).not.toContain("<b>Sam</b>");
    expect(email.html).not.toContain("&lt;b&gt;Sam");
    expect(email.text.split("\n")[0]).toBe(ORDER_EMAIL_COPY.greetingWithoutName);
  });
});

describe("staff order alert", () => {
  const alert = buildStaffOrderAlert({ reference: REFERENCE, contactName: "Sam Rivers", email: "buyer@example.com", lines: LINES });

  it("has a generic subject: no customer email or name in inbox previews", () => {
    expect(alert.subject).toBe(ORDER_EMAIL_COPY.staffAlert.subject);
    expect(alert.subject).not.toMatch(/buyer@example\.com|Sam|Rivers/);
  });

  it("names the reference, the contact, the address as typed (unverified) and the lines, and no price", () => {
    expect(alert.text).toContain(REFERENCE);
    expect(alert.text).toContain("Sam Rivers");
    expect(alert.text).toMatch(new RegExp(`${ORDER_EMAIL_COPY.staffAlert.labels.email.replace(/[()]/g, "\\$&")}\\s+buyer@example\\.com`));
    expect(alert.text).toContain("2 × Tula plush (Large, Single)");
    expect(visible(alert)).not.toMatch(PRICE);
  });
});

describe("quote email", () => {
  const quote = { currency: "AUD", subtotalMinor: 12345, freightMinor: 1500, paymentUrl: "https://pay.example.com/checkout/abc?x=1&y=2" };
  const email = buildQuoteEmail({ reference: REFERENCE, contactName: "Sam Rivers", lines: LINES, quote });

  it("formats the subtotal, the freight and their total from minor units, in the order's currency", () => {
    expect(email).not.toBeNull();
    expect(email!.subject).toBe(ORDER_EMAIL_COPY.quote.subject(REFERENCE));
    expect(email!.text).toMatch(/AUD\s123\.45/);
    expect(email!.text).toMatch(/AUD\s15\.00/);
    expect(email!.text).toMatch(/AUD\s138\.45/);
    expect(email!.text).toContain(REFERENCE);
    expect(email!.text).toContain("2 × Tula plush (Large, Single)");
  });

  it("links the payment URL as given, escaped", () => {
    expect(email!.text).toContain(quote.paymentUrl);
    expect(email!.html).toContain('href="https://pay.example.com/checkout/abc?x=1&amp;y=2"');
  });

  it.each([
    ["http", "http://pay.example.com/checkout"],
    ["javascript", "javascript:alert(1)"],
    ["credentials", "https://user:pass@pay.example.com/checkout"],
    ["not a URL", "pay here"],
  ])("never renders a %s payment link", (_label, paymentUrl) => {
    expect(buildQuoteEmail({ reference: REFERENCE, contactName: "Sam", lines: LINES, quote: { ...quote, paymentUrl } })).toBeNull();
  });

  it.each([
    ["a negative amount", { subtotalMinor: -1 }],
    ["a fractional amount", { freightMinor: 1.5 }],
    ["an invalid currency", { currency: "aud" }],
  ])("refuses %s", (_label, change) => {
    expect(buildQuoteEmail({ reference: REFERENCE, contactName: "Sam", lines: LINES, quote: { ...quote, ...change } })).toBeNull();
  });
});

describe("formatMinorUnits", () => {
  it("uses the currency's own minor unit", () => {
    expect(formatMinorUnits(1500, "JPY")).toMatch(/^JPY\s1,500$/);
    expect(formatMinorUnits(250000, "PHP")).toMatch(/^PHP\s2,500\.00$/);
    expect(formatMinorUnits(5, "AUD")).toMatch(/^AUD\s0\.05$/);
  });

  it("returns null for anything it cannot format exactly", () => {
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER + 2, "AUD")).toBeNull();
    expect(formatMinorUnits(1, "A1D")).toBeNull();
  });
});
