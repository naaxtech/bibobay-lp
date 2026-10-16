import { buildLeadAcknowledgement, buildStaffLeadAlert, type LeadMagnetLink } from "@/lib/email/lead-emails";
import type { OutboxChannel } from "./attempt";
import type { LeadDeliveryKind } from "./constants";
import type { ClaimedLeadDelivery, LeadDeliveryOutbox } from "./types";

/**
 * The signup outbox as an attempt channel (Task 8a): a claimed lead delivery becomes the
 * acknowledgement to the adult or the staff alert. The send right after a signup
 * (lib/leads/submit.ts) and the cron worker (lib/outbox/worker.ts) both use it, so a retried email
 * is the same email under the same idempotency key, `lead-delivery/<row id>` (the key the signup
 * flow has used since Task 5).
 */
export interface LeadChannelSettings {
  /** Null: no staff alerts are claimed or sent. */
  staffEmail: string | null;
  /** Reply-to for the acknowledgement only; the staff alert never has one (review M3). */
  replyTo: string | null;
  leadMagnet: LeadMagnetLink | null;
  /** True for the worker: a retried staff alert says it shows the details on file. */
  fromOutbox: boolean;
}

/** The kinds this channel may claim: never a staff alert without a staff address to send it to. */
export function leadKindsFor(staffEmail: string | null): LeadDeliveryKind[] {
  return staffEmail ? ["acknowledgement", "staff_alert"] : ["acknowledgement"];
}

export function leadDeliveryChannel(outbox: LeadDeliveryOutbox, settings: LeadChannelSettings): OutboxChannel<LeadDeliveryKind, ClaimedLeadDelivery> {
  return {
    name: "leads",
    claim: (options) => outbox.claimDeliveries(options),
    record: (id, outcome) => outbox.recordDeliveryAttempt(id, outcome),
    idempotencyKey: (item) => `lead-delivery/${item.id}`,
    build(item) {
      if (item.kind === "acknowledgement") {
        return {
          to: [item.email],
          ...buildLeadAcknowledgement({ firstName: item.firstName, leadMagnet: settings.leadMagnet }),
          ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
        };
      }
      if (!settings.staffEmail) return null;
      // Review M3: no reply-to. The submitted address is unverified and is labelled so in the body.
      return {
        to: [settings.staffEmail],
        ...buildStaffLeadAlert({
          email: item.email,
          firstName: item.firstName,
          ageBand: item.ageBand,
          source: item.source,
          // Only a new signup's alert is sent straight away (R40); the worker says the details are on file.
          created: true,
          fromOutbox: settings.fromOutbox,
        }),
      };
    },
  };
}
