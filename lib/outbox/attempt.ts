import type { EmailMessage, EmailSendResult } from "@/lib/email/client";
import { RpcError } from "@/lib/supabase/rpc";
import { OUTBOX_FINAL_FAILURE_CODES, OUTBOX_LIMITS, type OutboxName, type SendBudget } from "./constants";
import type { ClaimBatch, ClaimOptions, OutboxOutcome } from "./types";

/**
 * The one attempt step both send paths share (Task 8a; rulings R88, R91, R40):
 *
 *   claim one due row (the outbox's claim function, migration 0006)
 *   → build its message (null: nothing can be sent; recorded as failed `message_invalid`)
 *   → spend one unit of the send budget of the row's own kind in its outbox (`send:<budget>`, fix
 *     wave D-I1; lib/outbox/constants.ts SEND_BUDGETS); spent or unavailable: the claim is handed
 *     back (`deferred`), so the row stays due and no attempt is counted
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
  readonly name: OutboxName;
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
  /** Fix wave D-I1: `budget` names the spent bucket (`send:<budget>`); the kind alone is ambiguous across outboxes. */
  | { event: "delivery_send_capped"; kind: K; budget: SendBudget }
  /** `budget` is absent only for a kind with no budget in that outbox (code `unknown_budget`). */
  | { event: "delivery_send_cap_unavailable"; kind: K; budget?: SendBudget; code: string }
  | { event: "delivery_attempted"; kind: K; status: "sent" | "failed"; code?: string }
  | { event: "delivery_record_failed"; kind: K; code: string }
  | { event: "delivery_message_invalid"; kind: K }
  | { event: "delivery_skipped"; count: number }
  /**
   * Rows parked for a human: `count` at claim (out of attempts, or, in the signup and order
   * outboxes, unconfirmed past the idempotency window), with the `outbox` whose claim parked them,
   * since the cron worker logs every outbox under one channel (R185); or one row whose failure was
   * final, with its kind and code (review I1: the last attempt, or a code that is final at any
   * attempt).
   */
  | { event: "delivery_expired"; count: number; kind?: K; code?: string; outbox?: OutboxName };

export interface AttemptContext<K extends string = string> {
  /**
   * Spends one unit of the hourly send budget of this kind in this outbox (fix wave D-I1); false
   * when it is spent or cannot be checked.
   */
  reserve(kind: K, outbox: OutboxName): Promise<boolean>;
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
  /** The send budget of the claimed row's kind is spent (or unavailable); the row was handed back. */
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
  if (batch.expired > 0) context.log({ event: "delivery_expired", count: batch.expired, outbox: channel.name });

  const item = batch.claimed[0];
  if (!item) return { outcome: batch.skipped + batch.expired > 0 ? "progress" : "none", tally };

  const message = channel.build(item);
  if (!message) {
    context.log({ event: "delivery_message_invalid", kind: item.kind });
    await record(channel, item, { status: "failed", errorCode: "message_invalid" }, context);
    tally.failed += 1;
    return { outcome: "progress", tally };
  }

  if (!(await context.reserve(item.kind, channel.name))) {
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
 * The cron worker's loop over one outbox. Fix wave D-I1: kind by kind, in the order given, because
 * each kind spends its own send budget: one row of that kind per claim until none of it is due or
 * its budget is spent, then the next kind. The whole outbox stops when a claim fails, the run's
 * time is up (`deadline`, checked before every claim) or `maxRows` rows were handled across all
 * its kinds (a claim that finds nothing due is not a row).
 */
export async function drainChannel<K extends string, T extends ClaimedItem<K>>(
  channel: OutboxChannel<K, T>,
  kinds: readonly K[],
  context: AttemptContext<K>,
  { deadline, maxRows, now = Date.now }: { deadline: number; maxRows: number; now?: () => number },
): Promise<OutboxTally> {
  let total = emptyTally();
  let rows = 0;
  for (const kind of kinds) {
    while (rows < maxRows && now() < deadline) {
      const step = await attemptNext(channel, { kinds: [kind] }, context);
      total = addTally(total, step.tally);
      if (step.outcome === "claim_failed") return total;
      if (step.outcome === "none") break;
      rows += 1;
      // A spent budget closes this kind for the rest of the run; the other kinds keep theirs.
      if (step.outcome === "capped") break;
    }
  }
  return total;
}
