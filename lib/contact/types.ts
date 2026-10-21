import type { ContactDeliveryOutbox } from "@/lib/outbox/types";
import type { ContactTopic } from "./fields";

/**
 * The server side of the contact form (rulings R159, R169): what the route stores and the one
 * repository that stores it. The Supabase adapter (lib/supabase/contact.ts) implements it over
 * migration 0008's RPCs; tests pass a fake.
 */

/** A validated message, normalised as lib/contact/fields.ts checks it (`normalizeEmail`, `normalizeMessage`). */
export interface ContactRecordInput {
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
}

export interface ContactRepository extends ContactDeliveryOutbox {
  /** Resolves only once the message and its outbox row are both stored (one RPC, one transaction). */
  submitMessage(record: ContactRecordInput): Promise<{ messageId: string; deliveryId: string }>;
}
