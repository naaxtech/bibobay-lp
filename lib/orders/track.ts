import "server-only";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { errorCodeOf } from "@/lib/leads/submit";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { OrderStatus } from "./constants";
import { parseTrackingRequest, type TrackingRequest } from "./schema";

/**
 * Order tracking (spec §10 step 11, §11). A buyer finds their order with the private token issued
 * with it, or with its reference AND the email it was placed with. Order matters:
 *
 *   tracking gate → storage configured? → shared rate limit → well-formed request → one lookup
 *
 * Every miss (unknown, expired, malformed, a reference with the wrong email) gets the same answer,
 * so a lookup never tells which references exist; malformed requests never reach the database but
 * still count against the client's budget. The answer is the database's locked payload: reference,
 * status, two timestamps and each line's title, variant, pack and quantity. Never an address,
 * email, name, phone, notes, SKU or price.
 *
 * Task 7b's /orders/[token] page calls `trackOrderByToken` directly with the same dependencies as
 * the API route (lib/orders/dependencies.ts), so the gate and the rate limit apply there too.
 */

export interface TrackedOrderLine {
  title: string;
  variant: string | null;
  pack: string | null;
  quantity: number;
}

export interface TrackedOrder {
  reference: string;
  status: OrderStatus;
  /** ISO timestamps. */
  submittedAt: string;
  statusChangedAt: string;
  lines: TrackedOrderLine[];
}

export interface TrackingRepository {
  /** The order for a current (unexpired) private token, or null. */
  lookupByToken(token: string): Promise<TrackedOrder | null>;
  /** The order with this reference AND this email (both normalised), or null. */
  lookupByReferenceAndEmail(reference: string, email: string): Promise<TrackedOrder | null>;
}

/** Ten lookups per client per ten minutes, shared by every server instance (ruling R79). */
export const ORDER_TRACK_RATE_LIMIT = { scope: "order-track", maxHits: 10, windowSeconds: 600 } as const;

export type TrackingLogEvent =
  | { event: "order_tracked" }
  | { event: "order_track_miss" }
  | { event: "order_tracking_disabled" }
  | { event: "order_track_rate_limited" }
  | { event: "order_track_rate_limit_unavailable"; code: string }
  | { event: "order_track_storage_unconfigured" }
  | { event: "order_track_failed"; code: string };

export interface TrackingDependencies {
  /** Commerce AND tracking switched on in the CMS (lib/commerce/gate.ts `isTrackingEnabled`). */
  enabled: boolean;
  /** Null while Supabase is not configured. */
  repository: TrackingRepository | null;
  /** The shared limiter; null with storage configured fails closed. */
  rateLimiter: RateLimiter | null;
  /** An opaque, keyed hash of the client address; never the address itself. */
  clientKey: string;
  /** Structured, PII-free operational log: never a token, reference or email. */
  log: (event: TrackingLogEvent) => void;
}

export type TrackingResult =
  | { status: 200; body: { ok: true; order: TrackedOrder } }
  | { status: 404 | 429 | 500 | 503; body: { ok: false; message: string }; retryAfterSeconds?: number };

const refused = (status: 404 | 429 | 500 | 503, message: string, retryAfterSeconds?: number): TrackingResult => ({
  status,
  body: { ok: false, message },
  ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
});

/** A tracking request from the API body: `{ token }` or `{ reference, email }`. */
export function trackOrder(input: unknown, dependencies: TrackingDependencies): Promise<TrackingResult> {
  return track(() => parseTrackingRequest(input), dependencies);
}

/** The private-link lookup (the token from `/orders/[token]`). */
export function trackOrderByToken(token: string, dependencies: TrackingDependencies): Promise<TrackingResult> {
  return track(() => parseTrackingRequest({ token }), dependencies);
}

/** The lookup form: a reference with the email the order was placed with. */
export function trackOrderByReferenceAndEmail(input: { reference: string; email: string }, dependencies: TrackingDependencies): Promise<TrackingResult> {
  return track(() => parseTrackingRequest({ reference: input.reference, email: input.email }), dependencies);
}

async function track(read: () => TrackingRequest | null, dependencies: TrackingDependencies): Promise<TrackingResult> {
  const { repository, rateLimiter, log } = dependencies;

  if (!dependencies.enabled) {
    log({ event: "order_tracking_disabled" });
    return refused(404, ORDER_COPY.tracking.unavailable);
  }
  if (!repository || !rateLimiter) {
    log({ event: "order_track_storage_unconfigured" });
    return refused(503, ORDER_COPY.tracking.failed);
  }

  try {
    const decision = await rateLimiter.consume(`${ORDER_TRACK_RATE_LIMIT.scope}:${dependencies.clientKey}`, {
      maxHits: ORDER_TRACK_RATE_LIMIT.maxHits,
      windowSeconds: ORDER_TRACK_RATE_LIMIT.windowSeconds,
    });
    if (!decision.allowed) {
      log({ event: "order_track_rate_limited" });
      return refused(429, ORDER_COPY.tracking.rateLimited, decision.retryAfterSeconds);
    }
  } catch (error) {
    log({ event: "order_track_rate_limit_unavailable", code: errorCodeOf(error) });
    return refused(503, ORDER_COPY.tracking.failed);
  }

  const request = read();
  let order: TrackedOrder | null = null;
  if (request) {
    try {
      order = request.kind === "token"
        ? await repository.lookupByToken(request.token)
        : await repository.lookupByReferenceAndEmail(request.reference, request.email);
    } catch (error) {
      log({ event: "order_track_failed", code: errorCodeOf(error) });
      return refused(500, ORDER_COPY.tracking.failed);
    }
  }

  if (!order) {
    log({ event: "order_track_miss" });
    return refused(404, ORDER_COPY.tracking.notFound);
  }
  log({ event: "order_tracked" });
  return { status: 200, body: { ok: true, order } };
}
