import "server-only";

import { AGE_BANDS, type AgeBand } from "@/lib/leads/fields";
import { LEAD_DELIVERY_KINDS, ORDER_EMAIL_KINDS, type LeadDeliveryKind, type OrderEmailKind } from "@/lib/outbox/constants";
import type { ClaimBatch, ClaimOptions, ClaimedLeadDelivery, ClaimedOrderEmail, ClaimedOrderLine, ClaimedQuote, OrderEmailOutbox, OutboxOutcome } from "@/lib/outbox/types";
import { ORDER_REFERENCE_PATTERN } from "@/lib/orders/fields";
import { RpcError, callRpc, type RpcClient } from "./rpc";

/**
 * The outbox RPCs of migration 0006 (Task 8a). Every answer is rebuilt from its locked keys and
 * checked; anything unexpected is a `bad_response`, so a changed database answer can never put an
 * unvetted value into an email. Lead claims are parsed here too, for lib/supabase/leads.ts, and
 * the contact outbox (lib/supabase/contact.ts, migration 0008) reuses the checks it exports.
 */

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
export const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isOptionalText = (value: unknown): value is string | null => value === null || isText(value);
export const isAttempt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000;

/** A claim function's `{claimed, skipped, expired}` answer, each claimed entry rebuilt by `item` (null refuses the whole batch). */
export function batchFrom<T>(fn: string, data: unknown, item: (raw: unknown) => T | null): ClaimBatch<T> {
  if (!isRecord(data) || !Array.isArray(data.claimed) || !isCount(data.skipped) || !isCount(data.expired)) throw new RpcError(fn, "bad_response");
  const claimed = data.claimed.map(item);
  if (claimed.some((entry) => entry === null)) throw new RpcError(fn, "bad_response");
  return { claimed: claimed as T[], skipped: data.skipped, expired: data.expired };
}

function leadDelivery(raw: unknown): ClaimedLeadDelivery | null {
  if (!isRecord(raw)) return null;
  const { id, kind, attempt, email, firstName, ageBand, source } = raw;
  if (!isUuid(id) || !(LEAD_DELIVERY_KINDS as readonly unknown[]).includes(kind) || !isAttempt(attempt)) return null;
  if (!isText(email) || !isOptionalText(firstName) || !isText(source)) return null;
  if (ageBand !== null && !(AGE_BANDS as readonly unknown[]).includes(ageBand)) return null;
  return { id, kind: kind as LeadDeliveryKind, attempt, email, firstName, ageBand: ageBand as AgeBand | null, source };
}

function orderLine(raw: unknown): ClaimedOrderLine | null {
  if (!isRecord(raw)) return null;
  const { title, variant, pack, quantity } = raw;
  if (!isText(title) || !isOptionalText(variant) || !isOptionalText(pack)) return null;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) return null;
  return { title, variant, pack, quantity };
}

function quoteFrom(raw: unknown): ClaimedQuote | null {
  if (!isRecord(raw)) return null;
  const { currency, subtotalMinor, freightMinor, paymentUrl, revision } = raw;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) || !isCount(subtotalMinor) || !isCount(freightMinor)) return null;
  if (!isText(paymentUrl) || typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  return { currency, subtotalMinor, freightMinor, paymentUrl, revision };
}

function orderEmail(raw: unknown): ClaimedOrderEmail | null {
  if (!isRecord(raw)) return null;
  const { id, kind, attempt, reference, contactName, email } = raw;
  if (!isUuid(id) || !(ORDER_EMAIL_KINDS as readonly unknown[]).includes(kind) || !isAttempt(attempt)) return null;
  if (typeof reference !== "string" || !ORDER_REFERENCE_PATTERN.test(reference) || !isText(contactName) || !isText(email)) return null;
  const lines = Array.isArray(raw.lines) ? raw.lines.map(orderLine) : [];
  if (lines.length === 0 || lines.some((line) => line === null)) return null;
  // A quote always carries its figures, and no other email ever does.
  const quote = kind === "quote" ? quoteFrom(raw.quote) : raw.quote === null ? null : undefined;
  if ((kind === "quote" && quote === null) || quote === undefined) return null;
  return { id, kind: kind as OrderEmailKind, attempt, reference, contactName, email, lines: lines as ClaimedOrderLine[], quote };
}

export async function claimLeadDeliveries(client: RpcClient, { ownerId, kinds, limit }: ClaimOptions<LeadDeliveryKind>): Promise<ClaimBatch<ClaimedLeadDelivery>> {
  const data = await callRpc(client, "claim_lead_deliveries", { p_limit: limit, p_lead_id: ownerId ?? null, p_kinds: [...kinds] });
  return batchFrom("claim_lead_deliveries", data, leadDelivery);
}

/** The arguments both record functions take, from one outcome. */
export function outcomeArguments(outcome: OutboxOutcome) {
  return {
    p_status: outcome.status,
    p_provider_message_id: outcome.status === "sent" ? outcome.providerMessageId : null,
    p_error_code: outcome.status === "failed" ? outcome.errorCode : null,
  };
}

/** True when the record function found the row still claimed. */
export function recordedFrom(fn: string, data: unknown): boolean {
  const value = Array.isArray(data) ? data[0] : data;
  if (typeof value !== "boolean") throw new RpcError(fn, "bad_response");
  return value;
}

export function createSupabaseOrderEmailOutbox(client: RpcClient): OrderEmailOutbox {
  return {
    async claimEmails({ ownerId, kinds, limit }) {
      const data = await callRpc(client, "claim_order_emails", { p_limit: limit, p_order_id: ownerId ?? null, p_kinds: [...kinds] });
      return batchFrom("claim_order_emails", data, orderEmail);
    },
    async recordEmailAttempt(emailId, outcome) {
      const data = await callRpc(client, "record_order_email_attempt", { p_email_id: emailId, ...outcomeArguments(outcome) });
      return recordedFrom("record_order_email_attempt", data);
    },
  };
}
