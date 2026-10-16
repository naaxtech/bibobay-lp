import "server-only";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { errorCodeOf } from "@/lib/leads/submit";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { CanonicalLinesResult, CanonicalOrderLine } from "./catalogue";
import { orderCountryCodes } from "./countries";
import type { OrderPadLine } from "./pad";
import { isHoneypotFilled, validateOrderSubmission, type OrderFieldErrors } from "./schema";

/**
 * Order request orchestration (spec §10 steps 4-7). Order matters and is the whole point:
 *
 *   commerce gate → honeypot → validation (and the CMS country list) → storage configured? → shared rate limit
 *   → canonical CMS reload of every product → one atomic write → answer
 *
 * The gate comes first and, while commerce is off, nothing else runs: no database, no CMS read.
 * The browser sends product ids and quantities only; names, SKUs, variants and packs come from the
 * published CMS (./catalogue.ts). `submit_order` stores the order, its lines, its audit event and
 * the two outbox rows (buyer acknowledgement, staff alert) in one transaction, so the answer says
 * the order was received only once all of it committed (no fake success), and
 * `acknowledgementQueued` mirrors what the database reports. Nothing is sent before the answer:
 * once it has gone out, the two queued emails are attempted through the outbox's shared claim
 * (Task 8a, R88), and the cron worker retries what is left. Every refusal is generic and never
 * names a product.
 *
 * Ruling R81: the form sends one random submission key per order attempt and the same key on every
 * retry. A retry of a request that was stored (its answer lost on the way) gets the first order's
 * reference back and stores nothing new; no tracking token comes with it, because the first one
 * exists only as a hash.
 */

/** Exactly what is stored for an order: adult details, the server's consent version, canonical lines. */
export interface OrderRecordInput {
  contactName: string;
  email: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  notes?: string;
  consentVersion: string;
  /** The form's key for this order attempt (R81). */
  submissionKey: string;
  lines: CanonicalOrderLine[];
}

export type StoredOrder =
  | {
      orderId: string;
      reference: string;
      /** The private tracking token; it exists outside a hash only in this answer. */
      trackingToken: string;
      trackingTokenExpiresAt: string;
      acknowledgementQueued: boolean;
      duplicate: false;
    }
  | {
      /** A repeated submission key (R81): the first order, nothing new stored, no token, nothing queued. */
      orderId: string;
      reference: string;
      trackingToken: null;
      trackingTokenExpiresAt: null;
      acknowledgementQueued: false;
      duplicate: true;
    };

export interface OrderRepository {
  /** Stores the order atomically; resolves only once it committed. */
  submitOrder(record: OrderRecordInput): Promise<StoredOrder>;
}

/** Five order requests per client per hour, shared by every server instance (ruling R79). */
export const ORDER_RATE_LIMIT = { scope: "order", maxHits: 5, windowSeconds: 3600 } as const;

export type OrderLogEvent =
  | { event: "order_stored"; lines: number }
  /** A retry of a request already stored (R81): the customer's connection, not a fault. */
  | { event: "order_duplicate" }
  | { event: "order_store_failed"; code: string }
  | { event: "order_commerce_disabled" }
  | { event: "order_honeypot" }
  | { event: "order_storage_unconfigured" }
  | { event: "order_rate_limited" }
  | { event: "order_rate_limit_unavailable"; code: string }
  /** The customer asked for a product that is not (or no longer) listed: their choice, not a fault. */
  | { event: "order_products_refused" }
  | { event: "order_catalogue_invalid" }
  | { event: "order_catalogue_unavailable" }
  | { event: "order_config_invalid"; code: "consent_version_invalid" };

export interface OrderSubmissionDependencies {
  /** The CMS commerce switch; anything but true refuses every order before any work. */
  commerceEnabled: boolean;
  /** The CMS tracking switch: the private tracking token is only handed out while tracking exists. */
  trackingEnabled: boolean;
  /** Null while Supabase is not configured: nothing can be stored, so nothing is accepted. */
  repository: OrderRepository | null;
  /** The shared limiter. Null with storage configured is a misconfiguration and fails closed. */
  rateLimiter: RateLimiter | null;
  /** The canonical CMS reload (./catalogue.ts). */
  resolveLines: (lines: OrderPadLine[]) => Promise<CanonicalLinesResult>;
  /** The order form's consent version from CMS legal settings (R82); never taken from the request. */
  consentVersion: string;
  /** R85: the CMS list of countries an order may name; empty means every assigned country code. */
  orderCountries: readonly string[];
  /** An opaque, keyed hash of the client address (lib/leads/http.ts); never the address itself. */
  clientKey: string;
  /** Structured, PII-free operational log. */
  log: (event: OrderLogEvent) => void;
  /**
   * Task 8a (R88): attempts the stored order's queued emails (the buyer acknowledgement and the
   * staff alert) through the outbox's shared claim, so the cron worker can never send them too.
   * Null or absent while storage or email is unconfigured: the rows wait for the worker.
   */
  sendQueuedEmails?: ((orderId: string) => Promise<void>) | null;
  /** Runs work once the answer has gone out (the route passes `after()` from next/server). */
  runAfterResponse?: (task: () => Promise<void>) => void;
}

export interface OrderApiBody {
  ok: boolean;
  persisted: boolean;
  acknowledgementQueued: boolean;
  message: string;
  fieldErrors?: OrderFieldErrors;
  /** Present only once the order is stored. */
  reference?: string;
  /** True when this request was a retry of one already stored (R81); never with a token. */
  duplicate?: true;
  /** Present only once the order is stored, and only while tracking is switched on. */
  trackingToken?: string;
}

export interface OrderSubmissionResult {
  status: 200 | 400 | 404 | 429 | 500 | 503;
  body: OrderApiBody;
  retryAfterSeconds?: number;
}

const refused = (status: OrderSubmissionResult["status"], message: string, extra: Partial<OrderSubmissionResult> = {}): OrderSubmissionResult => ({
  status,
  body: { ok: false, persisted: false, acknowledgementQueued: false, message },
  ...extra,
});

export async function submitOrder(input: unknown, dependencies: OrderSubmissionDependencies): Promise<OrderSubmissionResult> {
  const { repository, rateLimiter, log } = dependencies;

  // Spec §10 "Server gating": a disabled shop answers the same way whatever is asked of it.
  if (!dependencies.commerceEnabled) {
    log({ event: "order_commerce_disabled" });
    return refused(404, ORDER_COPY.outcome.unavailable);
  }

  // A bot filled the hidden field: a generic refusal; nothing is counted, read or stored.
  if (isHoneypotFilled(input)) {
    log({ event: "order_honeypot" });
    return refused(400, ORDER_COPY.outcome.notConfirmed);
  }

  const validation = validateOrderSubmission(input);
  if (!validation.ok) {
    const hasFieldErrors = Object.keys(validation.fieldErrors).length > 0;
    const result = refused(400, hasFieldErrors ? ORDER_COPY.outcome.checkDetails : ORDER_COPY.outcome.notConfirmed);
    if (hasFieldErrors) result.body.fieldErrors = validation.fieldErrors;
    return result;
  }
  // R85: the form lists only these countries, so another one is a field the visitor can correct.
  if (!orderCountryCodes(dependencies.orderCountries).includes(validation.data.country)) {
    const result = refused(400, ORDER_COPY.outcome.checkDetails);
    result.body.fieldErrors = { country: "invalid" };
    return result;
  }

  if (!repository || !rateLimiter) {
    log({ event: "order_storage_unconfigured" });
    return refused(503, ORDER_COPY.outcome.busy);
  }

  try {
    const decision = await rateLimiter.consume(`${ORDER_RATE_LIMIT.scope}:${dependencies.clientKey}`, {
      maxHits: ORDER_RATE_LIMIT.maxHits,
      windowSeconds: ORDER_RATE_LIMIT.windowSeconds,
    });
    if (!decision.allowed) {
      log({ event: "order_rate_limited" });
      return refused(429, ORDER_COPY.outcome.rateLimited, { retryAfterSeconds: decision.retryAfterSeconds });
    }
  } catch (error) {
    // Fail closed: without the shared limiter the form could flood the outbox and the staff.
    log({ event: "order_rate_limit_unavailable", code: errorCodeOf(error) });
    return refused(503, ORDER_COPY.outcome.busy);
  }

  const { data } = validation;
  const canonical = await dependencies.resolveLines(data.lines.map(({ productId, quantity }) => ({ productId, quantity })));
  if (!canonical.ok) {
    if (canonical.reason === "catalogue_unavailable") {
      log({ event: "order_catalogue_unavailable" });
      return refused(503, ORDER_COPY.outcome.busy);
    }
    log({ event: canonical.reason === "invalid_product" ? "order_catalogue_invalid" : "order_products_refused" });
    return refused(400, ORDER_COPY.outcome.productsUnavailable);
  }

  const record: OrderRecordInput = {
    contactName: data.contactName,
    email: data.email,
    ...(data.phone ? { phone: data.phone } : {}),
    addressLine1: data.addressLine1,
    ...(data.addressLine2 ? { addressLine2: data.addressLine2 } : {}),
    city: data.city,
    ...(data.region ? { region: data.region } : {}),
    ...(data.postalCode ? { postalCode: data.postalCode } : {}),
    country: data.country,
    ...(data.notes ? { notes: data.notes } : {}),
    consentVersion: dependencies.consentVersion,
    submissionKey: data.submissionKey,
    lines: canonical.lines,
  };

  let stored: StoredOrder;
  try {
    stored = await repository.submitOrder(record);
  } catch (error) {
    log({ event: "order_store_failed", code: errorCodeOf(error) });
    return refused(500, ORDER_COPY.outcome.notConfirmed);
  }

  if (stored.duplicate) {
    log({ event: "order_duplicate" });
    return {
      status: 200,
      body: {
        ok: true,
        persisted: true,
        acknowledgementQueued: false,
        duplicate: true,
        // No tracking page to point at while tracking is off.
        message: dependencies.trackingEnabled ? ORDER_COPY.outcome.alreadyReceived : ORDER_COPY.outcome.alreadyReceivedUntracked,
        reference: stored.reference,
      },
    };
  }
  log({ event: "order_stored", lines: record.lines.length });

  // R88: the two emails submit_order queued are attempted once the answer has gone out. Whatever
  // happens to them is recorded on their outbox rows; it never delays or changes this answer.
  const sendQueuedEmails = dependencies.sendQueuedEmails;
  if (sendQueuedEmails) {
    const { orderId } = stored;
    const task = async () => {
      try {
        await sendQueuedEmails(orderId);
      } catch {
        // Nothing to record here: an unsent row stays due for the outbox worker.
      }
    };
    if (dependencies.runAfterResponse) dependencies.runAfterResponse(task);
    else await task();
  }

  return {
    status: 200,
    body: {
      ok: true,
      persisted: true,
      acknowledgementQueued: stored.acknowledgementQueued,
      message: ORDER_COPY.outcome.received,
      reference: stored.reference,
      ...(dependencies.trackingEnabled ? { trackingToken: stored.trackingToken } : {}),
    },
  };
}
