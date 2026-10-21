import "server-only";

import { getEmailEnvironment, getStaffNotificationEmail } from "@/lib/email/client";
import { leadStorageConfigured } from "@/lib/leads/dependencies";

/**
 * Whether the contact form is open (ruling R193; the exact condition is R205). A message is taken
 * only when someone will read it: Supabase can store it (the project URL, a server key that is not
 * a publishable one, and a `LEAD_IP_HASH_SECRET` of 32+ characters, as for signups), Resend can
 * send (`RESEND_API_KEY` and `RESEND_FROM`), and `STAFF_NOTIFICATION_EMAIL` names the inbox its
 * alert goes to.
 *
 * The one definition the route, readiness, the page, the footer, the sitemap and the legal text
 * all use. Closed, the page shows the CMS contact address or a closed notice, and the API answers
 * 503 (R193).
 */
export function contactFormOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  // The helpers take a mutable record; each gets a copy, never the caller's environment itself.
  const values = { ...env };
  return leadStorageConfigured(values) && getEmailEnvironment(values) !== null && getStaffNotificationEmail(values) !== null;
}
