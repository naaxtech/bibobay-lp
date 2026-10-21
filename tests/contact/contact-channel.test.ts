import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EmailMessage } from "@/lib/email/client";
import { contactAlertChannel, contactKindsFor, createContactAlertSender } from "@/lib/outbox/contact";
import { outboxLogger } from "@/lib/outbox/log";
import { budgetedSends } from "@/lib/outbox/send";
import type { ClaimOptions, ClaimedContactDelivery, ContactDeliveryOutbox, OutboxOutcome } from "@/lib/outbox/types";
import { createMemoryRateLimiter } from "@/lib/security/rate-limit";

const STAFF = "staff@example.com";

const row = (id: string, attempt = 1): ClaimedContactDelivery => ({
  id,
  kind: "contact_staff_alert",
  attempt,
  name: "Ada",
  email: "ada@example.com",
  topic: "partnerships",
  message: "Hello from a parent.",
  receivedAt: "2026-10-21T09:30:12.345+00:00",
});

function recordingOutbox(rows: ClaimedContactDelivery[]) {
  const claims: Array<ClaimOptions<string>> = [];
  const records: Array<[string, OutboxOutcome]> = [];
  const outbox: ContactDeliveryOutbox = {
    claimDeliveries: async (options) => {
      claims.push(options);
      return { claimed: rows.splice(0, 1), skipped: 0, expired: 0 };
    },
    recordDeliveryAttempt: async (id, outcome) => (records.push([id, outcome]), true),
  };
  return { outbox, claims, records };
}

describe("contactKindsFor", () => {
  it("claims nothing without a staff address", () => {
    expect(contactKindsFor(null)).toEqual([]);
    expect(contactKindsFor(STAFF)).toEqual(["contact_staff_alert"]);
  });
});

describe("contactAlertChannel", () => {
  const { outbox } = recordingOutbox([]);

  it("builds nothing without a staff address", () => {
    expect(contactAlertChannel(outbox, { staffEmail: null }).build(row("d1"))).toBeNull();
  });

  it("addresses the staff inbox, replies to the sender and keys the send by the row id", () => {
    const channel = contactAlertChannel(outbox, { staffEmail: STAFF });
    expect(channel.name).toBe("contact");
    expect(channel.build(row("d1"))).toMatchObject({ to: [STAFF], replyTo: "ada@example.com", subject: "New BIBO Bay message: Partnerships" });
    expect(channel.idempotencyKey(row("d1"))).toBe("contact-delivery/d1");
  });

  it("never addresses the sender", () => {
    const message = contactAlertChannel(outbox, { staffEmail: STAFF }).build(row("d1"));
    expect(message?.to).not.toContain("ada@example.com");
  });

  it("builds the same message for attempt 1 and attempt 5 of one row", () => {
    const channel = contactAlertChannel(outbox, { staffEmail: STAFF });
    expect(channel.build(row("d1", 1))).toEqual(channel.build(row("d1", 5)));
  });
});

describe("createContactAlertSender", () => {
  function setup(rows: ClaimedContactDelivery[], sendLimitPerHour = 60, staffEmail: string | null = STAFF) {
    const recording = recordingOutbox(rows);
    const send = vi.fn(async (message: EmailMessage) => (void message, { status: "sent" as const, providerMessageId: "re_1" }));
    const context = budgetedSends<"contact_staff_alert">({ rateLimiter: createMemoryRateLimiter(), sendLimitPerHour, mailer: { send }, log: () => {} });
    return { ...recording, send, sender: createContactAlertSender(recording.outbox, { staffEmail }, context) };
  }

  it("claims this message's alert by id and sends it once", async () => {
    const { sender, claims, send, records } = setup([row("d1")]);
    await sender("m1");
    expect(claims).toEqual([{ ownerId: "m1", kinds: ["contact_staff_alert"], limit: 1 }]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: [STAFF], replyTo: "ada@example.com", idempotencyKey: "contact-delivery/d1" });
    expect(records).toEqual([["d1", { status: "sent", providerMessageId: "re_1" }]]);
  });

  it("spends send:contact_staff_alert; over the cap the alert is handed back as deferred", async () => {
    const { sender, send, records } = setup([row("d1"), row("d2")], 1);
    await sender("m1");
    await sender("m2");
    expect(send).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      ["d1", { status: "sent", providerMessageId: "re_1" }],
      ["d2", { status: "deferred" }],
    ]);
  });

  it("claims nothing without a staff address", async () => {
    const { sender, claims, send } = setup([row("d1")], 60, null);
    await sender("m1");
    expect(claims).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("outboxLogger('contact')", () => {
  it("writes channel contact", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    outboxLogger<string>("contact")({ event: "delivery_attempted", kind: "contact_staff_alert", status: "sent" });
    expect(info).toHaveBeenCalledWith(JSON.stringify({ scope: "outbox", channel: "contact", event: "delivery_attempted", kind: "contact_staff_alert", status: "sent" }));
    info.mockRestore();
  });
});
