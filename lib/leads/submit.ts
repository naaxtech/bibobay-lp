import "server-only";

import { FORM_COPY } from "@/components/forms/form-copy";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/client";
import type { LeadMagnetLink } from "@/lib/email/lead-emails";
import { attemptNow, type AttemptContext, type OutboxLogEvent } from "@/lib/outbox/attempt";
import { sendBudgetFor, sendBudgetKey, type SendBudget } from "@/lib/outbox/constants";
import { leadDeliveryChannel } from "@/lib/outbox/leads";
import type { LeadDeliveryOutbox } from "@/lib/outbox/types";
import type { RateLimiter } from "@/lib/security/rate-limit";
import type { RemovalChannel } from "./removal-channel";
import { isHoneypotFilled, validateLeadSubmission, type AgeBand, type LeadFieldErrors, type UtmTags } from "./schema";

/**
 * Founding-family signup orchestration (spec §9). Order matters and is the whole point:
 *
 *   honeypot → validation → storage configured? → removal channel? → shared rate limit → durable write
 *   → outbox rows → answer → (claim → the kind's send budget → email attempt → outcome recorded)
 *
 * Success is reported only after the write (spec §9.8). An email problem after the write never
 * turns into a failed signup (§9.7): it is recorded on the outbox row for the retry worker
 * (Task 8a, lib/outbox/worker.ts). `acknowledgementQueued` is true only once that outbox row
 * exists (ruling R27). No message ever says an email was sent or delivered.
 *
 * Ruling R40, as narrowed by fix wave D-I1: every message sent straight from the form spends one
 * unit of the hourly budget of its own kind (`send:lead_acknowledgement` or `send:lead_staff_alert`,
 * lib/outbox/constants.ts SEND_BUDGETS; the cap is `ACK_SEND_LIMIT`), which the outbox worker spends
 * too for the same kind. Order emails and staff quotes have budgets of their own, so a signup flood
 * can never hold them up. Beyond the cap, or when the budget cannot be checked, the claim is handed
 * back and the row waits `pending` for the worker; the signup and its answer are unchanged. Only a
 * newly created lead sends anything now.
 *
 * Task 8a (ruling R88, Task 5 re-review N1): the rows are written unclaimed before the answer, and
 * everything that differs between a new and a listed address (the claim, the budget, the send)
 * happens after it, through the same claim the outbox worker uses (migration 0006), so the answer's
 * timing reveals nothing and no row is ever sent by both.
 *
 * Review M4: sends run in parallel, each bounded by `sendTimeoutMs` and aborted when it expires.
 * When the caller provides `runAfterResponse` (the route uses `after()` from next/server), they run
 * once the answer is sent; the outbox rows are always written before the answer.
 */

export type DeliveryKind = "acknowledgement" | "staff_alert";
export type DeliveryStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type DeliveryOutcome = { status: "sent"; providerMessageId: string } | { status: "failed"; errorCode: string };

/** Exactly what is stored for a signup: adult details, broad metadata, and the server's consent version. */
export interface LeadRecordInput {
  email: string;
  firstName?: string;
  ageBand?: AgeBand;
  consentVersion: string;
  source: string;
  locale?: string;
  utm?: UtmTags;
}

export interface LeadRepository extends LeadDeliveryOutbox {
  /**
   * Inserts a lead for a new normalised email; resolves only once the row is durably stored. For an
   * email already listed it changes nothing about the person (ruling R38) and answers
   * `created: false`.
   */
  submitLead(record: LeadRecordInput): Promise<{ leadId: string; created: boolean }>;
  /**
   * Writes the outbox row for one message kind, at most once per lead and kind. With `claim`, a new
   * row starts as `sending` (attempt 1). Since Task 8a the signup never claims here (R88): it
   * claims through `claimDeliveries` after the answer, as the outbox worker does.
   */
  enqueueDelivery(leadId: string, kind: DeliveryKind, options: { claim: boolean }): Promise<{ eventId: string; status: DeliveryStatus; created: boolean }>;
  // claimDeliveries and recordDeliveryAttempt (sent, failed or deferred) come from LeadDeliveryOutbox.
}

/** Five signups per client per ten minutes, shared by every server instance. */
export const LEAD_RATE_LIMIT = { scope: "lead", maxHits: 5, windowSeconds: 600 } as const;

/**
 * Ruling R40, fix wave D-I1: the hourly cap of every send budget, whatever the client, so the
 * public forms cannot be used to mail strangers at volume. The cap comes from
 * `LEAD_ACK_SEND_LIMIT_PER_HOUR` (lib/leads/dependencies.ts) and applies to EACH kind's bucket on its
 * own (`send:<budget>`, lib/outbox/constants.ts SEND_BUDGETS): the signup acknowledgement and staff
 * alert, the order acknowledgement and staff alert, and staff quotes. The single shared
 * `ack-send:global` bucket this used to name let one client starve every other kind.
 */
export const ACK_SEND_LIMIT = { defaultPerHour: 60, windowSeconds: 3600 } as const;

/** How long a signup waits for the email provider before recording a failure for the retry worker. */
export const EMAIL_SEND_TIMEOUT_MS = 8_000;

/**
 * P-I1 (Ruling R125): the 503 answer while no one who signs up could ask to be removed (neither email
 * sending nor a contact address is configured, ./removal-channel.ts). The form shows it as is. It
 * says that nothing was kept and promises nothing.
 */
export const LEAD_SIGNUPS_CLOSED_MESSAGE = "Signups are not open yet, so nothing was saved. Please check back soon.";

const DEFAULT_SOURCE = "landing";

export type LeadLogEvent =
  | { event: "lead_stored"; created: boolean }
  | { event: "lead_store_failed"; code: string }
  | { event: "lead_rate_limited" }
  | { event: "lead_rate_limit_unavailable"; code: string }
  | { event: "lead_storage_unconfigured" }
  /** P-I1: a signup refused because no removal channel exists (a warning; reaches Sentry, R52). */
  | { event: "lead_removal_channel_unconfigured" }
  | { event: "lead_honeypot" }
  | { event: "lead_config_invalid"; code: "consent_version_invalid" }
  | { event: "delivery_enqueue_failed"; kind: DeliveryKind; code: string }
  /** Fix wave D-I1: `budget` names the kind's bucket (`send:<budget>`); the send paths always set it. */
  | { event: "delivery_send_capped"; kind: DeliveryKind; budget?: SendBudget }
  | { event: "delivery_send_cap_unavailable"; kind: DeliveryKind; budget?: SendBudget; code: string }
  | { event: "delivery_attempted"; kind: DeliveryKind; status: DeliveryOutcome["status"]; code?: string }
  | { event: "delivery_record_failed"; kind: DeliveryKind; code: string }
  /** The shared attempt step's events (lib/outbox/attempt.ts): claims, skips, parked rows. */
  | OutboxLogEvent<DeliveryKind>;

export interface LeadSubmissionDependencies {
  /** Null while Supabase is not configured: nothing can be stored, so nothing is accepted. */
  repository: LeadRepository | null;
  /**
   * P-I1 (Ruling R125): how a person who joins could ask to be removed (reply to the acknowledgement
   * email, or write to the contact address). Null: signups are closed (503, nothing stored).
   */
  removalChannel: RemovalChannel;
  /** The shared limiter. Null with storage configured is a misconfiguration and fails closed. */
  rateLimiter: RateLimiter | null;
  /** Null while Resend is not configured: acknowledgements and staff alerts wait in the outbox as `pending`. */
  mailer: EmailSender | null;
  /** CMS lead copy: shown for success (only after persistence) and for every failure. */
  copy: { successMessage: string; errorMessage: string };
  /** The consent copy version from CMS legal settings; never taken from the request. */
  consentVersion: string;
  /** An opaque, keyed hash of the client address (lib/leads/http.ts); never the address itself. */
  clientKey: string;
  staffEmail: string | null;
  leadMagnet: LeadMagnetLink | null;
  /** Reply-to for the acknowledgement only; the staff alert never has one (review M3). */
  replyTo: string | null;
  /** Structured, PII-free operational log. */
  log: (event: LeadLogEvent) => void;
  sendTimeoutMs?: number;
  /** The hourly cap of each send budget (ruling R40, fix wave D-I1); `ACK_SEND_LIMIT.defaultPerHour` when absent. */
  sendLimitPerHour?: number;
  /**
   * Runs the email sends once the answer has gone out (the route passes `after()` from
   * next/server). Without it the sends run, in parallel, before the answer.
   */
  runAfterResponse?: (task: () => Promise<void>) => void;
}

export interface LeadApiBody {
  ok: boolean;
  persisted: boolean;
  acknowledgementQueued: boolean;
  message: string;
  fieldErrors?: LeadFieldErrors;
}

export interface LeadSubmissionResult {
  status: 200 | 400 | 429 | 500 | 503;
  body: LeadApiBody;
  retryAfterSeconds?: number;
}

/** A short, PII-free code for an unknown failure: an `RpcError`-style code, or "unknown". */
export function errorCodeOf(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "unknown";
}

const refused = (status: LeadSubmissionResult["status"], message: string, extra: Partial<LeadSubmissionResult> = {}): LeadSubmissionResult => ({
  status,
  body: { ok: false, persisted: false, acknowledgementQueued: false, message },
  ...extra,
});

/**
 * Sends one message, bounded by `timeoutMs`, and never throws. Also the outbox worker's and the
 * order emails' bounded send (Task 8a).
 */
export async function sendWithTimeout(mailer: EmailSender, message: EmailMessage, timeoutMs: number): Promise<EmailSendResult> {
  // Review M4: the timeout also aborts the provider request (Resend SDK `RequestOptions.signal`),
  // so a slow send does not keep running after its failure has been recorded.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EmailSendResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "failed", errorCode: "send_timeout" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      mailer.send(message, { signal: controller.signal }).catch((): EmailSendResult => ({ status: "failed", errorCode: "send_exception" })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type DeliveryContext = Pick<LeadSubmissionDependencies, "mailer" | "log" | "sendTimeoutMs"> & { repository: LeadRepository; rateLimiter: RateLimiter; sendLimitPerHour: number };

/**
 * Spends one unit of this kind's send budget (ruling R40, fix wave D-I1: `send:lead_acknowledgement`
 * or `send:lead_staff_alert`). False when the budget is spent or cannot be checked: the message then
 * waits in the outbox, and the signup is unaffected either way.
 */
async function reserveSend(kind: DeliveryKind, { rateLimiter, sendLimitPerHour, log }: DeliveryContext): Promise<boolean> {
  const budget = sendBudgetFor("leads", kind);
  if (!budget) {
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
}

/**
 * Writes the outbox row for one message kind, claimed for an immediate send only when `claim` is
 * true. Returns whether the row exists and, when this request owns a fresh `sending` row, the send
 * to run (which records its outcome). Never throws.
 *
 * Since Task 8a only the deprecated `deliverSequentially` below calls this: the signup now writes
 * its rows unclaimed (`enqueueUnclaimed`) and claims after the answer (R88). Kept, not deleted, for
 * comparing behaviour when reviewing the outbox history.
 */
async function queueDelivery(
  kind: DeliveryKind,
  leadId: string,
  claim: boolean,
  build: () => Omit<EmailMessage, "idempotencyKey">,
  context: DeliveryContext,
): Promise<{ queued: boolean; send?: () => Promise<void> }> {
  const { repository, mailer, log, sendTimeoutMs = EMAIL_SEND_TIMEOUT_MS } = context;
  let event: { eventId: string; status: DeliveryStatus; created: boolean };
  try {
    event = await repository.enqueueDelivery(leadId, kind, { claim });
  } catch (error) {
    log({ event: "delivery_enqueue_failed", kind, code: errorCodeOf(error) });
    return { queued: false };
  }
  // A repeat signup finds its row already there: one message per lead and kind, ever, so a stranger
  // cannot use the form to flood someone's inbox. Unsent rows are the retry worker's job.
  if (!claim || !mailer || !event.created || event.status !== "sending") return { queued: true };

  const { eventId } = event;
  return {
    queued: true,
    send: async () => {
      const outcome = await sendWithTimeout(mailer, { ...build(), idempotencyKey: `lead-delivery/${eventId}` }, sendTimeoutMs);
      log(outcome.status === "sent" ? { event: "delivery_attempted", kind, status: "sent" } : { event: "delivery_attempted", kind, status: "failed", code: outcome.errorCode });
      try {
        await repository.recordDeliveryAttempt(eventId, outcome);
      } catch (error) {
        // The row stays `sending`; the retry worker re-sends it under the same idempotency key.
        log({ event: "delivery_record_failed", kind, code: errorCodeOf(error) });
      }
    },
  };
}

/**
 * Kept for reference, not called: the pre-fix-round flow that queued and sent one message in
 * sequence, with no global send budget (superseded by `reserveSend` + `queueDelivery`, rulings R40
 * and review M4, and since Task 8a by the claim after the answer). Use only to compare behaviour
 * when reviewing the outbox history.
 *
 * @deprecated Never call it: it sends with an always-allow limiter, past the global send cap
 * (Task 5 re-review N3), and claims at enqueue instead of through the shared claim (R88). It is no
 * longer exported for that reason.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept unused on purpose (see above; the owner never deletes code)
async function deliverSequentially(
  kind: DeliveryKind,
  leadId: string,
  build: () => Omit<EmailMessage, "idempotencyKey">,
  context: Pick<LeadSubmissionDependencies, "mailer" | "log" | "sendTimeoutMs"> & { repository: LeadRepository },
): Promise<boolean> {
  const queued = await queueDelivery(kind, leadId, context.mailer !== null, build, {
    ...context,
    rateLimiter: { consume: async () => ({ allowed: true, remaining: 0, retryAfterSeconds: 0 }) },
    sendLimitPerHour: ACK_SEND_LIMIT.defaultPerHour,
  });
  await queued.send?.();
  return queued.queued;
}

export async function submitLead(input: unknown, dependencies: LeadSubmissionDependencies): Promise<LeadSubmissionResult> {
  const { repository, rateLimiter, copy, log } = dependencies;

  // A bot filled the hidden field: a generic refusal, and nothing is counted or stored (ruling R26).
  if (isHoneypotFilled(input)) {
    log({ event: "lead_honeypot" });
    return refused(400, copy.errorMessage);
  }

  const validation = validateLeadSubmission(input);
  if (!validation.ok) {
    const hasFieldErrors = Object.keys(validation.fieldErrors).length > 0;
    const result = refused(400, hasFieldErrors ? FORM_COPY.outcome.checkDetails : copy.errorMessage);
    if (hasFieldErrors) result.body.fieldErrors = validation.fieldErrors;
    return result;
  }

  if (!repository || !rateLimiter) {
    log({ event: "lead_storage_unconfigured" });
    return refused(503, copy.errorMessage);
  }

  // P-I1 (Ruling R125): consent must be withdrawable the way the page says. With no reply-able email
  // and no contact address there is no such way, so the signup is refused before anything is
  // counted or stored, with a message that says so.
  if (!dependencies.removalChannel) {
    log({ event: "lead_removal_channel_unconfigured" });
    return refused(503, LEAD_SIGNUPS_CLOSED_MESSAGE);
  }

  try {
    const decision = await rateLimiter.consume(`${LEAD_RATE_LIMIT.scope}:${dependencies.clientKey}`, {
      maxHits: LEAD_RATE_LIMIT.maxHits,
      windowSeconds: LEAD_RATE_LIMIT.windowSeconds,
    });
    if (!decision.allowed) {
      log({ event: "lead_rate_limited" });
      return refused(429, FORM_COPY.outcome.rateLimited, { retryAfterSeconds: decision.retryAfterSeconds });
    }
  } catch (error) {
    // Fail closed: without the shared limiter the form would be an open relay for the outbox.
    log({ event: "lead_rate_limit_unavailable", code: errorCodeOf(error) });
    return refused(503, copy.errorMessage);
  }

  const { data } = validation;
  const record: LeadRecordInput = {
    email: data.email,
    consentVersion: dependencies.consentVersion,
    source: data.source ?? DEFAULT_SOURCE,
    ...(data.firstName ? { firstName: data.firstName } : {}),
    ...(data.ageBand ? { ageBand: data.ageBand } : {}),
    ...(data.locale ? { locale: data.locale } : {}),
    ...(data.utm && Object.keys(data.utm).length > 0 ? { utm: data.utm } : {}),
  };

  let stored: { leadId: string; created: boolean };
  try {
    stored = await repository.submitLead(record);
  } catch (error) {
    log({ event: "lead_store_failed", code: errorCodeOf(error) });
    return refused(500, copy.errorMessage);
  }
  log({ event: "lead_stored", created: stored.created });

  const context: DeliveryContext = {
    ...dependencies,
    repository,
    rateLimiter,
    sendLimitPerHour: dependencies.sendLimitPerHour ?? ACK_SEND_LIMIT.defaultPerHour,
  };
  const { staffEmail, mailer } = dependencies;
  const kinds: DeliveryKind[] = staffEmail ? ["acknowledgement", "staff_alert"] : ["acknowledgement"];

  // Every outbox row is written before the answer, unclaimed, so `acknowledgementQueued` is never a
  // guess and the work before the answer is the same for a new and a listed address (N1).
  const queued = await Promise.all(kinds.map((kind) => enqueueUnclaimed(kind, stored.leadId, context)));
  const acknowledgementQueued = queued[0]?.queued ?? false;

  // Ruling R40: only a newly created lead may send anything now, and each send spends its kind's
  // budget (D-I1). A resubmitted address (ruling R38) only finds or writes `pending` rows, so repeating a
  // listed address can neither email anyone nor drain the budget for real signups. R88: the rows
  // this request created are claimed after the answer through the outbox's own claim, so the cron
  // worker can never send the same row; review M4: in parallel, each bounded by its own timeout.
  const sendNow = mailer && stored.created ? kinds.filter((_, index) => queued[index]?.created === true) : [];
  if (mailer && sendNow.length > 0) {
    const channel = leadDeliveryChannel(repository, { staffEmail, replyTo: dependencies.replyTo, leadMagnet: dependencies.leadMagnet, fromOutbox: false });
    const attempts: AttemptContext<DeliveryKind> = {
      reserve: (kind) => reserveSend(kind, context),
      deliver: (message) => sendWithTimeout(mailer, message, dependencies.sendTimeoutMs ?? EMAIL_SEND_TIMEOUT_MS),
      log,
    };
    const leadId = stored.leadId;
    const sendAll = async () => {
      await attemptNow(channel, leadId, sendNow, attempts);
    };
    if (dependencies.runAfterResponse) dependencies.runAfterResponse(sendAll);
    else await sendAll();
  }

  /*
   * Superseded in Task 8a (R88, N1), kept as the owner never deletes code: the pre-Task-8a flow
   * spent the send budget BEFORE the answer (only for a new address, so the answer's timing told
   * the two apart) and claimed rows at enqueue, outside the claim the worker uses. Its message
   * builders now live in lib/outbox/leads.ts. Use only to compare behaviour with the history.
   *
   *   const claims = new Map<DeliveryKind, boolean>();
   *   for (const kind of kinds) claims.set(kind, Boolean(dependencies.mailer) && stored.created && (await reserveSend(kind, context)));
   *   const builders: Record<DeliveryKind, () => Omit<EmailMessage, "idempotencyKey">> = {
   *     acknowledgement: () => ({
   *       to: [record.email],
   *       ...buildLeadAcknowledgement({ firstName: record.firstName, leadMagnet: dependencies.leadMagnet }),
   *       ...(dependencies.replyTo ? { replyTo: dependencies.replyTo } : {}),
   *     }),
   *     staff_alert: () => ({
   *       to: [staffEmail ?? ""],
   *       ...buildStaffLeadAlert({ email: record.email, firstName: record.firstName, ageBand: record.ageBand, source: record.source, created: stored.created }),
   *     }),
   *   };
   *   const queued = await Promise.all(kinds.map((kind) => queueDelivery(kind, stored.leadId, claims.get(kind) ?? false, builders[kind], context)));
   *   const sends = queued.flatMap((entry) => (entry.send ? [entry.send] : []));
   *   if (sends.length > 0) {
   *     const sendAll = async () => { await Promise.allSettled(sends.map((send) => send())); };
   *     if (dependencies.runAfterResponse) dependencies.runAfterResponse(sendAll);
   *     else await sendAll();
   *   }
   */

  return { status: 200, body: { ok: true, persisted: true, acknowledgementQueued, message: copy.successMessage } };
}

/** Writes one outbox row, unclaimed (R88). Never throws: a failure means the row does not exist. */
async function enqueueUnclaimed(kind: DeliveryKind, leadId: string, { repository, log }: DeliveryContext): Promise<{ queued: boolean; created: boolean }> {
  try {
    const event = await repository.enqueueDelivery(leadId, kind, { claim: false });
    return { queued: true, created: event.created };
  } catch (error) {
    log({ event: "delivery_enqueue_failed", kind, code: errorCodeOf(error) });
    return { queued: false, created: false };
  }
}
