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
]);

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
        /(?:_SECRET(?:_|$)|_TOKEN$|_PRIVATE_KEY$|_SERVICE_ROLE_KEY$|_API_KEY$)/i.test(name) &&
        Boolean(value?.trim()),
      )
      .map(([, value]) => value?.trim()),
  );
  const forbiddenPublic = Object.keys(env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_") && (
      !allowedPublicNames.has(name) ||
      /^sb_secret_/i.test(env[name]?.trim() ?? "") ||
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

  return {
    ok: forbiddenPublic.length === 0 && weak.length === 0,
    phase,
    forbiddenPublic,
    errors: [...forbiddenPublic.map((name) => `Forbidden public environment variable: ${name}`), ...weak],
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
