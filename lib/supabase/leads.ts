import "server-only";

import type { DeliveryKind, DeliveryOutcome, DeliveryStatus, LeadRecordInput, LeadRepository } from "@/lib/leads/submit";
import { RpcError, callRpc, firstRow, type RpcClient } from "./rpc";

const DELIVERY_STATUSES: readonly DeliveryStatus[] = ["pending", "sending", "sent", "failed"];

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * Lead storage through migration 0001's service-role RPCs. Nothing here reads a lead back: the
 * database answers only with ids, flags and outbox status.
 */
export function createSupabaseLeadRepository(client: RpcClient): LeadRepository {
  return {
    async submitLead(record: LeadRecordInput) {
      const row = firstRow(await callRpc(client, "submit_lead", {
        p_email: record.email,
        p_consent: true,
        p_consent_version: record.consentVersion,
        p_first_name: record.firstName ?? null,
        p_age_band: record.ageBand ?? null,
        p_source: record.source,
        p_locale: record.locale ?? null,
        p_utm: record.utm ?? {},
      }));
      if (!isUuid(row?.lead_id) || typeof row?.created !== "boolean") throw new RpcError("submit_lead", "bad_response");
      return { leadId: row.lead_id, created: row.created };
    },

    async enqueueDelivery(leadId: string, kind: DeliveryKind, { claim }: { claim: boolean }) {
      const row = firstRow(await callRpc(client, "enqueue_lead_delivery", { p_lead_id: leadId, p_kind: kind, p_claim: claim }));
      const status = row?.status;
      if (!isUuid(row?.event_id) || !DELIVERY_STATUSES.includes(status as DeliveryStatus) || typeof row?.created !== "boolean") {
        throw new RpcError("enqueue_lead_delivery", "bad_response");
      }
      return { eventId: row.event_id, status: status as DeliveryStatus, created: row.created };
    },

    async recordDeliveryAttempt(eventId: string, outcome: DeliveryOutcome) {
      await callRpc(client, "record_lead_delivery_attempt", {
        p_event_id: eventId,
        p_status: outcome.status,
        p_provider_message_id: outcome.status === "sent" ? outcome.providerMessageId : null,
        p_error_code: outcome.status === "failed" ? outcome.errorCode : null,
      });
    },
  };
}
