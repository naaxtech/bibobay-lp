import "server-only";

import type { EmailSender } from "@/lib/email/client";
import { ACK_SEND_LIMIT, EMAIL_SEND_TIMEOUT_MS, errorCodeOf, sendWithTimeout } from "@/lib/leads/submit";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { AttemptContext, OutboxLogEvent } from "./attempt";
import { sendBudgetFor, sendBudgetKey } from "./constants";

/**
 * The attempt context for the order emails, the staff quote send and the cron worker (Task 8a):
 * every message spends one unit of the hourly budget of its own kind in its outbox (fix wave D-I1:
 * `send:<budget>`, SEND_BUDGETS in ./constants.ts, each capped at `sendLimitPerHour`), and every
 * send is bounded by the signup flow's timeout and aborted when it expires. (The signup flow builds
 * the same context from its own `reserveSend`, lib/leads/submit.ts, with the same buckets.)
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
    async reserve(kind, outbox) {
      const budget = sendBudgetFor(outbox, kind);
      if (!budget) {
        // No such kind in this outbox: refused (fail closed), never charged to another kind's bucket.
        log({ event: "delivery_send_cap_unavailable", kind, code: "unknown_budget" });
        return false;
      }
      try {
        const decision = await rateLimiter.consume(sendBudgetKey(budget), { maxHits: sendLimitPerHour, windowSeconds: ACK_SEND_LIMIT.windowSeconds });
        if (!decision.allowed) log({ event: "delivery_send_capped", kind, budget });
        return decision.allowed;
      } catch (error) {
        log({ event: "delivery_send_cap_unavailable", kind, budget, code: errorCodeOf(error) });
        return false;
      }
    },
    deliver: (message) => sendWithTimeout(mailer, message, sendTimeoutMs),
    log,
  };
}
