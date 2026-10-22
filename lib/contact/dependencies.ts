import "server-only";

import { after } from "next/server";

import { createEmailSenderFromEnv, getStaffNotificationEmail } from "@/lib/email/client";
import { createBotCheck } from "@/lib/bot-check/gate";
import { ackSendLimitPerHour } from "@/lib/leads/dependencies";
import { clientKeyFromHeaders } from "@/lib/leads/http";
import { reportEvent } from "@/lib/observability/report";
import type { ContactDeliveryKind } from "@/lib/outbox/constants";
import { createContactAlertSender } from "@/lib/outbox/contact";
import { outboxLogger } from "@/lib/outbox/log";
import { budgetedSends } from "@/lib/outbox/send";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { hashSecretFrom } from "@/lib/security/secrets";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseContactRepository } from "@/lib/supabase/contact";
import { contactFormOpen } from "./availability";
import type { ContactLogEvent, ContactSubmissionDependencies } from "./submit";

/**
 * Wires the real adapters for one contact request from the environment (no CMS read: the route
 * answers with its own strings, and the form maps each status to its CMS or chrome copy).
 *
 * Storage counts as configured only with the Supabase URL, the server key AND the secret that
 * hashes client addresses for the shared rate limit (`LEAD_IP_HASH_SECRET`, at least 32
 * characters), as for signups. The form is open only when `contactFormOpen` holds (R205); the
 * alert is attempted after the answer only with storage, email sending and a staff address.
 */

const WARNING_EVENT = /_(failed|unavailable|unconfigured|invalid)$/;

/** Structured operational log: event names, codes and scopes only, never a name, an address or a message. */
export function logContactEvent(entry: ContactLogEvent): void {
  const line = JSON.stringify({ scope: "contact", ...entry });
  const warning = WARNING_EVENT.test(entry.event);
  if (warning) console.warn(line);
  else console.info(line);
  // Ruling R52: warnings also reach Sentry, tagged with the event and a code only.
  if (warning) reportEvent(entry.event, "code" in entry ? { code: entry.code } : {});
}

export function createContactDependencies(request: Request, env: Record<string, string | undefined> = process.env): ContactSubmissionDependencies {
  const admin = getSupabaseAdminEnvironment(env);
  const hashSecret = hashSecretFrom(env);
  const client = admin && hashSecret ? createSupabaseAdminClient(admin) : null;
  const email = createEmailSenderFromEnv(env);
  const staffEmail = getStaffNotificationEmail(env);
  const repository = client ? createSupabaseContactRepository(client) : null;
  const rateLimiter = client ? createSupabaseRateLimiter(client) : null;
  // R202, R212: one hourly cap for the alert's send budget AND for all messages together.
  const sendLimitPerHour = ackSendLimitPerHour(env);
  return {
    open: contactFormOpen(env),
    repository,
    rateLimiter,
    botCheck: createBotCheck(env),
    clientKey: hashSecret ? clientKeyFromHeaders(request.headers, hashSecret, env.CLOUDFLARE_ORIGIN_SECRET) : "",
    globalLimitPerHour: sendLimitPerHour,
    log: logContactEvent,
    // The alert is attempted after the answer through the outbox's claim, spending its own send
    // budget (R202); without storage, email or a staff address the row waits for the worker.
    sendAlert:
      repository && rateLimiter && email && staffEmail
        ? createContactAlertSender(
            repository,
            { staffEmail },
            budgetedSends<ContactDeliveryKind>({ rateLimiter, sendLimitPerHour, mailer: email.sender, log: outboxLogger("contact") }),
          )
        : null,
    // src: https://nextjs.org/docs/app/api-reference/functions/after · next 16.3.8 · 2026-10-21
    runAfterResponse: (task) => after(task),
  };
}
