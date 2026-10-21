import "server-only";

import { errorCodeOf } from "@/lib/leads/submit";
import { isHoneypotFilled } from "@/lib/leads/fields";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { ContactApiBody } from "./fields";
import { validateContactSubmission } from "./schema";
import type { ContactRepository } from "./types";

/**
 * Contact message orchestration (plan C5). Order matters and is the whole point:
 *
 *   honeypot → validation → open? → per-client limit → global limit → one atomic write → answer
 *   → (after the answer) the staff alert
 *
 * `persisted: true` only after the database confirmed the message and its outbox row in one
 * transaction (R159, R169). Nothing is sent before the answer; once it has gone out, the one staff
 * alert is attempted through the outbox's shared claim, and the cron worker retries what is left.
 * No email goes to the sender (R160), and no message here says anything was emailed.
 */

/** Largest request body the contact route reads: a 3,000-character message of 4-byte characters fits. */
export const CONTACT_BODY_LIMIT_BYTES = 32 * 1024;

/** Three messages per client per ten minutes, shared by every server instance (R171). */
export const CONTACT_RATE_LIMIT = { scope: "contact", maxHits: 3, windowSeconds: 600 } as const;
/** One hundred messages per hour from everyone together (R171). */
export const CONTACT_GLOBAL_RATE_LIMIT = { key: "contact:global", maxHits: 100, windowSeconds: 3600 } as const;

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
  | { event: "contact_honeypot" };

export interface ContactSubmissionDependencies {
  /** `contactFormOpen()` (R173): storage, email sending, a staff address and the hash secret. */
  open: boolean;
  /** Null while Supabase is not configured: nothing can be stored, so nothing is accepted. */
  repository: ContactRepository | null;
  /** The shared limiter. Null with a repository is a misconfiguration and fails closed. */
  rateLimiter: RateLimiter | null;
  /** An opaque, keyed hash of the client address (lib/leads/http.ts); never the address itself. */
  clientKey: string;
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
  status: 200 | 400 | 429 | 500 | 503;
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
    if (Object.keys(validation.fieldErrors).length === 0) return refused(400, CONTACT_API_MESSAGES.error);
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

  const limits = [
    { scope: "client" as const, key: `${CONTACT_RATE_LIMIT.scope}:${dependencies.clientKey}`, maxHits: CONTACT_RATE_LIMIT.maxHits, windowSeconds: CONTACT_RATE_LIMIT.windowSeconds },
    { scope: "global" as const, ...CONTACT_GLOBAL_RATE_LIMIT },
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
