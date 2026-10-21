import "server-only";

import { after } from "next/server";

import { createBotCheck } from "@/lib/bot-check/gate";
import { SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import { getStaffNotificationEmail, createEmailSenderFromEnv } from "@/lib/email/client";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { absoluteFileUrl } from "@/lib/content/freebie";
import { FREEBIE_PATH } from "@/lib/content/freebie-path";
import { EMAIL_DOWNLOAD_TTL_SECONDS, IMMEDIATE_DOWNLOAD_TTL_SECONDS, downloadPath, signDownloadToken } from "@/lib/freebies/token";
import type { LandingPageContent, SiteSettings } from "@/lib/content/types";
import type { LeadMagnetLink } from "@/lib/email/lead-emails";
import { getLandingPage, getLegalSettings, getSiteSettings } from "@/lib/sanity/fetch";
import { reportEvent } from "@/lib/observability/report";
import { SERVER_SECRET_MIN_LENGTH, hashSecretFrom } from "@/lib/security/secrets";
import { seoEnvironment } from "@/lib/seo/metadata";
import { clientKeyFromHeaders } from "./http";
import { removalChannelFrom } from "./removal-channel";
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

/** Re-exported for lib/orders and lib/admin; the one definition is in lib/security/secrets.ts. */
export { hashSecretFrom } from "@/lib/security/secrets";

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
 * Ruling R40, fix wave D-I1: the hourly cap of EACH send budget (`send:<budget>`, one per message
 * kind: signup acknowledgement, signup staff alert, order acknowledgement, order staff alert and
 * staff quote; lib/outbox/constants.ts SEND_BUDGETS), spent by the immediate sends and the outbox
 * worker alike. `LEAD_ACK_SEND_LIMIT_PER_HOUR` keeps its name; it must be a whole number from 1 to
 * 10000 (the bounds `consume_rate_limit` accepts); anything else means the default (60).
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
 * event, kind and code only, plus the send budget of a cap event (fix wave D-I1).
 */
export function logLeadEvent(entry: LeadLogEvent): void {
  const line = JSON.stringify({ scope: "leads", ...entry });
  // Task 8a: a row parked for a human (R91) is a warning too.
  const warning = WARNING_EVENT.test(entry.event) || entry.event === "delivery_expired";
  if (warning) console.warn(line);
  else console.info(line);
  if (warning || entry.event === "delivery_send_capped") {
    reportEvent(entry.event, {
      ...("kind" in entry ? { kind: entry.kind } : {}),
      ...("budget" in entry && entry.budget ? { budget: entry.budget } : {}),
      ...("code" in entry ? { code: entry.code } : {}),
    });
  }
}

/**
 * R140 (overrides R66's "the link is the file"): the lead magnet the acknowledgement may link to.
 * A repository file is never linked directly; the email carries a signed link to the download route
 * (30 days), signed here at call time, so a retried acknowledgement gets a fresh token. It needs the
 * site's verified origin to work from an inbox and the signing secret; without either, the email
 * leaves the pack out rather than send a link that cannot open. An https CMS file is linked as it is.
 * Shared with the outbox worker (Task 8a), which calls it at send time.
 */
export function leadMagnetFrom(lead: LandingPageContent["lead"], settings: SiteSettings, env: Record<string, string | undefined> = process.env): LeadMagnetLink | null {
  const magnet = lead.leadMagnet;
  if (!magnet?.available || !magnet.fileUrl) return null;
  const origin = seoEnvironment(settings, env).baseUrl;
  if (FREEBIE_PATH.test(magnet.fileUrl)) {
    if (!origin) return null;
    const token = signDownloadToken({ fileUrl: magnet.fileUrl, ttlSeconds: EMAIL_DOWNLOAD_TTL_SECONDS }, env);
    return token ? { title: magnet.title, fileUrl: new URL(downloadPath(token), origin).toString(), expiresInDays: EMAIL_DOWNLOAD_TTL_SECONDS / 86400 } : null;
  }
  const url = absoluteFileUrl(magnet.fileUrl);
  return url ? { title: magnet.title, fileUrl: url } : null;
}

/**
 * R140: the download the 200 answer of a stored signup carries. A repository file becomes a
 * same-origin signed path (24 hours; no origin needed, the page uses it relative); an https CMS file
 * is handed over as it is; anything else, or a missing secret, means no download.
 */
export function immediateDownloadFrom(lead: LandingPageContent["lead"], env: Record<string, string | undefined> = process.env): { url: string; title: string } | null {
  const magnet = lead.leadMagnet;
  if (!magnet?.available || !magnet.fileUrl) return null;
  if (FREEBIE_PATH.test(magnet.fileUrl)) {
    const token = signDownloadToken({ fileUrl: magnet.fileUrl, ttlSeconds: IMMEDIATE_DOWNLOAD_TTL_SECONDS }, env);
    return token ? { url: downloadPath(token), title: magnet.title } : null;
  }
  const url = absoluteFileUrl(magnet.fileUrl);
  return url ? { url, title: magnet.title } : null;
}

export async function createLeadDependencies(request: Request, env: Record<string, string | undefined> = process.env): Promise<LeadSubmissionDependencies> {
  // Both reads fall back to safe repository content when Sanity is unconfigured or unreachable.
  const [content, legal, settings] = await Promise.all([getLandingPage(), getLegalSettings(), getSiteSettings()]);
  const { lead } = content;
  const copy = { successMessage: lead.successMessage, errorMessage: lead.errorMessage };
  const magnet = leadMagnetFrom(lead, settings, env);
  const download = immediateDownloadFrom(lead, env);

  const admin = getSupabaseAdminEnvironment(env);
  const hashSecret = hashSecretFrom(env);
  const storage = admin && hashSecret ? createSupabaseAdminClient(admin) : null;
  const email = createEmailSenderFromEnv(env);

  return {
    repository: storage ? createSupabaseLeadRepository(storage) : null,
    // P-I1 (Ruling R125): email sending (reply to the acknowledgement) or the CMS contact address.
    removalChannel: removalChannelFrom(settings, env),
    botCheck: createBotCheck(env),
    rateLimiter: storage ? createSupabaseRateLimiter(storage) : null,
    mailer: email?.sender ?? null,
    copy,
    consentVersion: consentVersionFrom(legal.consentCopyVersion, logLeadEvent),
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret) : "",
    // Review M2: the staff alert is queued whenever an address is set, like the acknowledgement;
    // while Resend is unconfigured it waits in the outbox as `pending` for the Task 8 worker.
    staffEmail: getStaffNotificationEmail(env),
    leadMagnet: magnet,
    download,
    replyTo: email?.replyTo ?? null,
    log: logLeadEvent,
    sendLimitPerHour: ackSendLimitPerHour(env),
    // Review M4: the outbox rows are written before the response; the sends run after it is sent.
    runAfterResponse: (task) => after(task),
  };
}
