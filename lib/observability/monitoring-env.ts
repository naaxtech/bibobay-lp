// Relative on purpose: next.config.ts imports this file, and its transpiler does not resolve "@/".
import { analyticsConfig } from "../analytics/config";
import { VERCEL_ENVIRONMENTS, sentryDsnFrom, sentryIngestOrigin } from "./sentry-dsn";

export { sentryDsnFrom, sentryIngestOrigin } from "./sentry-dsn";

/**
 * Monitoring environment (Task 10M-a). Every value is optional; absent or malformed means the tool
 * is off. Public by design: NEXT_PUBLIC_SENTRY_DSN (a DSN can only submit events) and the two
 * PostHog names (lib/analytics/config.ts, ruling R70). Server only: SENTRY_AUTH_TOKEN, SENTRY_ORG and
 * SENTRY_PROJECT (build-time source-map upload). The environment tag is Vercel's own VERCEL_ENV;
 * there is deliberately no SENTRY_ENVIRONMENT name, because Sentry's browser SDK reads that name and
 * verify:bundle would then flag the SDK chunk.
 */
type Env = Record<string, string | undefined>;

/** Vercel's environment (production, preview, development), else development. */
export function sentryEnvironmentFrom(env: { VERCEL_ENV?: string }): string {
  const vercel = env.VERCEL_ENV?.trim();
  return vercel && VERCEL_ENVIRONMENTS.has(vercel) ? vercel : "development";
}

/** Exact origins the page may send monitoring data to: the Sentry ingest host, then PostHog's. */
export function monitoringConnectSources(
  env: Env = {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
): string[] {
  const sources = [sentryIngestOrigin(sentryDsnFrom(env.NEXT_PUBLIC_SENTRY_DSN)), analyticsConfig(env)?.apiHost ?? null];
  return sources.filter((source): source is string => source !== null);
}
