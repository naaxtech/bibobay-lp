import * as Sentry from "@sentry/nextjs";

/**
 * Server and edge error monitoring (Task 10M-a). Each runtime loads its Sentry setup, which does
 * nothing without NEXT_PUBLIC_SENTRY_DSN. Request errors Next catches go to Sentry through
 * captureRequestError (a no-op until Sentry is initialised), scrubbed by the shared beforeSend.
 * src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md · next 16.3.8 · 2026-10-16
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
