import "server-only";

import { after } from "next/server";

import { SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import { getStaffNotificationEmail, createEmailSenderFromEnv } from "@/lib/email/client";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { absoluteFileUrl } from "@/lib/content/freebie";
import type { LandingPageContent, SiteSettings } from "@/lib/content/types";
import type { LeadMagnetLink } from "@/lib/email/lead-emails";
import { getLandingPage, getLegalSettings, getSiteSettings } from "@/lib/sanity/fetch";
import { reportEvent } from "@/lib/observability/report";
import { SERVER_SECRET_MIN_LENGTH } from "@/lib/security/secrets";
import { seoEnvironment } from "@/lib/seo/metadata";
import { clientKeyFromHeaders } from "./http";
import { ACK_SEND_LIMIT, type LeadLogEvent, type LeadSubmissionDependencies } from "./submit";

/**
 * Wires the real adapters for one lead request from the environment and the CMS.
 *
 * Supabase counts as configured only with the project URL, the server key AND the secret that
 * hashes client addresses for the rate limit: storing without the shared limiter is not allowed
 * (spec §9.3), and hashing without a secret would be reversible. Missing any of them, the route
 * answers 503 and stores nothing.
 */

/**
 * Review M8: with a short secret, anyone holding the bucket table could brute-force it over the IPv4
 * space, so a shorter one counts as missing. scripts/verify-env.ts fails a production build with one.
 * N4: the number itself lives once, in lib/security/secrets.ts.
 */
export const LEAD_IP_HASH_SECRET_MIN_LENGTH = SERVER_SECRET_MIN_LENGTH;

/** The client-address hashing secret, or null when missing or too short (also used by lib/orders/dependencies.ts). */
export function hashSecretFrom(env: Record<string, string | undefined>): string | null {
  const secret = env.LEAD_IP_HASH_SECRET?.trim();
  return secret && secret.length >= LEAD_IP_HASH_SECRET_MIN_LENGTH ? secret : null;
}

export function leadStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getSupabaseAdminEnvironment(env) !== null && hashSecretFrom(env) !== null;
}

/**
 * Review M1: `submit_lead` accepts a consent version of 1-40 characters (migration 0001). It is also
 * kept to a plain token, so a CMS typo cannot carry markup or control characters into the consent
 * record.
 */
export const CONSENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/;

/** The CMS consent version when the database will accept it, else the repository fallback. */
function consentVersionFrom(cmsVersion: string, log: (event: LeadLogEvent) => void): string {
  const version = cmsVersion.trim();
  if (CONSENT_VERSION_PATTERN.test(version)) return version;
  // Otherwise every signup would fail with a 500 until an editor fixed the field. The value itself
  // is never logged. Studio-side max(40) validation is Task 2B's (studio/ schema), not changed here.
  log({ event: "lead_config_invalid", code: "consent_version_invalid" });
  return SAFE_FALLBACK_LEGAL.consentCopyVersion;
}

/**
 * Ruling R40: the hourly cap on emails sent straight from the form, shared by acknowledgements,
 * staff alerts and (Task 8) the outbox worker. `LEAD_ACK_SEND_LIMIT_PER_HOUR` must be a whole
 * number from 1 to 10000 (the bounds `consume_rate_limit` accepts); anything else means the default.
 */
export function ackSendLimitPerHour(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LEAD_ACK_SEND_LIMIT_PER_HOUR?.trim() ?? "";
  if (!/^[1-9]\d{0,4}$/.test(raw)) return ACK_SEND_LIMIT.defaultPerHour;
  const value = Number(raw);
  return value <= 10_000 ? value : ACK_SEND_LIMIT.defaultPerHour;
}

const WARNING_EVENT = /_(failed|unavailable|unconfigured|invalid)$/;

/**
 * Structured operational log: event names and codes only, never an address, name or email.
 * Warnings and the send-cap hit also go to Sentry as warning messages (ruling R52), tagged with the
 * event, kind and code only.
 */
export function logLeadEvent(entry: LeadLogEvent): void {
  const line = JSON.stringify({ scope: "leads", ...entry });
  // Task 8a: a row parked for a human (R91) is a warning too.
  const warning = WARNING_EVENT.test(entry.event) || entry.event === "delivery_expired";
  if (warning) console.warn(line);
  else console.info(line);
  if (warning || entry.event === "delivery_send_capped") {
    reportEvent(entry.event, { ...("kind" in entry ? { kind: entry.kind } : {}), ...("code" in entry ? { code: entry.code } : {}) });
  }
}

/**
 * R66: the lead magnet the acknowledgement may link to. A repository file needs the site's
 * verified origin to work from an inbox; until that is known the email leaves the pack out rather
 * than send a link that cannot open. Shared with the outbox worker (Task 8a), so a retried
 * acknowledgement links to the same file.
 */
export function leadMagnetFrom(lead: LandingPageContent["lead"], settings: SiteSettings, env: Record<string, string | undefined> = process.env): LeadMagnetLink | null {
  const origin = seoEnvironment(settings, env).baseUrl;
  const magnetUrl = lead.leadMagnet?.available && lead.leadMagnet.fileUrl ? absoluteFileUrl(lead.leadMagnet.fileUrl, origin) : null;
  return magnetUrl && lead.leadMagnet ? { title: lead.leadMagnet.title, fileUrl: magnetUrl } : null;
}

export async function createLeadDependencies(request: Request, env: Record<string, string | undefined> = process.env): Promise<LeadSubmissionDependencies> {
  // Both reads fall back to safe repository content when Sanity is unconfigured or unreachable.
  const [content, legal, settings] = await Promise.all([getLandingPage(), getLegalSettings(), getSiteSettings()]);
  const { lead } = content;
  const copy = { successMessage: lead.successMessage, errorMessage: lead.errorMessage };
  const magnet = leadMagnetFrom(lead, settings, env);
  /*
   * Moved into leadMagnetFrom above in Task 8a (the worker needs the same link); kept for history:
   *   const origin = seoEnvironment(settings, env).baseUrl;
   *   const magnetUrl = lead.leadMagnet?.available && lead.leadMagnet.fileUrl ? absoluteFileUrl(lead.leadMagnet.fileUrl, origin) : null;
   *   const magnet = magnetUrl && lead.leadMagnet ? { title: lead.leadMagnet.title, fileUrl: magnetUrl } : null;
   */

  const admin = getSupabaseAdminEnvironment(env);
  const hashSecret = hashSecretFrom(env);
  const storage = admin && hashSecret ? createSupabaseAdminClient(admin) : null;
  const email = createEmailSenderFromEnv(env);

  return {
    repository: storage ? createSupabaseLeadRepository(storage) : null,
    rateLimiter: storage ? createSupabaseRateLimiter(storage) : null,
    mailer: email?.sender ?? null,
    copy,
    consentVersion: consentVersionFrom(legal.consentCopyVersion, logLeadEvent),
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret) : "",
    // Review M2: the staff alert is queued whenever an address is set, like the acknowledgement;
    // while Resend is unconfigured it waits in the outbox as `pending` for the Task 8 worker.
    staffEmail: getStaffNotificationEmail(env),
    leadMagnet: magnet,
    replyTo: email?.replyTo ?? null,
    log: logLeadEvent,
    sendLimitPerHour: ackSendLimitPerHour(env),
    // Review M4: the outbox rows are written before the response; the sends run after it is sent.
    runAfterResponse: (task) => after(task),
  };
}
