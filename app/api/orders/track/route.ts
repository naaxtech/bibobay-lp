import { ORDER_COPY } from "@/components/forms/order-copy";
import { CommerceDisabledError, assertCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { reportError } from "@/lib/observability/report";
import { createTrackingDependencies } from "@/lib/orders/dependencies";
import { trackOrder, type TrackingResult } from "@/lib/orders/track";
import { getSiteSettings } from "@/lib/sanity/fetch";

/**
 * POST /api/orders/track: find an order by `{ token }` or `{ reference, email }` (spec §10 step 11;
 * Task 7a).
 *
 * Commerce AND tracking must be switched on in the CMS; otherwise every request gets the same 404
 * and nothing else happens. Found: `{ ok: true, order }` with the locked payload (reference, status,
 * timestamps, line titles, variants, packs and quantities). Every miss, whatever the reason:
 * the same 404 `{ ok: false, message }`.
 *
 * Statuses: 200 found · 400 unreadable body · 404 not found or tracking off · 413 too large ·
 * 415 not JSON · 429 rate limited · 500 lookup failed · 503 storage or limiter unavailable.
 */
export const runtime = "nodejs";

/** A token or a reference with an email is well under 1 KB. */
const TRACK_BODY_LIMIT_BYTES = 2 * 1024;

const NO_STORE = { "cache-control": "no-store" } as const;

function respond(status: number, body: TrackingResult["body"], retryAfterSeconds?: number) {
  return Response.json(body, {
    status,
    headers: retryAfterSeconds && retryAfterSeconds > 0 ? { ...NO_STORE, "retry-after": String(Math.ceil(retryAfterSeconds)) } : NO_STORE,
  });
}

const refusal = (status: number, message: string) => respond(status, { ok: false, message });

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    reportError(error, { area: "orders", event: "order_track_route_failed" });
    return refusal(500, ORDER_COPY.tracking.failed);
  }
}

async function handle(request: Request) {
  const settings = await getSiteSettings();
  try {
    assertCommerceEnabled(settings);
  } catch (error) {
    if (error instanceof CommerceDisabledError) return refusal(404, ORDER_COPY.tracking.unavailable);
    throw error;
  }
  if (!isTrackingEnabled(settings)) return refusal(404, ORDER_COPY.tracking.unavailable);

  if (!isJsonRequest(request)) return refusal(415, ORDER_COPY.tracking.failed);
  const body = await readBodyWithLimit(request, TRACK_BODY_LIMIT_BYTES);
  if (!body.ok) return refusal(body.reason === "too_large" ? 413 : 400, ORDER_COPY.tracking.failed);

  let input: unknown;
  try {
    input = JSON.parse(body.text);
  } catch {
    return refusal(400, ORDER_COPY.tracking.failed);
  }

  const result = await trackOrder(input, createTrackingDependencies(request, settings));
  return respond(result.status, result.body, "retryAfterSeconds" in result ? result.retryAfterSeconds : undefined);
}
