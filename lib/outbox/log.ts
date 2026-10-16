import "server-only";

import { reportEvent } from "@/lib/observability/report";
import type { OutboxLogEvent, OutboxTally } from "./attempt";

const WARNING_EVENT = /_(failed|unavailable|unconfigured|invalid)$/;

/**
 * The outbox's structured operational log (Task 8a): one JSON line per event, naming the outbox
 * (`leads` or `orders`), with event names, message kinds, counts and short codes only; never an
 * address, a name, a reference or a row id.
 *
 * Ruling R52: warnings, the send-cap hit and parked rows (`delivery_expired`: an unconfirmed send
 * outside the idempotency window, out of attempts, or refused as `invalid_idempotent_request`,
 * waiting for a human) also go to Sentry as warning messages tagged with the event, kind and code only.
 */
export function outboxLogger<K extends string>(channel: "leads" | "orders" | "worker") {
  return (entry: OutboxLogEvent<K>): void => {
    const line = JSON.stringify({ scope: "outbox", channel, ...entry });
    const warning = WARNING_EVENT.test(entry.event) || entry.event === "delivery_expired";
    if (warning) console.warn(line);
    else console.info(line);
    if (warning || entry.event === "delivery_send_capped") {
      reportEvent(entry.event, { ...("kind" in entry ? { kind: entry.kind } : {}), ...("code" in entry && entry.code ? { code: entry.code } : {}) });
    }
  };
}

/** One line per cron run, with its counts only (Task 8a). */
export function logWorkerRun(tally: OutboxTally): void {
  console.info(JSON.stringify({ scope: "outbox", channel: "worker", event: "worker_run", ...tally }));
}
