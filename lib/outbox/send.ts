import "server-only";

import type { EmailSender } from "@/lib/email/client";
import { ACK_SEND_LIMIT, EMAIL_SEND_TIMEOUT_MS, errorCodeOf, sendWithTimeout } from "@/lib/leads/submit";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { AttemptContext, OutboxLogEvent } from "./attempt";

/**
 * The attempt context for the order emails and the cron worker (Task 8a): every message spends one
 * unit of the same global hourly budget as the signup form (`ack-send:global`, ruling R40), and
 * every send is bounded by the signup flow's timeout and aborted when it expires. (The signup flow
 * builds the same context from its own `reserveSend`, lib/leads/submit.ts.)
 */
export function budgetedSends<K extends string>({
  rateLimiter,
  sendLimitPerHour,
  mailer,
  log,
  sendTimeoutMs = EMAIL_SEND_TIMEOUT_MS,
}: {
  rateLimiter: RateLimiter;
  sendLimitPerHour: number;
  mailer: EmailSender;
  log: (event: OutboxLogEvent<K>) => void;
  sendTimeoutMs?: number;
}): AttemptContext<K> {
  return {
    async reserve(kind) {
      try {
        const decision = await rateLimiter.consume(ACK_SEND_LIMIT.key, { maxHits: sendLimitPerHour, windowSeconds: ACK_SEND_LIMIT.windowSeconds });
        if (!decision.allowed) log({ event: "delivery_send_capped", kind });
        return decision.allowed;
      } catch (error) {
        log({ event: "delivery_send_cap_unavailable", kind, code: errorCodeOf(error) });
        return false;
      }
    },
    deliver: (message) => sendWithTimeout(mailer, message, sendTimeoutMs),
    log,
  };
}
