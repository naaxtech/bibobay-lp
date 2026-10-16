import "server-only";

import { getOrderableProducts } from "@/lib/sanity/fetch";
import { ORDER_LINE_LIMITS, SINGLE_LINE_CONTROL } from "./fields";
import type { OrderPadLine } from "./pad";

/**
 * The canonical catalogue check for an order (spec §10 step 5). The browser sends product ids and
 * quantities only; every id is reloaded from the published CMS here and each line snapshots the
 * product's name, SKU, variant and pack as the CMS holds them at that moment (R80: a missing value
 * is null). Nothing else about a product reaches the order, and never a price.
 *
 * One unknown, draft, sold-out or unlisted id rejects the whole order, and the answer never names
 * the id: the caller turns every failure here into one generic message.
 */
export interface CanonicalOrderLine {
  /** The product's published Sanity document id. */
  productId: string;
  name: string;
  sku: string | null;
  variant: string | null;
  pack: string | null;
  quantity: number;
}

/** Reads CMS product documents for the given ids; null when the CMS cannot be read. */
export type CanonicalProductLoader = (ids: readonly string[]) => Promise<unknown[] | null>;

export type CanonicalLinesFailure =
  /** An id the published catalogue does not list (unknown, draft, sold out or unlisted). */
  | "unavailable_products"
  /** A listed product whose CMS data cannot be stored as is (blank name, an over-long code). */
  | "invalid_product"
  /** The CMS is unconfigured or unreachable, so nothing can be checked. */
  | "catalogue_unavailable";

export type CanonicalLinesResult = { ok: true; lines: CanonicalOrderLine[] } | { ok: false; reason: CanonicalLinesFailure };

type Snapshot = Omit<CanonicalOrderLine, "quantity">;

const record = (raw: unknown): Record<string, unknown> => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});
const text = (raw: unknown): string => (typeof raw === "string" ? raw.trim() : "");

/** A trimmed optional code, null when blank or not text; `false` when it cannot be stored. */
function optionalCode(raw: unknown, limit: number): string | null | false {
  const value = text(raw);
  if (!value) return null;
  return value.length <= limit && !SINGLE_LINE_CONTROL.test(value) ? value : false;
}

/** The snapshot of one listed product, `false` when its data cannot be stored, null when it is not orderable. */
function snapshotOf(raw: unknown): Snapshot | false | null {
  const doc = record(raw);
  const productId = text(doc.id);
  if (!productId || doc.status !== "listed") return null;
  const name = text(doc.name);
  const sku = optionalCode(doc.sku, ORDER_LINE_LIMITS.sku);
  const variant = optionalCode(doc.variant, ORDER_LINE_LIMITS.variant);
  const pack = optionalCode(doc.pack, ORDER_LINE_LIMITS.pack);
  if (!name || name.length > ORDER_LINE_LIMITS.name || SINGLE_LINE_CONTROL.test(name)) return false;
  if (sku === false || variant === false || pack === false) return false;
  return { productId, name, sku, variant, pack };
}

export async function resolveCanonicalOrderLines(
  lines: readonly OrderPadLine[],
  load: CanonicalProductLoader = getOrderableProducts,
): Promise<CanonicalLinesResult> {
  if (lines.length === 0) return { ok: false, reason: "unavailable_products" };
  const ids = [...new Set(lines.map((line) => line.productId))];

  let documents: unknown[] | null;
  try {
    documents = await load(ids);
  } catch {
    documents = null;
  }
  if (!Array.isArray(documents)) return { ok: false, reason: "catalogue_unavailable" };

  const wanted = new Set(ids);
  const snapshots = new Map<string, Snapshot | false>();
  for (const raw of documents) {
    const snapshot = snapshotOf(raw);
    if (snapshot === null) continue;
    const id = snapshot === false ? text(record(raw).id) : snapshot.productId;
    // Only a document for an id that was asked for may answer for it.
    if (wanted.has(id) && !snapshots.has(id)) snapshots.set(id, snapshot);
  }

  const resolved: CanonicalOrderLine[] = [];
  let invalid = false;
  for (const line of lines) {
    const snapshot = snapshots.get(line.productId);
    if (snapshot === undefined) return { ok: false, reason: "unavailable_products" };
    if (snapshot === false) invalid = true;
    else resolved.push({ ...snapshot, quantity: line.quantity });
  }
  return invalid ? { ok: false, reason: "invalid_product" } : { ok: true, lines: resolved };
}
