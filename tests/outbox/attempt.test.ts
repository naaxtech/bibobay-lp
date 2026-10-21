import { describe, expect, it, vi } from "vitest";

import type { EmailMessage, EmailSendResult } from "@/lib/email/client";
import { attemptNext, attemptNow, drainChannel, type AttemptContext, type OutboxChannel, type OutboxLogEvent } from "@/lib/outbox/attempt";
import type { ClaimBatch, ClaimOptions, OutboxOutcome } from "@/lib/outbox/types";
import { RpcError } from "@/lib/supabase/rpc";

/*
 * The one attempt step both send paths share (Task 8a, R88): claim a row through the outbox's
 * claim function, build its message, spend one unit of the global send budget, send it under the
 * row's idempotency key, and record the outcome. A spent budget hands the claim back (`deferred`),
 * so the row stays due and no attempt is counted.
 */
type Kind = "acknowledgement" | "staff_alert";
interface Row { id: string; kind: Kind; status: "pending" | "sending" | "sent" | "failed" | "skipped"; attempts: number; owner: string }

function fakeChannel(rows: Row[], overrides: Partial<OutboxChannel<Kind, { id: string; kind: Kind; attempt: number }>> = {}) {
  const records: Array<[string, OutboxOutcome]> = [];
  const claims: Array<ClaimOptions<Kind>> = [];
  const channel: OutboxChannel<Kind, { id: string; kind: Kind; attempt: number }> = {
    name: "leads",
    async claim(options): Promise<ClaimBatch<{ id: string; kind: Kind; attempt: number }>> {
      claims.push(options);
      const due = rows.filter((row) => (!options.ownerId || row.owner === options.ownerId) && options.kinds.includes(row.kind) && (row.status === "pending" || row.status === "failed")).slice(0, options.limit);
      for (const row of due) {
        row.status = "sending";
        row.attempts += 1;
      }
      return { claimed: due.map(({ id, kind, attempts }) => ({ id, kind, attempt: attempts })), skipped: 0, expired: 0 };
    },
    async record(id, outcome) {
      records.push([id, outcome]);
      const row = rows.find((entry) => entry.id === id);
      if (!row || row.status !== "sending") return false;
      if (outcome.status === "deferred") {
        row.attempts -= 1;
        row.status = row.attempts === 0 ? "pending" : "failed";
      } else row.status = outcome.status;
      return true;
    },
    build: (item) => ({ to: [`${item.kind}@example.com`], subject: "Hello", html: "<p>Hello</p>", text: "Hello" }),
    idempotencyKey: (item) => `test/${item.id}`,
    ...overrides,
  };
  return { channel, records, claims };
}

function context(overrides: Partial<AttemptContext<Kind>> = {}) {
  const sent: EmailMessage[] = [];
  const events: Array<OutboxLogEvent<Kind>> = [];
  const reserve = vi.fn(async () => true);
  const ctx: AttemptContext<Kind> = {
    reserve,
    deliver: async (message): Promise<EmailSendResult> => (sent.push(message), { status: "sent", providerMessageId: `re_${sent.length}` }),
    log: (event) => events.push(event),
    ...overrides,
  };
  return { ctx, sent, events, reserve };
}

const row = (id: string, kind: Kind = "acknowledgement", owner = "lead-1"): Row => ({ id, kind, status: "pending", attempts: 0, owner });

describe("attemptNext", () => {
  it("claims one row, spends one budget unit, sends it under the row's key and records the provider's answer", async () => {
    const rows = [row("a")];
    const { channel, records, claims } = fakeChannel(rows);
    const { ctx, sent, reserve } = context();
    const step = await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(claims).toEqual([{ kinds: ["acknowledgement"], limit: 1 }]);
    // Fix wave D-I1: the budget is the row's own kind in this outbox.
    expect(reserve).toHaveBeenCalledWith("acknowledgement", "leads");
    expect(sent).toEqual([{ to: ["acknowledgement@example.com"], subject: "Hello", html: "<p>Hello</p>", text: "Hello", idempotencyKey: "test/a" }]);
    expect(records).toEqual([["a", { status: "sent", providerMessageId: "re_1" }]]);
    expect(step).toEqual({ outcome: "progress", tally: { sent: 1, failed: 0, skipped: 0, deferred: 0 } });
  });

  it("records a failed send for retry", async () => {
    const { channel, records } = fakeChannel([row("a")]);
    const { ctx } = context({ deliver: async () => ({ status: "failed", errorCode: "rate_limit_exceeded" }) });
    const step = await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(records).toEqual([["a", { status: "failed", errorCode: "rate_limit_exceeded" }]]);
    expect(step.tally).toEqual({ sent: 0, failed: 1, skipped: 0, deferred: 0 });
  });

  it("hands the claim back without sending when the budget is spent, so the row stays due uncounted", async () => {
    const rows = [row("a")];
    const { channel, records } = fakeChannel(rows);
    const { ctx, sent } = context({ reserve: async () => false });
    const step = await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(sent).toEqual([]);
    expect(records).toEqual([["a", { status: "deferred" }]]);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(step).toEqual({ outcome: "capped", tally: { sent: 0, failed: 0, skipped: 0, deferred: 1 } });
  });

  it("never spends budget or sends when the message cannot be built, and records why", async () => {
    const { channel, records } = fakeChannel([row("a", "staff_alert")], { build: () => null });
    const { ctx, sent, reserve, events } = context();
    const step = await attemptNext(channel, { kinds: ["staff_alert"] }, ctx);
    expect(reserve).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(records).toEqual([["a", { status: "failed", errorCode: "message_invalid" }]]);
    expect(events).toContainEqual({ event: "delivery_message_invalid", kind: "staff_alert" });
    expect(step.tally.failed).toBe(1);
  });

  it("answers none when nothing is due, without spending budget", async () => {
    const { channel } = fakeChannel([]);
    const { ctx, reserve } = context();
    expect(await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx)).toEqual({ outcome: "none", tally: { sent: 0, failed: 0, skipped: 0, deferred: 0 } });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("counts rows the claim skipped or parked, and logs them", async () => {
    const { channel } = fakeChannel([], { claim: async () => ({ claimed: [], skipped: 2, expired: 1 }) });
    const { ctx, events } = context();
    const step = await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(step).toEqual({ outcome: "progress", tally: { sent: 0, failed: 1, skipped: 2, deferred: 0 } });
    expect(events).toEqual(expect.arrayContaining([{ event: "delivery_skipped", count: 2 }, { event: "delivery_expired", count: 1, outbox: "leads" }]));
  });

  it("names the outbox whose claim parked rows, since the cron worker logs every outbox under one channel", async () => {
    const { channel } = fakeChannel([], { name: "contact", claim: async () => ({ claimed: [], skipped: 0, expired: 2 }) });
    const { ctx, events } = context();
    await attemptNext(channel, { kinds: ["staff_alert"] }, ctx);
    expect(events).toEqual([{ event: "delivery_expired", count: 2, outbox: "contact" }]);
  });

  it("stops on a failed claim with a code only", async () => {
    const { channel } = fakeChannel([], { claim: async () => { throw new RpcError("claim_lead_deliveries", "PGRST301"); } });
    const { ctx, events } = context();
    expect((await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx)).outcome).toBe("claim_failed");
    expect(events).toEqual([{ event: "delivery_claim_failed", code: "PGRST301" }]);
  });

  it("keeps the count when recording fails after the provider accepted the email; the row is re-claimed later under the same key", async () => {
    const { channel } = fakeChannel([row("a")], { record: async () => { throw new Error("timeout for parent@example.com"); } });
    const { ctx, events } = context();
    const step = await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(step.tally.sent).toBe(1);
    expect(events).toContainEqual({ event: "delivery_record_failed", kind: "acknowledgement", code: "unknown" });
    expect(JSON.stringify(events)).not.toContain("parent@example.com");
  });
});

describe("attemptNow (the send right after the answer)", () => {
  it("claims each named kind of one owner on its own, in parallel", async () => {
    const rows = [row("a", "acknowledgement"), row("b", "staff_alert"), row("c", "acknowledgement", "lead-2")];
    const { channel, claims } = fakeChannel(rows);
    const releases: Array<() => void> = [];
    const { ctx, sent } = context({
      deliver: (message) => new Promise<EmailSendResult>((resolve) => { releases.push(() => resolve({ status: "sent", providerMessageId: message.idempotencyKey ?? "" })); }),
    });
    const pending = attemptNow(channel, "lead-1", ["acknowledgement", "staff_alert"], ctx);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.forEach((release) => release());
    expect(await pending).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 0 });
    expect(claims).toEqual([
      { ownerId: "lead-1", kinds: ["acknowledgement"], limit: 1 },
      { ownerId: "lead-1", kinds: ["staff_alert"], limit: 1 },
    ]);
    expect(sent).toEqual([]);
    expect(rows.map((entry) => entry.status)).toEqual(["sent", "sent", "pending"]);
  });

  it("sends nothing for a row another caller already claimed (no double send)", async () => {
    const rows = [{ ...row("a"), status: "sending" as const, attempts: 1 }];
    const { channel } = fakeChannel(rows);
    const { ctx, reserve } = context();
    expect(await attemptNow(channel, "lead-1", ["acknowledgement"], ctx)).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 0 });
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe("drainChannel (the worker)", () => {
  it("claims one row of one kind at a time, kind by kind in the order given, until nothing of that kind is due (D-I1)", async () => {
    const rows = [row("a"), row("b"), row("c", "staff_alert", "lead-2")];
    const { channel, claims } = fakeChannel(rows);
    const { ctx, reserve } = context();
    expect(await drainChannel(channel, ["staff_alert", "acknowledgement"], ctx, { deadline: Number.POSITIVE_INFINITY, maxRows: 50 })).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 0 });
    expect(claims.map((options) => options.kinds)).toEqual([["staff_alert"], ["staff_alert"], ["acknowledgement"], ["acknowledgement"], ["acknowledgement"]]);
    expect(claims.every((options) => options.ownerId === undefined && options.limit === 1)).toBe(true);
    expect(reserve.mock.calls).toEqual([["staff_alert", "leads"], ["acknowledgement", "leads"], ["acknowledgement", "leads"]]);
  });

  it("stops a kind at its first spent budget, leaving its other rows due, and moves on to the next kind", async () => {
    const rows = [row("a"), row("b"), row("c"), row("d", "staff_alert")];
    const { channel } = fakeChannel(rows);
    let allowed = 1;
    const { ctx } = context({ reserve: async (kind) => kind === "staff_alert" || allowed-- > 0 });
    expect(await drainChannel(channel, ["acknowledgement", "staff_alert"], ctx, { deadline: Number.POSITIVE_INFINITY, maxRows: 50 })).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 1 });
    expect(rows.map((entry) => entry.status)).toEqual(["sent", "pending", "pending", "sent"]);
  });

  it("counts its row limit across every kind of the outbox", async () => {
    const rows = [row("a"), row("b"), row("c", "staff_alert")];
    const { channel } = fakeChannel(rows);
    const { ctx } = context();
    expect(await drainChannel(channel, ["acknowledgement", "staff_alert"], ctx, { deadline: Number.POSITIVE_INFINITY, maxRows: 2 })).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 0 });
    expect(rows.map((entry) => entry.status)).toEqual(["sent", "sent", "pending"]);
  });

  it("stops the whole outbox when a claim fails", async () => {
    const rows = [row("a", "staff_alert")];
    const { channel, claims } = fakeChannel(rows, { claim: async (options) => { claims.push(options); throw new RpcError("claim_lead_deliveries", "PGRST301"); } });
    const { ctx } = context();
    expect(await drainChannel(channel, ["acknowledgement", "staff_alert"], ctx, { deadline: Number.POSITIVE_INFINITY, maxRows: 50 })).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 0 });
    expect(claims).toHaveLength(1);
  });

  it("stops claiming once its time is up or its row limit is reached", async () => {
    const rows = [row("a"), row("b"), row("c")];
    const { channel } = fakeChannel(rows);
    const { ctx } = context();
    let clock = 0;
    const now = () => (clock += 10);
    expect(await drainChannel(channel, ["acknowledgement"], ctx, { deadline: 25, maxRows: 50, now })).toEqual({ sent: 2, failed: 0, skipped: 0, deferred: 0 });
    const more = fakeChannel([row("x"), row("y")]);
    expect(await drainChannel(more.channel, ["acknowledgement"], ctx, { deadline: Number.POSITIVE_INFINITY, maxRows: 1 })).toEqual({ sent: 1, failed: 0, skipped: 0, deferred: 0 });
  });
});

describe("a failure that parks the row for a human (Task 8a review I1)", () => {
  const failWith = (errorCode: string) => context({ deliver: async (): Promise<EmailSendResult> => ({ status: "failed", errorCode }) });

  it("reports delivery_expired with the kind and code when the last attempt fails", async () => {
    const { channel } = fakeChannel([{ ...row("a"), attempts: 7 }]);
    const { ctx, events } = failWith("rate_limit_exceeded");
    await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(events).toContainEqual({ event: "delivery_expired", count: 1, kind: "acknowledgement", code: "rate_limit_exceeded" });
  });

  it("reports an idempotency conflict at any attempt: the provider will never take this message", async () => {
    const { channel } = fakeChannel([row("a", "staff_alert")]);
    const { ctx, events } = failWith("invalid_idempotent_request");
    await attemptNext(channel, { kinds: ["staff_alert"] }, ctx);
    expect(events).toContainEqual({ event: "delivery_expired", count: 1, kind: "staff_alert", code: "invalid_idempotent_request" });
  });

  it("reports a message that cannot be built on its last attempt", async () => {
    const { channel } = fakeChannel([{ ...row("a"), attempts: 7 }], { build: () => null });
    const { ctx, events } = context();
    await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(events).toContainEqual({ event: "delivery_expired", count: 1, kind: "acknowledgement", code: "message_invalid" });
  });

  it("does not report a failure that will be retried", async () => {
    const { channel } = fakeChannel([{ ...row("a"), attempts: 2 }]);
    const { ctx, events } = failWith("rate_limit_exceeded");
    await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(events.filter((event) => event.event === "delivery_expired")).toEqual([]);
  });
});

describe("a final failure whose record changed nothing (re-review N2)", () => {
  it("reports nothing when the record function found no claimed row", async () => {
    const { channel } = fakeChannel([{ ...row("a"), attempts: 7 }], { record: async () => false });
    const { ctx, events } = context({ deliver: async (): Promise<EmailSendResult> => ({ status: "failed", errorCode: "rate_limit_exceeded" }) });
    await attemptNext(channel, { kinds: ["acknowledgement"] }, ctx);
    expect(events.filter((event) => event.event === "delivery_expired")).toEqual([]);
  });
});

