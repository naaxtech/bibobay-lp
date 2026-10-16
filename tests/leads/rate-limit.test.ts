import { describe, expect, it, vi } from "vitest";

import { createMemoryRateLimiter, createSupabaseRateLimiter, type RpcClient } from "@/lib/security/rate-limit";

vi.mock("server-only", () => ({}));

const RULE = { maxHits: 3, windowSeconds: 60 };

describe("in-memory rate limiter (local development and tests only)", () => {
  it("allows the configured number of hits per window, then blocks with a retry time", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter({ now: () => now });
    const results = [];
    for (let hit = 0; hit < 4; hit += 1) results.push(await limiter.consume("lead:a", RULE));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results.map((result) => result.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[3]?.retryAfterSeconds).toBe(60);
    now += 45_000;
    expect(await limiter.consume("lead:a", RULE)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 15 });
  });

  it("starts a fresh window once the old one has passed", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ now: () => now });
    for (let hit = 0; hit < 4; hit += 1) await limiter.consume("lead:a", RULE);
    now += 60_000;
    expect(await limiter.consume("lead:a", RULE)).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  it("keeps separate budgets per key", async () => {
    const limiter = createMemoryRateLimiter();
    for (let hit = 0; hit < 3; hit += 1) await limiter.consume("lead:a", RULE);
    expect((await limiter.consume("lead:a", RULE)).allowed).toBe(false);
    expect((await limiter.consume("lead:b", RULE)).allowed).toBe(true);
  });

  it("evicts expired windows instead of growing without bound", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter({ now: () => now, maxKeys: 10 });
    for (let key = 0; key < 10; key += 1) await limiter.consume(`lead:${key}`, RULE);
    now += 61_000;
    await limiter.consume("lead:new", RULE);
    expect(limiter.size()).toBe(1);
  });
});

function rpcReturning(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push([fn, args]);
      return Promise.resolve(result);
    },
  };
  return { client, calls };
}

describe("Supabase rate limiter (shared across serverless instances)", () => {
  it("consumes one hit through the consume_rate_limit RPC", async () => {
    const { client, calls } = rpcReturning({ data: [{ allowed: true, remaining: 2, retry_after_seconds: 0 }], error: null });
    const result = await createSupabaseRateLimiter(client).consume("lead:abc", RULE);
    expect(calls).toEqual([["consume_rate_limit", { bucket_key: "lead:abc", max_hits: 3, window_seconds: 60 }]]);
    expect(result).toEqual({ allowed: true, remaining: 2, retryAfterSeconds: 0 });
  });

  it("reports a spent budget with the database's retry time", async () => {
    const { client } = rpcReturning({ data: { allowed: false, remaining: 0, retry_after_seconds: 42 }, error: null });
    expect(await createSupabaseRateLimiter(client).consume("lead:abc", RULE)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
  });

  it("throws (so the caller fails closed) when the database errors", async () => {
    const { client } = rpcReturning({ data: null, error: { code: "57014", message: "canceling statement" } });
    await expect(createSupabaseRateLimiter(client).consume("lead:abc", RULE)).rejects.toThrow(/consume_rate_limit/);
  });

  it("throws on an answer it cannot read rather than allowing the request", async () => {
    const { client } = rpcReturning({ data: [{ allowed: "yes" }], error: null });
    await expect(createSupabaseRateLimiter(client).consume("lead:abc", RULE)).rejects.toThrow();
  });
});
