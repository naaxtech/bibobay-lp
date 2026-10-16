import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { OrderRecordInput } from "@/lib/orders/submit";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { createSupabaseOrderRepository } from "@/lib/supabase/orders";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
import type { RpcClient } from "@/lib/supabase/rpc";
import { pgliteRpc } from "@/tests/support/pglite-rpc";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * The outbox adapters against the real migrations (Task 8a): the claim and record RPCs of
 * migration 0006 are called as PostgREST calls them (named arguments, as service_role), so a
 * renamed argument or a changed answer shape fails here. A fixture-only test would pass anyway.
 */
const ORDER: OrderRecordInput = {
  contactName: "Alex Rivera",
  email: "buyer@example.com",
  phone: "+63 912 345 6789",
  addressLine1: "12 Reef Road",
  city: "Cebu City",
  country: "PH",
  notes: "Please call before delivery.",
  consentVersion: "2026-10.v1",
  submissionKey: "2b0e2f4a-5c6d-4e7f-8a9b-0c1d2e3f4a5c",
  lines: [
    { productId: "plush-tula", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: null, quantity: 2 },
    { productId: "book-bubbles", name: "Bubble breathing book", sku: null, variant: null, pack: "Pack of 3", quantity: 1 },
  ],
};

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

describe("the lead outbox adapter against the real migrations", () => {
  it("claims a named lead's delivery once, records it, and never hands it out again", async () => {
    const leads = createSupabaseLeadRepository(client);
    const { leadId } = await leads.submitLead({ email: "parent@example.com", firstName: "Ana", ageBand: "3-5", consentVersion: "1", source: "landing" });
    const queued = await leads.enqueueDelivery(leadId, "acknowledgement", { claim: false });
    expect(queued).toMatchObject({ status: "pending", created: true });

    const batch = await leads.claimDeliveries({ ownerId: leadId, kinds: ["acknowledgement"], limit: 1 });
    expect(batch).toEqual({
      claimed: [{ id: queued.eventId, kind: "acknowledgement", attempt: 1, email: "parent@example.com", firstName: "Ana", ageBand: "3-5", source: "landing" }],
      skipped: 0,
      expired: 0,
    });
    expect(await leads.claimDeliveries({ ownerId: leadId, kinds: ["acknowledgement"], limit: 1 })).toEqual({ claimed: [], skipped: 0, expired: 0 });
    expect(await leads.recordDeliveryAttempt(queued.eventId, { status: "sent", providerMessageId: "re_ack" })).toBe(true);
    expect(await leads.recordDeliveryAttempt(queued.eventId, { status: "sent", providerMessageId: "re_ack" })).toBe(false);
  });

  it("hands a claim back uncounted, so the next claim is attempt 1 again", async () => {
    const leads = createSupabaseLeadRepository(client);
    const { leadId } = await leads.submitLead({ email: "second@example.com", consentVersion: "1", source: "landing" });
    const queued = await leads.enqueueDelivery(leadId, "staff_alert", { claim: false });
    await leads.claimDeliveries({ ownerId: leadId, kinds: ["staff_alert"], limit: 1 });
    expect(await leads.recordDeliveryAttempt(queued.eventId, { status: "deferred" })).toBe(true);
    const again = await leads.claimDeliveries({ ownerId: leadId, kinds: ["staff_alert"], limit: 1 });
    expect(again.claimed).toEqual([{ id: queued.eventId, kind: "staff_alert", attempt: 1, email: "second@example.com", firstName: null, ageBand: null, source: "landing" }]);
    expect(await leads.recordDeliveryAttempt(queued.eventId, { status: "failed", errorCode: "rate_limit_exceeded" })).toBe(true);
  });

  it("reports a withdrawn lead's rows as skipped and returns nothing about them (R92)", async () => {
    await db.exec(`insert into public.lead_submissions (email, consent_state, consent_version, consent_withdrawn_at, source)
                   values ('gone@example.com', 'withdrawn', '1', now(), 'landing')`);
    const leads = createSupabaseLeadRepository(client);
    const { leadId } = await leads.submitLead({ email: "gone@example.com", consentVersion: "1", source: "landing" });
    await leads.enqueueDelivery(leadId, "acknowledgement", { claim: false });
    expect(await leads.claimDeliveries({ ownerId: leadId, kinds: ["acknowledgement", "staff_alert"], limit: 10 })).toEqual({ claimed: [], skipped: 1, expired: 0 });
    // A later resubmission finds the skipped row: still a queued row, so the API answer stays the
    // same as anyone else's (an adapter refusal here would turn acknowledgementQueued false).
    expect(await leads.enqueueDelivery(leadId, "acknowledgement", { claim: false })).toMatchObject({ status: "skipped", created: false });
  });

  it("claims across every lead when no lead is named (the worker)", async () => {
    const leads = createSupabaseLeadRepository(client);
    const { leadId } = await leads.submitLead({ email: "third@example.com", consentVersion: "1", source: "landing" });
    const queued = await leads.enqueueDelivery(leadId, "acknowledgement", { claim: false });
    const batch = await leads.claimDeliveries({ kinds: ["acknowledgement", "staff_alert"], limit: 50 });
    expect(batch.claimed.map((entry) => entry.id)).toContain(queued.eventId);
  });
});

describe("the order outbox adapter against the real migrations", () => {
  it("claims an order's two emails with only what they need, and records them", async () => {
    const orders = createSupabaseOrderRepository(client);
    const outbox = createSupabaseOrderEmailOutbox(client);
    const stored = await orders.submitOrder(ORDER);

    const batch = await outbox.claimEmails({ ownerId: stored.orderId, kinds: ["acknowledgement", "staff_alert"], limit: 2 });
    expect(batch.skipped).toBe(0);
    expect(batch.claimed.map((email) => email.kind).sort()).toEqual(["acknowledgement", "staff_alert"]);
    const acknowledgement = batch.claimed.find((email) => email.kind === "acknowledgement")!;
    expect(acknowledgement).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      kind: "acknowledgement",
      attempt: 1,
      reference: stored.reference,
      contactName: "Alex Rivera",
      email: "buyer@example.com",
      lines: [
        { title: "Tula plush", variant: "Large", pack: null, quantity: 2 },
        { title: "Bubble breathing book", variant: null, pack: "Pack of 3", quantity: 1 },
      ],
      quote: null,
    });
    expect(JSON.stringify(batch)).not.toMatch(/Reef Road|Cebu|912 345|call before|BB-TULA|plush-tula/);

    expect(await outbox.recordEmailAttempt(acknowledgement.id, { status: "sent", providerMessageId: "re_order" })).toBe(true);
    expect(await outbox.recordEmailAttempt(acknowledgement.id, { status: "sent", providerMessageId: "re_order" })).toBe(false);
    const alert = batch.claimed.find((email) => email.kind === "staff_alert")!;
    expect(await outbox.recordEmailAttempt(alert.id, { status: "deferred" })).toBe(true);
    expect((await outbox.claimEmails({ ownerId: stored.orderId, kinds: ["staff_alert"], limit: 1 })).claimed[0]).toMatchObject({ id: alert.id, attempt: 1 });
  });

  it("claims a queued quote with its figures and sets quote_sent_at once the provider accepts it (R90)", async () => {
    const orders = createSupabaseOrderRepository(client);
    const outbox = createSupabaseOrderEmailOutbox(client);
    const stored = await orders.submitOrder({ ...ORDER, submissionKey: "5d1c9e2b-4a3f-4c6d-9e8f-1a2b3c4d5e6a" });
    await db.query(
      "update public.orders set currency = 'PHP', subtotal_minor = 250000, freight_minor = 15000, payment_url = 'https://pay.example.com/c/1', quote_revision = 1 where id = $1",
      [stored.orderId],
    );
    await db.query("insert into public.order_email_outbox (order_id, kind, quote_revision) values ($1, 'quote', 1)", [stored.orderId]);

    const batch = await outbox.claimEmails({ ownerId: stored.orderId, kinds: ["quote"], limit: 1 });
    expect(batch.claimed).toHaveLength(1);
    expect(batch.claimed[0]!.quote).toEqual({ currency: "PHP", subtotalMinor: 250000, freightMinor: 15000, paymentUrl: "https://pay.example.com/c/1", revision: 1 });
    expect(await outbox.recordEmailAttempt(batch.claimed[0]!.id, { status: "sent", providerMessageId: "re_quote" })).toBe(true);
    const { rows } = await db.query<{ sent: boolean }>("select quote_sent_at is not null as sent from public.orders where id = $1", [stored.orderId]);
    expect(rows).toEqual([{ sent: true }]);
  });

  it("never marks the current quote sent when the accepted email was for an older revision (fix wave C-I1)", async () => {
    const orders = createSupabaseOrderRepository(client);
    const outbox = createSupabaseOrderEmailOutbox(client);
    const stored = await orders.submitOrder({ ...ORDER, submissionKey: "7a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d" });
    await db.query(
      "update public.orders set currency = 'PHP', subtotal_minor = 250000, freight_minor = 15000, payment_url = 'https://pay.example.com/c/1', quote_revision = 1 where id = $1",
      [stored.orderId],
    );
    await db.query("insert into public.order_email_outbox (order_id, kind, quote_revision) values ($1, 'quote', 1)", [stored.orderId]);
    const batch = await outbox.claimEmails({ ownerId: stored.orderId, kinds: ["quote"], limit: 1 });
    expect(batch.claimed[0]!.quote?.revision).toBe(1);

    // Revision 2 is saved while the revision 1 email is in flight (staff_save_order_quote's effect).
    await db.query("update public.orders set subtotal_minor = 260000, quote_revision = 2, quote_sent_at = null where id = $1", [stored.orderId]);
    expect(await outbox.recordEmailAttempt(batch.claimed[0]!.id, { status: "sent", providerMessageId: "re_quote_old" })).toBe(true);

    const { rows } = await db.query<{ sent: boolean; status: string }>(
      "select o.quote_sent_at is not null as sent, e.status from public.orders as o join public.order_email_outbox as e on e.order_id = o.id and e.kind = 'quote' where o.id = $1",
      [stored.orderId],
    );
    expect(rows).toEqual([{ sent: false, status: "sent" }]);
  });
});

describe("the outbox adapters refuse answers they do not expect", () => {
  const answering = (data: unknown): RpcClient => ({ rpc: async () => ({ data, error: null }) });

  it.each([
    ["not an object", null],
    ["no claimed list", { skipped: 0, expired: 0 }],
    ["a malformed row", { claimed: [{ id: "x", kind: "acknowledgement", attempt: 1, email: "a@example.com", firstName: null, ageBand: null, source: "landing" }], skipped: 0, expired: 0 }],
    ["an unknown kind", { claimed: [{ id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "newsletter", attempt: 1, email: "a@example.com", firstName: null, ageBand: null, source: "landing" }], skipped: 0, expired: 0 }],
    ["a bad count", { claimed: [], skipped: -1, expired: 0 }],
  ])("lead claim: %s", async (_label, data) => {
    await expect(createSupabaseLeadRepository(answering(data)).claimDeliveries({ kinds: ["acknowledgement"], limit: 1 })).rejects.toThrow("claim_lead_deliveries failed (bad_response)");
  });

  it.each([
    ["no lines", { claimed: [{ id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "acknowledgement", attempt: 1, reference: "BB-1A2B-3C4D", contactName: "Sam", email: "a@example.com", lines: [], quote: null }], skipped: 0, expired: 0 }],
    ["a quote without figures", { claimed: [{ id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "quote", attempt: 1, reference: "BB-1A2B-3C4D", contactName: "Sam", email: "a@example.com", lines: [{ title: "Tula", variant: null, pack: null, quantity: 1 }], quote: null }], skipped: 0, expired: 0 }],
    ["figures on an acknowledgement", { claimed: [{ id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "acknowledgement", attempt: 1, reference: "BB-1A2B-3C4D", contactName: "Sam", email: "a@example.com", lines: [{ title: "Tula", variant: null, pack: null, quantity: 1 }], quote: { currency: "AUD", subtotalMinor: 1, freightMinor: 0, paymentUrl: "https://pay.example.com", revision: 1 } }], skipped: 0, expired: 0 }],
    ["a bad reference", { claimed: [{ id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", kind: "acknowledgement", attempt: 1, reference: "nope", contactName: "Sam", email: "a@example.com", lines: [{ title: "Tula", variant: null, pack: null, quantity: 1 }], quote: null }], skipped: 0, expired: 0 }],
  ])("order claim: %s", async (_label, data) => {
    await expect(createSupabaseOrderEmailOutbox(answering(data)).claimEmails({ kinds: ["acknowledgement"], limit: 1 })).rejects.toThrow("claim_order_emails failed (bad_response)");
  });

  it("sends the arguments PostgREST expects, with null for an unnamed owner", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const recording: RpcClient = { rpc: async (fn, args) => (calls.push([fn, args]), { data: fn.startsWith("claim") ? { claimed: [], skipped: 0, expired: 0 } : true, error: null }) };
    await createSupabaseLeadRepository(recording).claimDeliveries({ kinds: ["acknowledgement"], limit: 5 });
    await createSupabaseLeadRepository(recording).recordDeliveryAttempt("4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", { status: "deferred" });
    await createSupabaseOrderEmailOutbox(recording).claimEmails({ ownerId: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71", kinds: ["quote"], limit: 1 });
    await createSupabaseOrderEmailOutbox(recording).recordEmailAttempt("6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71", { status: "failed", errorCode: "send_timeout" });
    expect(calls).toEqual([
      ["claim_lead_deliveries", { p_limit: 5, p_lead_id: null, p_kinds: ["acknowledgement"] }],
      ["record_lead_delivery_attempt", { p_event_id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", p_status: "deferred", p_provider_message_id: null, p_error_code: null }],
      ["claim_order_emails", { p_limit: 1, p_order_id: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71", p_kinds: ["quote"] }],
      ["record_order_email_attempt", { p_email_id: "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71", p_status: "failed", p_provider_message_id: null, p_error_code: "send_timeout" }],
    ]);
  });
});
