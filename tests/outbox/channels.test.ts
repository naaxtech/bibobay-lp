import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ORDER_EMAIL_COPY } from "@/lib/email/order-email-copy";
import { leadDeliveryChannel, leadKindsFor } from "@/lib/outbox/leads";
import { orderEmailChannel, orderKindsFor } from "@/lib/outbox/orders";
import type { ClaimedLeadDelivery, ClaimedOrderEmail, LeadDeliveryOutbox, OrderEmailOutbox } from "@/lib/outbox/types";

/*
 * The two outbox channels (Task 8a): what each claimed row becomes as an email, who receives it,
 * and the provider idempotency key (the row id, R91).
 */
const noLeadOutbox: LeadDeliveryOutbox = { claimDeliveries: async () => ({ claimed: [], skipped: 0, expired: 0 }), recordDeliveryAttempt: async () => true };
const noOrderOutbox: OrderEmailOutbox = { claimEmails: async () => ({ claimed: [], skipped: 0, expired: 0 }), recordEmailAttempt: async () => true };

const LEAD_ACK: ClaimedLeadDelivery = { id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "acknowledgement", attempt: 1, email: "parent@example.com", firstName: "Ana", ageBand: "3-5", source: "landing" };
const LEAD_ALERT: ClaimedLeadDelivery = { ...LEAD_ACK, id: "5f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "staff_alert" };

describe("the lead channel", () => {
  const settings = { staffEmail: "team@bibobay.example", replyTo: "hello@bibobay.example", leadMagnet: { title: "Bay colouring pack", fileUrl: "https://bibobay.example/pack.pdf" } };

  it("sends the acknowledgement to the adult, with the reply-to and the verified file", () => {
    const message = leadDeliveryChannel(noLeadOutbox, { ...settings, fromOutbox: false }).build(LEAD_ACK);
    expect(message).toMatchObject({ to: ["parent@example.com"], replyTo: "hello@bibobay.example" });
    expect(message?.text).toContain("Hi Ana,");
    expect(message?.text).toContain("https://bibobay.example/pack.pdf");
  });

  it("sends the staff alert to staff, never with the unverified address as reply-to", () => {
    const message = leadDeliveryChannel(noLeadOutbox, { ...settings, fromOutbox: false }).build(LEAD_ALERT);
    expect(message?.to).toEqual(["team@bibobay.example"]);
    expect(message).not.toHaveProperty("replyTo");
    expect(message?.text).toMatch(/Submitted address \(unverified\)\s+parent@example\.com/);
  });

  it("says a retried staff alert shows the details on file, not a fresh submission", () => {
    const now = leadDeliveryChannel(noLeadOutbox, { ...settings, fromOutbox: false }).build(LEAD_ALERT);
    const retried = leadDeliveryChannel(noLeadOutbox, { ...settings, fromOutbox: true }).build(LEAD_ALERT);
    expect(now?.text).toMatch(/^A new signup joined/);
    expect(retried?.text).not.toMatch(/A new signup joined|this submission contained/);
    expect(retried?.text).toMatch(/on file/);
    expect(retried?.text).toMatch(/Submitted address \(unverified\)\s+parent@example\.com/);
  });

  it("builds no staff alert without a staff address, and claims no staff alerts then", () => {
    expect(leadDeliveryChannel(noLeadOutbox, { ...settings, staffEmail: null, fromOutbox: true }).build(LEAD_ALERT)).toBeNull();
    expect(leadKindsFor(null)).toEqual(["acknowledgement"]);
    expect(leadKindsFor("team@bibobay.example")).toEqual(["acknowledgement", "staff_alert"]);
  });

  it("keeps the signup flow's idempotency key, so a retry of an immediate send cannot email twice", () => {
    expect(leadDeliveryChannel(noLeadOutbox, { ...settings, fromOutbox: true }).idempotencyKey(LEAD_ACK)).toBe(`lead-delivery/${LEAD_ACK.id}`);
  });
});

const ORDER_ACK: ClaimedOrderEmail = {
  id: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71",
  kind: "acknowledgement",
  attempt: 1,
  reference: "BB-1A2B-3C4D",
  contactName: "Sam Rivers",
  email: "buyer@example.com",
  lines: [{ title: "Tula plush", variant: "Large", pack: null, quantity: 2 }],
  quote: null,
};

describe("the order channel", () => {
  const settings = { staffEmail: "team@bibobay.example", replyTo: "hello@bibobay.example", tracking: { url: "https://bibobay.example/track" } };

  it("sends the acknowledgement to the buyer, with the reply-to and the /track page while tracking is on (R89)", () => {
    const message = orderEmailChannel(noOrderOutbox, settings).build(ORDER_ACK);
    expect(message).toMatchObject({ to: ["buyer@example.com"], replyTo: "hello@bibobay.example", subject: ORDER_EMAIL_COPY.acknowledgement.subject("BB-1A2B-3C4D") });
    expect(message?.text).toContain(ORDER_EMAIL_COPY.acknowledgement.trackAt("https://bibobay.example/track"));
    expect(orderEmailChannel(noOrderOutbox, { ...settings, tracking: null }).build(ORDER_ACK)?.text).not.toMatch(/track/i);
  });

  it("sends the staff alert to staff only, without a reply-to", () => {
    const message = orderEmailChannel(noOrderOutbox, settings).build({ ...ORDER_ACK, kind: "staff_alert" });
    expect(message?.to).toEqual(["team@bibobay.example"]);
    expect(message).not.toHaveProperty("replyTo");
    expect(message?.subject).toBe(ORDER_EMAIL_COPY.staffAlert.subject);
    expect(orderEmailChannel(noOrderOutbox, { ...settings, staffEmail: null }).build({ ...ORDER_ACK, kind: "staff_alert" })).toBeNull();
  });

  it("sends a quote to the buyer, and nothing for a quote it cannot render truthfully", () => {
    const quote = { currency: "AUD", subtotalMinor: 12345, freightMinor: 1500, paymentUrl: "https://pay.example.com/c/1", revision: 1 };
    const message = orderEmailChannel(noOrderOutbox, settings).build({ ...ORDER_ACK, kind: "quote", quote });
    expect(message).toMatchObject({ to: ["buyer@example.com"], replyTo: "hello@bibobay.example", subject: ORDER_EMAIL_COPY.quote.subject("BB-1A2B-3C4D") });
    expect(orderEmailChannel(noOrderOutbox, settings).build({ ...ORDER_ACK, kind: "quote", quote: { ...quote, paymentUrl: "http://pay.example.com" } })).toBeNull();
    expect(orderEmailChannel(noOrderOutbox, settings).build({ ...ORDER_ACK, kind: "quote", quote: null })).toBeNull();
  });

  it("claims staff alerts only while a staff address is set", () => {
    expect(orderKindsFor(null)).toEqual(["acknowledgement", "quote"]);
    expect(orderKindsFor("team@bibobay.example")).toEqual(["acknowledgement", "staff_alert", "quote"]);
  });

  it("uses the row id as the provider idempotency key (R91)", () => {
    expect(orderEmailChannel(noOrderOutbox, settings).idempotencyKey(ORDER_ACK)).toBe(`order-email/${ORDER_ACK.id}`);
  });
});
