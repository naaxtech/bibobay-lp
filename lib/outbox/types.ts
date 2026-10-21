import type { ContactTopic } from "@/lib/contact/fields";
import type { AgeBand } from "@/lib/leads/fields";
import type { ContactDeliveryKind, LeadDeliveryKind, OrderEmailKind } from "./constants";

/**
 * What the outbox claim functions of migration 0006 hand out (Task 8a), and those of migration 0008
 * for the contact outbox (R201). Each claimed row carries only what its email needs; the Supabase
 * adapters (lib/supabase/leads.ts, lib/supabase/outbox.ts, lib/supabase/contact.ts) rebuild these
 * shapes key by key and refuse anything else.
 */

/** The result of recording a claimed row. `deferred` hands the claim back without an attempt. */
export type OutboxOutcome =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; errorCode: string }
  | { status: "deferred" };

export interface ClaimBatch<T> {
  claimed: T[];
  /**
   * Rows the claim refused to send (a withdrawn lead, a superseded quote): now `skipped`. Always 0
   * for the contact outbox, whose messages cannot be withdrawn (R207).
   */
  skipped: number;
  /**
   * Rows parked for a human (R91: out of attempts, or, in the signup and order outboxes, unconfirmed
   * past the idempotency window; the contact outbox parks at the attempt cap only, R211).
   */
  expired: number;
}

/** Which rows one claim may take: one owner (a lead, an order or a contact message) or any, and some kinds. */
export interface ClaimOptions<K extends string> {
  ownerId?: string;
  kinds: readonly K[];
  limit: number;
}

export interface ClaimedLeadDelivery {
  id: string;
  kind: LeadDeliveryKind;
  attempt: number;
  email: string;
  firstName: string | null;
  ageBand: AgeBand | null;
  source: string;
}

export interface ClaimedOrderLine {
  title: string;
  variant: string | null;
  pack: string | null;
  quantity: number;
}

export interface ClaimedQuote {
  /** ISO 4217 code. */
  currency: string;
  subtotalMinor: number;
  freightMinor: number;
  paymentUrl: string;
  revision: number;
}

export interface ClaimedOrderEmail {
  id: string;
  kind: OrderEmailKind;
  attempt: number;
  reference: string;
  contactName: string;
  email: string;
  lines: ClaimedOrderLine[];
  /** Present for a quote only. */
  quote: ClaimedQuote | null;
}

export interface ClaimedContactDelivery {
  id: string;
  kind: ContactDeliveryKind;
  attempt: number;
  name: string;
  email: string;
  topic: ContactTopic;
  message: string;
  /** The message's `created_at`, as the claim's JSON string. */
  receivedAt: string;
}

/** The lead outbox through migration 0006's RPCs. */
export interface LeadDeliveryOutbox {
  claimDeliveries(options: ClaimOptions<LeadDeliveryKind>): Promise<ClaimBatch<ClaimedLeadDelivery>>;
  /** False when the row was no longer claimed (already recorded, or parked). */
  recordDeliveryAttempt(eventId: string, outcome: OutboxOutcome): Promise<boolean>;
}

/** The order outbox through migration 0006's RPCs. */
export interface OrderEmailOutbox {
  claimEmails(options: ClaimOptions<OrderEmailKind>): Promise<ClaimBatch<ClaimedOrderEmail>>;
  /** False when the row was no longer claimed (already recorded, or parked). */
  recordEmailAttempt(emailId: string, outcome: OutboxOutcome): Promise<boolean>;
}

/** The contact outbox through migration 0008's RPCs. */
export interface ContactDeliveryOutbox {
  claimDeliveries(options: ClaimOptions<ContactDeliveryKind>): Promise<ClaimBatch<ClaimedContactDelivery>>;
  /** False when the row was no longer claimed (already recorded, or parked). */
  recordDeliveryAttempt(deliveryId: string, outcome: OutboxOutcome): Promise<boolean>;
}
