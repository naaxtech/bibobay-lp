import { buildStaffContactAlert } from "@/lib/email/contact-emails";
import { attemptNow, type AttemptContext, type OutboxChannel } from "./attempt";
import type { ContactDeliveryKind } from "./constants";
import type { ClaimedContactDelivery, ContactDeliveryOutbox } from "./types";

/**
 * The contact outbox as an attempt channel (rulings R160, R169): a claimed row becomes the staff
 * alert for one message, addressed to the staff inbox with the sender as reply-to (R172). The
 * provider idempotency key is the row id, `contact-delivery/<row id>`. The message depends on the
 * row alone, so every attempt builds the same email; no email ever goes to the sender.
 */
export interface ContactChannelSettings {
  /** Null: no alert is claimed or sent, and the rows wait (R177). */
  staffEmail: string | null;
}

/** The kinds this channel may claim: none without a staff address to send them to. */
export function contactKindsFor(staffEmail: string | null): ContactDeliveryKind[] {
  return staffEmail ? ["contact_staff_alert"] : [];
}

export function contactAlertChannel(outbox: ContactDeliveryOutbox, settings: ContactChannelSettings): OutboxChannel<ContactDeliveryKind, ClaimedContactDelivery> {
  return {
    name: "contact",
    claim: (options) => outbox.claimDeliveries(options),
    record: (id, outcome) => outbox.recordDeliveryAttempt(id, outcome),
    idempotencyKey: (item) => `contact-delivery/${item.id}`,
    build(item) {
      if (!settings.staffEmail) return null;
      // R172: the documented exception to review M3. The address is unverified and labelled so in the body.
      return { to: [settings.staffEmail], replyTo: item.email, ...buildStaffContactAlert(item) };
    },
  };
}

/**
 * The send right after a message is stored: its alert is claimed by message id through the same
 * claim the cron worker uses; whatever is not sent stays due for the worker.
 */
export function createContactAlertSender(
  outbox: ContactDeliveryOutbox,
  settings: ContactChannelSettings,
  context: AttemptContext<ContactDeliveryKind>,
): (messageId: string) => Promise<void> {
  const channel = contactAlertChannel(outbox, settings);
  const kinds = contactKindsFor(settings.staffEmail);
  return async (messageId) => {
    await attemptNow(channel, messageId, kinds, context);
  };
}
