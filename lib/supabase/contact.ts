import "server-only";

import { CONTACT_LIMITS, characterCount, isContactTopic } from "@/lib/contact/fields";
import type { ContactRecordInput, ContactRepository } from "@/lib/contact/types";
import { CONTACT_DELIVERY_KINDS, type ContactDeliveryKind } from "@/lib/outbox/constants";
import type { ClaimedContactDelivery, OutboxOutcome } from "@/lib/outbox/types";
import { batchFrom, isAttempt, isText, isUuid, outcomeArguments, recordedFrom } from "./outbox";
import { RpcError, callRpc, firstRow, type RpcClient } from "./rpc";

/**
 * The contact form's storage and its own outbox (rulings R191, R201) through the service-role RPCs
 * of migration 0008. A message and its staff alert are written by one RPC in one transaction; the
 * alert is then claimed and recorded like any other outbox row. Every claimed entry is rebuilt from
 * its locked keys and checked, so a changed database answer can never put an unvetted value into
 * the staff alert; anything unexpected is a `bad_response`.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function contactDelivery(raw: unknown): ClaimedContactDelivery | null {
  if (!isRecord(raw)) return null;
  const { id, kind, attempt, name, email, topic, message, receivedAt } = raw;
  if (!isUuid(id) || !(CONTACT_DELIVERY_KINDS as readonly unknown[]).includes(kind) || !isAttempt(attempt)) return null;
  if (!isText(name) || characterCount(name) > CONTACT_LIMITS.name || !isText(email) || !isText(message) || !isContactTopic(topic)) return null;
  if (typeof receivedAt !== "string" || Number.isNaN(Date.parse(receivedAt))) return null;
  return { id, kind: kind as ContactDeliveryKind, attempt, name, email, topic, message, receivedAt };
}

export function createSupabaseContactRepository(client: RpcClient): ContactRepository {
  return {
    async submitMessage(record: ContactRecordInput) {
      const row = firstRow(await callRpc(client, "submit_contact_message", {
        p_name: record.name,
        p_email: record.email,
        p_topic: record.topic,
        p_message: record.message,
      }));
      if (!isUuid(row?.message_id) || !isUuid(row?.delivery_id)) throw new RpcError("submit_contact_message", "bad_response");
      return { messageId: row.message_id, deliveryId: row.delivery_id };
    },

    async claimDeliveries({ ownerId, kinds, limit }) {
      // The outbox holds one kind; an empty list (no staff address to alert) claims nothing.
      if (kinds.length === 0) return { claimed: [], skipped: 0, expired: 0 };
      const data = await callRpc(client, "claim_contact_deliveries", { p_limit: limit, p_message_id: ownerId ?? null });
      return batchFrom("claim_contact_deliveries", data, contactDelivery);
    },

    async recordDeliveryAttempt(deliveryId: string, outcome: OutboxOutcome) {
      const data = await callRpc(client, "record_contact_delivery_attempt", { p_delivery_id: deliveryId, ...outcomeArguments(outcome) });
      return recordedFrom("record_contact_delivery_attempt", data);
    },
  };
}
