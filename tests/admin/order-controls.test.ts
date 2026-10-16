import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { handleQuoteRequest, handleStatusRequest, handleTrackingLinkRequest, type AdminRouteDependencies } from "@/lib/admin/orders";
import { ADMIN_HEADERS, isSameOriginRequest } from "@/lib/admin/http";
import { ORDER_STATUSES, canTransitionOrder, type OrderStatus } from "@/lib/orders/constants";
import { advanceOrderStatus, getOrder, listOrders, parseQuoteRequest, parseStatusRequest } from "@/lib/orders/admin";
import type { StaffAccess } from "@/lib/supabase/auth";
import { StaffAuthUnavailableError } from "@/lib/supabase/auth";
import { STAFF_FIXTURE, pgliteStaffDatabase, seedOrder, seedStaff } from "@/tests/support/pglite-staff";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * The staff order controls' API rules (Task 8b; spec §10 steps 8-10; rulings R96-R99): the quote,
 * status and tracking-link routes, their request bodies, the one-way status flow, and what each
 * route answers to whom. The admin pages and their controls are Task 8c.
 *
 *   403 cross-site or not JSON (no detail) · 401 signed out · 403 not staff (the same body as a
 *   cross-site request) · 404 unknown reference · 409 stale status or revision, or not possible in
 *   the order's state · 400 field problems · 503 unconfigured · 200 done.
 */
let db: PGlite;

beforeAll(async () => {
  db = await createSupabaseStandIn();
  await applyMigrations(db, migrationFiles());
  await seedStaff(db);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ORIGIN = "https://bibobay.example";
const QUOTE = { currency: "AUD", subtotalMinor: 12_345, freightMinor: 1_500, paymentUrl: "https://pay.example.com/checkout/abc" } as const;
const HOSTS = ["pay.example.com"];

function adminRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const staffAccess = (userId: string = STAFF_FIXTURE.active): StaffAccess => ({ ok: true, staff: { userId, displayName: "Jo" }, database: pgliteStaffDatabase(db, userId) });

function dependencies(overrides: Partial<AdminRouteDependencies> = {}) {
  const after: Array<() => Promise<void>> = [];
  const log = vi.fn();
  const sendQuoteNow = vi.fn(async () => {});
  const deps: AdminRouteDependencies = {
    access: async () => staffAccess(),
    paymentHosts: HOSTS,
    sendQuoteNow,
    runAfterResponse: (task) => {
      after.push(task);
    },
    log,
    ...overrides,
  };
  return { deps, after, log, sendQuoteNow };
}

async function answer(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers };
}

async function orderRow(orderId: string) {
  const { rows } = await db.query<{ status: string; quote_revision: number }>("select status, quote_revision from public.orders where id = $1", [orderId]);
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

describe("the quote request body", () => {
  it("accepts a save with every figure and an allowed payment link, normalising currency and link", () => {
    expect(parseQuoteRequest({ intent: "save", revision: 0, ...QUOTE, currency: " aud ", paymentUrl: "https://PAY.example.com/checkout/abc" }, HOSTS)).toEqual({
      ok: true,
      intent: "save",
      input: { expectedRevision: 0, currency: "AUD", subtotalMinor: 12_345, freightMinor: 1_500, paymentUrl: "https://pay.example.com/checkout/abc" },
    });
  });

  it("accepts a send of one revision", () => {
    expect(parseQuoteRequest({ intent: "send", revision: 2 }, HOSTS)).toEqual({ ok: true, intent: "send", revision: 2 });
  });

  it.each([
    [{ intent: "save", revision: 0, ...QUOTE, currency: "XYZ" }, { currency: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, currency: "AUDD" }, { currency: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, currency: "" }, { currency: "required" }],
    [{ intent: "save", revision: 0, ...QUOTE, subtotalMinor: -1 }, { subtotalMinor: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, subtotalMinor: 100_000_001 }, { subtotalMinor: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, subtotalMinor: 12.5 }, { subtotalMinor: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, subtotalMinor: "12345" }, { subtotalMinor: "invalid" }],
    [{ intent: "save", revision: 0, ...QUOTE, freightMinor: null }, { freightMinor: "required" }],
    [{ intent: "save", revision: 0, ...QUOTE, paymentUrl: "http://pay.example.com/x" }, { paymentUrl: "not_https" }],
    [{ intent: "save", revision: 0, ...QUOTE, paymentUrl: "https://evil.example/x" }, { paymentUrl: "host_not_allowed" }],
    [{ intent: "save", revision: 0, ...QUOTE, paymentUrl: "" }, { paymentUrl: "required" }],
    [{ intent: "save", revision: -1, ...QUOTE }, { revision: "invalid" }],
    [{ intent: "save", ...QUOTE }, { revision: "required" }],
    [{ intent: "save", revision: 0, ...QUOTE, price: 1 }, { intent: "invalid" }],
    [{ intent: "send" }, { revision: "required" }],
    [{ intent: "send", revision: 0 }, { revision: "invalid" }],
    [{ intent: "send", revision: 1, paymentUrl: "x" }, { intent: "invalid" }],
    [{ intent: "delete" }, { intent: "invalid" }],
    [{}, { intent: "required" }],
    [[], { intent: "required" }],
    [null, { intent: "required" }],
  ] as const)("refuses %j with %j", (body, fieldErrors) => {
    expect(parseQuoteRequest(body, HOSTS)).toEqual({ ok: false, fieldErrors });
  });

  it("says that no payment link can be accepted while the allowlist is empty", () => {
    expect(parseQuoteRequest({ intent: "save", revision: 0, ...QUOTE }, [])).toEqual({ ok: false, fieldErrors: { paymentUrl: "no_allowed_hosts" } });
    expect(parseQuoteRequest({ intent: "save", revision: 0, ...QUOTE, paymentUrl: "" }, [])).toEqual({ ok: false, fieldErrors: { paymentUrl: "no_allowed_hosts" } });
  });
});

describe("the status request body (R98)", () => {
  it("accepts exactly the allowed steps", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const parsed = parseStatusRequest({ from, to });
        expect(parsed.ok, `${from} -> ${to}`).toBe(canTransitionOrder(from, to));
        if (!parsed.ok) expect(parsed.fieldErrors).toEqual({ to: "not_allowed" });
      }
    }
  });

  it("refuses unknown statuses, missing ones and extra keys", () => {
    expect(parseStatusRequest({ from: "new", to: "refunded" })).toEqual({ ok: false, fieldErrors: { to: "invalid" } });
    expect(parseStatusRequest({ to: "confirmed" })).toEqual({ ok: false, fieldErrors: { from: "required" } });
    expect(parseStatusRequest({ from: "new", to: "confirmed", note: "x" })).toEqual({ ok: false, fieldErrors: { from: "required", to: "required" } });
    expect(parseStatusRequest("new")).toEqual({ ok: false, fieldErrors: { from: "required", to: "required" } });
  });
});

// ---------------------------------------------------------------------------
// The one-way flow in the database
// ---------------------------------------------------------------------------

describe("advanceOrderStatus (R98) against the real migration", () => {
  const staff = () => pgliteStaffDatabase(db, STAFF_FIXTURE.active);
  const path: OrderStatus[] = ["new", "confirmed", "paid", "dispatched", "closed"];

  it("walks new -> confirmed -> paid -> dispatched -> closed, one step at a time, and records each", async () => {
    const order = await seedOrder(db);
    for (let index = 1; index < path.length; index += 1) {
      const result = await advanceOrderStatus(staff(), { reference: order.reference, from: path[index - 1]!, to: path[index]! });
      expect(result, path[index]).toMatchObject({ ok: true, value: { status: path[index] } });
    }
    const { rows } = await db.query<{ count: number }>("select count(*)::integer as count from public.order_events where order_id = $1 and event_type = 'status_changed' and actor = 'staff' and actor_user_id = $2", [order.orderId, STAFF_FIXTURE.active]);
    expect(rows[0]!.count).toBe(4);
  });

  it.each(["new", "confirmed", "paid", "dispatched"] as const)("allows cancelling from %s", async (from) => {
    const order = await seedOrder(db);
    for (const step of path.slice(1, path.indexOf(from) + 1)) await advanceOrderStatus(staff(), { reference: order.reference, from: path[path.indexOf(step) - 1]!, to: step });
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from, to: "cancelled" })).toMatchObject({ ok: true, value: { status: "cancelled" } });
  });

  it("treats closed and cancelled as final", async () => {
    const closed = await seedOrder(db);
    for (let index = 1; index < path.length; index += 1) await advanceOrderStatus(staff(), { reference: closed.reference, from: path[index - 1]!, to: path[index]! });
    for (const to of ORDER_STATUSES) expect(await advanceOrderStatus(staff(), { reference: closed.reference, from: "closed", to }), `closed -> ${to}`).toEqual({ ok: false, reason: "invalid" });

    const cancelled = await seedOrder(db);
    await advanceOrderStatus(staff(), { reference: cancelled.reference, from: "new", to: "cancelled" });
    for (const to of ORDER_STATUSES) expect(await advanceOrderStatus(staff(), { reference: cancelled.reference, from: "cancelled", to }), `cancelled -> ${to}`).toEqual({ ok: false, reason: "invalid" });
    expect(await orderRow(cancelled.orderId)).toMatchObject({ status: "cancelled" });
  });

  it("refuses a change from a status the order no longer has, so two staff never overwrite each other", async () => {
    const order = await seedOrder(db);
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "new", to: "confirmed" })).toMatchObject({ ok: true });
    expect(await advanceOrderStatus(staff(), { reference: order.reference, from: "new", to: "cancelled" })).toEqual({ ok: false, reason: "stale" });
    expect((await orderRow(order.orderId)).status).toBe("confirmed");
  });

  it("answers not found for an unknown reference, and does not ask the database about a malformed one", async () => {
    expect(await advanceOrderStatus(staff(), { reference: "BB-0000-0000", from: "new", to: "confirmed" })).toEqual({ ok: false, reason: "not_found" });
    const database = { select: vi.fn(), rpc: vi.fn() };
    expect(await advanceOrderStatus(database, { reference: "../etc", from: "new", to: "confirmed" })).toEqual({ ok: false, reason: "not_found" });
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

describe("staff reads under row level security", () => {
  it("lists orders newest first with their contact, status and quote state, for active staff", async () => {
    const order = await seedOrder(db, "newest@example.com");
    const orders = await listOrders(pgliteStaffDatabase(db, STAFF_FIXTURE.active));
    expect(orders[0]).toMatchObject({ id: order.orderId, reference: order.reference, status: "new", email: "newest@example.com", contactName: "Sam Rivers", quoteRevision: 0, quoteSentAt: null });
    expect(new Set(Object.keys(orders[0]!))).toEqual(new Set(["id", "reference", "status", "statusChangedAt", "createdAt", "contactName", "email", "country", "quoteRevision", "quoteSentAt"]));
  });

  it("reads one order with its lines, audit trail and emails, never its token hash or submission key", async () => {
    const order = await seedOrder(db);
    const detail = await getOrder(pgliteStaffDatabase(db, STAFF_FIXTURE.active), order.reference.toLowerCase());
    expect(detail).toMatchObject({
      reference: order.reference,
      addressLine1: "12 Harbour Road",
      phone: "+61 2 5550 1234",
      notes: "Leave at the door",
      lines: [{ lineNumber: 1, productId: "product-tula", title: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", quantity: 2 }],
      events: [{ actor: "customer", eventType: "order_submitted", newStatus: "new" }],
    });
    expect(detail!.emails.map((email) => email.kind).sort()).toEqual(["acknowledgement", "staff_alert"]);
    const text = JSON.stringify(detail);
    expect(text).not.toContain(order.trackingToken);
    expect(text).not.toMatch(/tracking_token_hash|trackingTokenHash|submission|idempotency|provider/i);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it.each([
    ["a signed-in user without a staff row", STAFF_FIXTURE.visitor],
    ["inactive staff", STAFF_FIXTURE.inactive],
  ] as const)("shows %s nothing at all", async (_who, userId) => {
    const order = await seedOrder(db);
    expect(await listOrders(pgliteStaffDatabase(db, userId))).toEqual([]);
    expect(await getOrder(pgliteStaffDatabase(db, userId), order.reference)).toBeNull();
  });

  it("answers null for an unknown or malformed reference", async () => {
    expect(await getOrder(pgliteStaffDatabase(db, STAFF_FIXTURE.active), "BB-0000-0000")).toBeNull();
    expect(await getOrder(pgliteStaffDatabase(db, STAFF_FIXTURE.active), "BB-0000-0000' or '1'='1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The routes' rules (R99), on the handlers the route files call
// ---------------------------------------------------------------------------

describe("same-origin JSON only (R99, R110)", () => {
  it("accepts Sec-Fetch-Site same-origin, or without it an Origin equal to the request's own host", () => {
    expect(isSameOriginRequest(adminRequest("/api/admin/x", {}))).toBe(true);
    expect(isSameOriginRequest(adminRequest("/api/admin/x", {}, { "sec-fetch-site": "", host: "bibobay.example" }))).toBe(true);
    const fetchSiteOnly = new Request(`${ORIGIN}/api/admin/x`, { method: "POST", headers: { "sec-fetch-site": "same-origin" } });
    expect(isSameOriginRequest(fetchSiteOnly)).toBe(true);
  });

  it.each([
    ["another origin", { origin: "https://evil.example", "sec-fetch-site": "", host: "bibobay.example" }],
    ["another scheme", { origin: "http://bibobay.example", "sec-fetch-site": "", host: "bibobay.example", "x-forwarded-proto": "https" }],
    ["another port", { origin: "https://bibobay.example:8443", "sec-fetch-site": "", host: "bibobay.example" }],
    ["a subdomain", { origin: "https://shop.bibobay.example", "sec-fetch-site": "same-site" }],
    ["an opaque origin", { origin: "null", "sec-fetch-site": "", host: "bibobay.example" }],
    ["a cross-site fetch with a forged origin", { "sec-fetch-site": "cross-site" }],
    ["a same-site fetch", { "sec-fetch-site": "same-site" }],
    ["a navigation typed in the address bar", { "sec-fetch-site": "none" }],
  ] as const)("refuses %s", (_case, headers) => {
    expect(isSameOriginRequest(adminRequest("/api/admin/x", {}, headers))).toBe(false);
  });

  it("refuses a request with neither header", () => {
    expect(isSameOriginRequest(new Request(`${ORIGIN}/api/admin/x`, { method: "POST" }))).toBe(false);
  });
});

describe("POST /api/admin/orders/[reference]/status", () => {
  it("moves the order one step and answers its new status, privately", async () => {
    const order = await seedOrder(db);
    const { deps, log } = dependencies();
    const { status, body, headers } = await answer(await handleStatusRequest(adminRequest(`/api/admin/orders/${order.reference}/status`, { from: "new", to: "confirmed" }), order.reference, deps));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, status: "confirmed", statusChangedAt: expect.any(String), message: ADMIN_COPY.status.changed });
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) expect(headers.get(name), name).toBe(value);
    expect(log).toHaveBeenCalledWith({ event: "admin_status_changed", status: "confirmed" });
  });

  it("refuses cross-site and non-JSON requests with 403 and no detail, before reading the session", async () => {
    const order = await seedOrder(db);
    const access = vi.fn(async () => staffAccess());
    const { deps } = dependencies({ access });
    for (const request of [
      adminRequest(`/api/admin/orders/${order.reference}/status`, { from: "new", to: "confirmed" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      adminRequest(`/api/admin/orders/${order.reference}/status`, "from=new&to=confirmed", { "content-type": "application/x-www-form-urlencoded" }),
      adminRequest(`/api/admin/orders/${order.reference}/status`, "{}", { "content-type": "text/plain" }),
    ]) {
      const { status, body } = await answer(await handleStatusRequest(request, order.reference, deps));
      expect(status).toBe(403);
      expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.forbidden });
    }
    expect(access).not.toHaveBeenCalled();
    expect((await orderRow(order.orderId)).status).toBe("new");
  });

  it("answers 401 signed out, and 403 for a user who is not staff with the same body as a cross-site request", async () => {
    const order = await seedOrder(db);
    const request = () => adminRequest(`/api/admin/orders/${order.reference}/status`, { from: "new", to: "confirmed" });
    expect(await answer(await handleStatusRequest(request(), order.reference, dependencies({ access: async () => ({ ok: false, reason: "signed_out" }) }).deps))).toMatchObject({
      status: 401,
      body: { ok: false, message: ADMIN_COPY.api.signedOut },
    });
    const notStaff = await answer(await handleStatusRequest(request(), order.reference, dependencies({ access: async () => ({ ok: false, reason: "not_staff" }) }).deps));
    const crossSite = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), order.reference, dependencies().deps));
    expect(notStaff.status).toBe(403);
    expect(notStaff.body).toEqual(crossSite.body);
    expect((await orderRow(order.orderId)).status).toBe("new");
  });

  it("refuses inactive staff and signed-in users without a staff row in the database too, even past the session check", async () => {
    const order = await seedOrder(db);
    for (const userId of [STAFF_FIXTURE.inactive, STAFF_FIXTURE.visitor]) {
      const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), order.reference, dependencies({ access: async () => staffAccess(userId) }).deps));
      expect(status, userId).toBe(403);
      expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.forbidden });
    }
    expect((await orderRow(order.orderId)).status).toBe("new");
  });

  it("answers 503 while staff sign-in is not configured, or when Auth cannot answer", async () => {
    const order = await seedOrder(db);
    expect((await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), order.reference, dependencies({ access: async () => ({ ok: false, reason: "unconfigured" }) }).deps)).status).toBe(503);
    const outage = dependencies({ access: async () => { throw new StaffAuthUnavailableError("auth_unavailable"); } });
    const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), order.reference, outage.deps));
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.unavailable });
  });

  it("answers 404 for an unknown or malformed reference", async () => {
    for (const reference of ["BB-0000-0000", "nope", "BB-1A2B-3C4D%27"]) {
      const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), reference, dependencies().deps));
      expect(status, reference).toBe(404);
      expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.notFound });
    }
  });

  it("answers 400 with the field problems for a step that is never allowed, from a terminal state too", async () => {
    const order = await seedOrder(db);
    for (const step of [{ from: "new", to: "paid" }, { from: "closed", to: "cancelled" }, { from: "cancelled", to: "confirmed" }, { from: "new", to: "shipped" }]) {
      const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", step), order.reference, dependencies().deps));
      expect(status, JSON.stringify(step)).toBe(400);
      expect(body).toMatchObject({ ok: false, message: ADMIN_COPY.api.checkDetails, fieldErrors: expect.any(Object) });
    }
    for (const raw of ["not json", "", "[1"]) {
      expect((await handleStatusRequest(adminRequest("/x", raw), order.reference, dependencies().deps)).status, raw).toBe(400);
    }
  });

  it("answers 409 when the order has moved on since the staff member looked", async () => {
    const order = await seedOrder(db);
    await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), order.reference, dependencies().deps);
    const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "cancelled" }), order.reference, dependencies().deps));
    expect(status).toBe(409);
    expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.stale });
  });

  it("answers 500 with generic copy when the database fails, and logs a code only", async () => {
    const order = await seedOrder(db);
    const broken: StaffAccess = { ok: true, staff: { userId: STAFF_FIXTURE.active, displayName: null }, database: { select: vi.fn(), rpc: async () => ({ data: null, error: { code: "XX000", message: `boom ${order.reference} buyer@example.com` } }) } };
    const { deps, log } = dependencies({ access: async () => broken });
    const { status, body } = await answer(await handleStatusRequest(adminRequest("/x", { from: "new", to: "confirmed" }), order.reference, deps));
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, message: ADMIN_COPY.api.failed });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/buyer@example|BB-/);
    expect(log).toHaveBeenCalledWith({ event: "admin_action_failed", code: "XX000" });
  });
});

describe("POST /api/admin/orders/[reference]/quote", () => {
  it("saves a quote and says nothing was sent", async () => {
    const order = await seedOrder(db);
    const { deps, after } = dependencies();
    const { status, body } = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, deps));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, revision: 1, message: ADMIN_COPY.quote.saved });
    expect(after).toEqual([]);
  });

  it("explains a refused payment link, and that none is accepted while no host is allowed", async () => {
    const order = await seedOrder(db);
    const refused = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE, paymentUrl: "https://evil.example/pay" }), order.reference, dependencies().deps));
    expect(refused).toMatchObject({ status: 400, body: { ok: false, message: ADMIN_COPY.api.checkDetails, fieldErrors: { paymentUrl: "host_not_allowed" } } });
    const none = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies({ paymentHosts: [] }).deps));
    expect(none).toMatchObject({ status: 400, body: { ok: false, message: ADMIN_COPY.quote.noPaymentHosts, fieldErrors: { paymentUrl: "no_allowed_hosts" } } });
    expect((await orderRow(order.orderId)).quote_revision).toBe(0);
  });

  it("queues a send, answers before any email is attempted, then attempts it once after the answer", async () => {
    const order = await seedOrder(db);
    await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies().deps);
    const { deps, after, sendQuoteNow } = dependencies();

    const { status, body } = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 1 }), order.reference, deps));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, revision: 1, alreadyQueued: false, message: ADMIN_COPY.quote.queued });
    expect(sendQuoteNow).not.toHaveBeenCalled();
    expect(after).toHaveLength(1);
    await after[0]!();
    expect(sendQuoteNow).toHaveBeenCalledExactlyOnceWith(order.orderId);
  });

  it("answers a repeated send as already queued and attempts nothing more", async () => {
    const order = await seedOrder(db);
    await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies().deps);
    await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 1 }), order.reference, dependencies().deps);
    const { deps, after } = dependencies();
    const { status, body } = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 1 }), order.reference, deps));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, revision: 1, alreadyQueued: true, message: ADMIN_COPY.quote.alreadyQueued });
    expect(after).toEqual([]);
  });

  it("still queues the quote when no email sender is configured: the worker sends it later", async () => {
    const order = await seedOrder(db);
    await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies().deps);
    const { deps, after } = dependencies({ sendQuoteNow: null });
    expect((await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 1 }), order.reference, deps)).status).toBe(200);
    expect(after).toEqual([]);
    const { rows } = await db.query<{ count: number }>("select count(*)::integer as count from public.order_email_outbox where order_id = $1 and kind = 'quote'", [order.orderId]);
    expect(rows[0]!.count).toBe(1);
  });

  it("answers 409 for a stale revision and for an order that can no longer be quoted", async () => {
    const order = await seedOrder(db);
    await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies().deps);
    expect(await answer(await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies().deps))).toMatchObject({ status: 409, body: { message: ADMIN_COPY.api.stale } });
    expect(await answer(await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 2 }), order.reference, dependencies().deps))).toMatchObject({ status: 409, body: { message: ADMIN_COPY.api.stale } });
    for (const [from, to] of [["new", "confirmed"], ["confirmed", "paid"]] as const) await advanceOrderStatus(pgliteStaffDatabase(db, STAFF_FIXTURE.active), { reference: order.reference, from, to });
    expect(await answer(await handleQuoteRequest(adminRequest("/x", { intent: "send", revision: 1 }), order.reference, dependencies().deps))).toMatchObject({ status: 409, body: { message: ADMIN_COPY.api.notAllowed } });
  });

  it("refuses everyone but active staff, writing nothing", async () => {
    const order = await seedOrder(db);
    // Final review T-M1: the exact code for each, as the status and tracking-link tests pin them. Signed out
    // is 401 ("sign in"); a user who is not staff, and inactive staff the database refuses, are 403.
    const refused = [
      ["signed out", async () => ({ ok: false, reason: "signed_out" }) as const, 401],
      ["not staff", async () => ({ ok: false, reason: "not_staff" }) as const, 403],
      ["inactive staff", async () => staffAccess(STAFF_FIXTURE.inactive), 403],
    ] as const;
    for (const [label, access, expected] of refused) {
      const { status } = await answer(await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }), order.reference, dependencies({ access }).deps));
      expect(status, label).toBe(expected);
    }
    const crossSite = await handleQuoteRequest(adminRequest("/x", { intent: "save", revision: 0, ...QUOTE }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), order.reference, dependencies().deps);
    expect(crossSite.status).toBe(403);
    expect((await orderRow(order.orderId)).quote_revision).toBe(0);
  });
});

describe("POST /api/admin/orders/[reference]/tracking-link", () => {
  it("issues a new private link, shown once, and never logs it", async () => {
    const order = await seedOrder(db);
    const { deps, log } = dependencies();
    const { status, body, headers } = await answer(await handleTrackingLinkRequest(adminRequest("/x", {}), order.reference, deps));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, trackingPath: expect.stringMatching(/^\/orders\/[0-9a-f]{64}$/), expiresAt: expect.any(String), message: ADMIN_COPY.trackingLink.rotated });
    expect(body.trackingPath).not.toBe(`/orders/${order.trackingToken}`);
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/[0-9a-f]{64}/);
    const { rows } = await db.query<{ actor: string }>("select actor from public.order_events where order_id = $1 and event_type = 'tracking_token_rotated'", [order.orderId]);
    expect(rows).toEqual([{ actor: "staff" }]);
  });

  it("follows the same rules: cross-site 403, signed out 401, not staff 403, unknown 404", async () => {
    const order = await seedOrder(db);
    expect((await handleTrackingLinkRequest(adminRequest("/x", {}, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }), order.reference, dependencies().deps)).status).toBe(403);
    expect((await handleTrackingLinkRequest(adminRequest("/x", {}), order.reference, dependencies({ access: async () => ({ ok: false, reason: "signed_out" }) }).deps)).status).toBe(401);
    expect((await handleTrackingLinkRequest(adminRequest("/x", {}), order.reference, dependencies({ access: async () => staffAccess(STAFF_FIXTURE.visitor) }).deps)).status).toBe(403);
    expect((await handleTrackingLinkRequest(adminRequest("/x", {}), "BB-0000-0000", dependencies().deps)).status).toBe(404);
    expect((await handleTrackingLinkRequest(adminRequest("/x", { reference: "x" }), order.reference, dependencies().deps)).status).toBe(400);
  });
});
