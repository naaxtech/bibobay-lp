import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY } from "@/components/forms/order-copy";
import {
  ORDER_TRACK_RATE_LIMIT,
  trackOrder,
  trackOrderByReferenceAndEmail,
  trackOrderByToken,
  type TrackedOrder,
  type TrackingDependencies,
  type TrackingLogEvent,
  type TrackingRepository,
} from "@/lib/orders/track";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { RpcError, type RpcClient } from "@/lib/supabase/rpc";

vi.mock("server-only", () => ({}));

const cms = vi.hoisted(() => {
  const state = { settings: { commerceEnabled: true, trackingEnabled: true } as Record<string, unknown> };
  return Object.assign(state, {
    getSiteSettings: vi.fn(async () => ({ ...(await import("@/lib/content/fallback")).SAFE_FALLBACK_SETTINGS, ...state.settings })),
    getLegalSettings: vi.fn(async () => (await import("@/lib/content/fallback")).SAFE_FALLBACK_LEGAL),
    getOrderableProducts: vi.fn(async () => []),
  });
});
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings: cms.getSiteSettings, getLegalSettings: cms.getLegalSettings, getOrderableProducts: cms.getOrderableProducts }));

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

import { POST } from "@/app/api/orders/track/route";
import { createSupabaseOrderRepository } from "@/lib/supabase/orders";

/*
 * Order tracking (spec §10 step 11, §11): a private token, or a reference plus the email the order
 * was placed with. One locked, minimal payload; one generic answer for every miss, so a lookup can
 * never tell which references exist; a shared per-client rate limit; and, while commerce or
 * tracking is off, no work at all.
 */

const TOKEN = "cd".repeat(32);
const REFERENCE = "BB-1A2B-3C4D";
const CLIENT_IP = "203.0.113.9";
const HASH_SECRET = "fixture-hash-secret-0123456789abcdef";

const ORDER: TrackedOrder = {
  reference: REFERENCE,
  status: "confirmed",
  submittedAt: "2026-10-16T01:02:03.000Z",
  statusChangedAt: "2026-10-17T04:05:06.000Z",
  lines: [
    { title: "Tula plush", variant: "Large", pack: "Single", quantity: 2 },
    { title: "Bob book", variant: null, pack: null, quantity: 1 },
  ],
};

/** The database payload for ORDER, as lookup_order_by_* return it. */
const PAYLOAD = {
  reference: REFERENCE,
  status: "confirmed",
  submittedAt: "2026-10-16T01:02:03+00:00",
  statusChangedAt: "2026-10-17T04:05:06+00:00",
  lines: [
    { title: "Tula plush", variant: "Large", pack: "Single", quantity: 2 },
    { title: "Bob book", variant: null, pack: null, quantity: 1 },
  ],
};

/** One stored order, found only by its exact token or its reference with its email. */
function fakeRepository(failure?: Error) {
  const calls: string[] = [];
  const repository: TrackingRepository = {
    async lookupByToken(token) {
      calls.push("token");
      if (failure) throw failure;
      return token === TOKEN ? ORDER : null;
    },
    async lookupByReferenceAndEmail(reference, email) {
      calls.push("reference");
      if (failure) throw failure;
      return reference === REFERENCE && email === "parent@example.com" ? ORDER : null;
    },
  };
  return { repository, calls };
}

const allowAll: RateLimiter = { async consume() { return { allowed: true, remaining: 9, retryAfterSeconds: 0 }; } };

function deps(overrides: Partial<TrackingDependencies> = {}) {
  const events: TrackingLogEvent[] = [];
  const repo = fakeRepository();
  const dependencies: TrackingDependencies = {
    enabled: true,
    repository: repo.repository,
    rateLimiter: allowAll,
    clientKey: "client-hash",
    log: (event) => events.push(event),
    ...overrides,
  };
  return { dependencies, events, calls: repo.calls };
}

const NOT_FOUND = { status: 404, body: { ok: false, message: ORDER_COPY.tracking.notFound } };

describe("the commerce and tracking gate", () => {
  it("answers every lookup with the same 404 while tracking is off, and does no work", async () => {
    const consume = vi.fn(allowAll.consume);
    const { dependencies, calls } = deps({ enabled: false, rateLimiter: { consume } });
    const unavailable = { status: 404, body: { ok: false, message: ORDER_COPY.tracking.unavailable } };
    expect(await trackOrder({ token: TOKEN }, dependencies)).toEqual(unavailable);
    expect(await trackOrderByToken(TOKEN, dependencies)).toEqual(unavailable);
    expect(await trackOrderByReferenceAndEmail({ reference: REFERENCE, email: "parent@example.com" }, dependencies)).toEqual(unavailable);
    expect(consume).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("finding an order", () => {
  it("finds it by its private token", async () => {
    const { dependencies } = deps();
    expect(await trackOrderByToken(TOKEN, dependencies)).toEqual({ status: 200, body: { ok: true, order: ORDER } });
    expect(await trackOrder({ token: TOKEN }, dependencies)).toEqual({ status: 200, body: { ok: true, order: ORDER } });
  });

  it("finds it by its reference with the email it was placed with, in any case and spacing", async () => {
    const { dependencies } = deps();
    expect(await trackOrder({ reference: " bb-1a2b-3c4d ", email: " Parent@Example.COM " }, dependencies)).toEqual({ status: 200, body: { ok: true, order: ORDER } });
    expect(await trackOrderByReferenceAndEmail({ reference: "bb-1a2b-3c4d", email: "PARENT@example.com" }, dependencies)).toEqual({ status: 200, body: { ok: true, order: ORDER } });
  });

  it.each([
    ["an unknown token", { token: "ef".repeat(32) }],
    ["a malformed token", { token: "not-a-token" }],
    ["a reference with another email", { reference: REFERENCE, email: "other@example.com" }],
    ["an unknown reference", { reference: "BB-0000-0000", email: "parent@example.com" }],
    ["a reference alone", { reference: REFERENCE }],
    ["an email alone", { email: "parent@example.com" }],
    ["a malformed reference", { reference: "ORDER-1", email: "parent@example.com" }],
    ["a request with an extra key", { token: TOKEN, include: "address" }],
    ["something that is not an object", "BB-1A2B-3C4D"],
  ])("answers %s exactly like every other miss", async (_case, input) => {
    const { dependencies } = deps();
    expect(await trackOrder(input, dependencies)).toEqual(NOT_FOUND);
  });

  it("answers the direct token and reference lookups' misses the same way", async () => {
    const { dependencies } = deps();
    expect(await trackOrderByToken("ef".repeat(32), dependencies)).toEqual(NOT_FOUND);
    expect(await trackOrderByToken("../etc", dependencies)).toEqual(NOT_FOUND);
    expect(await trackOrderByReferenceAndEmail({ reference: REFERENCE, email: "other@example.com" }, dependencies)).toEqual(NOT_FOUND);
    expect(await trackOrderByReferenceAndEmail({ reference: REFERENCE, email: "x" }, dependencies)).toEqual(NOT_FOUND);
  });

  it("never asks the database about a malformed request", async () => {
    const { dependencies, calls } = deps();
    await trackOrder({ token: "short" }, dependencies);
    await trackOrder({ reference: REFERENCE }, dependencies);
    expect(calls).toEqual([]);
  });

  it("logs event names only: never a token, reference or email", async () => {
    const { dependencies, events } = deps();
    await trackOrder({ token: TOKEN }, dependencies);
    await trackOrder({ reference: REFERENCE, email: "other@example.com" }, dependencies);
    expect(events).toEqual([{ event: "order_tracked" }, { event: "order_track_miss" }]);
    expect(JSON.stringify(events)).not.toMatch(/cdcd|BB-|example\.com/);
  });
});

describe("limits and failures", () => {
  it("counts every lookup, found or not, in the client's own tracking bucket, and answers 429 past the limit", async () => {
    const limiter = createMemoryRateLimiter();
    const consume = vi.spyOn(limiter, "consume");
    const { dependencies, calls } = deps({ rateLimiter: limiter });
    for (let attempt = 0; attempt < ORDER_TRACK_RATE_LIMIT.maxHits; attempt += 1) await trackOrder(attempt % 2 ? { token: TOKEN } : { token: "bad" }, dependencies);
    const refused = await trackOrder({ token: TOKEN }, dependencies);
    expect(refused).toEqual({ status: 429, body: { ok: false, message: ORDER_COPY.tracking.rateLimited }, retryAfterSeconds: expect.any(Number) });
    expect(consume).toHaveBeenLastCalledWith("order-track:client-hash", { maxHits: 10, windowSeconds: 600 });
    expect(calls).toHaveLength(ORDER_TRACK_RATE_LIMIT.maxHits / 2);
  });

  it("fails closed when the shared limiter cannot be reached", async () => {
    const { dependencies, calls, events } = deps({ rateLimiter: { consume: async () => { throw new RpcError("consume_rate_limit", "57P01"); } } });
    expect(await trackOrder({ token: TOKEN }, dependencies)).toEqual({ status: 503, body: { ok: false, message: ORDER_COPY.tracking.failed } });
    expect(calls).toEqual([]);
    expect(events).toContainEqual({ event: "order_track_rate_limit_unavailable", code: "57P01" });
  });

  it("answers 503 while storage is not configured", async () => {
    const { dependencies } = deps({ repository: null, rateLimiter: null });
    expect(await trackOrder({ token: TOKEN }, dependencies)).toEqual({ status: 503, body: { ok: false, message: ORDER_COPY.tracking.failed } });
  });

  it("says tracking failed, not that the order does not exist, when the database fails", async () => {
    const repo = fakeRepository(new RpcError("lookup_order_by_token", "57P01"));
    const { dependencies, events } = deps({ repository: repo.repository });
    expect(await trackOrder({ token: TOKEN }, dependencies)).toEqual({ status: 500, body: { ok: false, message: ORDER_COPY.tracking.failed } });
    expect(events).toContainEqual({ event: "order_track_failed", code: "57P01" });
  });
});

describe("Supabase tracking lookups", () => {
  function client(answer: { data: unknown; error: { code?: string; message: string } | null }) {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const rpc: RpcClient = { rpc: (fn, args) => { calls.push([fn, args]); return Promise.resolve(answer); } };
    return { rpc, calls };
  }

  it("looks an order up by token through lookup_order_by_token, and reads its locked payload", async () => {
    const { rpc, calls } = client({ data: PAYLOAD, error: null });
    expect(await createSupabaseOrderRepository(rpc).lookupByToken(TOKEN)).toEqual(ORDER);
    expect(calls).toEqual([["lookup_order_by_token", { p_token: TOKEN }]]);
  });

  it("looks an order up by reference and email through lookup_order_by_reference_email", async () => {
    const { rpc, calls } = client({ data: PAYLOAD, error: null });
    expect(await createSupabaseOrderRepository(rpc).lookupByReferenceAndEmail(REFERENCE, "parent@example.com")).toEqual(ORDER);
    expect(calls).toEqual([["lookup_order_by_reference_email", { p_reference: REFERENCE, p_email: "parent@example.com" }]]);
  });

  it("reads the database's single null as not found", async () => {
    const { rpc } = client({ data: null, error: null });
    expect(await createSupabaseOrderRepository(rpc).lookupByToken(TOKEN)).toBeNull();
    expect(await createSupabaseOrderRepository(rpc).lookupByReferenceAndEmail(REFERENCE, "parent@example.com")).toBeNull();
  });

  it("passes on only the locked keys, even if the database ever returned more", async () => {
    const leaky = { ...PAYLOAD, email: "parent@example.com", addressLine1: "12 Harbour Road", subtotalMinor: 4900, lines: PAYLOAD.lines.map((line) => ({ ...line, sku: "BB-TULA-01", sanityId: "product-tula" })) };
    const { rpc } = client({ data: leaky, error: null });
    const order = await createSupabaseOrderRepository(rpc).lookupByToken(TOKEN);
    expect(order).toEqual(ORDER);
    expect(JSON.stringify(order)).not.toMatch(/example\.com|Harbour|4900|BB-TULA|product-tula/);
  });

  it.each([
    ["an unknown status", { ...PAYLOAD, status: "shipped" }],
    ["a malformed reference", { ...PAYLOAD, reference: "ORDER-1" }],
    ["a missing timestamp", { ...PAYLOAD, submittedAt: null }],
    ["no lines", { ...PAYLOAD, lines: null }],
    ["a line without a title", { ...PAYLOAD, lines: [{ variant: null, pack: null, quantity: 1 }] }],
    ["a zero quantity", { ...PAYLOAD, lines: [{ title: "Tula", variant: null, pack: null, quantity: 0 }] }],
    ["a list instead of an object", [PAYLOAD]],
  ])("treats a payload with %s as a failed lookup", async (_case, data) => {
    const { rpc } = client({ data, error: null });
    await expect(createSupabaseOrderRepository(rpc).lookupByToken(TOKEN)).rejects.toMatchObject({ code: "bad_response" });
  });

  it("throws a value-free error when the database refuses", async () => {
    const { rpc } = client({ data: null, error: { code: "42501", message: "permission denied for parent@example.com" } });
    const error = await createSupabaseOrderRepository(rpc).lookupByToken(TOKEN).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("lookup_order_by_token failed (42501)");
  });

  it("rotates a tracking token through rotate_order_tracking_token, for staff and the Task 8 worker", async () => {
    const orderId = "6c1f7f8e-3a52-4b7e-9e3a-2f1d0c9b8a71";
    const { rpc, calls } = client({ data: [{ tracking_token: TOKEN, tracking_token_expires_at: "2027-04-14T00:00:00+00:00" }], error: null });
    expect(await createSupabaseOrderRepository(rpc).rotateTrackingToken(orderId)).toEqual({ trackingToken: TOKEN, trackingTokenExpiresAt: "2027-04-14T00:00:00.000Z" });
    expect(calls).toEqual([["rotate_order_tracking_token", { p_order_id: orderId }]]);
    const bad = client({ data: [{ tracking_token: "short", tracking_token_expires_at: "x" }], error: null });
    await expect(createSupabaseOrderRepository(bad.rpc).rotateTrackingToken(orderId)).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("POST /api/orders/track", () => {
  function post(body: unknown, headers: Record<string, string> = {}) {
    return POST(new Request("http://127.0.0.1:3000/api/orders/track", {
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
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://bibo-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_fixture_only");
    vi.stubEnv("LEAD_IP_HASH_SECRET", HASH_SECRET);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    supabase.answers.consume_rate_limit = () => ({ data: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }], error: null });
    supabase.answers.lookup_order_by_token = (args) => ({ data: args.p_token === TOKEN ? PAYLOAD : null, error: null });
    supabase.answers.lookup_order_by_reference_email = (args) => ({ data: args.p_reference === REFERENCE && args.p_email === "parent@example.com" ? PAYLOAD : null, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["commerce is off", { commerceEnabled: false, trackingEnabled: true }],
    ["tracking is off", { commerceEnabled: true, trackingEnabled: false }],
  ])("answers 404 and touches no database while %s", async (_case, settings) => {
    cms.settings = settings;
    for (const body of [{ token: TOKEN }, "{not json"]) {
      const response = await post(body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ ok: false, message: ORDER_COPY.tracking.unavailable });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(supabase.createClient).not.toHaveBeenCalled();
  });

  it("limits the client, then finds the order by its token through service-role RPCs", async () => {
    const response = await post({ token: TOKEN });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, order: ORDER });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(supabase.calls).toEqual([
      ["consume_rate_limit", { bucket_key: expect.stringMatching(/^order-track:[0-9a-f]{64}$/), max_hits: 10, window_seconds: 600 }],
      ["lookup_order_by_token", { p_token: TOKEN }],
    ]);
    expect(JSON.stringify(supabase.calls)).not.toContain(CLIENT_IP);
  });

  it("finds the order by its reference with the matching email, normalised", async () => {
    const response = await post({ reference: "bb-1a2b-3c4d", email: "Parent@Example.com" });
    expect(response.status).toBe(200);
    expect(supabase.calls[1]).toEqual(["lookup_order_by_reference_email", { p_reference: REFERENCE, p_email: "parent@example.com" }]);
  });

  it("answers every miss with the same 404", async () => {
    const bodies = [{ token: "ef".repeat(32) }, { reference: REFERENCE, email: "other@example.com" }, { reference: REFERENCE }, { token: "x" }];
    const answers = await Promise.all(bodies.map(async (body) => {
      const response = await post(body);
      return { status: response.status, body: await response.json() };
    }));
    for (const answer of answers) expect(answer).toEqual({ status: 404, body: { ok: false, message: ORDER_COPY.tracking.notFound } });
  });

  it("answers 429 with Retry-After once the client's lookups are spent", async () => {
    supabase.answers.consume_rate_limit = () => ({ data: [{ allowed: false, remaining: 0, retry_after_seconds: 300 }], error: null });
    const response = await post({ token: TOKEN });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(supabase.calls.map(([fn]) => fn)).toEqual(["consume_rate_limit"]);
  });

  it("answers 503 while Supabase is not configured", async () => {
    vi.stubEnv("LEAD_IP_HASH_SECRET", "");
    const response = await post({ token: TOKEN });
    expect(response.status).toBe(503);
    expect(supabase.calls).toEqual([]);
  });

  it("accepts JSON only, refuses an oversized body and malformed JSON", async () => {
    expect((await post("token=abc", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post({ token: "a".repeat(10_000) })).status).toBe(413);
    const malformed = await post("{not json");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, message: ORDER_COPY.tracking.failed });
    expect(supabase.calls).toEqual([]);
  });

  it("answers an unexpected failure with the generic copy", async () => {
    cms.getSiteSettings.mockRejectedValueOnce(new Error("boom"));
    const response = await post({ token: TOKEN });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, message: ORDER_COPY.tracking.failed });
  });
});
