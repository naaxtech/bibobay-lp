import "server-only";

import { BOT_CHECK_MESSAGES } from "@/lib/bot-check/fields";
import { runBotCheck, type BotCheck } from "@/lib/bot-check/gate";
import { ACK_SEND_LIMIT, errorCodeOf } from "@/lib/leads/submit";
import { isHoneypotFilled } from "@/lib/leads/fields";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { ContactApiBody } from "./fields";
import { validateContactSubmission } from "./schema";
import type { ContactRepository } from "./types";

/**
 * Contact message orchestration (plan C5). Order matters and is the whole point:
 *
 *   honeypot → validation → open? → bot check (R216) → per-client limit → global limit → one atomic write → answer
 *   → (after the answer) the staff alert
 *
 * `persisted: true` only after the database confirmed the message and its outbox row in one
 * transaction (R191, R201). Nothing is sent before the answer; once it has gone out, the one staff
 * alert is attempted through the outbox's shared claim, and the cron worker retries what is left.
 * No email goes to the sender (R192), and no message here says anything was emailed.
 */

/** Largest request body the contact route reads: a 3,000-character message of 4-byte characters fits. */
export const CONTACT_BODY_LIMIT_BYTES = 32 * 1024;

/** Three messages per client per ten minutes, shared by every server instance (R203). */
export const CONTACT_RATE_LIMIT = { scope: "contact", maxHits: 3, windowSeconds: 600 } as const;
/**
 * Every message from everyone together, per hour (R203). R212: its cap is the alert's own hourly send
 * cap (`globalLimitPerHour`, from `LEAD_ACK_SEND_LIMIT_PER_HOUR`), over the same window, so it caps
 * intake at the alert's hourly send cap; a cron retry in the same hour, or a burst at a window edge,
 * can defer an alert to the next cron run.
 */
export const CONTACT_GLOBAL_RATE_LIMIT = { key: "contact:global", windowSeconds: ACK_SEND_LIMIT.windowSeconds } as const;

/** Informational strings of the API; the form never shows them (it maps each status to its own copy). */
export const CONTACT_API_MESSAGES = {
  received: "Message received.",
  error: "The message could not be saved. Please try again.",
  closed: "The contact form is not open, so nothing was saved.",
  rateLimited: "Too many messages just now. Please wait a few minutes and try again.",
  checkDetails: "Please check the highlighted fields and try again.",
} as const;

export type ContactLogEvent =
  | { event: "contact_stored" }
  | { event: "contact_store_failed"; code: string }
  | { event: "contact_rate_limited"; scope: "client" | "global" }
  | { event: "contact_rate_limit_unavailable"; code: string }
  | { event: "contact_unconfigured" }
  | { event: "contact_honeypot" }
  | { event: "contact_bot_check_refused"; reason: string }
  | { event: "contact_bot_check_unavailable"; reason: string }
  | { event: "contact_bot_check_unconfigured"; reason: string };

export interface ContactSubmissionDependencies {
  /** `contactFormOpen()` (R205): storage, email sending, a staff address and the hash secret. */
  open: boolean;
  /** Null while Supabase is not configured: nothing can be stored, so nothing is accepted. */
  repository: ContactRepository | null;
  /** The shared limiter. Null with a repository is a misconfiguration and fails closed. */
  rateLimiter: RateLimiter | null;
  /** The spam check (R215): off, misconfigured (fails closed) or on with a verifier. */
  botCheck: BotCheck;
  /** An opaque, keyed hash of the client address (lib/leads/http.ts); never the address itself. */
  clientKey: string;
  /**
   * R212: the cap of `contact:global` per hour, the same value the alert's send budget
   * (`send:contact_staff_alert`) is capped at. This caps intake at the alert's hourly send cap; a cron
   * retry in the same hour, or a burst at a window edge, can defer an alert to the next cron run.
   */
  globalLimitPerHour: number;
  /** Structured, PII-free operational log. */
  log: (event: ContactLogEvent) => void;
  /**
   * Attempts the stored message's staff alert through the outbox's shared claim. Null or absent
   * while email or the staff address is unconfigured: the row waits for the worker.
   */
  sendAlert?: ((messageId: string) => Promise<void>) | null;
  /** Runs work once the answer has gone out (the route passes `after()` from next/server). */
  runAfterResponse?: (task: () => Promise<void>) => void;
}

export interface ContactSubmissionResult {
  status: 200 | 400 | 403 | 429 | 500 | 503;
  body: ContactApiBody;
  retryAfterSeconds?: number;
}

const refused = (status: ContactSubmissionResult["status"], message: string, extra: Partial<ContactSubmissionResult> = {}): ContactSubmissionResult => ({
  status,
  body: { ok: false, persisted: false, message },
  ...extra,
});

export async function submitContactMessage(input: unknown, dependencies: ContactSubmissionDependencies): Promise<ContactSubmissionResult> {
  const { repository, rateLimiter, log } = dependencies;

  // A bot filled the hidden field: a generic refusal; nothing is counted, read or stored.
  if (isHoneypotFilled(input)) {
    log({ event: "contact_honeypot" });
    return refused(400, CONTACT_API_MESSAGES.error);
  }

  const validation = validateContactSubmission(input);
  if (!validation.ok) {
    // C5: a body that is not an object, or carries any key the form does not send, is refused as a
    // whole, before (and instead of) any field problem it may also have.
    if (validation.formError || Object.keys(validation.fieldErrors).length === 0) return refused(400, CONTACT_API_MESSAGES.error);
    const result = refused(400, CONTACT_API_MESSAGES.checkDetails);
    result.body.fieldErrors = validation.fieldErrors;
    return result;
  }

  if (!dependencies.open || !repository) {
    log({ event: "contact_unconfigured" });
    return { status: 503, body: { ok: false, persisted: false, closed: true, message: CONTACT_API_MESSAGES.closed } };
  }
  if (!rateLimiter) {
    log({ event: "contact_rate_limit_unavailable", code: "missing" });
    return refused(503, CONTACT_API_MESSAGES.error);
  }

  // R216: after every cheap refusal and before any counter, so a bot without a token spends nobody's count.
  const gate = await runBotCheck(dependencies.botCheck, validation.botCheckToken, "contact");
  if (!gate.ok) {
    if (gate.kind === "refused") {
      log({ event: "contact_bot_check_refused", reason: gate.reason });
      return refused(403, BOT_CHECK_MESSAGES.refused);
    }
    log({ event: gate.kind === "unconfigured" ? "contact_bot_check_unconfigured" : "contact_bot_check_unavailable", reason: gate.reason });
    return refused(503, BOT_CHECK_MESSAGES.unavailable);
  }

  const limits = [
    { scope: "client" as const, key: `${CONTACT_RATE_LIMIT.scope}:${dependencies.clientKey}`, maxHits: CONTACT_RATE_LIMIT.maxHits, windowSeconds: CONTACT_RATE_LIMIT.windowSeconds },
    { scope: "global" as const, key: CONTACT_GLOBAL_RATE_LIMIT.key, maxHits: dependencies.globalLimitPerHour, windowSeconds: CONTACT_GLOBAL_RATE_LIMIT.windowSeconds },
  ];
  for (const { scope, key, maxHits, windowSeconds } of limits) {
    try {
      const decision = await rateLimiter.consume(key, { maxHits, windowSeconds });
      if (!decision.allowed) {
        log({ event: "contact_rate_limited", scope });
        return refused(429, CONTACT_API_MESSAGES.rateLimited, { retryAfterSeconds: decision.retryAfterSeconds });
      }
    } catch (error) {
      // Fail closed: without the shared limiter the form could flood the outbox and the staff inbox.
      log({ event: "contact_rate_limit_unavailable", code: errorCodeOf(error) });
      return refused(503, CONTACT_API_MESSAGES.error);
    }
  }

  let messageId: string;
  try {
    ({ messageId } = await repository.submitMessage(validation.data));
  } catch (error) {
    log({ event: "contact_store_failed", code: errorCodeOf(error) });
    return refused(500, CONTACT_API_MESSAGES.error);
  }
  log({ event: "contact_stored" });

  // The alert is attempted once the answer has gone out. Whatever happens to it is recorded on its
  // outbox row; it never delays or changes this answer.
  const sendAlert = dependencies.sendAlert;
  if (sendAlert) {
    const task = async () => {
      try {
        await sendAlert(messageId);
      } catch {
        // Nothing to record here: an unsent row stays due for the outbox worker.
      }
    };
    if (dependencies.runAfterResponse) dependencies.runAfterResponse(task);
    else await task();
  }

  return { status: 200, body: { ok: true, persisted: true, message: CONTACT_API_MESSAGES.received } };
}
