import { browserSentryEnvironment, sentryDsnFrom } from "./lib/observability/sentry-dsn";
import { sentryOptions } from "./lib/observability/sentry-config";

/**
 * Browser error monitoring (Task 10M-a). The SDK is loaded only when a DSN is configured, as its
 * own chunk after the page has started, so a site without Sentry ships none of it and the first
 * load stays light. Errors in the first moments before it loads are not reported.
 * src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md · next 16.3.8 · 2026-10-16
 */
const dsn = sentryDsnFrom(process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions({ dsn, environment: browserSentryEnvironment(process.env.NEXT_PUBLIC_VERCEL_ENV) }));
  });
}
