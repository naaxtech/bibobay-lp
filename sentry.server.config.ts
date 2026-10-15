import * as Sentry from "@sentry/nextjs";

import { sentryDsnFrom, sentryEnvironmentFrom } from "./lib/observability/monitoring-env";
import { sentryOptions } from "./lib/observability/sentry-config";

/** Sentry for the Node.js runtime (Task 10M-a): only with a valid DSN, always scrubbed. */
const dsn = sentryDsnFrom(process.env.NEXT_PUBLIC_SENTRY_DSN);
if (dsn) {
  Sentry.init(
    sentryOptions({
      dsn,
      environment: sentryEnvironmentFrom({ VERCEL_ENV: process.env.VERCEL_ENV }),
      // No request sessions (re-review 2 N1): error reports only.
      makeHttpIntegration: (settings) => Sentry.httpIntegration(settings),
    }),
  );
}
