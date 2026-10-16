import "server-only";

import { createHmac } from "node:crypto";
import { after } from "next/server";

import { createEmailSenderFromEnv } from "@/lib/email/client";
import { ackSendLimitPerHour, hashSecretFrom } from "@/lib/leads/dependencies";
import { clientKeyFromHeaders } from "@/lib/leads/http";
import { createQuoteEmailSender } from "@/lib/orders/admin";
import { outboxLogger } from "@/lib/outbox/log";
import { budgetedSends } from "@/lib/outbox/send";
import { paymentHostsFrom } from "@/lib/security/payment-url";
import { createSupabaseRateLimiter } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient, getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { requireStaffUser, staffClientForRequest, staffSignInFrom } from "@/lib/supabase/auth";
import { createSupabaseOrderEmailOutbox } from "@/lib/supabase/outbox";
import { logAdminEvent } from "./http";
import type { AdminRouteDependencies } from "./orders";
import type { SessionDependencies } from "./session";

type Env = Record<string, string | undefined>;

/**
 * Wires the staff routes (Task 8b) from the environment, the way lib/orders/dependencies.ts does
 * for orders. Staff reads and writes use the signed-in user's own client (the publishable key and
 * the session cookies; NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). The
 * service role (SUPABASE_SERVICE_ROLE_KEY) serves two things only (R95): the shared sign-in rate
 * limiter, and the attempt to send a queued quote right after the answer (R88). Nothing here reads
 * the CMS: admin works whether commerce is on or off.
 */

/** The quote email attempt after the answer, or null without Supabase's server key or Resend: the worker sends it. */
function quoteSenderFrom(env: Env): AdminRouteDependencies["sendQuoteNow"] {
  const admin = getSupabaseAdminEnvironment(env);
  const email = createEmailSenderFromEnv(env);
  if (!admin || !email) return null;
  const client = createSupabaseAdminClient(admin);
  return createQuoteEmailSender(
    createSupabaseOrderEmailOutbox(client),
    // Quotes only: no staff alert is claimed here, and the acknowledgement's tracking line is not used.
    { staffEmail: null, replyTo: email.replyTo, tracking: null },
    budgetedSends({ rateLimiter: createSupabaseRateLimiter(client), sendLimitPerHour: ackSendLimitPerHour(env), mailer: email.sender, log: outboxLogger("orders") }),
  );
}

export async function createAdminRouteDependencies(request: Request, env: Env = process.env): Promise<AdminRouteDependencies> {
  const staff = await staffClientForRequest(request, env);
  return {
    access: () => requireStaffUser(staff?.session ?? null),
    paymentHosts: paymentHostsFrom(env),
    sendQuoteNow: quoteSenderFrom(env),
    runAfterResponse: (task) => after(task),
    log: logAdminEvent,
  };
}

/**
 * The sign-in route's adapters. The limiter needs the service role and LEAD_IP_HASH_SECRET (the
 * secret that keys the client-address hash, and here the email digest too); without either,
 * sign-in answers 503 rather than run unthrottled.
 */
export async function createSessionDependencies(request: Request, env: Env = process.env): Promise<SessionDependencies> {
  const staff = await staffClientForRequest(request, env);
  const admin = getSupabaseAdminEnvironment(env);
  const secret = hashSecretFrom(env);
  return {
    auth: staff ? staffSignInFrom(staff.client, staff.session) : null,
    rateLimiter: admin && secret ? createSupabaseRateLimiter(createSupabaseAdminClient(admin)) : null,
    clientKey: secret ? clientKeyFromHeaders(request.headers, secret) : "",
    emailKey: (email) => (secret ? createHmac("sha256", secret).update(`staff-login-email:${email}`).digest("hex") : ""),
    log: logAdminEvent,
  };
}
