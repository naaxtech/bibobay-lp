import { addTally, drainChannel, type AttemptContext, type OutboxTally } from "./attempt";
import { WORKER_LIMITS, type LeadDeliveryKind, type OrderEmailKind } from "./constants";
import { leadDeliveryChannel, leadKindsFor, type LeadChannelSettings } from "./leads";
import { orderEmailChannel, orderKindsFor, type OrderChannelSettings } from "./orders";
import type { LeadDeliveryOutbox, OrderEmailOutbox } from "./types";

/**
 * One pass of the email outbox worker (Task 8a, R88: the retry net behind the sends made right
 * after each answer). It drains the order outbox first (a buyer waits on it), then the signup
 * outbox, one row per claim through the same claim functions the immediate sends use, so no row
 * is ever sent by both. Each row is: claimed (attempt counted) → built → one unit of the shared
 * `ack-send:global` budget → sent under the row's idempotency key, bounded by its timeout →
 * recorded. It stops claiming when nothing is due, the budget is spent (that row is handed back),
 * a claim fails, `WORKER_LIMITS.runMs` has passed or a channel reached `maxRowsPerChannel`.
 * It answers counts only.
 */
export interface OutboxWorkerInput {
  leads: { outbox: LeadDeliveryOutbox; settings: LeadChannelSettings };
  orders: { outbox: OrderEmailOutbox; settings: OrderChannelSettings };
  /** Budget, bounded send and log, shared by both outboxes (lib/outbox/send.ts). */
  context: AttemptContext<LeadDeliveryKind | OrderEmailKind>;
  now?: () => number;
  /** When the request started (review M6): the run's time counts from there, setup included. */
  startedAt?: number;
}

export async function runOutboxWorker({ leads, orders, context, now = Date.now, startedAt }: OutboxWorkerInput): Promise<OutboxTally> {
  const deadline = (startedAt ?? now()) + WORKER_LIMITS.runMs;
  const limits = { deadline, maxRows: WORKER_LIMITS.maxRowsPerChannel, now };

  const orderTally = await drainChannel(orderEmailChannel(orders.outbox, orders.settings), orderKindsFor(orders.settings.staffEmail), context, limits);
  // A spent budget stops the whole run: the signup outbox would only claim and hand back rows.
  if (orderTally.deferred > 0) return orderTally;
  const leadTally = await drainChannel(leadDeliveryChannel(leads.outbox, leads.settings), leadKindsFor(leads.settings.staffEmail), context, limits);
  return addTally(orderTally, leadTally);
}
