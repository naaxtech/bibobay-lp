import type { EmailMessage, EmailSendResult } from "@/lib/email/client";
import { RpcError } from "@/lib/supabase/rpc";
import { OUTBOX_FINAL_FAILURE_CODES, OUTBOX_LIMITS } from "./constants";
import type { ClaimBatch, ClaimOptions, OutboxOutcome } from "./types";

/**
 * The one attempt step both send paths share (Task 8a; rulings R88, R91, R40):
 *
 *   claim one due row (the outbox's claim function, migration 0006)
 *   → build its message (null: nothing can be sent; recorded as failed `message_invalid`)
 *   → spend one unit of the global send budget (`ack-send:global`); spent or unavailable: the
 *     claim is handed back (`deferred`), so the row stays due and no attempt is counted
 *   → send, bounded by a timeout, under the row's idempotency key
 *   → record the outcome.
 *
 * The claim comes first, so a unit of budget is spent only on a row this caller holds, and two
 * callers (the send right after an answer, and the cron worker) can never hold the same row. The
 * idempotency key is derived from the row id only, so a row re-claimed after a crash is sent under
 * the same key and the provider does not deliver it twice (R91).
 *
 * This module imports nothing from the lead or order flows: lib/leads/submit.ts uses it, and the
 * send budget and the bounded send are passed in (`AttemptContext`).
 */

/** A claimed row: its id, its kind and which attempt this claim is (attempts are counted at claim). */
export interface ClaimedItem<K extends string> {
  id: string;
  kind: K;
  attempt: number;
}

export interface OutboxChannel<K extends string, T extends ClaimedItem<K>> {
  readonly name: "leads" | "orders";
  claim(options: ClaimOptions<K>): Promise<ClaimBatch<T>>;
  record(id: string, outcome: OutboxOutcome): Promise<boolean>;
  /** The message for one claimed row, recipient included, or null when it cannot be built: nothing is sent. */
  build(item: T): Omit<EmailMessage, "idempotencyKey"> | null;
  /** The provider idempotency key, derived from the row id only (R91). */
  idempotencyKey(item: T): string;
}

/** Event names and codes only: never an address, a name, a reference or a row id. */
export type OutboxLogEvent<K extends string = string> =
  | { event: "delivery_claim_failed"; code: string }
  | { event: "delivery_send_capped"; kind: K }
  | { event: "delivery_send_cap_unavailable"; kind: K; code: string }
  | { event: "delivery_attempted"; kind: K; status: "sent" | "failed"; code?: string }
  | { event: "delivery_record_failed"; kind: K; code: string }
  | { event: "delivery_message_invalid"; kind: K }
  | { event: "delivery_skipped"; count: number }
  /**
   * Rows parked for a human: `count` at claim (unconfirmed past the idempotency window), or one row
   * whose failure was final, with its kind and code (review I1: the last attempt, or a code that is
   * final at any attempt).
   */
  | { event: "delivery_expired"; count: number; kind?: K; code?: string };

export interface AttemptContext<K extends string = string> {
  /** Spends one unit of the shared hourly send budget; false when it is spent or cannot be checked. */
  reserve(kind: K): Promise<boolean>;
  /** Sends one message, bounded by a timeout. Never throws. */
  deliver(message: EmailMessage): Promise<EmailSendResult>;
  log(event: OutboxLogEvent<K>): void;
}

export interface OutboxTally {
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
}

export type AttemptOutcome =
  /** A row was claimed, skipped or parked: there may be more. */
  | "progress"
  /** Nothing was due. */
  | "none"
  /** The send budget is spent (or unavailable); the claimed row was handed back. */
  | "capped"
  /** The claim itself failed. */
  | "claim_failed";

export const emptyTally = (): OutboxTally => ({ sent: 0, failed: 0, skipped: 0, deferred: 0 });

export function addTally(total: OutboxTally, part: OutboxTally): OutboxTally {
  return { sent: total.sent + part.sent, failed: total.failed + part.failed, skipped: total.skipped + part.skipped, deferred: total.deferred + part.deferred };
}

const codeOf = (error: unknown) => (error instanceof RpcError ? error.code : "unknown");

/**
 * Whether the record functions of migration 0006 park this failure (next_attempt_at 'infinity'):
 * on the last attempt, or with a code that is final at any attempt. Same rule as the SQL, pinned
 * to it by tests/outbox/migration-policy.test.ts.
 */
export function failureParksRow(attempt: number, errorCode: string): boolean {
  return attempt >= OUTBOX_LIMITS.maxAttempts || (OUTBOX_FINAL_FAILURE_CODES as readonly string[]).includes(errorCode);
}

async function record<K extends string, T extends ClaimedItem<K>>(channel: OutboxChannel<K, T>, item: T, outcome: OutboxOutcome, context: AttemptContext<K>) {
  let recorded: boolean;
  try {
    recorded = await channel.record(item.id, outcome);
  } catch (error) {
    // The row stays `sending`; a later claim (after 15 minutes) re-sends it under the same key.
    context.log({ event: "delivery_record_failed", kind: item.kind, code: codeOf(error) });
    return;
  }
  // Review I1: a final failure leaves the row for a human, so it is reported, not just logged
  // (re-review N2: only when the record function did park this row).
  if (recorded && outcome.status === "failed" && failureParksRow(item.attempt, outcome.errorCode)) {
    context.log({ event: "delivery_expired", count: 1, kind: item.kind, code: outcome.errorCode });
  }
}

export async function attemptNext<K extends string, T extends ClaimedItem<K>>(
  channel: OutboxChannel<K, T>,
  scope: { ownerId?: string; kinds: readonly K[] },
  context: AttemptContext<K>,
): Promise<{ outcome: AttemptOutcome; tally: OutboxTally }> {
  const tally = emptyTally();
  let batch: ClaimBatch<T>;
  try {
    batch = await channel.claim({ ...scope, limit: 1 });
  } catch (error) {
    context.log({ event: "delivery_claim_failed", code: codeOf(error) });
    return { outcome: "claim_failed", tally };
  }

  tally.skipped += batch.skipped;
  tally.failed += batch.expired;
  if (batch.skipped > 0) context.log({ event: "delivery_skipped", count: batch.skipped });
  if (batch.expired > 0) context.log({ event: "delivery_expired", count: batch.expired });

  const item = batch.claimed[0];
  if (!item) return { outcome: batch.skipped + batch.expired > 0 ? "progress" : "none", tally };

  const message = channel.build(item);
  if (!message) {
    context.log({ event: "delivery_message_invalid", kind: item.kind });
    await record(channel, item, { status: "failed", errorCode: "message_invalid" }, context);
    tally.failed += 1;
    return { outcome: "progress", tally };
  }

  if (!(await context.reserve(item.kind))) {
    await record(channel, item, { status: "deferred" }, context);
    tally.deferred += 1;
    return { outcome: "capped", tally };
  }

  const result = await context.deliver({ ...message, idempotencyKey: channel.idempotencyKey(item) });
  context.log(result.status === "sent" ? { event: "delivery_attempted", kind: item.kind, status: "sent" } : { event: "delivery_attempted", kind: item.kind, status: "failed", code: result.errorCode });
  await record(channel, item, result, context);
  if (result.status === "sent") tally.sent += 1;
  else tally.failed += 1;
  return { outcome: "progress", tally };
}

/**
 * R88: the attempt made right after an API answer. Each named kind of one owner (a lead or an
 * order) is claimed on its own, in parallel, so one slow send never holds up the other (review M4).
 * A row another caller already holds is simply not claimed.
 */
export async function attemptNow<K extends string, T extends ClaimedItem<K>>(
  channel: OutboxChannel<K, T>,
  ownerId: string,
  kinds: readonly K[],
  context: AttemptContext<K>,
): Promise<OutboxTally> {
  const steps = await Promise.all(kinds.map((kind) => attemptNext(channel, { ownerId, kinds: [kind] }, context)));
  return steps.reduce((total, step) => addTally(total, step.tally), emptyTally());
}

/**
 * The cron worker's loop over one outbox: one row at a time, until nothing is due, the send
 * budget is spent, a claim fails, the run's time is up (`deadline`, checked before every claim) or
 * `maxRows` rows were handled.
 */
export async function drainChannel<K extends string, T extends ClaimedItem<K>>(
  channel: OutboxChannel<K, T>,
  kinds: readonly K[],
  context: AttemptContext<K>,
  { deadline, maxRows, now = Date.now }: { deadline: number; maxRows: number; now?: () => number },
): Promise<OutboxTally> {
  let total = emptyTally();
  for (let rows = 0; rows < maxRows && now() < deadline; rows += 1) {
    const step = await attemptNext(channel, { kinds }, context);
    total = addTally(total, step.tally);
    if (step.outcome !== "progress") break;
  }
  return total;
}
