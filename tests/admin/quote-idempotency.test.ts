import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));

import type { AttemptContext } from "@/lib/outbox/attempt";
import type { OrderEmailKind } from "@/lib/outbox/constants";
import { advanceOrderStatus, createQuoteEmailSender, queueQuoteEmail, saveOrderQuote } from "@/lib/orders/admin";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
import { pgliteRpc } from "@/tests/support/pglite-rpc";
import { STAFF_FIXTURE, pgliteStaffDatabase, seedOrder, seedStaff } from "@/tests/support/pglite-staff";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * Ruling R96 (spec §10 step 9), against the real migrations in an embedded Postgres: saving a quote
 * never notifies anyone; sending is a separate, explicit action for one saved revision, queued once
 * in the order outbox (idempotency key <order id>:quote:<revision>), so repeated sends are no-ops;
 * a newer save supersedes an unsent one; sending never changes the order's status, and a failed
 * status change never loses a queued quote. The send right after the answer goes through Task 8a's
 * claim, with the service role, and never sends a superseded revision.
 */
let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
  await seedStaff(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const staff = () => pgliteStaffDatabase(db, STAFF_FIXTURE.active);
const QUOTE = { currency: "AUD", subtotalMinor: 12_345, freightMinor: 1_500, paymentUrl: "https://pay.example.com/checkout/abc" } as const;

async function quoteRows(orderId: string) {
  const { rows } = await db.query<{ quote_revision: number; status: string; attempts: number }>(
    "select quote_revision, status, attempts from public.order_email_outbox where order_id = $1 and kind = 'quote' order by quote_revision",
    [orderId],
  );
  return rows;
}

async function orderRow(orderId: string) {
  const { rows } = await db.query<{ status: string; quote_revision: number; quote_sent_at: Date | null; subtotal_minor: number | null }>(
    "select status, quote_revision, quote_sent_at, subtotal_minor from public.orders where id = $1",
    [orderId],
  );
  return rows[0]!;
}

/** The send right after the answer: Task 8a's claim, the service role, a fake provider. */
type Deliver = AttemptContext<OrderEmailKind>["deliver"];

function quoteSender(deliver: Mock<Deliver> = vi.fn<Deliver>(async () => ({ status: "sent", providerMessageId: `re_${Math.random().toString(36).slice(2)}` }))) {
  const context: AttemptContext<OrderEmailKind> = { reserve: async () => true, deliver, log: vi.fn() };
  const send = createQuoteEmailSender(createSupabaseOrderEmailOutbox(pgliteRpc(db)), { staffEmail: null, replyTo: null, tracking: null }, context);
  return { send, deliver, context };
}

describe("saving a quote (R96)", () => {
  it("stores the figures under a new revision and notifies nobody", async () => {
    const order = await seedOrder(db);
    const result = await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    expect(result).toEqual({ ok: true, value: { orderId: order.orderId, revision: 1 } });
    expect(await orderRow(order.orderId)).toMatchObject({ status: "new", quote_revision: 1, quote_sent_at: null, subtotal_minor: 12_345 });
    expect(await quoteRows(order.orderId)).toEqual([]);
  });

  it("refuses a save based on a revision the order has moved past, and changes nothing", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    expect(await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE, subtotalMinor: 1 })).toEqual({ ok: false, reason: "stale" });
    expect((await orderRow(order.orderId)).subtotal_minor).toBe(12_345);
  });

  it("answers not found for an unknown or malformed reference", async () => {
    expect(await saveOrderQuote(staff(), { reference: "BB-0000-0000", expectedRevision: 0, ...QUOTE })).toEqual({ ok: false, reason: "not_found" });
    expect(await saveOrderQuote(staff(), { reference: "nope", expectedRevision: 0, ...QUOTE })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("sending a quote (R96)", () => {
  it("queues the revision once; repeated sends are answered as already queued and queue nothing", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });

    const first = await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    expect(first).toEqual({ ok: true, value: { orderId: order.orderId, revision: 1, alreadyQueued: false } });
    const repeats = await Promise.all([1, 2, 3].map(() => queueQuoteEmail(staff(), { reference: order.reference, revision: 1 })));
    for (const repeat of repeats) expect(repeat).toEqual({ ok: true, value: { orderId: order.orderId, revision: 1, alreadyQueued: true } });

    expect(await quoteRows(order.orderId)).toEqual([{ quote_revision: 1, status: "pending", attempts: 0 }]);
    const { rows } = await db.query<{ count: number }>("select count(*)::integer as count from public.order_events where order_id = $1 and event_type = 'quote_queued'", [order.orderId]);
    expect(rows[0]!.count).toBe(1);
  });

  it("never changes the order's status", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    expect((await orderRow(order.orderId)).status).toBe("new");
  });

  it("refuses a revision that is not the current one, and an order with nothing saved", async () => {
    const order = await seedOrder(db);
    expect(await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 })).toEqual({ ok: false, reason: "not_allowed" });
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    expect(await queueQuoteEmail(staff(), { reference: order.reference, revision: 2 })).toEqual({ ok: false, reason: "stale" });
    expect(await quoteRows(order.orderId)).toEqual([]);
  });

  it("sends the queued revision right after the answer, once, through the outbox claim", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    const { send, deliver } = quoteSender();

    await send(order.orderId);
    await send(order.orderId);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]![0]).toMatchObject({ to: ["buyer@example.com"], idempotencyKey: expect.stringMatching(/^order-email\//) });
    expect(await quoteRows(order.orderId)).toEqual([{ quote_revision: 1, status: "sent", attempts: 1 }]);
    expect((await orderRow(order.orderId)).quote_sent_at).not.toBeNull();
  });

  it("skips a superseded revision and still sends the current one in the same attempt", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 1, ...QUOTE, subtotalMinor: 20_000 });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 2 });
    const { send, deliver } = quoteSender();

    await send(order.orderId);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]![0]!.text).toContain("200.00");
    expect(await quoteRows(order.orderId)).toEqual([
      { quote_revision: 1, status: "skipped", attempts: 0 },
      { quote_revision: 2, status: "sent", attempts: 1 },
    ]);
  });

  it("leaves a quote the provider refused queued for the worker, and answers nothing more", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    const { send, deliver } = quoteSender(vi.fn<Deliver>(async () => ({ status: "failed", errorCode: "rate_limit_exceeded" })));

    await send(order.orderId);

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(await quoteRows(order.orderId)).toEqual([{ quote_revision: 1, status: "failed", attempts: 1 }]);
    expect((await orderRow(order.orderId)).quote_sent_at).toBeNull();
  });
});

describe("quotes and status changes stay independent", () => {
  it("email success plus a failed status update: the quote stays sent, the status stays put, a resend is a no-op", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });
    const { send, deliver } = quoteSender();
    await send(order.orderId);

    // Staff try to mark it paid from a status it never had: refused, nothing changes.
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "confirmed", to: "paid" })).toEqual({ ok: false, reason: "stale" });
    expect(await orderRow(order.orderId)).toMatchObject({ status: "new", quote_revision: 1 });
    expect(await quoteRows(order.orderId)).toEqual([{ quote_revision: 1, status: "sent", attempts: 1 }]);

    // Sending the same revision again never repeats the email.
    expect(await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 })).toEqual({ ok: true, value: { orderId: order.orderId, revision: 1, alreadyQueued: true } });
    await send(order.orderId);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("a failed status change never loses the queued quote, which is still sent afterwards", async () => {
    const order = await seedOrder(db);
    await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE });
    await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 });

    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "new", to: "paid" })).toEqual({ ok: false, reason: "invalid" });
    expect(await quoteRows(order.orderId)).toEqual([{ quote_revision: 1, status: "pending", attempts: 0 }]);

    const { send, deliver } = quoteSender();
    await send(order.orderId);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((await orderRow(order.orderId)).status).toBe("new");
  });

  it("a confirmed order can be quoted and sent; once paid, it cannot", async () => {
    const order = await seedOrder(db);
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "new", to: "confirmed" })).toMatchObject({ ok: true, value: { status: "confirmed" } });
    expect(await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 0, ...QUOTE })).toMatchObject({ ok: true });
    expect(await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 })).toMatchObject({ ok: true, value: { alreadyQueued: false } });
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "confirmed", to: "paid" })).toMatchObject({ ok: true, value: { status: "paid" } });
    expect(await saveOrderQuote(staff(), { reference: order.reference, expectedRevision: 1, ...QUOTE })).toEqual({ ok: false, reason: "not_allowed" });
    expect(await queueQuoteEmail(staff(), { reference: order.reference, revision: 1 })).toEqual({ ok: false, reason: "not_allowed" });
  });
});

describe("only active staff", () => {
  it.each([
    ["a signed-in user without a staff row", STAFF_FIXTURE.visitor],
    ["inactive staff", STAFF_FIXTURE.inactive],
    ["a request with no user", null],
  ] as const)("refuses %s, and writes nothing", async (_who, userId) => {
    const order = await seedOrder(db);
    const database = pgliteStaffDatabase(db, userId);
    expect(await saveOrderQuote(database, { reference: order.reference, expectedRevision: 0, ...QUOTE })).toEqual({ ok: false, reason: "not_staff" });
    expect(await queueQuoteEmail(database, { reference: order.reference, revision: 1 })).toEqual({ ok: false, reason: "not_staff" });
    expect(await orderRow(order.orderId)).toMatchObject({ status: "new", quote_revision: 0, subtotal_minor: null });
    expect(await quoteRows(order.orderId)).toEqual([]);
  });
});
