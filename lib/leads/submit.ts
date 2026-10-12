import "server-only";

import { FORM_COPY } from "@/components/forms/form-copy";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/client";
import { buildLeadAcknowledgement, buildStaffLeadAlert, type LeadMagnetLink } from "@/lib/email/lead-emails";
import type { RateLimiter } from "@/lib/security/rate-limit";
import { isHoneypotFilled, validateLeadSubmission, type AgeBand, type LeadFieldErrors, type UtmTags } from "./schema";

/**
 * Founding-family signup orchestration (spec §9). Order matters and is the whole point:
 *
 *   honeypot → validation → storage configured? → shared rate limit → durable write
 *   → outbox row → (email attempt → outcome recorded)
 *
 * Success is reported only after the write (spec §9.8). An email problem after the write never
 * turns into a failed signup (§9.7): it is recorded on the outbox row for the retry worker
 * (Task 8). `acknowledgementQueued` is true only once that outbox row exists (ruling R27).
 * No message ever says an email was sent or delivered.
 */

export type DeliveryKind = "acknowledgement" | "staff_alert";
export type DeliveryStatus = "pending" | "sending" | "sent" | "failed";
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

export interface LeadRepository {
  /** Upserts on the normalised email; resolves only once the row is durably stored. */
  submitLead(record: LeadRecordInput): Promise<{ leadId: string; created: boolean }>;
  /**
   * Writes the outbox row for one message kind, at most once per lead and kind. With `claim`, a new
   * row starts as `sending` (attempt 1) because this request is about to send it.
   */
  enqueueDelivery(leadId: string, kind: DeliveryKind, options: { claim: boolean }): Promise<{ eventId: string; status: DeliveryStatus; created: boolean }>;
  recordDeliveryAttempt(eventId: string, outcome: DeliveryOutcome): Promise<void>;
}

/** Five signups per client per ten minutes, shared by every server instance. */
export const LEAD_RATE_LIMIT = { scope: "lead", maxHits: 5, windowSeconds: 600 } as const;

/** How long a signup waits for the email provider before recording a failure for the retry worker. */
export const EMAIL_SEND_TIMEOUT_MS = 8_000;

const DEFAULT_SOURCE = "landing";

export type LeadLogEvent =
  | { event: "lead_stored"; created: boolean }
  | { event: "lead_store_failed"; code: string }
  | { event: "lead_rate_limited" }
  | { event: "lead_rate_limit_unavailable"; code: string }
  | { event: "lead_storage_unconfigured" }
  | { event: "lead_honeypot" }
  | { event: "delivery_enqueue_failed"; kind: DeliveryKind; code: string }
  | { event: "delivery_attempted"; kind: DeliveryKind; status: DeliveryOutcome["status"]; code?: string }
  | { event: "delivery_record_failed"; kind: DeliveryKind; code: string };

export interface LeadSubmissionDependencies {
  /** Null while Supabase is not configured: nothing can be stored, so nothing is accepted. */
  repository: LeadRepository | null;
  /** The shared limiter. Null with storage configured is a misconfiguration and fails closed. */
  rateLimiter: RateLimiter | null;
  /** Null while Resend is not configured: acknowledgements wait in the outbox as `pending`. */
  mailer: EmailSender | null;
  /** CMS lead copy: shown for success (only after persistence) and for every failure. */
  copy: { successMessage: string; errorMessage: string };
  /** The consent copy version from CMS legal settings; never taken from the request. */
  consentVersion: string;
  /** An opaque, keyed hash of the client address (lib/leads/http.ts); never the address itself. */
  clientKey: string;
  staffEmail: string | null;
  leadMagnet: LeadMagnetLink | null;
  replyTo: string | null;
  /** Structured, PII-free operational log. */
  log: (event: LeadLogEvent) => void;
  sendTimeoutMs?: number;
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

async function sendWithTimeout(mailer: EmailSender, message: EmailMessage, timeoutMs: number): Promise<EmailSendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EmailSendResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", errorCode: "send_timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([mailer.send(message).catch((): EmailSendResult => ({ status: "failed", errorCode: "send_exception" })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Queues one outbox message and, when a mailer is configured and the row is new, sends it now and
 * records the outcome. Returns whether the outbox row exists. Never throws.
 */
async function deliver(
  kind: DeliveryKind,
  leadId: string,
  build: () => Omit<EmailMessage, "idempotencyKey">,
  { repository, mailer, log, sendTimeoutMs = EMAIL_SEND_TIMEOUT_MS }: Pick<LeadSubmissionDependencies, "mailer" | "log" | "sendTimeoutMs"> & { repository: LeadRepository },
): Promise<boolean> {
  let event: { eventId: string; status: DeliveryStatus; created: boolean };
  try {
    event = await repository.enqueueDelivery(leadId, kind, { claim: mailer !== null });
  } catch (error) {
    log({ event: "delivery_enqueue_failed", kind, code: errorCodeOf(error) });
    return false;
  }
  // A repeat signup finds its row already there: one message per lead and kind, ever, so a stranger
  // cannot use the form to flood someone's inbox. Unsent rows are the retry worker's job.
  if (!event.created || !mailer || event.status !== "sending") return true;

  const outcome = await sendWithTimeout(mailer, { ...build(), idempotencyKey: `lead-delivery/${event.eventId}` }, sendTimeoutMs);
  log(outcome.status === "sent" ? { event: "delivery_attempted", kind, status: "sent" } : { event: "delivery_attempted", kind, status: "failed", code: outcome.errorCode });
  try {
    await repository.recordDeliveryAttempt(event.eventId, outcome);
  } catch (error) {
    // The row stays `sending`; the retry worker re-sends it under the same idempotency key.
    log({ event: "delivery_record_failed", kind, code: errorCodeOf(error) });
  }
  return true;
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

  const acknowledgementQueued = await deliver("acknowledgement", stored.leadId, () => ({
    to: [record.email],
    ...buildLeadAcknowledgement({ firstName: record.firstName, leadMagnet: dependencies.leadMagnet }),
    ...(dependencies.replyTo ? { replyTo: dependencies.replyTo } : {}),
  }), { ...dependencies, repository });

  if (dependencies.staffEmail) {
    const staffEmail = dependencies.staffEmail;
    await deliver("staff_alert", stored.leadId, () => ({
      to: [staffEmail],
      ...buildStaffLeadAlert({ email: record.email, firstName: record.firstName, ageBand: record.ageBand, source: record.source, created: stored.created }),
      replyTo: record.email,
    }), { ...dependencies, repository });
  }

  return { status: 200, body: { ok: true, persisted: true, acknowledgementQueued, message: copy.successMessage } };
}
