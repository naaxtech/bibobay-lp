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
/**
 * The longest string sent, in characters (Task 7b re-review): the masking patterns cost more on
 * long unbroken text, and this runs on the browser's main thread for console breadcrumbs.
 */
const MAX_TEXT = 2_000;
/** A path or URL followed by a query, anywhere in free text (Task 7b re-review O3). */
const QUERY_IN_TEXT = /((?:[a-z][a-z0-9+.-]*:\/\/[^\s/?#"'<>]+)?\/[^\s?#"'<>]*)\?[^\s#"'<>]*/gi;

const cap = (value: string) => (value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
const maskEmails = (value: string) => (value.includes("@") ? value.replace(EMAIL, MASK) : value);
const stripQueries = (value: string) => (value.includes("?") ? value.replace(QUERY_IN_TEXT, "$1") : value);
/** Free text: cut to MAX_TEXT, queries removed, email addresses and private order tokens masked. */
const maskText = (value: string) => maskPrivatePaths(maskEmails(stripQueries(cap(value))));

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

/** Query strings the SDK and Next record as separate attributes; dropped wherever they appear. */
const QUERY_KEYS: readonly string[] = ["http.query", "url.query"];
/**
 * How deep nested context and span data is cleaned (Task 7b review: Next records the request URL
 * as `http.target` in `contexts.trace.data`). Anything deeper is dropped, which also ends a cycle.
 */
const MAX_DEPTH = 6;

function cleanValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return cleanString(value);
  if (!value || typeof value !== "object") return value;
  // An Error (e.g. a console.error argument) keeps its cleaned message; other class instances
  // their cleaned text form. Only plain objects and arrays are walked.
  if (value instanceof Error) return cleanString(`${value.name}: ${value.message}`);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((entry) => cleanValue(entry, depth + 1));
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return cleanString(String(value));
  return cleanRecord(value as Record<string, unknown>, depth + 1);
}

/** Every string at every depth cleaned (query removed, emails and order tokens masked); query keys dropped. */
function cleanRecord<T extends Record<string, unknown>>(record: T, depth = 0): T {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (QUERY_KEYS.includes(key)) continue;
    const cleaned = cleanValue(value, depth);
    if (cleaned !== undefined) clean[key] = cleaned;
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
    clean.exception = {
      ...clean.exception,
      values: clean.exception.values.map((entry) => {
        const value = entry.value ? { ...entry, value: maskText(entry.value) } : { ...entry };
        // Local variable values in stack frames can hold anything a function had (an email, an
        // address): never sent, whatever the SDK collected.
        if (value.stacktrace?.frames) value.stacktrace = { ...value.stacktrace, frames: value.stacktrace.frames.map((frame) => {
          const kept = { ...frame };
          delete kept.vars;
          return kept;
        }) };
        return value;
      }),
    };
  }
  if (clean.tags) clean.tags = Object.fromEntries(Object.entries(clean.tags).map(([key, value]) => [key, typeof value === "string" ? maskText(value) : value]));
  if (clean.contexts) {
    clean.contexts = Object.fromEntries(Object.entries(clean.contexts).map(([key, context]) => [key, context && typeof context === "object" ? cleanRecord(context as Record<string, unknown>) : context]));
  }
  if (clean.breadcrumbs) clean.breadcrumbs = clean.breadcrumbs.map(scrubBreadcrumb);
  if (typeof clean.transaction === "string") clean.transaction = maskPrivatePaths(withoutQuery(clean.transaction));
  if (clean.spans) {
    clean.spans = clean.spans.map((span) => {
      const scrubbed = span.data ? { ...span, data: cleanRecord(span.data) } : { ...span };
      if (typeof scrubbed.description === "string") scrubbed.description = maskPrivatePaths(scrubbed.description);
      return scrubbed;
    });
  }
  return clean;
}

/**
 * UNUSED since ruling R86 (Task 7b re-review, 2026-10-16): the trace sample rates of Task 10M-a
 * (commit 825d525), 0.1 in production and every trace elsewhere. Tracing is now off: SDK 11
 * streams traces as spans and never runs beforeSendTransaction on them, so they left with URL
 * queries and private order tokens. Kept, not deleted (owner's rule): use it only together with a
 * `beforeSendSpan` scrubber that masks every span attribute, proven by e2e/observability.
 */
export function tracesSampleRateFor(environment: string): number {
  return environment === "production" ? 0.1 : 1;
}

/**
 * The least data SDK 11 collects. It has no `sendDefaultPii`; `dataCollection` decides, and its
 * defaults collect headers, bodies, query strings, user info and stack-frame variables.
 * src: node_modules/@sentry/core/build/types/types/datacollection.d.ts · @sentry/core 11.8.0 · 2026-10-16
 */
export const MINIMAL_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

export interface SentrySettings {
  dsn: string;
  environment: string;
}

/**
 * Error reports only (ruling R86): no `tracesSampleRate` or `tracesSampler`, so the SDK traces
 * nothing, and no browser tracing or replay integration.
 */
export function sentryOptions({ dsn, environment }: SentrySettings) {
  return {
    dsn,
    environment,
    // SDK 10's switch; SDK 11 ignores it (dataCollection below replaces it). Kept for readers of the old docs.
    sendDefaultPii: false,
    dataCollection: MINIMAL_DATA_COLLECTION,
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    // Runs only with traceLifecycle "static", and tracing is off; kept so a trace could never skip the scrubber.
    beforeSendTransaction: (event: TransactionEvent) => scrubEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => scrubBreadcrumb(crumb),
    // Never session replay or browser tracing, even if a default integration set offered them.
    integrations: (defaults: Integration[]) => defaults.filter((integration) => !/^(Replay|BrowserTracing)/.test(integration.name)),
  };
}
