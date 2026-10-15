import "server-only";

import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/constants";
import { ORDER_REFERENCE_PATTERN, TRACKING_TOKEN_PATTERN } from "@/lib/orders/fields";
import type { OrderRecordInput, OrderRepository, StoredOrder } from "@/lib/orders/submit";
import type { TrackedOrder, TrackedOrderLine, TrackingRepository } from "@/lib/orders/track";
import { RpcError, callRpc, firstRow, type RpcClient } from "./rpc";

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A timestamp from the database as an ISO string, or null when it is not one. */
function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const optionalText = (value: unknown): string | null | undefined => (value === null ? null : typeof value === "string" ? value : undefined);

/** One tracking line, rebuilt from the locked keys only; null when malformed. */
function trackedLine(raw: unknown): TrackedOrderLine | null {
  if (!isRecord(raw)) return null;
  const variant = optionalText(raw.variant);
  const pack = optionalText(raw.pack);
  const { title, quantity } = raw;
  if (typeof title !== "string" || !title || variant === undefined || pack === undefined) return null;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) return null;
  return { title, variant, pack, quantity };
}

/**
 * The tracking payload of migration 0003, rebuilt from its locked keys only: whatever else the
 * database might ever return (an address, an email, a price) cannot reach the response.
 */
function trackedOrder(fn: string, data: unknown): TrackedOrder | null {
  if (data === null) return null;
  if (!isRecord(data)) throw new RpcError(fn, "bad_response");
  const { reference, status } = data;
  const submittedAt = isoTimestamp(data.submittedAt);
  const statusChangedAt = isoTimestamp(data.statusChangedAt);
  const lines = Array.isArray(data.lines) ? data.lines.map(trackedLine) : null;
  if (
    typeof reference !== "string" || !ORDER_REFERENCE_PATTERN.test(reference) ||
    !(ORDER_STATUSES as readonly unknown[]).includes(status) ||
    !submittedAt || !statusChangedAt ||
    !lines || lines.length === 0 || lines.some((line) => line === null)
  ) {
    throw new RpcError(fn, "bad_response");
  }
  return { reference, status: status as OrderStatus, submittedAt, statusChangedAt, lines: lines as TrackedOrderLine[] };
}

export interface RotatedTrackingToken {
  trackingToken: string;
  trackingTokenExpiresAt: string;
}

export interface SupabaseOrderRepository extends OrderRepository, TrackingRepository {
  /** Replaces an order's private token (migration 0005); the old one stops working at once. */
  rotateTrackingToken(orderId: string): Promise<RotatedTrackingToken>;
}

/**
 * Orders through the service-role RPCs of migrations 0002-0005. Nothing here reads an order table:
 * the database answers with ids, the reference, the private token (once), flags and the locked
 * tracking payload.
 */
export function createSupabaseOrderRepository(client: RpcClient): SupabaseOrderRepository {
  return {
    async submitOrder(record: OrderRecordInput): Promise<StoredOrder> {
      const row = firstRow(await callRpc(client, "submit_order", {
        p_contact_name: record.contactName,
        p_email: record.email,
        p_phone: record.phone ?? null,
        p_address_line1: record.addressLine1,
        p_address_line2: record.addressLine2 ?? null,
        p_city: record.city,
        p_region: record.region ?? null,
        p_postal_code: record.postalCode ?? null,
        p_country: record.country,
        p_notes: record.notes ?? null,
        p_consent: true,
        p_consent_version: record.consentVersion,
        // The canonical CMS snapshot only (lib/orders/catalogue.ts), in the keys submit_order checks.
        p_lines: record.lines.map((line) => ({
          sanity_id: line.productId,
          title: line.name,
          sku: line.sku,
          variant: line.variant,
          pack: line.pack,
          quantity: line.quantity,
        })),
      }));
      const expiresAt = isoTimestamp(row?.tracking_token_expires_at);
      if (
        !isUuid(row?.order_id) ||
        typeof row?.reference !== "string" || !ORDER_REFERENCE_PATTERN.test(row.reference) ||
        typeof row?.tracking_token !== "string" || !TRACKING_TOKEN_PATTERN.test(row.tracking_token) ||
        !expiresAt ||
        typeof row?.acknowledgement_queued !== "boolean"
      ) {
        throw new RpcError("submit_order", "bad_response");
      }
      return {
        orderId: row.order_id,
        reference: row.reference,
        trackingToken: row.tracking_token,
        trackingTokenExpiresAt: expiresAt,
        acknowledgementQueued: row.acknowledgement_queued,
      };
    },

    async lookupByToken(token: string) {
      return trackedOrder("lookup_order_by_token", await callRpc(client, "lookup_order_by_token", { p_token: token }));
    },

    async lookupByReferenceAndEmail(reference: string, email: string) {
      return trackedOrder(
        "lookup_order_by_reference_email",
        await callRpc(client, "lookup_order_by_reference_email", { p_reference: reference, p_email: email }),
      );
    },

    async rotateTrackingToken(orderId: string) {
      const row = firstRow(await callRpc(client, "rotate_order_tracking_token", { p_order_id: orderId }));
      const expiresAt = isoTimestamp(row?.tracking_token_expires_at);
      if (typeof row?.tracking_token !== "string" || !TRACKING_TOKEN_PATTERN.test(row.tracking_token) || !expiresAt) {
        throw new RpcError("rotate_order_tracking_token", "bad_response");
      }
      return { trackingToken: row.tracking_token, trackingTokenExpiresAt: expiresAt };
    },
  };
}
