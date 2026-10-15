import type { Breadcrumb, ErrorEvent, Event } from "@sentry/nextjs";

import { maskPrivatePaths } from "../privacy/private-links";

/** The parts of these SDK types this file relies on (the package's index does not re-export them). */
export type TransactionEvent = Event & { type: "transaction" };
export interface Integration {
  name: string;
}

/**
 * Shared Sentry options and scrubbing (Task 10M-a, binding privacy rule 4). Error reports only:
 * no default personal data, no session replay, and every event, transaction and breadcrumb passes
 * through the scrubber, which keeps a request's method, its URL without the query and the user
 * agent, and nothing else from it; drops the user and every extra value; and masks anything shaped
 * like an email address, and the token of a private order link (Task 7b: `/orders/[token]`). Types
 * only from the SDK: this file never loads Sentry itself.
 */

const EMAIL = /[^\s@<>"'(),;:/?#=&]+@[^\s@<>"'(),;:/?#=&]+\.[A-Za-z]{2,}/g;
const MASK = "[email]";

const maskEmails = (value: string) => value.replace(EMAIL, MASK);
/** Free text: email addresses and private order tokens masked. */
const maskText = (value: string) => maskPrivatePaths(maskEmails(value));

/** A URL or path without its query string and fragment; other strings unchanged. */
function withoutQuery(value: string): string {
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value.split(/[?#]/)[0]!;
    }
  }
  return value.startsWith("/") ? value.split(/[?#]/)[0]! : value;
}

const cleanString = (value: string) => maskText(withoutQuery(value));

function cleanRecord<T extends Record<string, unknown>>(record: T, drop: readonly string[] = []): T {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (drop.includes(key)) continue;
    clean[key] = typeof value === "string" ? cleanString(value) : value;
  }
  return clean as T;
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const clean: Breadcrumb = { ...crumb };
  if (typeof clean.message === "string") clean.message = maskText(clean.message);
  if (clean.data) clean.data = cleanRecord(clean.data);
  return clean;
}

function scrubRequest(request: NonNullable<Event["request"]>): Event["request"] {
  const clean: NonNullable<Event["request"]> = {};
  if (request.url) clean.url = maskPrivatePaths(withoutQuery(request.url));
  if (request.method) clean.method = request.method;
  const userAgent = Object.entries(request.headers ?? {}).find(([name]) => name.toLowerCase() === "user-agent");
  if (userAgent) clean.headers = { [userAgent[0]]: userAgent[1] };
  return clean;
}

/** beforeSend / beforeSendTransaction: see the file comment for what survives. */
export function scrubEvent<T extends Event>(event: T): T {
  const clean: T = { ...event };
  delete clean.user;
  delete clean.extra;
  if (clean.request) clean.request = scrubRequest(clean.request);
  if (typeof clean.message === "string") clean.message = maskText(clean.message);
  if (clean.logentry?.message) clean.logentry = { ...clean.logentry, message: maskText(clean.logentry.message) };
  if (clean.exception?.values) {
    clean.exception = { ...clean.exception, values: clean.exception.values.map((value) => (value.value ? { ...value, value: maskText(value.value) } : value)) };
  }
  if (clean.tags) clean.tags = Object.fromEntries(Object.entries(clean.tags).map(([key, value]) => [key, typeof value === "string" ? maskText(value) : value]));
  if (clean.contexts) {
    clean.contexts = Object.fromEntries(Object.entries(clean.contexts).map(([key, context]) => [key, context && typeof context === "object" ? cleanRecord(context as Record<string, unknown>) : context]));
  }
  if (clean.breadcrumbs) clean.breadcrumbs = clean.breadcrumbs.map(scrubBreadcrumb);
  if (typeof clean.transaction === "string") clean.transaction = maskPrivatePaths(withoutQuery(clean.transaction));
  if (clean.spans) {
    clean.spans = clean.spans.map((span) => {
      const scrubbed = span.data ? { ...span, data: cleanRecord(span.data, ["http.query"]) } : { ...span };
      if (typeof scrubbed.description === "string") scrubbed.description = maskPrivatePaths(scrubbed.description);
      return scrubbed;
    });
  }
  return clean;
}

/** Traces: 0.1 in production, every one elsewhere (preview, development). */
export function tracesSampleRateFor(environment: string): number {
  return environment === "production" ? 0.1 : 1;
}

export interface SentrySettings {
  dsn: string;
  environment: string;
  tracesSampleRate?: number;
}

export function sentryOptions({ dsn, environment, tracesSampleRate }: SentrySettings) {
  return {
    dsn,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate ?? tracesSampleRateFor(environment),
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeSendTransaction: (event: TransactionEvent) => scrubEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => scrubBreadcrumb(crumb),
    // Never session replay, even if a default integration set offered it.
    integrations: (defaults: Integration[]) => defaults.filter((integration) => !/^Replay/.test(integration.name)),
  };
}
