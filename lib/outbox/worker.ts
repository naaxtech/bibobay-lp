import { addTally, drainChannel, type AttemptContext, type OutboxTally } from "./attempt";
import { WORKER_LIMITS, type LeadDeliveryKind, type OrderEmailKind } from "./constants";
import { leadDeliveryChannel, leadKindsFor, type LeadChannelSettings } from "./leads";
import { orderEmailChannel, orderKindsFor, type OrderChannelSettings } from "./orders";
import type { LeadDeliveryOutbox, OrderEmailOutbox } from "./types";

/**
 * One pass of the email outbox worker (Task 8a, R88: the retry net behind the sends made right
 * after each answer). It drains the order outbox first (a buyer waits on it), quotes first (staff
 * sent them, and the buyer's payment link is in them), then the signup outbox, one kind at a time
 * and one row per claim through the same claim functions the immediate sends use, so no row is
 * ever sent by both. Each row is: claimed (attempt counted) → built → one unit of the send budget
 * of its own kind (fix wave D-I1, `send:<budget>`, lib/outbox/constants.ts) → sent under the row's
 * idempotency key, bounded by its timeout → recorded. A kind stops when none of it is due or its
 * budget is spent (that row is handed back); the other kinds go on. An outbox stops when a claim
 * fails or it handled `maxRowsPerChannel` rows; the run stops when `WORKER_LIMITS.runMs` has passed.
 * It answers counts only.
 */

/** Fix wave D-I1: the order outbox's drain order. Quotes first; each kind has its own budget. */
const ORDER_DRAIN_ORDER: readonly OrderEmailKind[] = ["quote", "acknowledgement", "staff_alert"];
export interface OutboxWorkerInput {
  leads: { outbox: LeadDeliveryOutbox; settings: LeadChannelSettings };
  orders: { outbox: OrderEmailOutbox; settings: OrderChannelSettings };
  /** Per-kind budgets, bounded send and log, shared by both outboxes (lib/outbox/send.ts). */
  context: AttemptContext<LeadDeliveryKind | OrderEmailKind>;
  now?: () => number;
  /** When the request started (review M6): the run's time counts from there, setup included. */
  startedAt?: number;
}

export async function runOutboxWorker({ leads, orders, context, now = Date.now, startedAt }: OutboxWorkerInput): Promise<OutboxTally> {
  const deadline = (startedAt ?? now()) + WORKER_LIMITS.runMs;
  const limits = { deadline, maxRows: WORKER_LIMITS.maxRowsPerChannel, now };

  const orderKinds = orderKindsFor(orders.settings.staffEmail);
  const orderTally = await drainChannel(
    orderEmailChannel(orders.outbox, orders.settings),
    ORDER_DRAIN_ORDER.filter((kind) => orderKinds.includes(kind)),
    context,
    limits,
  );
  // Fix wave D-I1: a spent budget closes only its own kind (drainChannel), so the signup outbox is
  // always drained too; the run used to stop here at the first spent budget, when one bucket was shared.
  const leadTally = await drainChannel(leadDeliveryChannel(leads.outbox, leads.settings), leadKindsFor(leads.settings.staffEmail), context, limits);
  return addTally(orderTally, leadTally);
}
