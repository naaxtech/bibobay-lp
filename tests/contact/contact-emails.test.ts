import { describe, expect, it } from "vitest";

import { buildStaffContactAlert, formatReceivedAt } from "@/lib/email/contact-emails";

const ALERT = { name: "Ada Lovelace", email: "ada@example.com", topic: "press" as const, message: "Hello, <script>alert(1)</script> & goodbye.\nSecond line.", receivedAt: "2026-10-21T09:30:12.345+00:00" };

describe("buildStaffContactAlert", () => {
  it("puts only the topic label in the subject", () => {
    const { subject } = buildStaffContactAlert(ALERT);
    expect(subject).toBe("New BIBO Bay message: Press and media");
    for (const secret of [ALERT.name, ALERT.email, "Hello"]) expect(subject).not.toContain(secret);
  });

  it("escapes every value", () => {
    const { html } = buildStaffContactAlert({ ...ALERT, name: "Tom & <i>Jerry</i>" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; goodbye.");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>Jerry");
    expect(html).toContain("Tom &amp; &lt;i&gt;Jerry&lt;/i&gt;");
  });

  it("keeps the message verbatim in the text part and wraps it in HTML", () => {
    const { html, text } = buildStaffContactAlert(ALERT);
    expect(text).toContain(`Message:\n${ALERT.message}`);
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("labels the address unverified and explains the reply (R204)", () => {
    const { html, text } = buildStaffContactAlert(ALERT);
    for (const part of [html, text]) {
      expect(part).toContain("Email (unverified)");
      expect(part).toContain("Replying to this email writes to the address above. Nothing on the form proves the sender owns it.");
      expect(part).toContain("A message arrived through the contact form on the BIBO Bay website.");
      expect(part).toContain("Press and media");
      expect(part).toContain("2026-10-21 09:30 UTC");
    }
    expect(text).toContain("Name");
    expect(text).toContain("Topic");
  });

  it("formats the time in UTC", () => {
    expect(formatReceivedAt("2026-10-21T09:30:12.345+00:00")).toBe("2026-10-21 09:30 UTC");
    expect(formatReceivedAt("2026-10-21T23:59:59+02:00")).toBe("2026-10-21 21:59 UTC");
  });

  it("is deterministic", () => {
    expect(buildStaffContactAlert(ALERT)).toEqual(buildStaffContactAlert({ ...ALERT }));
  });
});
