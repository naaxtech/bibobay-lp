import "server-only";

import { createEmailSenderFromEnv, getStaffNotificationEmail } from "@/lib/email/client";
import { ackSendLimitPerHour, leadMagnetFrom } from "@/lib/leads/dependencies";
import { getLandingPage, getSiteSettings } from "@/lib/sanity/fetch";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseContactRepository } from "@/lib/supabase/contact";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
import type { OutboxTally } from "./attempt";
import { orderTrackingForEmail } from "./config";
import type { ContactDeliveryKind, LeadDeliveryKind, OrderEmailKind } from "./constants";
import { outboxLogger } from "./log";
import { budgetedSends } from "./send";
import { runOutboxWorker } from "./worker";

/**
 * Wires the cron worker (Task 8a) from the environment and the CMS, or answers null while Supabase
 * (URL and server key) or Resend (key and sender) is unconfigured: then the route answers 503 and
 * the rows wait. The worker hashes no client address, but it signs the download link of a retried
 * acknowledgement (R140), so it needs `LEAD_IP_HASH_SECRET` for that; without it the email simply
 * omits the pack. The emails it builds are the ones the request paths build (same lead magnet, R140; same tracking
 * line, R89; same staff address and reply-to). The contact outbox needs no `LEAD_IP_HASH_SECRET`
 * here (R177) and, like the others, claims nothing without a staff address.
 */
export async function createOutboxWorker(env: Record<string, string | undefined> = process.env): Promise<{ run(startedAt?: number): Promise<OutboxTally> } | null> {
  const admin = getSupabaseAdminEnvironment(env);
  const email = createEmailSenderFromEnv(env);
  if (!admin || !email) return null;

  const client = createSupabaseAdminClient(admin);
  const [content, settings] = await Promise.all([getLandingPage(), getSiteSettings()]);
  const staffEmail = getStaffNotificationEmail(env);
  const context = budgetedSends<LeadDeliveryKind | OrderEmailKind | ContactDeliveryKind>({
    rateLimiter: createSupabaseRateLimiter(client),
    sendLimitPerHour: ackSendLimitPerHour(env),
    mailer: email.sender,
    log: outboxLogger("worker"),
  });

  return {
    run: (startedAt?: number) =>
      runOutboxWorker({
        startedAt,
        leads: {
          outbox: createSupabaseLeadRepository(client),
          settings: { staffEmail, replyTo: email.replyTo, leadMagnet: leadMagnetFrom(content.lead, settings, env) },
        },
        orders: {
          outbox: createSupabaseOrderEmailOutbox(client),
          settings: { staffEmail, replyTo: email.replyTo, tracking: orderTrackingForEmail(settings, env) },
        },
        contact: { outbox: createSupabaseContactRepository(client), settings: { staffEmail } },
        context,
      }),
  };
}
