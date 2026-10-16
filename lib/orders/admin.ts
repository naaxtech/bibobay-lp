import "server-only";

import { attemptNext, type AttemptContext } from "@/lib/outbox/attempt";
import type { OrderEmailKind } from "@/lib/outbox/constants";
import { orderEmailChannel, type OrderChannelSettings } from "@/lib/outbox/orders";
import type { OrderEmailOutbox } from "@/lib/outbox/types";
import { PAYMENT_URL_MAX_LENGTH, validatePaymentUrl, type PaymentUrlRefusal } from "@/lib/security/payment-url";
import { RpcError, callRpc, firstRow, type RpcClient, type RpcResult } from "@/lib/supabase/rpc";
import { ORDER_STATUSES, canTransitionOrder, type OrderStatus } from "./constants";
import { ORDER_REFERENCE_PATTERN, TRACKING_TOKEN_PATTERN } from "./fields";

/**
 * Staff order administration (Task 8b; spec §10 steps 8-10; rulings R95-R98), over the signed-in
 * staff member's own Supabase client (lib/supabase/auth.ts): reads go through row level security
 * and the column grants of migration 0007, writes through its staff RPCs, which check for an active
 * staff row themselves. Nothing here uses the service role, except `createQuoteEmailSender`, which
 * attempts a queued quote right after the answer through Task 8a's claim (R88, R95).
 *
 * Every operation answers a typed result. Refusals the database names map to a reason:
 *   not_staff (42501) · not_found (P0002) · invalid (22023) · stale (40001: the status or quote
 *   revision the staff member saw is no longer the order's) · not_allowed (55000: not possible in
 *   the order's state).
 * Anything else is thrown as an RpcError carrying a code only, never a database message.
 */

export type StaffTable = "orders" | "order_items" | "order_events" | "order_email_outbox" | "staff_users";

export interface StaffSelect {
  table: StaffTable;
  columns: readonly string[];
  /** Equality filters, all of which must hold. */
  match?: Readonly<Record<string, string>>;
  order?: { column: string; ascending: boolean };
  limit?: number;
}

/** What staff code needs from the signed-in user's client: reads under RLS, and the staff RPCs. */
export interface StaffDatabase extends RpcClient {
  select(query: StaffSelect): PromiseLike<RpcResult>;
}

export type AdminRefusal = "not_staff" | "not_found" | "invalid" | "stale" | "not_allowed";
export type AdminResult<T> = { ok: true; value: T } | { ok: false; reason: AdminRefusal };

const REFUSALS: Readonly<Record<string, AdminRefusal>> = {
  "42501": "not_staff",
  P0002: "not_found",
  "22023": "invalid",
  "40001": "stale",
  "55000": "not_allowed",
};

const refused = (reason: AdminRefusal): { ok: false; reason: AdminRefusal } => ({ ok: false, reason });

/** One staff RPC: its data, a named refusal, or an RpcError for anything else. */
async function staffCall(db: StaffDatabase, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; reason: AdminRefusal }> {
  try {
    return { ok: true, data: await callRpc(db, fn, args) };
  } catch (error) {
    if (error instanceof RpcError && Object.hasOwn(REFUSALS, error.code)) return refused(REFUSALS[error.code]!);
    throw error;
  }
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isStatus = (value: unknown): value is OrderStatus => (ORDER_STATUSES as readonly unknown[]).includes(value);
const isRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const normalisedReference = (reference: string) => reference.trim().toUpperCase();

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** Quote figures (R96): whole minor units from 0 to 100,000,000. */
export const QUOTE_AMOUNT_MAX_MINOR = 100_000_000;

export type QuoteFieldError = "required" | "invalid" | PaymentUrlRefusal;
export type QuoteField = "revision" | "currency" | "subtotalMinor" | "freightMinor" | "paymentUrl";

export interface QuoteSaveInput {
  /** The quote revision the staff member saw (0 before the first quote). */
  expectedRevision: number;
  currency: string;
  subtotalMinor: number;
  freightMinor: number;
  /** Normalised by validatePaymentUrl, on an allowed host. */
  paymentUrl: string;
}

export type QuoteRequest =
  | { ok: true; intent: "save"; input: QuoteSaveInput }
  | { ok: true; intent: "send"; revision: number }
  | { ok: false; fieldErrors: Partial<Record<QuoteField | "intent", QuoteFieldError>> };

/** ISO 4217 codes this runtime knows (Intl); just the shape where Intl cannot list them. */
function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : null;
  return list ? list.includes(code) : true;
}

const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= QUOTE_AMOUNT_MAX_MINOR;

const hasOnly = (input: Record<string, unknown>, keys: readonly string[]) => Object.keys(input).every((key) => keys.includes(key));

/**
 * The body of POST /api/admin/orders/[reference]/quote:
 *   { intent: "save", revision, currency, subtotalMinor, freightMinor, paymentUrl }
 *   { intent: "send", revision }
 * Any other key, or a payment link that validatePaymentUrl refuses for `allowedHosts`, is a field problem.
 */
export function parseQuoteRequest(input: unknown, allowedHosts: readonly string[]): QuoteRequest {
  if (!isRecord(input)) return { ok: false, fieldErrors: { intent: "required" } };
  if (input.intent === "send") {
    if (!hasOnly(input, ["intent", "revision"])) return { ok: false, fieldErrors: { intent: "invalid" } };
    const { revision } = input;
    if (revision === undefined) return { ok: false, fieldErrors: { revision: "required" } };
    if (!isRevision(revision) || revision < 1) return { ok: false, fieldErrors: { revision: "invalid" } };
    return { ok: true, intent: "send", revision };
  }
  if (input.intent !== "save") return { ok: false, fieldErrors: { intent: input.intent === undefined ? "required" : "invalid" } };
  if (!hasOnly(input, ["intent", "revision", "currency", "subtotalMinor", "freightMinor", "paymentUrl"])) return { ok: false, fieldErrors: { intent: "invalid" } };

  const fieldErrors: Partial<Record<QuoteField, QuoteFieldError>> = {};
  const { revision, subtotalMinor, freightMinor } = input;
  if (revision === undefined) fieldErrors.revision = "required";
  else if (!isRevision(revision)) fieldErrors.revision = "invalid";

  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (input.currency === undefined || currency === "") fieldErrors.currency = "required";
  else if (!isCurrency(currency)) fieldErrors.currency = "invalid";

  for (const [field, value] of [["subtotalMinor", subtotalMinor], ["freightMinor", freightMinor]] as const) {
    if (value === undefined || value === null) fieldErrors[field] = "required";
    else if (!isAmount(value)) fieldErrors[field] = "invalid";
  }

  let paymentUrl = "";
  if (input.paymentUrl === undefined || input.paymentUrl === "") fieldErrors.paymentUrl = allowedHosts.length === 0 ? "no_allowed_hosts" : "required";
  else {
    const checked = validatePaymentUrl(input.paymentUrl, allowedHosts);
    if (checked.ok) paymentUrl = checked.url;
    else fieldErrors.paymentUrl = checked.reason;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    intent: "save",
    input: { expectedRevision: revision as number, currency, subtotalMinor: subtotalMinor as number, freightMinor: freightMinor as number, paymentUrl },
  };
}

export type StatusField = "from" | "to";
export type StatusRequest =
  | { ok: true; from: OrderStatus; to: OrderStatus }
  | { ok: false; fieldErrors: Partial<Record<StatusField, "required" | "invalid" | "not_allowed">> };

/** The body of POST /api/admin/orders/[reference]/status: `{ from, to }`, one allowed step (R98). */
export function parseStatusRequest(input: unknown): StatusRequest {
  if (!isRecord(input) || !hasOnly(input, ["from", "to"])) return { ok: false, fieldErrors: { from: "required", to: "required" } };
  const fieldErrors: Partial<Record<StatusField, "required" | "invalid" | "not_allowed">> = {};
  for (const field of ["from", "to"] as const) {
    if (input[field] === undefined) fieldErrors[field] = "required";
    else if (!isStatus(input[field])) fieldErrors[field] = "invalid";
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  const from = input.from as OrderStatus;
  const to = input.to as OrderStatus;
  if (!canTransitionOrder(from, to)) return { ok: false, fieldErrors: { to: "not_allowed" } };
  return { ok: true, from, to };
}

// ---------------------------------------------------------------------------
// Writes (the staff RPCs of migration 0007)
// ---------------------------------------------------------------------------

export async function saveOrderQuote(
  db: StaffDatabase,
  { reference, expectedRevision, currency, subtotalMinor, freightMinor, paymentUrl }: { reference: string } & QuoteSaveInput,
): Promise<AdminResult<{ orderId: string; revision: number }>> {
  if (!ORDER_REFERENCE_PATTERN.test(normalisedReference(reference))) return refused("not_found");
  if (paymentUrl.length > PAYMENT_URL_MAX_LENGTH) return refused("invalid");
  const call = await staffCall(db, "staff_save_order_quote", {
    p_reference: normalisedReference(reference),
    p_expected_revision: expectedRevision,
    p_currency: currency,
    p_subtotal_minor: subtotalMinor,
    p_freight_minor: freightMinor,
    p_payment_url: paymentUrl,
  });
  if (!call.ok) return call;
  const row = firstRow(call.data);
  if (!isUuid(row?.order_id) || !isRevision(row?.quote_revision) || row.quote_revision !== expectedRevision + 1) {
    throw new RpcError("staff_save_order_quote", "bad_response");
  }
  return { ok: true, value: { orderId: row.order_id, revision: row.quote_revision } };
}

/** R96: the explicit send of one saved revision. A repeat answers `alreadyQueued` and queues nothing. */
export async function queueQuoteEmail(
  db: StaffDatabase,
  { reference, revision }: { reference: string; revision: number },
): Promise<AdminResult<{ orderId: string; revision: number; alreadyQueued: boolean }>> {
  if (!ORDER_REFERENCE_PATTERN.test(normalisedReference(reference))) return refused("not_found");
  const call = await staffCall(db, "staff_queue_order_quote", { p_reference: normalisedReference(reference), p_revision: revision });
  if (!call.ok) return call;
  const row = firstRow(call.data);
  if (!isUuid(row?.order_id) || row.quote_revision !== revision || typeof row.already_queued !== "boolean") {
    throw new RpcError("staff_queue_order_quote", "bad_response");
  }
  return { ok: true, value: { orderId: row.order_id, revision, alreadyQueued: row.already_queued } };
}

/** R98: one step, from the status the staff member saw. */
export async function advanceOrderStatus(
  db: StaffDatabase,
  { reference, from, to }: { reference: string; from: OrderStatus; to: OrderStatus },
): Promise<AdminResult<{ status: OrderStatus; statusChangedAt: string }>> {
  if (!ORDER_REFERENCE_PATTERN.test(normalisedReference(reference))) return refused("not_found");
  if (!canTransitionOrder(from, to)) return refused("invalid");
  const call = await staffCall(db, "staff_advance_order_status", { p_reference: normalisedReference(reference), p_from: from, p_to: to });
  if (!call.ok) return call;
  const row = firstRow(call.data);
  const changedAt = isoTimestamp(row?.status_changed_at);
  if (!isUuid(row?.order_id) || row.status !== to || !changedAt) throw new RpcError("staff_advance_order_status", "bad_response");
  return { ok: true, value: { status: to, statusChangedAt: changedAt } };
}

/** A new private tracking link (actor `staff`); the token exists outside a hash only in this answer. */
export async function rotateTrackingLink(db: StaffDatabase, reference: string): Promise<AdminResult<{ trackingToken: string; expiresAt: string }>> {
  if (!ORDER_REFERENCE_PATTERN.test(normalisedReference(reference))) return refused("not_found");
  const call = await staffCall(db, "staff_rotate_order_tracking_token", { p_reference: normalisedReference(reference) });
  if (!call.ok) return call;
  const row = firstRow(call.data);
  const expiresAt = isoTimestamp(row?.tracking_token_expires_at);
  if (typeof row?.tracking_token !== "string" || !TRACKING_TOKEN_PATTERN.test(row.tracking_token) || !expiresAt) {
    throw new RpcError("staff_rotate_order_tracking_token", "bad_response");
  }
  return { ok: true, value: { trackingToken: row.tracking_token, expiresAt } };
}

// ---------------------------------------------------------------------------
// The quote email, right after the answer (R88, R95: the only service-role step)
// ---------------------------------------------------------------------------

/** Most claims one send makes: older, superseded quote rows are skipped one claim at a time first. */
const QUOTE_SEND_MAX_CLAIMS = 5;

/**
 * Attempts an order's queued quote through Task 8a's claim (the same claim the cron worker uses, so
 * a row is never sent by both). The claim skips superseded revisions (and quotes of orders past
 * `confirmed`); each skip is one claim, so this claims again until one row was attempted, the
 * budget is spent, or nothing is due. Whatever is not sent stays queued for the worker.
 */
export function createQuoteEmailSender(
  outbox: OrderEmailOutbox,
  settings: OrderChannelSettings,
  context: AttemptContext<OrderEmailKind>,
): (orderId: string) => Promise<void> {
  const channel = orderEmailChannel(outbox, settings);
  return async (orderId) => {
    for (let claims = 0; claims < QUOTE_SEND_MAX_CLAIMS; claims += 1) {
      const step = await attemptNext(channel, { ownerId: orderId, kinds: ["quote"] }, context);
      const attempted = step.tally.sent + step.tally.failed + step.tally.deferred > 0;
      if (step.outcome !== "progress" || attempted) return;
    }
  };
}

// ---------------------------------------------------------------------------
// Reads (row level security: active staff only)
// ---------------------------------------------------------------------------

export interface AdminOrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  statusChangedAt: string;
  createdAt: string;
  contactName: string;
  email: string;
  country: string;
  quoteRevision: number;
  quoteSentAt: string | null;
}

export interface AdminOrderLine {
  lineNumber: number;
  productId: string;
  title: string;
  sku: string | null;
  variant: string | null;
  pack: string | null;
  quantity: number;
}

export interface AdminOrderEvent {
  actor: "customer" | "staff" | "system";
  actorUserId: string | null;
  eventType: string;
  oldStatus: OrderStatus | null;
  newStatus: OrderStatus | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminOrderEmail {
  kind: OrderEmailKind;
  quoteRevision: number | null;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  notes: string | null;
  consentVersion: string;
  consentGrantedAt: string;
  currency: string | null;
  subtotalMinor: number | null;
  freightMinor: number | null;
  paymentUrl: string | null;
  trackingTokenExpiresAt: string;
  trackingTokenRotatedAt: string | null;
  updatedAt: string;
  lines: AdminOrderLine[];
  events: AdminOrderEvent[];
  emails: AdminOrderEmail[];
}

const SUMMARY_COLUMNS = ["id", "reference", "status", "status_changed_at", "created_at", "contact_name", "email", "country", "quote_revision", "quote_sent_at"] as const;
const DETAIL_COLUMNS = [
  ...SUMMARY_COLUMNS,
  "phone", "address_line1", "address_line2", "city", "region", "postal_code", "notes", "consent_version", "consent_granted_at",
  "currency", "subtotal_minor", "freight_minor", "payment_url", "tracking_token_expires_at", "tracking_token_rotated_at", "updated_at",
] as const;
const LINE_COLUMNS = ["line_number", "sanity_id", "title", "sku", "variant", "pack", "quantity"] as const;
const EVENT_COLUMNS = ["actor", "actor_user_id", "event_type", "old_status", "new_status", "metadata", "created_at"] as const;
const EMAIL_COLUMNS = ["kind", "quote_revision", "status", "attempts", "last_attempt_at", "next_attempt_at", "last_error_code", "created_at"] as const;

async function selectRows(db: StaffDatabase, query: StaffSelect): Promise<Record<string, unknown>[]> {
  const { data, error } = await db.select(query);
  if (error) throw new RpcError(`select_${query.table}`, error.code);
  if (!Array.isArray(data) || !data.every(isRecord)) throw new RpcError(`select_${query.table}`, "bad_response");
  return data;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const optional = (value: unknown): string | null | undefined => (value === null ? null : typeof value === "string" ? value : undefined);
const optionalTime = (value: unknown): string | null | undefined => (value === null ? null : isoTimestamp(value) ?? undefined);
const optionalInteger = (value: unknown): number | null | undefined => (value === null ? null : typeof value === "number" && Number.isSafeInteger(value) ? value : undefined);

function summaryFrom(row: Record<string, unknown>): AdminOrderSummary | null {
  const statusChangedAt = isoTimestamp(row.status_changed_at);
  const createdAt = isoTimestamp(row.created_at);
  const quoteSentAt = optionalTime(row.quote_sent_at);
  const { id, reference, status, quote_revision: quoteRevision } = row;
  const contactName = text(row.contact_name);
  const email = text(row.email);
  const country = text(row.country);
  if (!isUuid(id) || typeof reference !== "string" || !ORDER_REFERENCE_PATTERN.test(reference) || !isStatus(status)) return null;
  if (!statusChangedAt || !createdAt || quoteSentAt === undefined || !isRevision(quoteRevision) || !contactName || !email || !country) return null;
  return { id, reference, status, statusChangedAt, createdAt, contactName, email, country, quoteRevision, quoteSentAt };
}

function detailFrom(row: Record<string, unknown>): Omit<AdminOrderDetail, "lines" | "events" | "emails"> | null {
  const summary = summaryFrom(row);
  const addressLine1 = text(row.address_line1);
  const city = text(row.city);
  const consentVersion = text(row.consent_version);
  const consentGrantedAt = isoTimestamp(row.consent_granted_at);
  const trackingTokenExpiresAt = isoTimestamp(row.tracking_token_expires_at);
  const updatedAt = isoTimestamp(row.updated_at);
  const optionals = {
    phone: optional(row.phone),
    addressLine2: optional(row.address_line2),
    region: optional(row.region),
    postalCode: optional(row.postal_code),
    notes: optional(row.notes),
    currency: optional(row.currency),
    paymentUrl: optional(row.payment_url),
    subtotalMinor: optionalInteger(row.subtotal_minor),
    freightMinor: optionalInteger(row.freight_minor),
    trackingTokenRotatedAt: optionalTime(row.tracking_token_rotated_at),
  };
  if (!summary || !addressLine1 || !city || !consentVersion || !consentGrantedAt || !trackingTokenExpiresAt || !updatedAt) return null;
  if (Object.values(optionals).some((value) => value === undefined)) return null;
  return {
    ...summary,
    ...(optionals as { [K in keyof typeof optionals]: Exclude<(typeof optionals)[K], undefined> }),
    addressLine1,
    city,
    consentVersion,
    consentGrantedAt,
    trackingTokenExpiresAt,
    updatedAt,
  };
}

function lineFrom(row: Record<string, unknown>): AdminOrderLine | null {
  const { line_number: lineNumber, quantity } = row;
  const productId = text(row.sanity_id);
  const title = text(row.title);
  const sku = optional(row.sku);
  const variant = optional(row.variant);
  const pack = optional(row.pack);
  if (typeof lineNumber !== "number" || typeof quantity !== "number" || !productId || !title) return null;
  if (sku === undefined || variant === undefined || pack === undefined) return null;
  return { lineNumber, productId, title, sku, variant, pack, quantity };
}

function eventFrom(row: Record<string, unknown>): AdminOrderEvent | null {
  const { actor, metadata } = row;
  const eventType = text(row.event_type);
  const actorUserId = optional(row.actor_user_id);
  const createdAt = isoTimestamp(row.created_at);
  const oldStatus = row.old_status === null ? null : isStatus(row.old_status) ? row.old_status : undefined;
  const newStatus = row.new_status === null ? null : isStatus(row.new_status) ? row.new_status : undefined;
  if (actor !== "customer" && actor !== "staff" && actor !== "system") return null;
  if (!eventType || actorUserId === undefined || !createdAt || oldStatus === undefined || newStatus === undefined || !isRecord(metadata)) return null;
  return { actor, actorUserId, eventType, oldStatus, newStatus, metadata, createdAt };
}

const EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;

function emailFrom(row: Record<string, unknown>): AdminOrderEmail | null {
  const { kind, status, attempts } = row;
  const quoteRevision = optionalInteger(row.quote_revision);
  const lastAttemptAt = optionalTime(row.last_attempt_at);
  // 'infinity' (a row parked for a human) is not a time: shown as none.
  const nextAttemptAt = row.next_attempt_at === "infinity" ? null : optionalTime(row.next_attempt_at);
  const lastErrorCode = optional(row.last_error_code);
  const createdAt = isoTimestamp(row.created_at);
  if (kind !== "acknowledgement" && kind !== "staff_alert" && kind !== "quote") return null;
  if (!(EMAIL_STATUSES as readonly unknown[]).includes(status) || typeof attempts !== "number" || !createdAt) return null;
  if (quoteRevision === undefined || lastAttemptAt === undefined || nextAttemptAt === undefined || lastErrorCode === undefined) return null;
  return { kind, quoteRevision, status: status as AdminOrderEmail["status"], attempts, lastAttemptAt, nextAttemptAt, lastErrorCode, createdAt };
}

function all<T>(table: string, rows: Record<string, unknown>[], build: (row: Record<string, unknown>) => T | null): T[] {
  const built = rows.map(build);
  if (built.some((entry) => entry === null)) throw new RpcError(`select_${table}`, "bad_response");
  return built as T[];
}

/** Newest first; at most `limit` (1-200) orders, optionally of one status. */
export async function listOrders(db: StaffDatabase, { status, limit = 100 }: { status?: OrderStatus; limit?: number } = {}): Promise<AdminOrderSummary[]> {
  const rows = await selectRows(db, {
    table: "orders",
    columns: SUMMARY_COLUMNS,
    ...(status ? { match: { status } } : {}),
    order: { column: "created_at", ascending: false },
    limit: Math.min(Math.max(Math.trunc(limit), 1), 200),
  });
  return all("orders", rows, summaryFrom);
}

/** One order with its lines, audit trail and emails; null when staff cannot see it or it does not exist. */
export async function getOrder(db: StaffDatabase, reference: string): Promise<AdminOrderDetail | null> {
  const wanted = normalisedReference(reference);
  if (!ORDER_REFERENCE_PATTERN.test(wanted)) return null;
  const [row] = await selectRows(db, { table: "orders", columns: DETAIL_COLUMNS, match: { reference: wanted }, limit: 1 });
  if (!row) return null;
  const order = detailFrom(row);
  if (!order) throw new RpcError("select_orders", "bad_response");
  const [lines, events, emails] = await Promise.all([
    selectRows(db, { table: "order_items", columns: LINE_COLUMNS, match: { order_id: order.id }, order: { column: "line_number", ascending: true } }),
    selectRows(db, { table: "order_events", columns: EVENT_COLUMNS, match: { order_id: order.id }, order: { column: "created_at", ascending: true } }),
    selectRows(db, { table: "order_email_outbox", columns: EMAIL_COLUMNS, match: { order_id: order.id }, order: { column: "created_at", ascending: true } }),
  ]);
  return { ...order, lines: all("order_items", lines, lineFrom), events: all("order_events", events, eventFrom), emails: all("order_email_outbox", emails, emailFrom) };
}
