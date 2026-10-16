import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY } from "@/components/forms/order-copy";
import type { CanonicalLinesResult, CanonicalOrderLine } from "@/lib/orders/catalogue";
import { ORDER_RATE_LIMIT, submitOrder, type OrderLogEvent, type OrderRecordInput, type OrderRepository, type OrderSubmissionDependencies } from "@/lib/orders/submit";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { RpcError, type RpcClient } from "@/lib/supabase/rpc";

vi.mock("server-only", () => ({}));

/** Sanity reads for the route tests; the unit tests inject their own catalogue instead. */
const cms = vi.hoisted(() => {
  const state = {
    settings: { commerceEnabled: true, trackingEnabled: true } as Record<string, unknown>,
    products: [] as unknown[] | null,
    /** The signup's version: an order must never record it (R82). */
    consentVersion: "2026-10.v1",
    orderConsentCopy: "I am an adult and agree to the order terms.",
    orderConsentVersion: "order-2026-10",
  };
  return Object.assign(state, {
    getSiteSettings: vi.fn(async () => ({ ...(await import("@/lib/content/fallback")).SAFE_FALLBACK_SETTINGS, ...state.settings })),
    getLegalSettings: vi.fn(async () => ({
      ...(await import("@/lib/content/fallback")).SAFE_FALLBACK_LEGAL,
      consentCopyVersion: state.consentVersion,
      orderConsentCopy: state.orderConsentCopy,
      orderConsentCopyVersion: state.orderConsentVersion,
    })),
    getOrderableProducts: vi.fn(async (ids: readonly string[]) => (void ids, state.products)),
  });
});
// Fix wave D-M2: the routes' gates read getGateSettings (the same settings, with a 300 s backstop).
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings: cms.getSiteSettings, getGateSettings: cms.getSiteSettings, getLegalSettings: cms.getLegalSettings, getOrderableProducts: cms.getOrderableProducts }));

/** Every RPC the route makes, through the mocked Supabase client. */
const supabase = vi.hoisted(() => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const answers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { code?: string; message: string } | null }> = {};
  const createClient = vi.fn(() => ({
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push([fn, args]);
      const answer = answers[fn];
      return Promise.resolve(answer ? answer(args) : { data: null, error: { code: "42883", message: "missing" } });
    },
  }));
  return { calls, answers, createClient };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: supabase.createClient }));

import { POST } from "@/app/api/orders/route";
import { SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { createOrderDependencies, createTrackingDependencies, orderConsentFrom } from "@/lib/orders/dependencies";
import { createSupabaseOrderRepository } from "@/lib/supabase/orders";

/*
 * Order submission (spec §10 steps 4-7; Task 7a). Commerce is gated on the server; the honeypot,
 * validation, the shared rate limit and the canonical CMS reload all run before anything is
 * stored; one RPC stores the order atomically; and the answer says an order was received only
 * once that RPC committed. Every refusal is generic: it never names a product id, and the copy
 * never claims an email was sent or shows a price.
 */

const ORDER_ID = "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71";
const REFERENCE = "BB-1A2B-3C4D";
const TOKEN = "ab".repeat(32);
const CLIENT_IP = "203.0.113.9";
const HASH_SECRET = "fixture-hash-secret-0123456789abcdef";
/** R81: the order form's key for one order attempt. */
const KEY = "6f1c2a4e-8b3d-4c5e-9a7f-1b2c3d4e5f60";

const TULA_LINE: CanonicalOrderLine = { productId: "product-tula-plush", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", quantity: 2 };

const VALID = {
  contactName: "Sam Rivers",
  email: "Parent@Example.com",
  phone: "+61 2 5550 1234",
  addressLine1: "12 Harbour Road",
  city: "Seaside",
  postalCode: "2000",
  country: "AU",
  notes: "Leave at the door",
  consent: true,
  lines: [{ productId: "product-tula-plush", quantity: 2 }],
  submissionKey: KEY,
  website: "",
};

/** An in-memory repository recording what would be stored. */
function fakeRepository(answer: Partial<Awaited<ReturnType<OrderRepository["submitOrder"]>>> | Error = {}) {
  const stored: OrderRecordInput[] = [];
  const repository: OrderRepository = {
    async submitOrder(record) {
      if (answer instanceof Error) throw answer;
      stored.push(record);
      return { orderId: ORDER_ID, reference: REFERENCE, trackingToken: TOKEN, trackingTokenExpiresAt: "2027-04-14T00:00:00.000Z", acknowledgementQueued: true, duplicate: false, ...answer } as Awaited<ReturnType<OrderRepository["submitOrder"]>>;
    },
  };
  return { repository, stored };
}

const allowAll: RateLimiter = { async consume() { return { allowed: true, remaining: 4, retryAfterSeconds: 0 }; } };

function deps(overrides: Partial<OrderSubmissionDependencies> = {}) {
  const events: OrderLogEvent[] = [];
  const resolveLines = vi.fn(async (lines: Array<{ productId: string; quantity: number }>): Promise<CanonicalLinesResult> => ({
    ok: true,
    lines: lines.map((line) => ({ ...TULA_LINE, productId: line.productId, quantity: line.quantity })),
  }));
  const dependencies: OrderSubmissionDependencies = {
    commerceEnabled: true,
    trackingEnabled: true,
    repository: fakeRepository().repository,
    rateLimiter: allowAll,
    resolveLines,
    consentVersion: "7",
    orderCountries: [],
    clientKey: "client-hash",
    log: (event) => events.push(event),
    ...overrides,
  };
  return { dependencies, events, resolveLines: dependencies.resolveLines as typeof resolveLines };
}

describe("the commerce gate", () => {
  it("refuses every order while commerce is off, and does no work at all", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const { dependencies, resolveLines } = deps({ commerceEnabled: false, repository: repo.repository, rateLimiter: { consume } });
    for (const input of [VALID, { ...VALID, website: "spam" }, { nonsense: true }]) {
      const result = await submitOrder(input, dependencies);
      expect(result).toEqual({ status: 404, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.unavailable } });
    }
    expect(consume).not.toHaveBeenCalled();
    expect(resolveLines).not.toHaveBeenCalled();
    expect(repo.stored).toEqual([]);
  });
});

describe("before anything is stored", () => {
  it("turns a bot away with a generic refusal: nothing counted, read or stored", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const { dependencies, resolveLines, events } = deps({ repository: repo.repository, rateLimiter: { consume } });
    const result = await submitOrder({ ...VALID, website: "https://spam.example" }, dependencies);
    expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed } });
    expect(consume).not.toHaveBeenCalled();
    expect(resolveLines).not.toHaveBeenCalled();
    expect(repo.stored).toEqual([]);
    expect(events).toEqual([{ event: "order_honeypot" }]);
  });

  it("answers field problems with field errors and stores nothing", async () => {
    const repo = fakeRepository();
    const { dependencies, resolveLines } = deps({ repository: repo.repository });
    const result = await submitOrder({ ...VALID, consent: false, addressLine1: "a".repeat(201) }, dependencies);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.checkDetails, fieldErrors: { addressLine1: "too_long", consent: "required" } });
    expect(resolveLines).not.toHaveBeenCalled();
    expect(repo.stored).toEqual([]);
  });

  it("refuses a body that carries a price or a product name, generically", async () => {
    const repo = fakeRepository();
    const { dependencies } = deps({ repository: repo.repository });
    const priced = await submitOrder({ ...VALID, total: 0 }, dependencies);
    expect(priced).toEqual({ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed } });
    const named = await submitOrder({ ...VALID, lines: [{ productId: "product-tula-plush", quantity: 1, name: "Free plush" }] }, dependencies);
    expect(named.status).toBe(400);
    expect(named.body.fieldErrors).toEqual({ lines: "invalid" });
    expect(repo.stored).toEqual([]);
  });

  it("refuses a country outside the CMS list as a field problem, before counting or storing anything (R85)", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const { dependencies, resolveLines } = deps({ repository: repo.repository, rateLimiter: { consume }, orderCountries: ["PH", "NZ"] });
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.checkDetails, fieldErrors: { country: "invalid" } } });
    expect(consume).not.toHaveBeenCalled();
    expect(resolveLines).not.toHaveBeenCalled();
    expect(repo.stored).toEqual([]);
    expect((await submitOrder({ ...VALID, country: "nz" }, dependencies)).status).toBe(200);
  });

  it("with no CMS list, accepts every assigned country code and refuses the rest (R85)", async () => {
    const { dependencies } = deps();
    expect((await submitOrder({ ...VALID, country: "PH" }, dependencies)).status).toBe(200);
    for (const country of ["ZZ", "UK", "EU"]) {
      expect((await submitOrder({ ...VALID, country }, dependencies)).body.fieldErrors, country).toEqual({ country: "invalid" });
    }
  });

  it("stores nothing and answers 503 while storage is not configured", async () => {
    const { dependencies, resolveLines } = deps({ repository: null, rateLimiter: null });
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({ status: 503, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.busy } });
    expect(resolveLines).not.toHaveBeenCalled();
  });

  it("counts each client in its own order bucket and answers 429 past the limit, before reading the catalogue", async () => {
    const limiter = createMemoryRateLimiter();
    const consume = vi.spyOn(limiter, "consume");
    const repo = fakeRepository();
    const { dependencies, resolveLines } = deps({ rateLimiter: limiter, repository: repo.repository });
    for (let attempt = 0; attempt < ORDER_RATE_LIMIT.maxHits; attempt += 1) expect((await submitOrder(VALID, dependencies)).status).toBe(200);
    const refused = await submitOrder(VALID, dependencies);
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.rateLimited });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(consume).toHaveBeenLastCalledWith("order:client-hash", { maxHits: 5, windowSeconds: 3600 });
    expect(resolveLines).toHaveBeenCalledTimes(ORDER_RATE_LIMIT.maxHits);
    expect(repo.stored).toHaveLength(ORDER_RATE_LIMIT.maxHits);
  });

  it("fails closed when the shared limiter cannot be reached", async () => {
    const repo = fakeRepository();
    const { dependencies, events } = deps({ repository: repo.repository, rateLimiter: { consume: async () => { throw new RpcError("consume_rate_limit", "57P01"); } } });
    const result = await submitOrder(VALID, dependencies);
    expect(result.status).toBe(503);
    expect(result.body.message).toBe(ORDER_COPY.outcome.busy);
    expect(repo.stored).toEqual([]);
    expect(events).toContainEqual({ event: "order_rate_limit_unavailable", code: "57P01" });
  });
});

describe("the canonical catalogue reload", () => {
  it("stores the CMS snapshot of every product with the submitted quantities, never anything the browser said", async () => {
    const repo = fakeRepository();
    const resolveLines = vi.fn(async (): Promise<CanonicalLinesResult> => ({ ok: true, lines: [{ ...TULA_LINE, name: "Tula plush (from the CMS)", quantity: 3 }] }));
    const { dependencies } = deps({ repository: repo.repository, resolveLines });
    await submitOrder({ ...VALID, lines: [{ productId: "product-tula-plush", quantity: 3 }] }, dependencies);
    expect(resolveLines).toHaveBeenCalledWith([{ productId: "product-tula-plush", quantity: 3 }]);
    expect(repo.stored[0]?.lines).toEqual([{ ...TULA_LINE, name: "Tula plush (from the CMS)", quantity: 3 }]);
  });

  it.each([
    ["an unknown, draft, sold-out or unlisted product", "unavailable_products", "order_products_refused"],
    ["a listed product whose CMS data cannot be stored", "invalid_product", "order_catalogue_invalid"],
  ] as const)("refuses %s generically, without naming it, and stores nothing", async (_case, reason, logged) => {
    const repo = fakeRepository();
    const { dependencies, events } = deps({ repository: repo.repository, resolveLines: async () => ({ ok: false, reason }) });
    const result = await submitOrder({ ...VALID, lines: [{ productId: "product-made-up", quantity: 1 }] }, dependencies);
    expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.productsUnavailable } });
    expect(JSON.stringify(result)).not.toContain("product-made-up");
    expect(repo.stored).toEqual([]);
    expect(events).toContainEqual({ event: logged });
  });

  it("answers 503 and stores nothing when the CMS cannot be read", async () => {
    const repo = fakeRepository();
    const { dependencies, events } = deps({ repository: repo.repository, resolveLines: async () => ({ ok: false, reason: "catalogue_unavailable" }) });
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({ status: 503, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.busy } });
    expect(repo.stored).toEqual([]);
    expect(events).toContainEqual({ event: "order_catalogue_unavailable" });
  });
});

describe("storing the order", () => {
  it("stores adult details, the server's consent version and the canonical lines; nothing priced", async () => {
    const repo = fakeRepository();
    const { dependencies } = deps({ repository: repo.repository, consentVersion: "7" });
    await submitOrder(VALID, dependencies);
    expect(repo.stored).toEqual([{
      contactName: "Sam Rivers",
      email: "parent@example.com",
      phone: "+61 2 5550 1234",
      addressLine1: "12 Harbour Road",
      city: "Seaside",
      postalCode: "2000",
      country: "AU",
      notes: "Leave at the door",
      consentVersion: "7",
      submissionKey: KEY,
      lines: [TULA_LINE],
    }]);
  });

  it("says the order was received, with its reference and private tracking token, only once it is stored", async () => {
    const { dependencies, events } = deps();
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({
      status: 200,
      body: { ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN },
    });
    expect(events).toContainEqual({ event: "order_stored", lines: 1 });
  });

  it("leaves the tracking token out while tracking is switched off", async () => {
    const { dependencies } = deps({ trackingEnabled: false });
    const result = await submitOrder(VALID, dependencies);
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE });
  });

  it("answers a repeated submission key with the first order's reference: received already, no token, nothing queued (R81)", async () => {
    const duplicate = fakeRepository({ trackingToken: null, trackingTokenExpiresAt: null, acknowledgementQueued: false, duplicate: true });
    const { dependencies, events } = deps({ repository: duplicate.repository, trackingEnabled: true });
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({
      status: 200,
      body: { ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceived, reference: REFERENCE },
    });
    expect(duplicate.stored[0]?.submissionKey).toBe(KEY);
    expect(events).toContainEqual({ event: "order_duplicate" });
    expect(events).not.toContainEqual(expect.objectContaining({ event: "order_stored" }));
  });

  it("answers a repeat without pointing at a tracking page while tracking is off (R81)", async () => {
    const duplicate = fakeRepository({ trackingToken: null, trackingTokenExpiresAt: null, acknowledgementQueued: false, duplicate: true });
    const { dependencies } = deps({ repository: duplicate.repository, trackingEnabled: false });
    expect((await submitOrder(VALID, dependencies)).body).toEqual({ ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceivedUntracked, reference: REFERENCE });
  });

  it("reports the acknowledgement queued only when the database says its outbox row exists", async () => {
    const { dependencies } = deps({ repository: fakeRepository({ acknowledgementQueued: false }).repository });
    expect((await submitOrder(VALID, dependencies)).body.acknowledgementQueued).toBe(false);
  });

  it("never claims success when the write fails: no reference, no token, a generic message", async () => {
    const { dependencies, events } = deps({ repository: fakeRepository(new RpcError("submit_order", "23505")).repository });
    const result = await submitOrder(VALID, dependencies);
    expect(result).toEqual({ status: 500, body: { ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed } });
    expect(events).toContainEqual({ event: "order_store_failed", code: "23505" });
  });

  it("logs event names and codes only: no name, email, address or product", async () => {
    const { dependencies, events } = deps();
    await submitOrder(VALID, dependencies);
    await submitOrder({ ...VALID, website: "x" }, dependencies);
    expect(JSON.stringify(events)).not.toMatch(/sam|rivers|example\.com|harbour|seaside|tula|product-|203\.0/i);
  });
});

describe("the queued order emails (Task 8a, R88)", () => {
  it("are attempted for the stored order only after the answer, through the outbox", async () => {
    const sendQueuedEmails = vi.fn(async (orderId: string) => void orderId);
    const tasks: Array<() => Promise<void>> = [];
    const { dependencies } = deps({ sendQueuedEmails, runAfterResponse: (task) => { tasks.push(task); } });
    const result = await submitOrder(VALID, dependencies);
    expect(result.body).toMatchObject({ ok: true, persisted: true, reference: REFERENCE });
    expect(sendQueuedEmails).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]!();
    expect(sendQueuedEmails).toHaveBeenCalledWith(ORDER_ID);
  });

  it("never change the answer, even when the attempt fails", async () => {
    const plain = await submitOrder(VALID, deps().dependencies);
    const failing = vi.fn(async () => { throw new Error("provider down for parent@example.com"); });
    expect(await submitOrder(VALID, deps({ sendQueuedEmails: failing }).dependencies)).toEqual(plain);
    expect(failing).toHaveBeenCalledWith(ORDER_ID);
    const tasks: Array<() => Promise<void>> = [];
    expect(await submitOrder(VALID, deps({ sendQueuedEmails: failing, runAfterResponse: (task) => { tasks.push(task); } }).dependencies)).toEqual(plain);
    await expect(tasks[0]!()).resolves.toBeUndefined();
  });

  it("are not attempted for a repeated submission key (nothing new was queued, R81) or an order that was not stored", async () => {
    const sendQueuedEmails = vi.fn(async () => {});
    const duplicate = fakeRepository({ trackingToken: null, trackingTokenExpiresAt: null, acknowledgementQueued: false, duplicate: true });
    await submitOrder(VALID, deps({ repository: duplicate.repository, sendQueuedEmails }).dependencies);
    await submitOrder(VALID, deps({ repository: fakeRepository(new RpcError("submit_order", "23505")).repository, sendQueuedEmails }).dependencies);
    await submitOrder({ ...VALID, website: "x" }, deps({ sendQueuedEmails }).dependencies);
    expect(sendQueuedEmails).not.toHaveBeenCalled();
  });
});

describe("order copy", () => {
  const strings = JSON.stringify(ORDER_COPY);

  it("never claims an email was sent or a receipt is on its way", () => {
    expect(strings).not.toMatch(/\b(sent|inbox|check your (email|mail)|we('ve| have) emailed|receipt|confirmation email|on its way)\b/i);
  });

  it("never shows a price or claims a payment", () => {
    expect(strings).not.toMatch(/[$€£¥]|\b(price[ds]?|USD|AUD|EUR|GBP|paid|payment (received|taken))\b|\d+\.\d{2}/i);
  });

  it("tells the buyer, when the order is received, that nothing has been charged", () => {
    expect(ORDER_COPY.outcome.received).toMatch(/nothing has been charged/i);
  });

  it("answers a repeat as already received, pointing at tracking by reference and email (R81: no new link exists)", () => {
    expect(ORDER_COPY.outcome.alreadyReceived).toMatch(/already/i);
    expect(ORDER_COPY.outcome.alreadyReceived).toMatch(/nothing has been charged/i);
    expect(ORDER_COPY.outcome.alreadyReceived).toMatch(/reference/i);
    expect(ORDER_COPY.outcome.alreadyReceived).toMatch(/email/i);
    expect(ORDER_COPY.outcome.alreadyReceivedUntracked).toMatch(/already/i);
    expect(ORDER_COPY.outcome.alreadyReceivedUntracked).toMatch(/nothing has been charged/i);
    expect(ORDER_COPY.outcome.alreadyReceivedUntracked).toMatch(/reference/i);
    expect(ORDER_COPY.outcome.alreadyReceivedUntracked).not.toMatch(/track/i);
  });
});

describe("Supabase order repository", () => {
  function client(answer: { data: unknown; error: { code?: string; message: string } | null }) {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const rpc: RpcClient = { rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve(answer); } };
    return { rpc, calls };
  }
  const RECORD: OrderRecordInput = { contactName: "Sam Rivers", email: "parent@example.com", addressLine1: "12 Harbour Road", city: "Seaside", country: "AU", consentVersion: "7", submissionKey: KEY, lines: [TULA_LINE, { productId: "product-bob", name: "Bob book", sku: null, variant: null, pack: null, quantity: 1 }] };
  const ROW = { order_id: ORDER_ID, reference: REFERENCE, tracking_token: TOKEN, tracking_token_expires_at: "2027-04-14T00:00:00+00:00", acknowledgement_queued: true, duplicate: false };

  it("calls submit_order with bounded named arguments and the canonical lines only", async () => {
    const { rpc, calls } = client({ data: [ROW], error: null });
    const stored = await createSupabaseOrderRepository(rpc).submitOrder(RECORD);
    expect(calls).toEqual([["submit_order", {
      p_contact_name: "Sam Rivers", p_email: "parent@example.com", p_phone: null, p_address_line1: "12 Harbour Road", p_address_line2: null,
      p_city: "Seaside", p_region: null, p_postal_code: null, p_country: "AU", p_notes: null, p_consent: true, p_consent_version: "7",
      p_submission_key: KEY,
      p_lines: [
        { sanity_id: "product-tula-plush", title: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", quantity: 2 },
        { sanity_id: "product-bob", title: "Bob book", sku: null, variant: null, pack: null, quantity: 1 },
      ],
    }]]);
    expect(stored).toEqual({ orderId: ORDER_ID, reference: REFERENCE, trackingToken: TOKEN, trackingTokenExpiresAt: "2027-04-14T00:00:00.000Z", acknowledgementQueued: true, duplicate: false });
  });

  it("reads a duplicate answer: the first order's id and reference, no token (R81)", async () => {
    const { rpc } = client({ data: [{ ...ROW, tracking_token: null, tracking_token_expires_at: null, acknowledgement_queued: false, duplicate: true }], error: null });
    expect(await createSupabaseOrderRepository(rpc).submitOrder(RECORD)).toEqual({ orderId: ORDER_ID, reference: REFERENCE, trackingToken: null, trackingTokenExpiresAt: null, acknowledgementQueued: false, duplicate: true });
  });

  it("throws a value-free error when the database refuses, never its message", async () => {
    const { rpc } = client({ data: null, error: { code: "22023", message: "order lines are invalid for parent@example.com" } });
    const error = await createSupabaseOrderRepository(rpc).submitOrder(RECORD).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as Error).message).toBe("submit_order failed (22023)");
  });

  it.each([
    ["no row", []],
    ["a malformed reference", [{ ...ROW, reference: "ORDER-1" }]],
    ["a malformed token", [{ ...ROW, tracking_token: "short" }]],
    ["no acknowledgement flag", [{ ...ROW, acknowledgement_queued: "yes" }]],
    ["no duplicate flag", [{ ...ROW, duplicate: undefined }]],
    ["a first order without a token", [{ ...ROW, tracking_token: null, tracking_token_expires_at: null }]],
    ["a duplicate carrying a token", [{ ...ROW, duplicate: true, acknowledgement_queued: false }]],
  ])("treats %s as a failed write", async (_case, data) => {
    const { rpc } = client({ data, error: null });
    await expect(createSupabaseOrderRepository(rpc).submitOrder(RECORD)).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("POST /api/orders", () => {
  const TULA_DOC = { id: "product-tula-plush", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", status: "listed" };

  function configureSupabase() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
    vi.stubEnv("LEAD_IP_HASH_SECRET", HASH_SECRET);
  }

  function post(body: unknown, headers: Record<string, string> = {}) {
    return POST(new Request("http://127.0.0.1:3000/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
  }

  beforeEach(() => {
    supabase.calls.length = 0;
    for (const key of Object.keys(supabase.answers)) delete supabase.answers[key];
    supabase.createClient.mockClear();
    cms.settings = { commerceEnabled: true, trackingEnabled: true };
    cms.products = [TULA_DOC];
    cms.getSiteSettings.mockClear();
    cms.getLegalSettings.mockClear();
    cms.getOrderableProducts.mockClear();
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "LEAD_IP_HASH_SECRET"]) vi.stubEnv(name, "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    configureSupabase();
    supabase.answers.consume_rate_limit = () => ({ data: [{ allowed: true, remaining: 4, retry_after_seconds: 0 }], error: null });
    supabase.answers.submit_order = () => ({ data: [{ order_id: ORDER_ID, reference: REFERENCE, tracking_token: TOKEN, tracking_token_expires_at: "2027-04-14T00:00:00+00:00", acknowledgement_queued: true, duplicate: false }], error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("with commerce off: a non-enumerating 404, no database client, no catalogue or legal read", async () => {
    cms.settings = { commerceEnabled: false };
    for (const body of [VALID, { ...VALID, website: "spam" }, "{not json"]) {
      const response = await post(body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.unavailable });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(supabase.createClient).not.toHaveBeenCalled();
    expect(cms.getOrderableProducts).not.toHaveBeenCalled();
    expect(cms.getLegalSettings).not.toHaveBeenCalled();
  });

  it("limits, reloads the catalogue and stores through service-role RPCs, then reports the order received", async () => {
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(supabase.calls.map(([fn]) => fn)).toEqual(["consume_rate_limit", "submit_order"]);
    expect(cms.getOrderableProducts).toHaveBeenCalledWith(["product-tula-plush"]);
    expect(supabase.calls[1]?.[1]).toMatchObject({
      p_email: "parent@example.com",
      p_submission_key: KEY,
      p_consent: true,
      // R82: the order form's own consent version, never the signup's.
      p_consent_version: "order-2026-10",
      p_lines: [{ sanity_id: "product-tula-plush", title: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", quantity: 2 }],
    });
  });

  it("answers a retried request whose first answer was lost with the first order, and no token (R81)", async () => {
    supabase.answers.submit_order = () => ({ data: [{ order_id: ORDER_ID, reference: REFERENCE, tracking_token: null, tracking_token_expires_at: null, acknowledgement_queued: false, duplicate: true }], error: null });
    const response = await post(VALID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceived, reference: REFERENCE });
  });

  it("keys the shared limiter by a keyed hash of the client address, never the address itself", async () => {
    await post(VALID);
    expect(JSON.stringify(supabase.calls)).not.toContain(CLIENT_IP);
    expect(supabase.calls[0]?.[1]).toEqual({ bucket_key: expect.stringMatching(/^order:[0-9a-f]{64}$/), max_hits: 5, window_seconds: 3600 });
  });

  it("gives every address in one IPv6 /64 the same order bucket", async () => {
    await post(VALID, { "x-forwarded-for": "2001:db8:85a3:8d3::1" });
    await post(VALID, { "x-forwarded-for": "2001:db8:85a3:8d3:ffff::2" });
    await post(VALID, { "x-forwarded-for": "2001:db8:85a3:8d4::1" });
    const buckets = supabase.calls.filter(([fn]) => fn === "consume_rate_limit").map(([, args]) => args.bucket_key);
    expect(buckets[1]).toBe(buckets[0]);
    expect(buckets[2]).not.toBe(buckets[0]);
  });

  it("refuses a country the CMS does not list, touching no database (R85)", async () => {
    cms.settings = { commerceEnabled: true, trackingEnabled: true, orderCountries: ["PH"] };
    const response = await post(VALID);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.checkDetails, fieldErrors: { country: "invalid" } });
    expect(supabase.calls).toEqual([]);
  });

  it("refuses a product the published catalogue does not list, without storing anything", async () => {
    cms.products = [];
    const response = await post({ ...VALID, lines: [{ productId: "product-sold-out", quantity: 1 }] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.productsUnavailable });
    expect(supabase.calls.map(([fn]) => fn)).toEqual(["consume_rate_limit"]);
  });

  it("answers 429 with Retry-After once the shared limit is spent, before reading the catalogue", async () => {
    supabase.answers.consume_rate_limit = () => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 1200 }], error: null });
    const response = await post(VALID);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1200");
    expect(cms.getOrderableProducts).not.toHaveBeenCalled();
  });

  it("reports a generic failure, never success, when the database refuses the write", async () => {
    supabase.answers.submit_order = () => ({ data: null, error: { code: "57P01", message: "terminating connection" } });
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed });
  });

  it("answers 503 and touches no database while Supabase is not configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const response = await post(VALID);
    expect(response.status).toBe(503);
    expect(supabase.calls).toEqual([]);
  });

  it("accepts JSON only, refuses an oversized body and malformed JSON", async () => {
    expect((await post("contactName=Sam", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post({ ...VALID, notes: "n".repeat(40_000) })).status).toBe(413);
    const malformed = await post("{not json");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed });
    expect(supabase.calls).toEqual([]);
  });

  it("answers an unexpected failure with the generic copy", async () => {
    cms.getSiteSettings.mockRejectedValueOnce(new Error("boom"));
    const response = await post(VALID);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: ORDER_COPY.outcome.notConfirmed });
  });
});

describe("order dependencies", () => {
  const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://bibo-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture_only" };
  const request = () => new Request("http://127.0.0.1:3000/api/orders", { method: "POST", headers: { "x-forwarded-for": CLIENT_IP } });
  const ON = { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: false };

  beforeEach(() => {
    cms.consentVersion = "2026-10.v1";
    cms.orderConsentCopy = "I am an adult and agree to the order terms.";
    cms.orderConsentVersion = "order-2026-10";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("reads the gate from the CMS settings it is given", async () => {
    const deps = await createOrderDependencies(request(), ON, {});
    expect([deps.commerceEnabled, deps.trackingEnabled]).toEqual([true, false]);
    const off = await createOrderDependencies(request(), SAFE_FALLBACK_SETTINGS, {});
    expect([off.commerceEnabled, off.trackingEnabled]).toEqual([false, false]);
  });

  it("wires storage and the shared limiter only with an address-hashing secret of at least 32 characters", async () => {
    const short = await createOrderDependencies(request(), ON, { ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(31) });
    expect([short.repository, short.rateLimiter]).toEqual([null, null]);
    const wired = await createOrderDependencies(request(), ON, { ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(32) });
    expect(wired.repository).not.toBeNull();
    expect(wired.rateLimiter).not.toBeNull();
    expect(wired.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(wired.clientKey).not.toContain(CLIENT_IP);
  });

  it("attempts the queued emails after the answer only with storage and email configured (R88)", async () => {
    const RESEND = { RESEND_API_KEY: "re_fixture_only", RESEND_FROM: "BIBO Bay <hello@bibobay.example>" };
    expect((await createOrderDependencies(request(), ON, {})).sendQueuedEmails).toBeNull();
    expect((await createOrderDependencies(request(), ON, { ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(32) })).sendQueuedEmails).toBeNull();
    expect((await createOrderDependencies(request(), ON, RESEND)).sendQueuedEmails).toBeNull();
    const wired = await createOrderDependencies(request(), ON, { ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(32), ...RESEND });
    expect(typeof wired.sendQueuedEmails).toBe("function");
    expect(typeof wired.runAfterResponse).toBe("function");
  });

  it("builds the tracking adapters from request headers alone, as a server page has them (review Minor 7)", () => {
    const headers = new Headers({ "x-forwarded-for": CLIENT_IP });
    const deps = createTrackingDependencies(headers, { ...ON, trackingEnabled: true }, { ...SUPABASE, LEAD_IP_HASH_SECRET: "s".repeat(32) });
    expect(deps.enabled).toBe(true);
    expect(deps.repository).not.toBeNull();
    expect(deps.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.clientKey).not.toContain(CLIENT_IP);
  });

  it("records the order form's CMS consent version, never the signup's (R82)", async () => {
    expect((await createOrderDependencies(request(), ON, {})).consentVersion).toBe("order-2026-10");
  });

  it("falls back to the repository order version, logging a code without the value, when the CMS version cannot be stored", async () => {
    cms.orderConsentVersion = "version two";
    const deps = await createOrderDependencies(request(), ON, {});
    expect(deps.consentVersion).toBe(SAFE_FALLBACK_LEGAL.orderConsentCopyVersion);
    const lines = vi.mocked(console.warn).mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([JSON.stringify({ scope: "orders", event: "order_config_invalid", code: "consent_version_invalid" })]);
  });

  it("passes on the countries the CMS lists (R85)", async () => {
    expect((await createOrderDependencies(request(), { ...ON, orderCountries: ["PH", "AU"] }, {})).orderCountries).toEqual(["PH", "AU"]);
    expect((await createOrderDependencies(request(), ON, {})).orderCountries).toEqual([]);
  });

  it("gives the order page the sentence that matches the version an order records (R82)", () => {
    const legal = { ...SAFE_FALLBACK_LEGAL, orderConsentCopy: "I agree to the order terms.", orderConsentCopyVersion: "order-3" };
    expect(orderConsentFrom(legal)).toEqual({ copy: "I agree to the order terms.", version: "order-3" });
    // A version the database cannot store: the repository sentence and version, together.
    expect(orderConsentFrom({ ...legal, orderConsentCopyVersion: "version three" })).toEqual({ copy: SAFE_FALLBACK_LEGAL.orderConsentCopy, version: SAFE_FALLBACK_LEGAL.orderConsentCopyVersion });
  });
});
