import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ContactRecordInput } from "@/lib/contact/types";
import { createSupabaseContactRepository } from "@/lib/supabase/contact";
import { RpcError, type RpcClient } from "@/lib/supabase/rpc";
import { pgliteRpc } from "@/tests/support/pglite-rpc";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * The contact adapter against the real migrations (rulings R159, R169): migration 0008's submit,
 * claim and record RPCs are called as PostgREST calls them (named arguments, as service_role), so a
 * renamed argument or a changed answer shape fails here. A fixture-only test would pass anyway.
 */
const RECORD: ContactRecordInput = { name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let db: PGlite;
let client: RpcClient;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
  client = pgliteRpc(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the contact adapter against the real migrations", () => {
  it("submitMessage stores one message and its alert, and returns both ids", async () => {
    const stored = await createSupabaseContactRepository(client).submitMessage({ ...RECORD, email: "Stored@Example.com" });
    expect(stored.messageId).toMatch(UUID);
    expect(stored.deliveryId).toMatch(UUID);

    const { rows } = await db.query<{ email: string; kind: string; status: string; attempts: number; delivery: string }>(
      `select m.email, d.kind, d.status, d.attempts, d.id::text as delivery
         from public.contact_messages as m join public.contact_message_deliveries as d on d.message_id = m.id
        where m.id = $1`,
      [stored.messageId],
    );
    expect(rows).toEqual([{ email: "stored@example.com", kind: "contact_staff_alert", status: "pending", attempts: 0, delivery: stored.deliveryId }]);
  });

  it("turns a database refusal into an RpcError that names only the function and code", async () => {
    const message = "too short";
    expect(Array.from(message)).toHaveLength(9);
    const error = await createSupabaseContactRepository(client).submitMessage({ ...RECORD, message }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe("22023");
    expect((error as RpcError).message).toBe("submit_contact_message failed (22023)");
    expect((error as RpcError).message).not.toContain(message);
  });

  it("claimDeliveries claims this message's alert with exactly the contract's keys", async () => {
    const contact = createSupabaseContactRepository(client);
    const { messageId, deliveryId } = await contact.submitMessage({ ...RECORD, name: "Grace", email: "grace@example.com" });

    const batch = await contact.claimDeliveries({ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 });
    expect(batch.skipped).toBe(0);
    expect(batch.expired).toBe(0);
    expect(batch.claimed).toHaveLength(1);
    const item = batch.claimed[0]!;
    expect(Object.keys(item).sort()).toEqual(["attempt", "email", "id", "kind", "message", "name", "receivedAt", "topic"]);
    expect(item).toMatchObject({ id: deliveryId, kind: "contact_staff_alert", attempt: 1, name: "Grace", email: "grace@example.com", topic: "press", message: "Hello from a parent." });
    expect(Number.isFinite(Date.parse(item.receivedAt))).toBe(true);

    expect(await contact.claimDeliveries({ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 })).toEqual({ claimed: [], skipped: 0, expired: 0 });
  });

  it("recordDeliveryAttempt records a sent alert and answers false the second time", async () => {
    const contact = createSupabaseContactRepository(client);
    const { messageId, deliveryId } = await contact.submitMessage({ ...RECORD, email: "recorded@example.com" });
    await contact.claimDeliveries({ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 });

    expect(await contact.recordDeliveryAttempt(deliveryId, { status: "sent", providerMessageId: "re_contact_1" })).toBe(true);
    expect(await contact.recordDeliveryAttempt(deliveryId, { status: "sent", providerMessageId: "re_contact_1" })).toBe(false);
    const { rows } = await db.query<{ status: string; provider: string }>(
      "select status, provider_message_id as provider from public.contact_message_deliveries where id = $1",
      [deliveryId],
    );
    expect(rows).toEqual([{ status: "sent", provider: "re_contact_1" }]);
  });

  it("hands a claim back uncounted, so the next claim is attempt 1 again", async () => {
    const contact = createSupabaseContactRepository(client);
    const { messageId, deliveryId } = await contact.submitMessage({ ...RECORD, email: "deferred@example.com" });
    await contact.claimDeliveries({ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 });
    expect(await contact.recordDeliveryAttempt(deliveryId, { status: "deferred" })).toBe(true);
    const again = await contact.claimDeliveries({ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 });
    expect(again.claimed).toEqual([expect.objectContaining({ id: deliveryId, attempt: 1 })]);
    expect(await contact.recordDeliveryAttempt(deliveryId, { status: "failed", errorCode: "rate_limit_exceeded" })).toBe(true);
  });

  it("claims across every message when none is named (the worker)", async () => {
    const contact = createSupabaseContactRepository(client);
    const { deliveryId } = await contact.submitMessage({ ...RECORD, email: "worker@example.com" });
    const batch = await contact.claimDeliveries({ kinds: ["contact_staff_alert"], limit: 50 });
    expect(batch.claimed.map((item) => item.id)).toContain(deliveryId);
  });
});

describe("the contact adapter refuses what it does not expect", () => {
  const VALID = {
    id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11",
    kind: "contact_staff_alert",
    attempt: 1,
    name: "Ada",
    email: "ada@example.com",
    topic: "press",
    message: "Hello from a parent.",
    receivedAt: "2026-10-21T09:30:12.345+00:00",
  };
  const answering = (data: unknown): RpcClient => ({ rpc: async () => ({ data, error: null }) });
  const batchOf = (item: Record<string, unknown>) => ({ claimed: [item], skipped: 0, expired: 0 });

  it("accepts a well-formed claim answer as it is", async () => {
    const batch = await createSupabaseContactRepository(answering(batchOf(VALID))).claimDeliveries({ kinds: ["contact_staff_alert"], limit: 1 });
    expect(batch).toEqual(batchOf(VALID));
  });

  it("claims nothing and calls no RPC for an empty kinds list", async () => {
    const rpc = vi.fn(async () => ({ data: batchOf(VALID), error: null }));
    const batch = await createSupabaseContactRepository({ rpc }).claimDeliveries({ kinds: [], limit: 10 });
    expect(batch).toEqual({ claimed: [], skipped: 0, expired: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown topic", { ...VALID, topic: "other" }],
    ["a lead outbox kind", { ...VALID, kind: "staff_alert" }],
    ["a malformed id", { ...VALID, id: "4f8c1c1e-" }],
    ["attempt 0", { ...VALID, attempt: 0 }],
    ["an empty email", { ...VALID, email: "" }],
    ["an empty message", { ...VALID, message: "" }],
    ["an empty name", { ...VALID, name: "" }],
    ["a name over 80 characters", { ...VALID, name: "a".repeat(81) }],
    ["an unreadable time", { ...VALID, receivedAt: "yesterday" }],
    ["a missing key", Object.fromEntries(Object.entries(VALID).filter(([key]) => key !== "receivedAt"))],
  ])("refuses a malformed claim answer as bad_response: %s", async (_label, item) => {
    await expect(createSupabaseContactRepository(answering(batchOf(item))).claimDeliveries({ kinds: ["contact_staff_alert"], limit: 1 })).rejects.toThrow(
      "claim_contact_deliveries failed (bad_response)",
    );
  });

  it.each([
    ["not an object", null],
    ["no claimed list", { skipped: 0, expired: 0 }],
    ["a bad count", { claimed: [], skipped: 0, expired: -1 }],
  ])("refuses a malformed claim batch as bad_response: %s", async (_label, data) => {
    await expect(createSupabaseContactRepository(answering(data)).claimDeliveries({ kinds: ["contact_staff_alert"], limit: 1 })).rejects.toThrow(
      "claim_contact_deliveries failed (bad_response)",
    );
  });

  it.each([
    ["no row", []],
    ["a missing delivery id", [{ message_id: VALID.id }]],
    ["a malformed message id", [{ message_id: "nope", delivery_id: VALID.id }]],
  ])("refuses a submit answer without both ids as bad_response: %s", async (_label, data) => {
    await expect(createSupabaseContactRepository(answering(data)).submitMessage(RECORD)).rejects.toThrow("submit_contact_message failed (bad_response)");
  });

  it("refuses a record answer that is not a boolean", async () => {
    await expect(createSupabaseContactRepository(answering("yes")).recordDeliveryAttempt(VALID.id, { status: "deferred" })).rejects.toThrow(
      "record_contact_delivery_attempt failed (bad_response)",
    );
  });

  it("sends the arguments PostgREST expects, with null for an unnamed message", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const recording: RpcClient = {
      rpc: async (fn, args) => {
        calls.push([fn, args]);
        if (fn === "submit_contact_message") return { data: [{ message_id: VALID.id, delivery_id: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71" }], error: null };
        return { data: fn.startsWith("claim") ? { claimed: [], skipped: 0, expired: 0 } : true, error: null };
      },
    };
    const contact = createSupabaseContactRepository(recording);
    expect(await contact.submitMessage(RECORD)).toEqual({ messageId: VALID.id, deliveryId: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71" });
    await contact.claimDeliveries({ kinds: ["contact_staff_alert"], limit: 5 });
    await contact.claimDeliveries({ ownerId: VALID.id, kinds: ["contact_staff_alert"], limit: 1 });
    await contact.recordDeliveryAttempt(VALID.id, { status: "failed", errorCode: "send_timeout" });
    expect(calls).toEqual([
      ["submit_contact_message", { p_name: "Ada", p_email: "ada@example.com", p_topic: "press", p_message: "Hello from a parent." }],
      ["claim_contact_deliveries", { p_limit: 5, p_message_id: null }],
      ["claim_contact_deliveries", { p_limit: 1, p_message_id: VALID.id }],
      ["record_contact_delivery_attempt", { p_delivery_id: VALID.id, p_status: "failed", p_provider_message_id: null, p_error_code: "send_timeout" }],
    ]);
  });
});
