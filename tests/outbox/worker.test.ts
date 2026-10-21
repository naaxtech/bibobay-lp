import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { cronSecretFrom, isCronAuthorized, orderTrackingForEmail } from "@/lib/outbox/config";
import { WORKER_LIMITS } from "@/lib/outbox/constants";
import { runOutboxWorker } from "@/lib/outbox/worker";
import type { AttemptContext } from "@/lib/outbox/attempt";
import type { ClaimedContactDelivery, ClaimedLeadDelivery, ClaimedOrderEmail, ClaimOptions, ContactDeliveryOutbox, LeadDeliveryOutbox, OrderEmailOutbox, OutboxOutcome } from "@/lib/outbox/types";
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

const lead = (id: string, kind: ClaimedLeadDelivery["kind"] = "acknowledgement"): ClaimedLeadDelivery => ({ id, kind, attempt: 1, email: "parent@example.com", firstName: null, ageBand: null, source: "landing" });
const QUOTE = { currency: "AUD", subtotalMinor: 1000, freightMinor: 0, paymentUrl: "https://pay.example.com/q", revision: 1 };
const order = (id: string, kind: ClaimedOrderEmail["kind"] = "acknowledgement"): ClaimedOrderEmail => ({ id, kind, attempt: 1, reference: "BB-1A2B-3C4D", contactName: "Sam Rivers", email: "buyer@example.com", lines: [{ title: "Tula plush", variant: null, pack: null, quantity: 1 }], quote: kind === "quote" ? QUOTE : null });

/** An outbox that hands out its due rows in order, one claim at a time, only of the kinds asked for. */
function queue<T extends { kind: string }>(rows: T[]) {
  const claims: Array<ClaimOptions<string>> = [];
  const records: Array<[string, OutboxOutcome]> = [];
  return {
    claims,
    records,
    take: async (options: ClaimOptions<string>) => {
      claims.push(options);
      const index = rows.findIndex((row) => options.kinds.includes(row.kind));
      const row = index >= 0 ? rows.splice(index, 1)[0] : undefined;
      return { claimed: row ? [row] : [], skipped: 0, expired: 0 };
    },
    record: async (id: string, outcome: OutboxOutcome) => (records.push([id, outcome]), true),
  };
}

function context(overrides: Partial<AttemptContext<string>> = {}): AttemptContext<string> {
  return { reserve: async () => true, deliver: async () => ({ status: "sent", providerMessageId: "re_1" }), log: () => {}, ...overrides };
}

const contactRow = (id: string): ClaimedContactDelivery => ({ id, kind: "contact_staff_alert", attempt: 1, name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent.", receivedAt: "2026-10-21T09:30:12.345+00:00" });

/** The contact outbox over a queue, with a staff address or without one. */
const contactOf = (queued: ReturnType<typeof queue>, staffEmail: string | null) => ({
  outbox: { claimDeliveries: queued.take, recordDeliveryAttempt: queued.record } as ContactDeliveryOutbox,
  settings: { staffEmail },
});
const emptyContact = () => contactOf(queue<ClaimedContactDelivery>([]), null);

const SETTINGS = {
  leads: { staffEmail: "team@bibobay.example", replyTo: null, leadMagnet: null, fromOutbox: true },
  orders: { staffEmail: null, replyTo: null, tracking: null },
};

describe("runOutboxWorker", () => {
  it("drains the order outbox, quotes first, then the signup outbox, one kind and one row per claim, and answers counts only", async () => {
    const leads = queue([lead("l1"), lead("l2")]);
    const orders = queue([order("o1"), order("q1", "quote")]);
    const sendOrder: string[] = [];
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ deliver: async (message) => (sendOrder.push(message.idempotencyKey ?? ""), { status: "sent", providerMessageId: "re_1" }) }),
    });
    expect(result).toEqual({ sent: 4, failed: 0, skipped: 0, deferred: 0 });
    expect(sendOrder).toEqual(["order-email/q1", "order-email/o1", "lead-delivery/l1", "lead-delivery/l2"]);
    // Fix wave D-I1: each kind is drained under its own budget; quotes (staff are waiting on them) first.
    expect(orders.claims).toEqual([
      { kinds: ["quote"], limit: 1 },
      { kinds: ["quote"], limit: 1 },
      { kinds: ["acknowledgement"], limit: 1 },
      { kinds: ["acknowledgement"], limit: 1 },
    ]);
    expect(leads.claims.map((options) => options.kinds)).toEqual([["acknowledgement"], ["acknowledgement"], ["acknowledgement"], ["staff_alert"]]);
  });

  it("asks the budget of each row's own kind and outbox (D-I1)", async () => {
    const leads = queue([lead("l1"), lead("s1", "staff_alert")]);
    const orders = queue([order("o1"), order("q1", "quote")]);
    const asked: string[] = [];
    await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ reserve: async (kind, outbox) => (asked.push(`${outbox}:${kind}`), true) }),
    });
    expect(asked).toEqual(["orders:quote", "orders:acknowledgement", "leads:acknowledgement", "leads:staff_alert"]);
  });

  it("a spent budget closes only its own kind: a full signup bucket never holds up a quote or an order email (D-I1)", async () => {
    const leads = queue([lead("l1"), lead("l2"), lead("s1", "staff_alert")]);
    const orders = queue([order("o1"), order("q1", "quote")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ reserve: async (kind, outbox) => !(outbox === "leads" && kind === "acknowledgement") }),
    });
    expect(result).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 1 });
    expect(orders.records.map(([id, outcome]) => [id, outcome.status])).toEqual([["q1", "sent"], ["o1", "sent"]]);
    // The capped signup acknowledgement is handed back once; the next signup row is never claimed; the staff alert still goes.
    expect(leads.records.map(([id, outcome]) => [id, outcome.status])).toEqual([["l1", "deferred"], ["s1", "sent"]]);
  });

  it("stops claiming once the run's time is up (bounded run time)", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("o2")]);
    let clock = 0;
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ deliver: async () => ((clock += WORKER_LIMITS.runMs), { status: "sent", providerMessageId: "re_1" }) }),
      now: () => clock,
    });
    expect(result.sent).toBe(1);
    // The quote claim found nothing; the first acknowledgement used up the run.
    expect(orders.claims.map((options) => options.kinds)).toEqual([["quote"], ["acknowledgement"]]);
    expect(leads.claims).toHaveLength(0);
  });

  it("with every budget spent, hands back one row per kind and claims nothing more of that kind", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("o2")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ reserve: async () => false }),
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 2 });
    expect(orders.records).toEqual([["o1", { status: "deferred" }]]);
    expect(leads.records).toEqual([["l1", { status: "deferred" }]]);
  });

  it("handles at most WORKER_LIMITS.maxRowsPerChannel rows of one outbox per run", async () => {
    const orders = queue(Array.from({ length: WORKER_LIMITS.maxRowsPerChannel + 5 }, (_, index) => order(`o${index}`)));
    const leads = queue([lead("l1")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context(),
    });
    expect(result.sent).toBe(WORKER_LIMITS.maxRowsPerChannel + 1);
    // Review M6: 40 s from the request leaves a last send (at most its timeout) inside maxDuration 60.
    expect(WORKER_LIMITS).toEqual({ runMs: 40_000, maxRowsPerChannel: 100 });
  });
});

describe("the contact outbox (R201)", () => {
  const STAFF = "team@bibobay.example";

  it("drains orders (quotes first), then signups, then contact alerts", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("q1", "quote")]);
    const contact = queue([contactRow("c1")]);
    const sent: string[] = [];
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: contactOf(contact, STAFF),
      context: context({ deliver: async (message) => (sent.push(message.idempotencyKey ?? ""), { status: "sent", providerMessageId: "re_1" }) }),
    });
    expect(result).toEqual({ sent: 4, failed: 0, skipped: 0, deferred: 0 });
    expect(sent).toEqual(["order-email/q1", "order-email/o1", "lead-delivery/l1", "contact-delivery/c1"]);
    expect(contact.claims).toEqual([{ kinds: ["contact_staff_alert"], limit: 1 }, { kinds: ["contact_staff_alert"], limit: 1 }]);
  });

  it("claims no contact row while no staff address is set", async () => {
    const contact = queue([contactRow("c1")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: queue([]).take, recordDeliveryAttempt: queue([]).record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: queue([]).take, recordEmailAttempt: queue([]).record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: contactOf(contact, null),
      context: context(),
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 0 });
    expect(contact.claims).toEqual([]);
    expect(contact.records).toEqual([]);
  });

  it("spends the contact budget for a contact row", async () => {
    const asked: string[] = [];
    await runOutboxWorker({
      leads: { outbox: { claimDeliveries: queue([]).take, recordDeliveryAttempt: queue([]).record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: queue([]).take, recordEmailAttempt: queue([]).record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: contactOf(queue([contactRow("c1")]), STAFF),
      context: context({ reserve: async (kind, outbox) => (asked.push(`${outbox}:${kind}`), true) }),
    });
    expect(asked).toEqual(["contact:contact_staff_alert"]);
  });

  it("a spent contact budget hands back that row and holds up no other outbox", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1")]);
    const contact = queue([contactRow("c1"), contactRow("c2")]);
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: contactOf(contact, STAFF),
      context: context({ reserve: async (_kind, outbox) => outbox !== "contact" }),
    });
    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 1 });
    expect(orders.records.map(([id, outcome]) => [id, outcome.status])).toEqual([["o1", "sent"]]);
    expect(leads.records.map(([id, outcome]) => [id, outcome.status])).toEqual([["l1", "sent"]]);
    expect(contact.records).toEqual([["c1", { status: "deferred" }]]);
  });
});

describe("the run's clock (Task 8a review M6)", () => {
  it("starts when the request started, not after the worker was set up", async () => {
    const leads = queue([lead("l1")]);
    const orders = queue([order("o1"), order("o2"), order("o3")]);
    let clock = 100_000;
    const result = await runOutboxWorker({
      leads: { outbox: { claimDeliveries: leads.take, recordDeliveryAttempt: leads.record } as LeadDeliveryOutbox, settings: SETTINGS.leads },
      orders: { outbox: { claimEmails: orders.take, recordEmailAttempt: orders.record } as OrderEmailOutbox, settings: SETTINGS.orders },
      contact: emptyContact(),
      context: context({ deliver: async () => ((clock += 4_000), { status: "sent", providerMessageId: "re_1" }) }),
      now: () => clock,
      // The setup (CMS reads, clients) took 34 s of the run's 40.
      startedAt: clock - 34_000,
    });
    expect(result.sent).toBe(2);
    expect(orders.claims.map((options) => options.kinds)).toEqual([["quote"], ["acknowledgement"], ["acknowledgement"]]);
  });
});
