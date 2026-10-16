import "server-only";

import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { reportEvent } from "@/lib/observability/report";
import type { OrderStatus } from "@/lib/orders/constants";

/**
 * Request and response rules shared by every staff API route (Task 8b, ruling R99).
 *
 * The routes authenticate with cookies, so a page on another site could make a browser send them.
 * Every state-changing request must therefore come from this site's own pages: its `Origin` equals
 * the request's own origin, or, without an Origin, the browser says `Sec-Fetch-Site: same-origin`.
 * A `Sec-Fetch-Site` that says anything else wins over the Origin. And it must be JSON, which a
 * cross-site form cannot send without a CORS preflight this site never approves. Anything else is
 * 403 with no detail.
 *
 * Every answer is private and never stored or indexed (the same headers as next.config.ts's admin
 * rule, set here too so they hold whatever the platform does with config headers).
 */
export const ADMIN_HEADERS = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

export function adminJson(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...ADMIN_HEADERS, ...extra } });
}

export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    let own: string;
    try {
      own = new URL(request.url).origin;
    } catch {
      return false;
    }
    return origin === own;
  }
  return fetchSite === "same-origin";
}

/** R99: same-origin AND JSON. */
export const isAdminWrite = (request: Request) => isSameOriginRequest(request) && isJsonRequest(request);

/** Largest admin request body read. A quote is well under 4 KB (its link is at most 2,048 characters). */
export const ADMIN_BODY_LIMIT_BYTES = 16 * 1024;

/** The JSON body, `{}` for an empty one, or why it could not be read. */
export async function readAdminJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  const body = await readBodyWithLimit(request, ADMIN_BODY_LIMIT_BYTES);
  if (!body.ok) return { ok: false, status: body.reason === "too_large" ? 413 : 400 };
  if (body.text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

/**
 * The staff API's operational log: event names, reasons, statuses and short codes only. Never an
 * email, a name, a password, a reference, a token or a configuration value.
 */
export type AdminLogEvent =
  | { event: "admin_request_refused"; reason: "cross_site" | "signed_out" | "not_staff" }
  | { event: "admin_unconfigured" }
  | { event: "admin_auth_unavailable"; code: string }
  | { event: "admin_order_not_found" }
  | { event: "admin_fields_refused" }
  | { event: "admin_conflict"; reason: "stale" | "not_allowed" }
  | { event: "admin_quote_saved" }
  | { event: "admin_quote_queued"; alreadyQueued: boolean }
  | { event: "admin_status_changed"; status: OrderStatus }
  | { event: "admin_tracking_link_rotated" }
  | { event: "admin_action_failed"; code: string }
  | { event: "staff_signed_in" }
  | { event: "staff_sign_in_refused" }
  | { event: "staff_sign_in_rate_limited" }
  | { event: "staff_sign_in_unavailable"; code: string }
  | { event: "staff_signed_out" }
  /** The cookies were cleared, but Auth did not confirm it revoked the session. */
  | { event: "staff_sign_out_unavailable" };

const WARNING_EVENT = /_(failed|unavailable|unconfigured|invalid)$/;

export function logAdminEvent(entry: AdminLogEvent): void {
  const line = JSON.stringify({ scope: "admin", ...entry });
  const warning = WARNING_EVENT.test(entry.event);
  if (warning) console.warn(line);
  else console.info(line);
  // Ruling R52: warnings also reach Sentry, tagged with the event and a code only.
  if (warning) reportEvent(entry.event, "code" in entry ? { code: entry.code } : {});
}

/** A short, safe code for a log line: never a message, which could echo submitted values. */
export function codeOf(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown";
}
