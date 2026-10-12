import { describe, expect, it, vi } from "vitest";

import { createResendSender, getEmailEnvironment, type ResendLike } from "@/lib/email/client";
import { buildLeadAcknowledgement, buildStaffLeadAlert, escapeHtml } from "@/lib/email/lead-emails";

vi.mock("server-only", () => ({}));

/** Contact details, people and claims that must never appear in a BIBO Bay email. */
const FORBIDDEN = /(\+?\d[\d\s().-]{7,}\d)|\b(street|avenue|road|suite|po box|ceo|founder|expert|award|guarantee|delivered to)\b/i;

describe("acknowledgement email", () => {
  it("says truthfully that the adult is on the founding-family list, from BIBO Bay", () => {
    const email = buildLeadAcknowledgement({ firstName: "Ana" });
    expect(email.subject).toBe("You're on the BIBO Bay founding-family list");
    expect(email.text).toContain("Hi Ana,");
    expect(email.text).toMatch(/founding-family list/);
    expect(email.text).toContain("BIBO Bay");
    expect(email.html).toContain("Hi Ana,");
  });

  it("greets without a name when none was given", () => {
    const email = buildLeadAcknowledgement({});
    expect(email.text.startsWith("Hello,")).toBe(true);
    expect(email.html).not.toContain("undefined");
  });

  it("explains how to be removed by replying, without inventing an unsubscribe link", () => {
    const email = buildLeadAcknowledgement({ firstName: "Ana" });
    expect(email.text).toMatch(/reply to this email/i);
    expect(email.text).toMatch(/remove you/i);
    expect(email.text).not.toMatch(/https?:\/\//);
    expect(email.html).not.toMatch(/href=/);
  });

  it("offers the starter file only when the CMS marks a real file available", () => {
    const without = buildLeadAcknowledgement({ firstName: "Ana", leadMagnet: null });
    expect(without.text).not.toMatch(/download|attach|starter/i);
    const withFile = buildLeadAcknowledgement({ firstName: "Ana", leadMagnet: { title: "Bay colouring sheet", fileUrl: "https://cdn.sanity.io/files/abc/production/sheet.pdf" } });
    expect(withFile.text).toContain("Bay colouring sheet: https://cdn.sanity.io/files/abc/production/sheet.pdf");
    expect(withFile.html).toContain('href="https://cdn.sanity.io/files/abc/production/sheet.pdf"');
  });

  it("refuses a lead-magnet link that is not https", () => {
    const email = buildLeadAcknowledgement({ leadMagnet: { title: "Sheet", fileUrl: "javascript:alert(1)" } });
    expect(email.html).not.toContain("javascript:");
    expect(email.text).not.toContain("javascript:");
  });

  it("escapes the adult's name in HTML and keeps it out of the subject", () => {
    const email = buildLeadAcknowledgement({ firstName: "<script>alert(1)</script>" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.subject).not.toContain("script");
  });

  it("carries no child data, address, phone, staff names or claims", () => {
    const email = buildLeadAcknowledgement({ firstName: "Ana", leadMagnet: { title: "Sheet", fileUrl: "https://cdn.sanity.io/files/a/b/c.pdf" } });
    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toMatch(FORBIDDEN);
      expect(part).not.toMatch(/\b(age|ages|child|children|kids?|son|daughter|birthday|school)\b/i);
    }
  });
});

describe("staff alert email", () => {
  const lead = { email: "parent@example.com", firstName: "Ana", ageBand: "6-8" as const, source: "landing", created: true };

  it("uses a generic subject with no personal data", () => {
    const email = buildStaffLeadAlert(lead);
    expect(email.subject).toBe("New BIBO Bay founding-family signup");
  });

  it("gives staff the adult's email, first name and broad age band", () => {
    const email = buildStaffLeadAlert(lead);
    expect(email.text).toContain("parent@example.com");
    expect(email.text).toContain("Ana");
    expect(email.text).toContain("6 to 8");
    expect(email.text).toMatch(/new signup/i);
  });

  it("labels the address as submitted and unverified, since the form cannot prove who owns it", () => {
    const email = buildStaffLeadAlert(lead);
    expect(email.text).toMatch(/^Submitted address \(unverified\)\s+parent@example\.com$/m);
    expect(email.html).toContain("Submitted address (unverified)</dt>");
    expect(email.text).not.toMatch(/^Email\s/m);
  });

  it("describes a resubmitted address truthfully: nothing on the record changed", () => {
    const text = buildStaffLeadAlert({ ...lead, created: false }).text;
    expect(text).toMatch(/already on the founding-family list was submitted again/i);
    expect(text).toMatch(/nothing on the existing record was changed/i);
    expect(text).not.toMatch(/updated/i);
  });

  it("escapes every submitted value in HTML", () => {
    const email = buildStaffLeadAlert({ ...lead, firstName: "<img src=x onerror=alert(1)>" });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("Resend sender", () => {
  const message = { to: ["parent@example.com"], subject: "S", html: "<p>H</p>", text: "T", replyTo: "hello@bibobay.example", idempotencyKey: "lead-delivery/evt-1" };

  function fakeResend(send: ResendLike["emails"]["send"]) {
    const spy = vi.fn(send);
    return { client: { emails: { send: spy } } satisfies ResendLike, spy };
  }

  it("is configured only with both an API key and a verified sender", () => {
    expect(getEmailEnvironment({})).toBeNull();
    expect(getEmailEnvironment({ RESEND_API_KEY: "re_123" })).toBeNull();
    expect(getEmailEnvironment({ RESEND_FROM: "BIBO Bay <hello@bibobay.example>" })).toBeNull();
    expect(getEmailEnvironment({ RESEND_API_KEY: "re_123", RESEND_FROM: "BIBO Bay <hello@bibobay.example>" })).toEqual({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", replyTo: null });
    expect(getEmailEnvironment({ RESEND_API_KEY: "re_123", RESEND_FROM: "not an address" })).toBeNull();
  });

  it("sends through Resend with an idempotency key and reports the provider id", async () => {
    const { client, spy } = fakeResend(async () => ({ data: { id: "re_abc" }, error: null, headers: null }));
    const result = await createResendSender({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", client }).send(message);
    expect(result).toEqual({ status: "sent", providerMessageId: "re_abc" });
    expect(spy).toHaveBeenCalledWith(
      { from: "BIBO Bay <hello@bibobay.example>", to: ["parent@example.com"], subject: "S", html: "<p>H</p>", text: "T", replyTo: "hello@bibobay.example" },
      { idempotencyKey: "lead-delivery/evt-1" },
    );
  });

  it("reports Resend's error code, never its message", async () => {
    const { client } = fakeResend(async () => ({ data: null, error: { name: "validation_error", message: "parent@example.com is invalid", statusCode: 422 }, headers: null }));
    const result = await createResendSender({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", client }).send(message);
    expect(result).toEqual({ status: "failed", errorCode: "validation_error" });
  });

  it("turns a thrown request into a failed result instead of throwing", async () => {
    const { client } = fakeResend(async () => { throw new Error("ECONNRESET"); });
    const result = await createResendSender({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", client }).send(message);
    expect(result).toEqual({ status: "failed", errorCode: "send_exception" });
  });

  it("passes an abort signal to the SDK so a timed-out send stops its request (M4)", async () => {
    const { client, spy } = fakeResend(async () => ({ data: { id: "re_abc" }, error: null, headers: null }));
    const controller = new AbortController();
    await createResendSender({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", client }).send(message, { signal: controller.signal });
    expect(spy.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "lead-delivery/evt-1", signal: controller.signal });
  });

  it("reports an aborted send as a failure, without calling the SDK when already aborted", async () => {
    const { client, spy } = fakeResend(async () => ({ data: { id: "re_abc" }, error: null, headers: null }));
    const controller = new AbortController();
    controller.abort();
    const result = await createResendSender({ apiKey: "re_123", from: "BIBO Bay <hello@bibobay.example>", client }).send(message, { signal: controller.signal });
    expect(result).toEqual({ status: "failed", errorCode: "send_aborted" });
    expect(spy).not.toHaveBeenCalled();
  });
});
