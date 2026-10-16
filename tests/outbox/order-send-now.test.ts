import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const reported = vi.hoisted(() => ({ events: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/observability/report", () => ({
  reportError: () => {},
  reportEvent: (event: string, tags: Record<string, unknown>) => reported.events.push([event, tags]),
}));

import type { EmailMessage, EmailSendResult } from "@/lib/email/client";
import { outboxLogger } from "@/lib/outbox/log";
import { createOrderEmailSender } from "@/lib/outbox/orders";
import { budgetedSends } from "@/lib/outbox/send";
import type { ClaimOptions, ClaimedOrderEmail, OrderEmailOutbox, OutboxOutcome } from "@/lib/outbox/types";
import { ACK_SEND_LIMIT } from "@/lib/leads/submit";
import type { OrderEmailKind } from "@/lib/outbox/constants";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";

/*
 * The send right after an order is stored (Task 8a, R88): both queued emails are claimed by order
 * id through the order outbox's claim, each spends one unit of the global send budget, and each
 * outcome is recorded. Plus the outbox's operational log (ruling R52).
 */
const ORDER_ID = "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71";
const email = (id: string, kind: OrderEmailKind): ClaimedOrderEmail => ({
  id,
  kind,
  attempt: 1,
  reference: "BB-1A2B-3C4D",
  contactName: "Sam Rivers",
  email: "buyer@example.com",
  lines: [{ title: "Tula plush", variant: null, pack: null, quantity: 1 }],
  quote: null,
});

function fakeOutbox() {
  const claims: Array<ClaimOptions<OrderEmailKind>> = [];
  const records: Array<[string, OutboxOutcome]> = [];
  const outbox: OrderEmailOutbox = {
    async claimEmails(options) {
      claims.push(options);
      const kind = options.kinds[0]!;
      return { claimed: [email(`${kind}-row`, kind)], skipped: 0, expired: 0 };
    },
    async recordEmailAttempt(id, outcome) {
      records.push([id, outcome]);
      return true;
    },
  };
  return { outbox, claims, records };
}

function mailer() {
  const sent: EmailMessage[] = [];
  return { sent, deliver: async (message: EmailMessage): Promise<EmailSendResult> => (sent.push(message), { status: "sent", providerMessageId: `re_${sent.length}` }) };
}

describe("createOrderEmailSender", () => {
  const settings = { staffEmail: "team@bibobay.example", replyTo: null, tracking: null };

  it("claims the order's acknowledgement and staff alert by order id, one claim each, and records both", async () => {
    const { outbox, claims, records } = fakeOutbox();
    const { sent, deliver } = mailer();
    const send = createOrderEmailSender(outbox, settings, { reserve: async () => true, deliver, log: () => {} });
    await send(ORDER_ID);
    expect(claims).toEqual([
      { ownerId: ORDER_ID, kinds: ["acknowledgement"], limit: 1 },
      { ownerId: ORDER_ID, kinds: ["staff_alert"], limit: 1 },
    ]);
    expect(sent.map((message) => [message.to, message.idempotencyKey])).toEqual([
      [["buyer@example.com"], "order-email/acknowledgement-row"],
      [["team@bibobay.example"], "order-email/staff_alert-row"],
    ]);
    expect(records.map(([id, outcome]) => [id, outcome.status])).toEqual([["acknowledgement-row", "sent"], ["staff_alert-row", "sent"]]);
  });

  it("never claims a staff alert without a staff address (it waits for one), and never a quote", async () => {
    const { outbox, claims } = fakeOutbox();
    await createOrderEmailSender(outbox, { ...settings, staffEmail: null }, { reserve: async () => true, deliver: mailer().deliver, log: () => {} })(ORDER_ID);
    expect(claims.map((options) => options.kinds)).toEqual([["acknowledgement"]]);
  });
});

describe("budgetedSends (fix wave D-I1: one budget per message kind)", () => {
  const SENT = { send: async () => ({ status: "sent" as const, providerMessageId: "re_1" }) };

  it("spends one unit of the row's own bucket, send:<kind>, at the configured hourly cap", async () => {
    const consume = vi.fn<RateLimiter["consume"]>(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }));
    const context = budgetedSends<string>({ rateLimiter: { consume }, sendLimitPerHour: 7, mailer: SENT, log: () => {} });
    for (const [kind, outbox] of [["acknowledgement", "orders"], ["staff_alert", "orders"], ["quote", "orders"], ["acknowledgement", "leads"], ["staff_alert", "leads"]] as const) {
      expect(await context.reserve(kind, outbox)).toBe(true);
    }
    const rule = { maxHits: 7, windowSeconds: ACK_SEND_LIMIT.windowSeconds };
    expect(consume.mock.calls).toEqual([
      ["send:order_acknowledgement", rule],
      ["send:order_staff_alert", rule],
      ["send:quote", rule],
      ["send:lead_acknowledgement", rule],
      ["send:lead_staff_alert", rule],
    ]);
    expect(ACK_SEND_LIMIT.windowSeconds).toBe(3600);
  });

  it("a full signup bucket never holds up a quote, an order email or a staff alert", async () => {
    const context = budgetedSends<string>({ rateLimiter: createMemoryRateLimiter(), sendLimitPerHour: 2, mailer: SENT, log: () => {} });
    expect(await context.reserve("acknowledgement", "leads")).toBe(true);
    expect(await context.reserve("acknowledgement", "leads")).toBe(true);
    expect(await context.reserve("acknowledgement", "leads")).toBe(false);
    expect(await context.reserve("quote", "orders")).toBe(true);
    expect(await context.reserve("acknowledgement", "orders")).toBe(true);
    expect(await context.reserve("staff_alert", "orders")).toBe(true);
    expect(await context.reserve("staff_alert", "leads")).toBe(true);
  });

  it("caps each kind on its own: a spent quote bucket leaves the order acknowledgement open", async () => {
    const context = budgetedSends<string>({ rateLimiter: createMemoryRateLimiter(), sendLimitPerHour: 1, mailer: SENT, log: () => {} });
    expect(await context.reserve("quote", "orders")).toBe(true);
    expect(await context.reserve("quote", "orders")).toBe(false);
    expect(await context.reserve("acknowledgement", "orders")).toBe(true);
    expect(await context.reserve("acknowledgement", "orders")).toBe(false);
  });

  it("reports a spent or unreachable budget as no, with an event naming the kind and its budget", async () => {
    const events: unknown[] = [];
    const capped = budgetedSends<string>({ rateLimiter: { consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 60 }) }, sendLimitPerHour: 1, mailer: SENT, log: (event) => events.push(event) });
    expect(await capped.reserve("quote", "orders")).toBe(false);
    const down = budgetedSends<string>({ rateLimiter: { consume: async () => { throw new Error("db down"); } }, sendLimitPerHour: 1, mailer: SENT, log: (event) => events.push(event) });
    expect(await down.reserve("acknowledgement", "leads")).toBe(false);
    expect(events).toEqual([
      { event: "delivery_send_capped", kind: "quote", budget: "quote" },
      { event: "delivery_send_cap_unavailable", kind: "acknowledgement", budget: "lead_acknowledgement", code: "unknown" },
    ]);
  });

  it("refuses, without asking the limiter, a kind that has no budget in that outbox", async () => {
    const consume = vi.fn<RateLimiter["consume"]>(async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }));
    const events: unknown[] = [];
    const context = budgetedSends<string>({ rateLimiter: { consume }, sendLimitPerHour: 1, mailer: SENT, log: (event) => events.push(event) });
    expect(await context.reserve("quote", "leads")).toBe(false);
    expect(consume).not.toHaveBeenCalled();
    expect(events).toEqual([{ event: "delivery_send_cap_unavailable", kind: "quote", code: "unknown_budget" }]);
  });

  it("bounds every send by its timeout", async () => {
    const context = budgetedSends({ rateLimiter: { consume: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }) }, sendLimitPerHour: 1, mailer: { send: () => new Promise<EmailSendResult>(() => {}) }, log: () => {}, sendTimeoutMs: 20 });
    expect(await context.deliver({ to: ["a@example.com"], subject: "s", html: "h", text: "t" })).toEqual({ status: "failed", errorCode: "send_timeout" });
  });
});

describe("outboxLogger (ruling R52)", () => {
  beforeEach(() => {
    reported.events.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line per event, naming the outbox, and reports warnings, the send cap and parked rows to Sentry", () => {
    const log = outboxLogger("orders");
    log({ event: "delivery_send_capped", kind: "acknowledgement", budget: "order_acknowledgement" });
    log({ event: "delivery_send_cap_unavailable", kind: "quote", budget: "quote", code: "PGRST301" });
    log({ event: "delivery_claim_failed", code: "PGRST301" });
    log({ event: "delivery_message_invalid", kind: "quote" });
    log({ event: "delivery_expired", count: 2 });
    log({ event: "delivery_attempted", kind: "acknowledgement", status: "sent" });
    log({ event: "delivery_skipped", count: 1 });
    log({ event: "delivery_expired", count: 1, kind: "quote", code: "invalid_idempotent_request" });
    expect(reported.events).toEqual([
      ["delivery_send_capped", { kind: "acknowledgement", budget: "order_acknowledgement" }],
      ["delivery_send_cap_unavailable", { kind: "quote", budget: "quote", code: "PGRST301" }],
      ["delivery_claim_failed", { code: "PGRST301" }],
      ["delivery_message_invalid", { kind: "quote" }],
      ["delivery_expired", {}],
      ["delivery_expired", { kind: "quote", code: "invalid_idempotent_request" }],
    ]);
    expect(console.info).toHaveBeenCalledWith(JSON.stringify({ scope: "outbox", channel: "orders", event: "delivery_attempted", kind: "acknowledgement", status: "sent" }));
    expect(console.info).toHaveBeenCalledWith(JSON.stringify({ scope: "outbox", channel: "orders", event: "delivery_send_capped", kind: "acknowledgement", budget: "order_acknowledgement" }));
  });
});
