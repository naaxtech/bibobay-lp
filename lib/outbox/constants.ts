/**
 * The email outbox's shared vocabulary (Task 8a). The values mirror migration 0006; the static gate
 * tests/outbox/migration-policy.test.ts fails if the two drift apart.
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

/** One cron run (app/api/cron/email-outbox): R88 schedules it once a day on Vercel Hobby. */
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

export const WORKER_LIMITS = {
  /**
   * No new claim after this long from the request's start (review M6), so a last claim plus a send
   * bounded by its timeout ends inside the route's 60-second maximum duration.
   */
  runMs: 40_000,
  /** Most rows one run handles per outbox; the hourly send budget usually stops it first. */
  maxRowsPerChannel: 100,
} as const;
