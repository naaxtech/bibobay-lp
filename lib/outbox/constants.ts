/**
 * The email outbox's shared vocabulary (Task 8a). The values mirror migration 0006; the static gate
 * tests/outbox/migration-policy.test.ts fails if the two drift apart. The contact outbox's kind
 * mirrors migration 0008, pinned by tests/contact/migration-policy.test.ts.
 */

/** Every status an outbox row can have. `skipped` is final: the claim refused to send it (R92). */
export const OUTBOX_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** The two signup messages (migration 0001). */
export const LEAD_DELIVERY_KINDS = ["acknowledgement", "staff_alert"] as const;
export type LeadDeliveryKind = (typeof LEAD_DELIVERY_KINDS)[number];

/** The order messages; quotes are queued by the staff side (Task 8b). */
export const ORDER_EMAIL_KINDS = ["acknowledgement", "staff_alert", "quote"] as const;
export type OrderEmailKind = (typeof ORDER_EMAIL_KINDS)[number];

/**
 * The contact form's one message (migration 0008). Ruling R169: it has an outbox of its own,
 * `contact_message_deliveries`, and is not a kind of the lead outbox.
 */
export const CONTACT_DELIVERY_KINDS = ["contact_staff_alert"] as const;
export type ContactDeliveryKind = (typeof CONTACT_DELIVERY_KINDS)[number];

/** The three outboxes, as an attempt channel names itself (lib/outbox/attempt.ts). */
export type OutboxName = "leads" | "orders" | "contact";

/**
 * Fix wave D-I1: one hourly send budget per message kind, so no kind can starve another. Each is
 * its own bucket in the shared rate limiter (`consume_rate_limit`), keyed `send:<budget>`, and each
 * is capped at `LEAD_ACK_SEND_LIMIT_PER_HOUR` per hour (default 60, lib/leads/dependencies.ts):
 *
 *   send:lead_acknowledgement   the signup acknowledgement (public form)
 *   send:lead_staff_alert       the signup staff alert (public form)
 *   send:order_acknowledgement  the order acknowledgement (public form)
 *   send:order_staff_alert      the order staff alert (public form)
 *   send:quote                  the quote email (queued only by active, audited staff)
 *   send:contact_staff_alert    the contact staff alert (public form)
 *
 * Both send paths and the cron worker spend the bucket of the row's own kind, so a flood of signups
 * from fresh addresses spends the two signup buckets and nothing else: order emails, staff quotes
 * and contact alerts keep their own hour. Replaces the single shared `ack-send:global` bucket of
 * ruling R40. The contact alert's own bucket is ruling R170.
 */
export const SEND_BUDGETS = {
  leads: { acknowledgement: "lead_acknowledgement", staff_alert: "lead_staff_alert" },
  orders: { acknowledgement: "order_acknowledgement", staff_alert: "order_staff_alert", quote: "quote" },
  contact: { contact_staff_alert: "contact_staff_alert" },
} as const satisfies { leads: Record<LeadDeliveryKind, string>; orders: Record<OrderEmailKind, string>; contact: Record<ContactDeliveryKind, string> };
export type SendBudget =
  | (typeof SEND_BUDGETS.leads)[LeadDeliveryKind]
  | (typeof SEND_BUDGETS.orders)[OrderEmailKind]
  | (typeof SEND_BUDGETS.contact)[ContactDeliveryKind];

/** The budget a row of this kind spends in this outbox; null for a kind the outbox does not have. */
export function sendBudgetFor(outbox: OutboxName, kind: string): SendBudget | null {
  const budgets: Readonly<Record<string, SendBudget>> = SEND_BUDGETS[outbox];
  return Object.hasOwn(budgets, kind) ? budgets[kind]! : null;
}

/** The shared limiter's bucket for one budget. */
export const sendBudgetKey = (budget: SendBudget): `send:${SendBudget}` => `send:${budget}`;

export const OUTBOX_LIMITS = {
  /** Most rows one claim may take. */
  maxClaim: 50,
  /** A failure on this attempt is final (next_attempt_at 'infinity'). */
  maxAttempts: 8,
  /** A row still `sending` after this long is claimed again under the same idempotency key (R91). */
  staleSendingMinutes: 15,
  /**
   * An unconfirmed send is retried only within this many hours of the attempt that made it
   * unconfirmed: the provider keeps an idempotency key for 24 hours (R91).
   */
  idempotencyWindowHours: 23,
} as const;

/**
 * A failure with one of these codes is final at any attempt (next_attempt_at 'infinity'):
 * the provider already holds this idempotency key with another message (migration 0006 record
 * functions; pinned by tests/outbox/migration-policy.test.ts).
 */
export const OUTBOX_FINAL_FAILURE_CODES = ["invalid_idempotent_request"] as const;

/**
 * Failure codes that are an answer: nothing was accepted, so a retry cannot deliver twice (review
 * M3). Resend 6.32.1's refusals plus our own `message_invalid`. Every other code (timeouts,
 * exceptions, server errors, in-progress and unknown codes) leaves the send unconfirmed, bounded
 * by the idempotency window. Mirrors migration 0006 `outbox_failure_unconfirmed` (pinned by a test).
 */
export const PROVIDER_REFUSAL_CODES = [
  "invalid_idempotency_key",
  "validation_error",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
  "method_not_allowed",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
  "rate_limit_exceeded",
  "security_error",
  "message_invalid",
] as const;

/** One cron run (app/api/cron/email-outbox): ruling R180 schedules it once a day (see vercel.json) on the Hobby plan; a Pro plan would allow the 15-minute schedule of R134 back. */
export const WORKER_LIMITS = {
  /**
   * No new claim after this long from the request's start (review M6), so a last claim plus a send
   * bounded by its timeout ends inside the route's 60-second maximum duration.
   */
  runMs: 40_000,
  /** Most rows one run handles per outbox; the hourly send budget usually stops it first. */
  maxRowsPerChannel: 100,
} as const;
