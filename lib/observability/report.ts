import "server-only";

import * as Sentry from "@sentry/nextjs";

import { sentryDsnFrom } from "./monitoring-env";

/**
 * The only way app code reaches Sentry (Task 10M-a, privacy rules 5 and 6). Context is reduced to
 * a few tags that are plain identifiers: an area, an event name, a delivery kind and a database or
 * service error code. Anything else (an address, a name, a lead payload) is dropped before Sentry
 * sees it. Without a DSN both functions do nothing.
 */
export interface ReportContext {
  area?: string;
  event?: string;
  kind?: string;
  code?: string;
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
const ERROR_CODE = /^[A-Z0-9]{1,16}$/;

function tagsFrom(context: Record<string, unknown>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const name of ["area", "event", "kind"] as const) {
    const value = context[name];
    if (typeof value === "string" && IDENTIFIER.test(value)) tags[name] = value;
  }
  if (typeof context.code === "string" && ERROR_CODE.test(context.code)) tags.code = context.code;
  return tags;
}

const enabled = () => sentryDsnFrom(process.env.NEXT_PUBLIC_SENTRY_DSN) !== null;

/** An unexpected failure, with where it happened. The user-facing message stays generic. */
export function reportError(error: unknown, context: ReportContext): void {
  if (!enabled()) return;
  Sentry.captureException(error, { tags: tagsFrom(context as Record<string, unknown>) });
}

/** An operational event worth an alert (ruling R52), as a warning-level message. */
export function reportEvent(event: string, context: Omit<ReportContext, "event" | "area"> = {}): void {
  if (!enabled()) return;
  const tags = tagsFrom({ ...(context as Record<string, unknown>), event });
  if (!tags.event) return;
  Sentry.captureMessage(tags.event, { level: "warning", tags });
}
