import "server-only";

import { after } from "next/server";

import { isCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import { SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import type { LegalSettings, SiteSettings } from "@/lib/content/types";
import { createEmailSenderFromEnv, getStaffNotificationEmail } from "@/lib/email/client";
import { ackSendLimitPerHour, CONSENT_VERSION_PATTERN, hashSecretFrom } from "@/lib/leads/dependencies";
import { clientKeyFromHeaders } from "@/lib/leads/http";
import { reportEvent } from "@/lib/observability/report";
import { orderTrackingForEmail } from "@/lib/outbox/config";
import { outboxLogger } from "@/lib/outbox/log";
import { createOrderEmailSender } from "@/lib/outbox/orders";
import { budgetedSends } from "@/lib/outbox/send";
import { getLegalSettings } from "@/lib/sanity/fetch";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
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

/**
 * Ruling R82: the order form's own consent sentence and the version an order records, always as a
 * pair. The CMS pair when the database will accept its version; otherwise the repository sentence
 * and version together (logged with a code, never the value), so the order page never shows words
 * whose version an order would not record. The order page shows `copy`; the route records `version`.
 */
export function orderConsentFrom(legal: Pick<LegalSettings, "orderConsentCopy" | "orderConsentCopyVersion">): { copy: string; version: string } {
  const version = legal.orderConsentCopyVersion.trim();
  if (CONSENT_VERSION_PATTERN.test(version)) return { copy: legal.orderConsentCopy, version };
  logOrderEvent({ event: "order_config_invalid", code: "consent_version_invalid" });
  return { copy: SAFE_FALLBACK_LEGAL.orderConsentCopy, version: SAFE_FALLBACK_LEGAL.orderConsentCopyVersion };
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
  const email = createEmailSenderFromEnv(env);
  return {
    commerceEnabled: isCommerceEnabled(settings),
    trackingEnabled: isTrackingEnabled(settings),
    repository: client ? createSupabaseOrderRepository(client) : null,
    rateLimiter: client ? createSupabaseRateLimiter(client) : null,
    resolveLines: (lines) => resolveCanonicalOrderLines(lines),
    consentVersion: orderConsentFrom(legal).version,
    orderCountries: settings.orderCountries,
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret) : "",
    log: logOrderEvent,
    // Task 8a (R88): the two queued emails are attempted after the answer through the outbox's
    // claim, spending the shared send budget; without storage or email they wait for the worker.
    sendQueuedEmails:
      client && email
        ? createOrderEmailSender(
            createSupabaseOrderEmailOutbox(client),
            { staffEmail: getStaffNotificationEmail(env), replyTo: email.replyTo, tracking: orderTrackingForEmail(settings, env) },
            budgetedSends({ rateLimiter: createSupabaseRateLimiter(client), sendLimitPerHour: ackSendLimitPerHour(env), mailer: email.sender, log: outboxLogger("orders") }),
          )
        : null,
    runAfterResponse: (task) => after(task),
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
