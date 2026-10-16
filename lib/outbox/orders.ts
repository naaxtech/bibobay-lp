import { buildOrderAcknowledgement, buildQuoteEmail, buildStaffOrderAlert } from "@/lib/email/order-emails";
import { attemptNow, type AttemptContext, type OutboxChannel } from "./attempt";
import type { OrderEmailKind } from "./constants";
import type { ClaimedOrderEmail, OrderEmailOutbox } from "./types";

/**
 * The order outbox as an attempt channel (Task 8a): a claimed order email becomes the buyer
 * acknowledgement (R89: the /track page while tracking is on, never the private link), the staff
 * alert, or the quote. The provider idempotency key is the row id, `order-email/<row id>` (R91).
 */
export interface OrderChannelSettings {
  /** Null: no staff alerts are claimed or sent. */
  staffEmail: string | null;
  /** Reply-to for the buyer's emails only; the staff alert never has one. */
  replyTo: string | null;
  /** Null while order tracking is off. `url` is the /track page, or null while the site's address is not verified. */
  tracking: { url: string | null } | null;
}

/** The kinds this channel may claim: never a staff alert without a staff address to send it to. */
export function orderKindsFor(staffEmail: string | null): OrderEmailKind[] {
  return staffEmail ? ["acknowledgement", "staff_alert", "quote"] : ["acknowledgement", "quote"];
}

export function orderEmailChannel(outbox: OrderEmailOutbox, settings: OrderChannelSettings): OutboxChannel<OrderEmailKind, ClaimedOrderEmail> {
  const toBuyer = (item: ClaimedOrderEmail) => ({ to: [item.email], ...(settings.replyTo ? { replyTo: settings.replyTo } : {}) });
  return {
    name: "orders",
    claim: (options) => outbox.claimEmails(options),
    record: (id, outcome) => outbox.recordEmailAttempt(id, outcome),
    idempotencyKey: (item) => `order-email/${item.id}`,
    build(item) {
      const order = { reference: item.reference, contactName: item.contactName, lines: item.lines };
      switch (item.kind) {
        case "acknowledgement":
          return { ...toBuyer(item), ...buildOrderAcknowledgement({ ...order, tracking: settings.tracking }) };
        case "staff_alert":
          return settings.staffEmail ? { to: [settings.staffEmail], ...buildStaffOrderAlert({ ...order, email: item.email }) } : null;
        case "quote": {
          const email = item.quote ? buildQuoteEmail({ ...order, quote: item.quote }) : null;
          return email ? { ...toBuyer(item), ...email } : null;
        }
      }
    },
  };
}

/**
 * R88: the send right after an order is stored. The two emails submit_order queued (the buyer
 * acknowledgement, and the staff alert when a staff address is set) are claimed by order id, one
 * claim each and in parallel, through the same claim the cron worker uses; whatever is not sent
 * stays due for the worker. Quotes are never sent from here (staff send them; Task 8b).
 */
export function createOrderEmailSender(
  outbox: OrderEmailOutbox,
  settings: OrderChannelSettings,
  context: AttemptContext<OrderEmailKind>,
): (orderId: string) => Promise<void> {
  const channel = orderEmailChannel(outbox, settings);
  const kinds = orderKindsFor(settings.staffEmail).filter((kind) => kind !== "quote");
  return async (orderId) => {
    await attemptNow(channel, orderId, kinds, context);
  };
}
