import { analyticsConfig } from "../lib/analytics/config";
import { sentryDsnFrom } from "../lib/observability/sentry-dsn";
import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type EnvironmentPhase = "development" | "test" | "production";

export interface EnvReport {
  ok: boolean;
  phase: EnvironmentPhase;
  forbiddenPublic: string[];
  errors: string[];
}

const allowedPublicNames = new Set([
  // Lead capture (Task 5) adds no public name: the browser posts to /api/leads and never talks to
  // Supabase or Resend. Its server names (SUPABASE_SERVICE_ROLE_KEY, RESEND_*, STAFF_NOTIFICATION_EMAIL,
  // LEAD_IP_HASH_SECRET, LEAD_ACK_SEND_LIMIT_PER_HOUR) are refused here under a NEXT_PUBLIC_ prefix
  // like any unlisted name.
  // Task 9 adds none either: SANITY_REVALIDATE_SECRET (webhook), SANITY_API_READ_TOKEN (draft preview)
  // and SANITY_STUDIO_ORIGIN (CSP frame-ancestors) are read on the server only (proxy.ts, route handlers).
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SANITY_PROJECT_ID",
  "NEXT_PUBLIC_SANITY_DATASET",
  "NEXT_PUBLIC_SANITY_API_VERSION",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // Ruling R70 (visit statistics): a PostHog project key can only send events, so it is public by
  // design; the host is where they go. A personal API key (phx_) reads the whole project and is
  // refused under this name below.
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  // Task 10M-a: a Sentry DSN can only submit events. Its server names (SENTRY_AUTH_TOKEN,
  // SENTRY_ORG, SENTRY_PROJECT) are refused here under NEXT_PUBLIC_.
  "NEXT_PUBLIC_SENTRY_DSN",
  // Vercel's own framework-prefixed System Environment Variables, set on every Next.js build.
  // src: https://raw.githubusercontent.com/vercel/vercel/main/packages/build-utils/src/get-prefixed-env-vars.ts · read 2026-10-16
  "NEXT_PUBLIC_VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_TARGET_ENV",
  "NEXT_PUBLIC_VERCEL_REGION",
  "NEXT_PUBLIC_VERCEL_BRANCH_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID",
  "NEXT_PUBLIC_VERCEL_PROJECT_ID",
]);

/** Vercel also adds every VERCEL_GIT_* variable with the framework prefix (same source). */
const VERCEL_GIT_PUBLIC = /^NEXT_PUBLIC_VERCEL_GIT_[A-Z_]+$/;

/**
 * The only names the browser may see. scripts/verify-bundle-secrets.ts reads this same set, so a
 * name added here is accepted by the client-bundle scan too, and any other NEXT_PUBLIC_ name fails it.
 */
export const ALLOWED_PUBLIC_NAMES: ReadonlySet<string> = allowedPublicNames;

/** Server names whose values are credentials; their values must never reach a public name or the client bundle. */
export const PRIVATE_NAME_PATTERN = /(?:_SECRET(?:_|$)|_TOKEN$|_PRIVATE_KEY$|_SERVICE_ROLE_KEY$|_API_KEY$)/i;

/** Matches lib/leads/dependencies.ts: a shorter address-hashing secret leaves lead storage unconfigured. */
export const LEAD_IP_HASH_SECRET_MIN_LENGTH = 32;

/** Reject public server credentials by name and secret-key values; never echo values. */
export function verifyEnvironment(
  env: Record<string, string | undefined>,
  phase: EnvironmentPhase,
): EnvReport {
  if (phase !== "development" && phase !== "test" && phase !== "production") {
    throw new Error(`Unknown environment phase: ${String(phase)}`);
  }

  const privateValues = new Set(
    Object.entries(env)
      .filter(([name, value]) =>
        !name.startsWith("NEXT_PUBLIC_") &&
        PRIVATE_NAME_PATTERN.test(name) &&
        Boolean(value?.trim()),
      )
      .map(([, value]) => value?.trim()),
  );
  const forbiddenPublic = Object.keys(env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_") && (
      !(allowedPublicNames.has(name) || VERCEL_GIT_PUBLIC.test(name)) ||
      /^sb_secret_/i.test(env[name]?.trim() ?? "") ||
      (name === "NEXT_PUBLIC_POSTHOG_KEY" && /^phx_/i.test(env[name]?.trim() ?? "")) ||
      privateValues.has(env[name]?.trim())
    ))
    .sort();

  // Review M8: a short HMAC secret makes a leaked rate-limit table brute-forceable over the IPv4
  // space. The route already refuses to store leads with one (lib/leads/dependencies.ts); a
  // production build fails loudly instead of shipping a form that only ever answers 503. Unset is
  // allowed: leads are simply not configured yet. Only the name is reported, never the value.
  const hashSecret = env.LEAD_IP_HASH_SECRET?.trim() ?? "";
  const weak = phase === "production" && hashSecret.length > 0 && hashSecret.length < LEAD_IP_HASH_SECRET_MIN_LENGTH
    ? [`LEAD_IP_HASH_SECRET must be at least ${LEAD_IP_HASH_SECRET_MIN_LENGTH} characters`]
    : [];

  // Review M6: monitoring values that are set but malformed would leave analytics or error reports
  // silently off. Fail instead, naming the variable but never its value.
  const monitoring: string[] = [];
  if ((env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "") && analyticsConfig(env) === null) {
    monitoring.push("NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST: not a PostHog project key (phc_) with an exact https host; analytics would stay off");
  }
  if ((env.NEXT_PUBLIC_SENTRY_DSN?.trim() ?? "") && sentryDsnFrom(env.NEXT_PUBLIC_SENTRY_DSN) === null) {
    monitoring.push("NEXT_PUBLIC_SENTRY_DSN: not an https DSN with a public key and a numeric project; error reports would stay off");
  }

  return {
    ok: forbiddenPublic.length === 0 && weak.length === 0 && monitoring.length === 0,
    phase,
    forbiddenPublic,
    errors: [...forbiddenPublic.map((name) => `Forbidden public environment variable: ${name}`), ...weak, ...monitoring],
  };
}

// Importing this module from tests or the app must never inspect or print process.env.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = (process.argv[2] || process.env.NODE_ENV || "development") as EnvironmentPhase;
  verifyEnvironment({}, phase);
  Object.assign(process.env, { NODE_ENV: phase });
  nextEnv.loadEnvConfig(process.cwd(), phase === "development");
  const report = verifyEnvironment(process.env, phase);
  if (report.ok) {
    console.log(`Environment check passed (${report.phase}).`);
  } else {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  }
}
