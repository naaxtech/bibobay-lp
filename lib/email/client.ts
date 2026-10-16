import "server-only";

import { Resend } from "resend";

/**
 * Transactional email through Resend (spec §12), behind a small interface so the lead flow can be
 * tested without the network and Task 8's outbox worker can reuse it.
 *
 * Never throws: a mail outage must not fail a signup that is already stored. A failure is reported
 * as a short provider error code (Resend's `name`, e.g. `daily_quota_exceeded`), never the
 * provider's message, which can echo the recipient's address.
 *
 * RESEND_FROM must be an address on a domain verified in Resend. Until one is verified, Resend only
 * delivers its sandbox sender to the account owner, so an unverified sender looks fine in testing
 * and silently drops real signups. There is deliberately no fallback sender: with no RESEND_FROM,
 * email is unconfigured and acknowledgements wait in the outbox.
 */
export interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Sent as Resend's Idempotency-Key, so a retried outbox event cannot email twice. */
  idempotencyKey?: string;
}

export type EmailSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; errorCode: string };

export interface EmailSendOptions {
  /** Aborts the provider request, e.g. when the caller's timeout fires (Resend SDK `RequestOptions.signal`). */
  signal?: AbortSignal;
}

export interface EmailSender {
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailSendResult>;
}

export interface EmailEnvironment {
  apiKey: string;
  from: string;
  /** Optional address replies go to (for removal requests); null leaves replies to the sender. */
  replyTo: string | null;
}

/** `Name <local@domain>` or a bare `local@domain`. */
const SENDER_PATTERN = /^(?:[^<>@\r\n]{1,80} <[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)$/;
const ADDRESS_PATTERN = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;

export function getEmailEnvironment(env: Record<string, string | undefined> = process.env): EmailEnvironment | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM?.trim();
  if (!apiKey || !from || !SENDER_PATTERN.test(from)) return null;
  const replyTo = env.RESEND_REPLY_TO?.trim();
  return { apiKey, from, replyTo: replyTo && ADDRESS_PATTERN.test(replyTo) ? replyTo : null };
}

/** A staff inbox for lead alerts, or null when alerts are off. */
export function getStaffNotificationEmail(env: Record<string, string | undefined> = process.env): string | null {
  const address = env.STAFF_NOTIFICATION_EMAIL?.trim();
  return address && ADDRESS_PATTERN.test(address) ? address : null;
}

/** The slice of the Resend SDK this module uses; tests pass a fake. */
export interface ResendLike {
  emails: {
    send(
      payload: { from: string; to: string[]; subject: string; html: string; text: string; replyTo?: string },
      options?: { idempotencyKey?: string; signal?: AbortSignal },
    ): Promise<{ data: { id: string } | null; error: { name: string; message: string; statusCode: number | null } | null; headers?: Record<string, string> | null }>;
  };
}

const errorCode = (name: unknown) => (typeof name === "string" && /^[a-z0-9_]{1,60}$/i.test(name) ? name : "provider_error");

export function createResendSender({ apiKey, from, client }: { apiKey: string; from: string; client?: ResendLike }): EmailSender {
  const resend: ResendLike = client ?? (new Resend(apiKey) as unknown as ResendLike);
  return {
    async send(message, { signal } = {}) {
      // An already-expired caller budget: do not start a request that would only be abandoned.
      if (signal?.aborted) return { status: "failed", errorCode: "send_aborted" };
      try {
        const payload = {
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        };
        const requestOptions = {
          ...(message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : {}),
          ...(signal ? { signal } : {}),
        };
        const { data, error } = await resend.emails.send(payload, Object.keys(requestOptions).length > 0 ? requestOptions : undefined);
        if (error) return { status: "failed", errorCode: signal?.aborted ? "send_aborted" : errorCode(error.name) };
        if (!data?.id) return { status: "failed", errorCode: "missing_message_id" };
        return { status: "sent", providerMessageId: data.id };
      } catch {
        return { status: "failed", errorCode: "send_exception" };
      }
    },
  };
}

/** The configured sender, or null when email is not set up (acknowledgements then wait in the outbox). */
export function createEmailSenderFromEnv(env: Record<string, string | undefined> = process.env): { sender: EmailSender; replyTo: string | null } | null {
  const config = getEmailEnvironment(env);
  return config ? { sender: createResendSender({ apiKey: config.apiKey, from: config.from }), replyTo: config.replyTo } : null;
}
