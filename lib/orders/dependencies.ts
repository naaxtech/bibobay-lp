import "server-only";

import { isCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import { SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import type { SiteSettings } from "@/lib/content/types";
import { CONSENT_VERSION_PATTERN, hashSecretFrom } from "@/lib/leads/dependencies";
import { clientKeyFromHeaders } from "@/lib/leads/http";
import { reportEvent } from "@/lib/observability/report";
import { getLegalSettings } from "@/lib/sanity/fetch";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseOrderRepository } from "@/lib/supabase/orders";
import { resolveCanonicalOrderLines } from "./catalogue";
import type { OrderLogEvent, OrderSubmissionDependencies } from "./submit";
import type { TrackingDependencies, TrackingLogEvent } from "./track";

/**
 * Wires the real adapters for one order or tracking request from the environment and the CMS,
 * the same way lib/leads/dependencies.ts does for signups.
 *
 * The caller has already read the CMS site settings and checked the commerce gate: while commerce
 * is off a route does no work at all (spec §10 "Server gating"), so nothing here runs.
 *
 * Storage counts as configured only with the Supabase URL, the server key AND the secret that
 * hashes client addresses for the shared rate limit (`LEAD_IP_HASH_SECRET`, at least 32
 * characters; the same keyed hash as signups, under the `order:` and `order-track:` scopes).
 * Missing any of them, the routes answer 503 and store nothing.
 */

const WARNING_EVENT = /_(failed|unavailable|unconfigured|invalid)$/;

function logEvent(scope: "orders" | "order-tracking", entry: OrderLogEvent | TrackingLogEvent): void {
  const line = JSON.stringify({ scope, ...entry });
  const warning = WARNING_EVENT.test(entry.event);
  if (warning) console.warn(line);
  else console.info(line);
  // Ruling R52: warnings also reach Sentry, tagged with the event and a code only.
  if (warning) reportEvent(entry.event, "code" in entry ? { code: entry.code } : {});
}

/** Structured operational log for order requests: event names and codes only, never a person or product. */
export const logOrderEvent = (entry: OrderLogEvent) => logEvent("orders", entry);

/** Structured operational log for tracking lookups: event names and codes only, never a token, reference or email. */
export const logTrackingEvent = (entry: TrackingLogEvent) => logEvent("order-tracking", entry);

/** The CMS consent version when the database will accept it, else the repository fallback (as for signups). */
function consentVersionFrom(cmsVersion: string): string {
  const version = cmsVersion.trim();
  if (CONSENT_VERSION_PATTERN.test(version)) return version;
  logOrderEvent({ event: "order_config_invalid", code: "consent_version_invalid" });
  return SAFE_FALLBACK_LEGAL.consentCopyVersion;
}

function storageFrom(env: Record<string, string | undefined>) {
  const admin = getSupabaseAdminEnvironment(env);
  const hashSecret = hashSecretFrom(env);
  return { client: admin && hashSecret ? createSupabaseAdminClient(admin) : null, hashSecret };
}

export async function createOrderDependencies(
  request: Request,
  settings: SiteSettings,
  env: Record<string, string | undefined> = process.env,
): Promise<OrderSubmissionDependencies> {
  const legal = await getLegalSettings();
  const { client, hashSecret } = storageFrom(env);
  return {
    commerceEnabled: isCommerceEnabled(settings),
    trackingEnabled: isTrackingEnabled(settings),
    repository: client ? createSupabaseOrderRepository(client) : null,
    rateLimiter: client ? createSupabaseRateLimiter(client) : null,
    resolveLines: (lines) => resolveCanonicalOrderLines(lines),
    consentVersion: consentVersionFrom(legal.consentCopyVersion),
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret) : "",
    log: logOrderEvent,
  };
}

/**
 * The adapters for one tracking lookup (app/api/orders/track, and Task 7b's /orders/[token] page).
 * It takes the request headers only, so a server page can pass `await headers()`.
 */
export function createTrackingDependencies(
  requestHeaders: Headers,
  settings: SiteSettings,
  env: Record<string, string | undefined> = process.env,
): TrackingDependencies {
  const { client, hashSecret } = storageFrom(env);
  return {
    enabled: isTrackingEnabled(settings),
    repository: client ? createSupabaseOrderRepository(client) : null,
    rateLimiter: client ? createSupabaseRateLimiter(client) : null,
    clientKey: hashSecret ? clientKeyFromHeaders(requestHeaders, hashSecret) : "",
    log: logTrackingEvent,
  };
}
