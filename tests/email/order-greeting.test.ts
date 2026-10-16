import { describe, expect, it } from "vitest";

import { buildOrderAcknowledgement, buildQuoteEmail, buildStaffOrderAlert } from "@/lib/email/order-emails";
import { ORDER_EMAIL_COPY } from "@/lib/email/order-email-copy";

/*
 * Fix wave D-M3: the contact name opens the buyer's emails ("Hi <name>,"), and those go from BIBO
 * Bay's verified sender to whatever address was typed. The order schema refuses a name with a link
 * (lib/orders/schema.ts); the builders are the second guard, for a row stored before that rule or
 * by any other path: a name that breaks the signup first-name rule (a link, `www.`, `<` or `>`,
 * control characters) or the length cap is never put in a greeting.
 */
const LINES = [{ title: "Tula plush", variant: null, pack: null, quantity: 1 }];
const QUOTE = { currency: "AUD", subtotalMinor: 12_345, freightMinor: 1_500, paymentUrl: "https://pay.example.com/checkout/abc" };

const acknowledgement = (contactName: string) => buildOrderAcknowledgement({ reference: "BB-1A2B-3C4D", contactName, lines: LINES, tracking: null });
const quote = (contactName: string) => buildQuoteEmail({ reference: "BB-1A2B-3C4D", contactName, lines: LINES, quote: QUOTE })!;

const UNSAFE = [
  "Your parcel is held, pay at https://evil.example",
  "Sam, see www.evil.example now",
  "Sam <a href=x>Rivers</a>",
  "Sam\u0007Rivers",
  "n".repeat(121),
];

describe("the greeting of the buyer's emails (D-M3)", () => {
  it.each([["acknowledgement", acknowledgement], ["quote", quote]] as const)("names a real buyer in the %s", (_kind, build) => {
    const email = build("  Sam Rivers ");
    expect(email.text.split("\n")[0]).toBe("Hi Sam Rivers,");
    expect(email.html).toContain("Hi Sam Rivers,");
  });

  it.each(UNSAFE)("never puts a name that breaks the first-name rule in a greeting: %j", (name) => {
    for (const email of [acknowledgement(name), quote(name)]) {
      expect(email.text.split("\n")[0]).toBe(ORDER_EMAIL_COPY.greetingWithoutName);
      expect(email.html).toContain(`>${ORDER_EMAIL_COPY.greetingWithoutName}</p>`);
      expect(email.text).not.toMatch(/evil\.example|www\.|<a |\u0007/);
      expect(email.html).not.toMatch(/evil\.example|www\./);
    }
  });

  it("never contains a URL in the greeting of either email", () => {
    for (const name of [...UNSAFE, "Sam Rivers", "Ana-María O'Neil"]) {
      for (const email of [acknowledgement(name), quote(name)]) {
        expect(email.text.split("\n")[0]).not.toMatch(/:\/\/|www\./i);
      }
    }
  });

  it("greets without a name when the name is blank", () => {
    expect(acknowledgement("   ").text.split("\n")[0]).toBe(ORDER_EMAIL_COPY.greetingWithoutName);
  });

  it("still shows staff the name as typed (escaped) in the staff alert, which goes only to the staff inbox", () => {
    const alert = buildStaffOrderAlert({ reference: "BB-1A2B-3C4D", contactName: "Sam <b>Rivers</b>", email: "buyer@example.com", lines: LINES });
    expect(alert.text).toContain("Sam <b>Rivers</b>");
    expect(alert.html).toContain("Sam &lt;b&gt;Rivers&lt;/b&gt;");
  });
});
