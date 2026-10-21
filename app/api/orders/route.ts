import { ORDER_COPY } from "@/components/forms/order-copy";
import { CommerceDisabledError, assertCommerceEnabled } from "@/lib/commerce/gate";
import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { reportError } from "@/lib/observability/report";
import { createOrderDependencies } from "@/lib/orders/dependencies";
import { submitOrder, type OrderApiBody } from "@/lib/orders/submit";
import { getGateSettings } from "@/lib/sanity/fetch";

/**
 * POST /api/orders: an order request (spec §10 steps 4-7; Task 7a).
 *
 * The commerce gate runs first: while the CMS keeps commerce off, every request gets the same 404
 * and nothing else happens (no body read, no database, no catalogue or legal read). Otherwise it
 * answers `{ ok, persisted, acknowledgementQueued, message }`, plus `fieldErrors` on a 400 with
 * field problems, and `reference` (and, while tracking is on, the private `trackingToken`) once the
 * order is stored. `persisted: true` only after the database committed the order. No payment is
 * taken and no price is ever returned.
 *
 * Statuses: 200 stored · 400 invalid, honeypot or unavailable products · 403 bot check refused ·
 * 404 commerce off · 413 too large · 415 not JSON · 429 rate limited · 500 write failed · 503 storage, limiter or
 * catalogue unavailable.
 */
export const runtime = "nodejs";
// A siteverify timeout and its retry stay inside this budget; on Hobby without Fluid compute the default is shorter.
// src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md · next 16.3.8 · 2026-10-22
export const maxDuration = 30;

/** Largest order body read. Forty lines and a full address are well under 8 KB. */
const ORDER_BODY_LIMIT_BYTES = 32 * 1024;

const NO_STORE = { "cache-control": "no-store" } as const;

function respond(status: number, body: OrderApiBody, retryAfterSeconds?: number) {
  return Response.json(body, {
    status,
    headers: retryAfterSeconds && retryAfterSeconds > 0 ? { ...NO_STORE, "retry-after": String(Math.ceil(retryAfterSeconds)) } : NO_STORE,
  });
}

const refusal = (status: number, message: string) => respond(status, { ok: false, persisted: false, acknowledgementQueued: false, message });

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    // An unexpected failure goes to Sentry (tags only); the buyer gets the generic copy.
    reportError(error, { area: "orders", event: "order_route_failed" });
    return refusal(500, ORDER_COPY.outcome.notConfirmed);
  }
}

async function handle(request: Request) {
  // Fix wave D-M2 (Ruling R127): the gate's read expires after 300 s even if the webhook never fires.
  const settings = await getGateSettings();
  try {
    assertCommerceEnabled(settings);
  } catch (error) {
    if (error instanceof CommerceDisabledError) return refusal(404, ORDER_COPY.outcome.unavailable);
    throw error;
  }

  if (!isJsonRequest(request)) return refusal(415, ORDER_COPY.outcome.notConfirmed);
  const body = await readBodyWithLimit(request, ORDER_BODY_LIMIT_BYTES);
  if (!body.ok) return refusal(body.reason === "too_large" ? 413 : 400, ORDER_COPY.outcome.notConfirmed);

  let input: unknown;
  try {
    input = JSON.parse(body.text);
  } catch {
    return refusal(400, ORDER_COPY.outcome.notConfirmed);
  }

  const result = await submitOrder(input, await createOrderDependencies(request, settings));
  return respond(result.status, result.body, result.retryAfterSeconds);
}
