import "server-only";

import { RpcError, callRpc, firstRow, type RpcClient } from "@/lib/supabase/rpc";

export type { RpcClient } from "@/lib/supabase/rpc";

export interface RateLimitRule {
  /** How many requests one key may make per window. */
  maxHits: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; 0 while allowed. */
  retryAfterSeconds: number;
}

/**
 * A fixed-window rate limiter keyed by an opaque string (for leads: `lead:<keyed hash of the client
 * address>`; the address itself never reaches a limiter).
 *
 * Ruling R3: production uses the Supabase adapter, so every serverless instance shares one budget
 * (spec §9.3 "shared durable rate limit runs in Supabase, not process memory"). The in-memory
 * adapter is for tests and local experiments only: per instance, it is not a real limit.
 * Task 7 (migration 0005) extends the same table and RPC for orders.
 */
export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

interface MemoryWindow {
  hits: number;
  resetAt: number;
}

export interface MemoryRateLimiterOptions {
  now?: () => number;
  /** Upper bound on remembered keys; expired windows are swept first, then the oldest key goes. */
  maxKeys?: number;
}

/**
 * In-process limiter for tests and local experiments. Not used by the lead route: without Supabase
 * the route stores nothing and answers 503 before any limiter runs, and with Supabase it uses
 * `createSupabaseRateLimiter`. Keep it for unit tests of callers and for Task 7's order tests.
 */
export function createMemoryRateLimiter({ now = Date.now, maxKeys = 5_000 }: MemoryRateLimiterOptions = {}): RateLimiter & { size(): number } {
  const windows = new Map<string, MemoryWindow>();

  const sweep = (time: number) => {
    if (windows.size < maxKeys) return;
    for (const [key, window] of windows) if (window.resetAt <= time) windows.delete(key);
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  };

  return {
    async consume(key, { maxHits, windowSeconds }) {
      const time = now();
      const current = windows.get(key);
      if (!current || current.resetAt <= time) {
        sweep(time);
        windows.set(key, { hits: 1, resetAt: time + windowSeconds * 1000 });
        return { allowed: maxHits >= 1, remaining: Math.max(0, maxHits - 1), retryAfterSeconds: maxHits >= 1 ? 0 : windowSeconds };
      }
      current.hits = Math.min(current.hits + 1, maxHits + 1);
      const allowed = current.hits <= maxHits;
      return {
        allowed,
        remaining: Math.max(0, maxHits - current.hits),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((current.resetAt - time) / 1000)),
      };
    },
    size: () => windows.size,
  };
}

/** The shared limiter: one `consume_rate_limit` RPC per request (service role only; migration 0001). */
export function createSupabaseRateLimiter(client: RpcClient): RateLimiter {
  return {
    async consume(key, { maxHits, windowSeconds }) {
      const data = await callRpc(client, "consume_rate_limit", { bucket_key: key, max_hits: maxHits, window_seconds: windowSeconds });
      const row = firstRow(data);
      const allowed = row?.allowed;
      const remaining = row?.remaining;
      const retryAfter = row?.retry_after_seconds;
      if (typeof allowed !== "boolean" || typeof remaining !== "number" || typeof retryAfter !== "number") {
        throw new RpcError("consume_rate_limit", "bad_response");
      }
      return { allowed, remaining, retryAfterSeconds: retryAfter };
    },
  };
}
