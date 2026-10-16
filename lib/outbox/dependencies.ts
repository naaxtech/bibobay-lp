import "server-only";

import { createEmailSenderFromEnv, getStaffNotificationEmail } from "@/lib/email/client";
import { ackSendLimitPerHour, leadMagnetFrom } from "@/lib/leads/dependencies";
import { getLandingPage, getSiteSettings } from "@/lib/sanity/fetch";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
import type { OutboxTally } from "./attempt";
import { orderTrackingForEmail } from "./config";
import type { LeadDeliveryKind, OrderEmailKind } from "./constants";
import { outboxLogger } from "./log";
import { budgetedSends } from "./send";
import { runOutboxWorker } from "./worker";

/**
 * Wires the cron worker (Task 8a) from the environment and the CMS, or answers null while Supabase
 * (URL and server key) or Resend (key and sender) is unconfigured: then the route answers 503 and
 * the rows wait. The worker hashes no client address, so `LEAD_IP_HASH_SECRET` is not needed here.
 * The emails it builds are the ones the request paths build (same lead magnet, R66; same tracking
 * line, R89; same staff address and reply-to).
 */
export async function createOutboxWorker(env: Record<string, string | undefined> = process.env): Promise<{ run(): Promise<OutboxTally> } | null> {
  const admin = getSupabaseAdminEnvironment(env);
  const email = createEmailSenderFromEnv(env);
  if (!admin || !email) return null;

  const client = createSupabaseAdminClient(admin);
  const [content, settings] = await Promise.all([getLandingPage(), getSiteSettings()]);
  const staffEmail = getStaffNotificationEmail(env);
  const context = budgetedSends<LeadDeliveryKind | OrderEmailKind>({
    rateLimiter: createSupabaseRateLimiter(client),
    sendLimitPerHour: ackSendLimitPerHour(env),
    mailer: email.sender,
    log: outboxLogger("worker"),
  });

  return {
    run: () =>
      runOutboxWorker({
        leads: {
          outbox: createSupabaseLeadRepository(client),
          settings: { staffEmail, replyTo: email.replyTo, leadMagnet: leadMagnetFrom(content.lead, settings, env), fromOutbox: true },
        },
        orders: {
          outbox: createSupabaseOrderEmailOutbox(client),
          settings: { staffEmail, replyTo: email.replyTo, tracking: orderTrackingForEmail(settings, env) },
        },
        context,
      }),
  };
}
