import { analyticsConfig } from "../lib/analytics/config";
import { botCheckConfig, type BotCheckProblem } from "../lib/bot-check/config";
import { sentryDsnFrom } from "../lib/observability/sentry-dsn";
import { parsePaymentHostAllowlist } from "../lib/security/payment-url";
import { SERVER_SECRET_MIN_LENGTH } from "../lib/security/secrets";
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
  // Bot check (Cloudflare Turnstile): a site key is public by design (it is rendered in the page).
  // TURNSTILE_SECRET_KEY is a server name and is refused under NEXT_PUBLIC_.
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
]);

const BOT_CHECK_PROBLEMS: Record<BotCheckProblem, string> = {
  half: "only one of the two keys is set",
  malformed: "a key is not the shape Turnstile issues",
  mixed_keys: "a Cloudflare test key is mixed with a real key",
  test_keys_in_production: "Cloudflare test keys are set in production",
};

/**
 * Vercel prefixes every System Environment Variable with the framework prefix (VERCEL_* becomes
 * NEXT_PUBLIC_VERCEL_*) and adds names over time, so the whole namespace is allowed rather than a list:
 * NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG appeared on 2026-10-16 and failed the first production build.
 * Vercel's own prefixer (the file named below) produces only eight named variables plus VERCEL_GIT_*, never a
 * credential-shaped name, and it does not produce that observability name: it reached the build by another Vercel
 * path, which is why the whole namespace is allowed rather than the prefixer's list. Credential-shaped names
 * inside the namespace stay refused on purpose, because any NEXT_PUBLIC_ value can reach the browser; a
 * Vercel-injected one would need an explicit entry in the list above after its value is confirmed not secret.
 * src: https://raw.githubusercontent.com/vercel/vercel/main/packages/build-utils/src/get-prefixed-env-vars.ts · read 2026-10-16
 */
const VERCEL_PUBLIC = /^NEXT_PUBLIC_VERCEL_[A-Z0-9_]+$/;

/** The explicitly listed public names (the Vercel namespace is a rule, not a list); use isAllowedPublicName to decide. */
export const ALLOWED_PUBLIC_NAMES: ReadonlySet<string> = allowedPublicNames;

/**
 * The only names the browser may see: the explicit list or Vercel's own namespace, never a name shaped
 * like a credential. scripts/verify-bundle-secrets.ts and verify-deployment.ts use this same predicate, so
 * the env verifier and the client-bundle scan agree on every name.
 */
export function isAllowedPublicName(name: string): boolean {
  return allowedPublicNames.has(name) || (VERCEL_PUBLIC.test(name) && !PRIVATE_NAME_PATTERN.test(name));
}

/** Server names whose values are credentials; their values must never reach a public name or the client bundle. */
export const PRIVATE_NAME_PATTERN = /(?:_SECRET(?:_|$)|_TOKEN$|_PRIVATE_KEY$|_SERVICE_ROLE_KEY$|_API_KEY$)/i;

/** The value lib/leads/dependencies.ts uses (N4: both read lib/security/secrets.ts): a shorter address-hashing secret leaves lead storage unconfigured. */
export const LEAD_IP_HASH_SECRET_MIN_LENGTH = SERVER_SECRET_MIN_LENGTH;

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
      !isAllowedPublicName(name) ||
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
  // Task 8a: the outbox worker treats a shorter CRON_SECRET as unset (503 on every run), so a
  // production build fails instead of shipping a worker that never runs. Name only, never the value.
  const cronSecret = env.CRON_SECRET?.trim() ?? "";
  if (phase === "production" && cronSecret.length > 0 && cronSecret.length < SERVER_SECRET_MIN_LENGTH) {
    weak.push(`CRON_SECRET must be at least ${SERVER_SECRET_MIN_LENGTH} characters`);
  }

  // Review M6: monitoring values that are set but malformed would leave analytics or error reports
  // silently off. Fail instead, naming the variable but never its value.
  const monitoring: string[] = [];
  if ((env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "") && analyticsConfig(env) === null) {
    monitoring.push("NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST: not a PostHog project key (phc_) with an exact https host; analytics would stay off");
  }
  // Ruling R86: error reports only. The Sentry SDK would read this name and trace (re-review 2 N2).
  // (NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE is already refused above as an unknown public name.)
  if (env.SENTRY_TRACES_SAMPLE_RATE !== undefined) {
    monitoring.push("SENTRY_TRACES_SAMPLE_RATE: Sentry tracing is off by design (ruling R86); remove this variable");
  }
  if ((env.NEXT_PUBLIC_SENTRY_DSN?.trim() ?? "") && sentryDsnFrom(env.NEXT_PUBLIC_SENTRY_DSN) === null) {
    monitoring.push("NEXT_PUBLIC_SENTRY_DSN: not an https DSN with a public key and a numeric project; error reports would stay off");
  }

  // Task 8b (ruling R97): quotes accept payment links only to the exact hosts listed. An entry that
  // is not one exact host is ignored by the app, so a typo would silently refuse that provider's
  // links: fail instead, with a count only, never the value. Unset or empty is allowed (no payment
  // links are accepted until the owner lists the providers).
  const payment: string[] = [];
  const { invalid } = parsePaymentHostAllowlist(env.PAYMENT_HOST_ALLOWLIST);
  if (invalid > 0) {
    payment.push(
      `PAYMENT_HOST_ALLOWLIST: ${invalid} ${invalid === 1 ? "entry is" : "entries are"} not one exact host (no wildcards, schemes, paths, ports or IP addresses) and would be ignored`,
    );
  }

  // Bot check (R215): a misconfigured pair makes every form answer 503, so a production build fails
  // instead. Variable names and a reason only, never a value.
  const botCheck: string[] = [];
  const botCheckState = botCheckConfig(env);
  if (phase === "production" && botCheckState.state === "misconfigured") {
    botCheck.push(`NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY: ${BOT_CHECK_PROBLEMS[botCheckState.problem]}; every form would answer 503`);
  }

  return {
    ok: forbiddenPublic.length === 0 && weak.length === 0 && monitoring.length === 0 && payment.length === 0 && botCheck.length === 0,
    phase,
    forbiddenPublic,
    errors: [...forbiddenPublic.map((name) => `Forbidden public environment variable: ${name}`), ...weak, ...monitoring, ...payment, ...botCheck],
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
