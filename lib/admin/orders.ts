import "server-only";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { reportError } from "@/lib/observability/report";
import {
  advanceOrderStatus,
  parseQuoteRequest,
  parseStatusRequest,
  queueQuoteEmail,
  rotateTrackingLink,
  saveOrderQuote,
  type AdminRefusal,
  type StaffDatabase,
} from "@/lib/orders/admin";
import { ORDER_REFERENCE_PATTERN } from "@/lib/orders/fields";
import { StaffAuthUnavailableError, type StaffAccess } from "@/lib/supabase/auth";
import { adminJson, codeOf, isAdminWrite, readAdminJson, type AdminLogEvent } from "./http";

/**
 * The staff order routes (Task 8b; rulings R95-R99):
 *   POST /api/admin/orders/[reference]/quote         { intent: "save", revision, currency, subtotalMinor, freightMinor, paymentUrl }
 *                                                    { intent: "send", revision }
 *   POST /api/admin/orders/[reference]/status        { from, to }
 *   POST /api/admin/orders/[reference]/tracking-link {}
 *
 * In this order, each answers:
 *   403 cross-site or not JSON (no detail; the session is not even read)
 *   503 staff sign-in unconfigured, or Auth / the database unreachable · 401 signed out
 *   403 not active staff (the same body as a cross-site request)
 *   404 unknown or malformed reference · 400 unreadable body or field problems
 *   409 stale (the status or revision the staff member saw is no longer the order's) or not
 *       possible in the order's state · 500 anything else · 200 done.
 * Admin works whether commerce is on or off (spec §10 "Admin remains available to authorized staff").
 */

export interface AdminRouteDependencies {
  /** requireStaffUser for this request's session. May throw StaffAuthUnavailableError. */
  access(): Promise<StaffAccess>;
  /** PAYMENT_HOST_ALLOWLIST, parsed (R97). Empty: no payment link is accepted. */
  paymentHosts: readonly string[];
  /** Attempts an order's queued quote through Task 8a's claim (service role), or null without storage or email. */
  sendQuoteNow: ((orderId: string) => Promise<void>) | null;
  /** next/server `after()`: runs a task once the answer has been sent. */
  runAfterResponse(task: () => Promise<void>): void;
  log(event: AdminLogEvent): void;
}

type Staff = { database: StaffDatabase };

const forbidden = () => adminJson(403, { ok: false, message: ADMIN_COPY.api.forbidden });

/** The checks every staff order route makes before it reads a body: origin, JSON, session, reference. */
async function admit(request: Request, reference: string, deps: AdminRouteDependencies): Promise<Response | Staff> {
  if (!isAdminWrite(request)) {
    deps.log({ event: "admin_request_refused", reason: "cross_site" });
    return forbidden();
  }
  let access: StaffAccess;
  try {
    access = await deps.access();
  } catch (error) {
    if (!(error instanceof StaffAuthUnavailableError)) throw error;
    deps.log({ event: "admin_auth_unavailable", code: error.code });
    return adminJson(503, { ok: false, message: ADMIN_COPY.api.unavailable });
  }
  if (!access.ok) {
    if (access.reason === "unconfigured") {
      deps.log({ event: "admin_unconfigured" });
      return adminJson(503, { ok: false, message: ADMIN_COPY.api.unconfigured });
    }
    deps.log({ event: "admin_request_refused", reason: access.reason });
    return access.reason === "signed_out" ? adminJson(401, { ok: false, message: ADMIN_COPY.api.signedOut }) : forbidden();
  }
  if (!ORDER_REFERENCE_PATTERN.test(reference.trim().toUpperCase())) {
    deps.log({ event: "admin_order_not_found" });
    return adminJson(404, { ok: false, message: ADMIN_COPY.api.notFound });
  }
  return { database: access.database };
}

async function body(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const read = await readAdminJson(request);
  return read.ok ? read : { ok: false, response: adminJson(read.status, { ok: false, message: ADMIN_COPY.api.badRequest }) };
}

/** The answer for a refusal the database named. */
function refusal(reason: AdminRefusal, deps: AdminRouteDependencies): Response {
  switch (reason) {
    case "not_staff":
      deps.log({ event: "admin_request_refused", reason: "not_staff" });
      return forbidden();
    case "not_found":
      deps.log({ event: "admin_order_not_found" });
      return adminJson(404, { ok: false, message: ADMIN_COPY.api.notFound });
    case "invalid":
      deps.log({ event: "admin_fields_refused" });
      return adminJson(400, { ok: false, message: ADMIN_COPY.api.checkDetails });
    case "stale":
    case "not_allowed":
      deps.log({ event: "admin_conflict", reason });
      return adminJson(409, { ok: false, message: reason === "stale" ? ADMIN_COPY.api.stale : ADMIN_COPY.api.notAllowed });
  }
}

const fieldProblems = (fieldErrors: Record<string, string>, deps: AdminRouteDependencies, message: string = ADMIN_COPY.api.checkDetails) => {
  deps.log({ event: "admin_fields_refused" });
  return adminJson(400, { ok: false, message, fieldErrors });
};

/** Anything unexpected: generic copy, a code in the log, the error (tags only) in Sentry. */
async function guarded(deps: AdminRouteDependencies, event: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    deps.log({ event: "admin_action_failed", code: codeOf(error) });
    reportError(error, { area: "admin", event });
    return adminJson(500, { ok: false, message: ADMIN_COPY.api.failed });
  }
}

export function handleQuoteRequest(request: Request, reference: string, deps: AdminRouteDependencies): Promise<Response> {
  return guarded(deps, "admin_quote_failed", async () => {
    const staff = await admit(request, reference, deps);
    if (staff instanceof Response) return staff;
    const read = await body(request);
    if (!read.ok) return read.response;
    const parsed = parseQuoteRequest(read.value, deps.paymentHosts);
    if (!parsed.ok) {
      const noHosts = parsed.fieldErrors.paymentUrl === "no_allowed_hosts";
      return fieldProblems(parsed.fieldErrors, deps, noHosts ? ADMIN_COPY.quote.noPaymentHosts : ADMIN_COPY.api.checkDetails);
    }

    if (parsed.intent === "save") {
      const saved = await saveOrderQuote(staff.database, { reference, ...parsed.input });
      if (!saved.ok) return refusal(saved.reason, deps);
      deps.log({ event: "admin_quote_saved" });
      return adminJson(200, { ok: true, revision: saved.value.revision, message: ADMIN_COPY.quote.saved });
    }

    const queued = await queueQuoteEmail(staff.database, { reference, revision: parsed.revision });
    if (!queued.ok) return refusal(queued.reason, deps);
    const { orderId, revision, alreadyQueued } = queued.value;
    deps.log({ event: "admin_quote_queued", alreadyQueued });
    // R88: the newly queued quote is attempted after the answer, through 8a's claim; a repeat is a
    // no-op. Without storage or email it waits for the worker.
    const send = deps.sendQuoteNow;
    if (!alreadyQueued && send) deps.runAfterResponse(() => send(orderId));
    return adminJson(200, { ok: true, revision, alreadyQueued, message: alreadyQueued ? ADMIN_COPY.quote.alreadyQueued : ADMIN_COPY.quote.queued });
  });
}

export function handleStatusRequest(request: Request, reference: string, deps: AdminRouteDependencies): Promise<Response> {
  return guarded(deps, "admin_status_failed", async () => {
    const staff = await admit(request, reference, deps);
    if (staff instanceof Response) return staff;
    const read = await body(request);
    if (!read.ok) return read.response;
    const parsed = parseStatusRequest(read.value);
    if (!parsed.ok) return fieldProblems(parsed.fieldErrors, deps);
    const moved = await advanceOrderStatus(staff.database, { reference, from: parsed.from, to: parsed.to });
    if (!moved.ok) return refusal(moved.reason, deps);
    deps.log({ event: "admin_status_changed", status: moved.value.status });
    return adminJson(200, { ok: true, status: moved.value.status, statusChangedAt: moved.value.statusChangedAt, message: ADMIN_COPY.status.changed });
  });
}

export function handleTrackingLinkRequest(request: Request, reference: string, deps: AdminRouteDependencies): Promise<Response> {
  return guarded(deps, "admin_tracking_link_failed", async () => {
    const staff = await admit(request, reference, deps);
    if (staff instanceof Response) return staff;
    const read = await body(request);
    if (!read.ok) return read.response;
    const value = read.value;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 0) return fieldProblems({ body: "invalid" }, deps);
    const rotated = await rotateTrackingLink(staff.database, reference);
    if (!rotated.ok) return refusal(rotated.reason, deps);
    deps.log({ event: "admin_tracking_link_rotated" });
    // Shown to the staff member once; never logged. Only a hash of it is stored.
    return adminJson(200, { ok: true, trackingPath: `/orders/${rotated.value.trackingToken}`, expiresAt: rotated.value.expiresAt, message: ADMIN_COPY.trackingLink.rotated });
  });
}
