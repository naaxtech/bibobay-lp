import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { cronSecretFrom, isCronAuthorized, orderTrackingForEmail } from "@/lib/outbox/config";
import { WORKER_LIMITS } from "@/lib/outbox/constants";
import { runOutboxWorker } from "@/lib/outbox/worker";
import type { AttemptContext } from "@/lib/outbox/attempt";
import type { ClaimedLeadDelivery, ClaimedOrderEmail, ClaimOptions, LeadDeliveryOutbox, OrderEmailOutbox, OutboxOutcome } from "@/lib/outbox/types";
import { SERVER_SECRET_MIN_LENGTH } from "@/lib/security/secrets";

/*
 * The cron worker (Task 8a): its secret, its tracking line, and one bounded pass over both outboxes.
 */
describe("the cron secret", () => {
  const SECRET = "c".repeat(SERVER_SECRET_MIN_LENGTH);

  it("is configured only with at least the shared 32-character minimum (N4)", () => {
    expect(cronSecretFrom({})).toBeNull();
    expect(cronSecretFrom({ CRON_SECRET: "c".repeat(SERVER_SECRET_MIN_LENGTH - 1) })).toBeNull();
    expect(cronSecretFrom({ CRON_SECRET: `  ${SECRET}  ` })).toBe(SECRET);
  });

  it("authorises exactly `Bearer <secret>`, nothing else", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    for (const header of [null, "", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, "Bearer ", `Basic ${SECRET}`]) {
      expect(isCronAuthorized(header, SECRET)).toBe(false);
    }
  });
});

describe("the acknowledgement's tracking line (R89)", () => {
  const ON = { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: true };

  it("is absent while tracking is off", () => {
    expect(orderTrackingForEmail({ ...ON, trackingEnabled: false }, { NEXT_PUBLIC_APP_URL: "https://bibobay.example" })).toBeNull();
    expect(orderTrackingForEmail({ ...ON, commerceEnabled: false }, { NEXT_PUBLIC_APP_URL: "https://bibobay.example" })).toBeNull();
  });

  it("names the /track page on the verified origin, or the page by name when the origin is unknown", () => {
    expect(orderTrackingForEmail(ON, { NEXT_PUBLIC_APP_URL: "https://bibobay.example/some/path" })).toEqual({ url: "https://bibobay.example/track" });
    expect(orderTrackingForEmail(ON, { NEXT_PUBLIC_APP_URL: "http://bibobay.example" })).toEqual({ url: null });
    expect(orderTrackingForEmail(ON, {})).toEqual({ url: null });
  });
});

const lead = (id: string): ClaimedLeadDelivery => ({ id, kind: "acknowledgement", attempt: 1, email: "parent@example.com", firstName: null, ageBand: null, source: "landing" });
const order = (id: string): ClaimedOrderEmail => ({ id, kind: "acknowledgement", attempt: 1, reference: "BB-1A2B-3C4D", contactName: "Sam Rivers", email: "buyer@example.com", lines: [{ title: "Tula plush", variant: null, pack: null, quantity: 1 }], quote: null });

function queue<T>(rows: T[]) {
  const claims: Array<ClaimOptions<string>> = [];
  const records: Array<[string, OutboxOutcome]> = [];
  return {
    claims,
    records,
    take: async (options: ClaimOptions<string>) => {
      claims.push(options);
      const row = rows.shift();
      return { claimed: row ? [row] : [], skipped: 0, expired: 0 };
    },
    record: async (id: string, outcome: OutboxOutcome) => (records.push([id, outcome]), true),
  };
}

function context(overrides: Partial<AttemptContext<string>> = {}): AttemptContext<string> {
  return { reserve: async () => true, deliver: async () => ({ status: "sent", providerMessageId: "re_1" }), log: () => {}, ...overrides };
}

const SETTINGS = {
  leads: { staffEmail: "team@bibobay.example", replyTo: null, leadMagnet: null, fromOutbox: true },
  orders: { staffEmail: null, replyTo: null, tracking: null },
};

describe("runOutboxWorker", () => {
  it("drains the order outbox, then the signup outbox, one row per claim, and answers counts only", async () => {
    const leads = queue([lead("l1"), lead("l2")]);
    const orders = queue([order("o1")]);
    const sendOrder: string[] = [];
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      context: context({ deliver: async (message) => (sendOrder.push(message.idempotencyKey ?? ""), { status: "sent", providerMessageId: "re_1" }) }),
    });
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 0 });
    expect(sendOrder).toEqual(["order-email/o1", "lead-delivery/l1", "lead-delivery/l2"]);
    expect(orders.claims[0]).toEqual({ kinds: ["acknowledgement", "quote"], limit: 1 });
    expect(leads.claims[0]).toEqual({ kinds: ["acknowledgement", "staff_alert"], limit: 1 });
  });

  it("stops claiming once the run's time is up (bounded run time)", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("o2")]);
    let clock = 0;
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      context: context({ deliver: async () => ((clock += WORKER_LIMITS.runMs), { status: "sent", providerMessageId: "re_1" }) }),
      now: () => clock,
    });
    expect(result.sent).toBe(1);
    expect(orders.claims).toHaveLength(1);
    expect(leads.claims).toHaveLength(0);
  });

  it("stops at the send budget: the capped row is handed back and nothing else is claimed", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("o2")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      context: context({ reserve: async () => false }),
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 1 });
    expect(orders.records).toEqual([["o1", { status: "deferred" }]]);
    expect(leads.claims).toHaveLength(0);
  });

  it("handles at most WORKER_LIMITS.maxRowsPerChannel rows of one outbox per run", async () => {
    const orders = queue(Array.from({ length: WORKER_LIMITS.maxRowsPerChannel + 5 }, (_, index) => order(`o${index}`)));
    const leads = queue([lead("l1")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      context: context(),
    });
    expect(result.sent).toBe(WORKER_LIMITS.maxRowsPerChannel + 1);
    expect(WORKER_LIMITS).toEqual({ runMs: 45_000, maxRowsPerChannel: 100 });
  });
});
