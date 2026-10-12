import "server-only";

import { getEmailEnvironment, getStaffNotificationEmail, createEmailSenderFromEnv } from "@/lib/email/client";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { getLandingPage, getLegalSettings } from "@/lib/sanity/fetch";
import { clientKeyFromHeaders } from "./http";
import type { LeadLogEvent, LeadSubmissionDependencies } from "./submit";

/**
 * Wires the real adapters for one lead request from the environment and the CMS.
 *
 * Supabase counts as configured only with the project URL, the server key AND the secret that
 * hashes client addresses for the rate limit: storing without the shared limiter is not allowed
 * (spec §9.3), and hashing without a secret would be reversible. Missing any of them, the route
 * answers 503 and stores nothing.
 */
export function leadStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return getSupabaseAdminEnvironment(env) !== null && Boolean(env.LEAD_IP_HASH_SECRET?.trim());
}

/** Structured operational log: event names and codes only, never an address, name or email. */
export function logLeadEvent(entry: LeadLogEvent): void {
  const line = JSON.stringify({ scope: "leads", ...entry });
  if (entry.event.endsWith("_failed") || entry.event.endsWith("_unavailable") || entry.event.endsWith("_unconfigured")) console.warn(line);
  else console.info(line);
}

export async function createLeadDependencies(request: Request, env: Record<string, string | undefined> = process.env): Promise<LeadSubmissionDependencies> {
  // Both reads fall back to safe repository content when Sanity is unconfigured or unreachable.
  const [content, legal] = await Promise.all([getLandingPage(), getLegalSettings()]);
  const { lead } = content;
  const copy = { successMessage: lead.successMessage, errorMessage: lead.errorMessage };
  const magnet = lead.leadMagnet?.available && lead.leadMagnet.fileUrl ? { title: lead.leadMagnet.title, fileUrl: lead.leadMagnet.fileUrl } : null;

  const admin = getSupabaseAdminEnvironment(env);
  const hashSecret = env.LEAD_IP_HASH_SECRET?.trim();
  const storage = admin && hashSecret ? createSupabaseAdminClient(admin) : null;
  const email = createEmailSenderFromEnv(env);

  return {
    repository: storage ? createSupabaseLeadRepository(storage) : null,
    rateLimiter: storage ? createSupabaseRateLimiter(storage) : null,
    mailer: email?.sender ?? null,
    copy,
    consentVersion: legal.consentCopyVersion,
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret) : "",
    staffEmail: getEmailEnvironment(env) ? getStaffNotificationEmail(env) : null,
    leadMagnet: magnet,
    replyTo: email?.replyTo ?? null,
    log: logLeadEvent,
  };
}
