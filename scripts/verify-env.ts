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
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SANITY_PROJECT_ID",
  "NEXT_PUBLIC_SANITY_DATASET",
  "NEXT_PUBLIC_SANITY_API_VERSION",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
]);

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

  return {
    ok: forbiddenPublic.length === 0,
    phase,
    forbiddenPublic,
    errors: forbiddenPublic.map((name) => `Forbidden public environment variable: ${name}`),
  };
}

// Importing this module from tests or the app must never inspect or print process.env.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.env.NODE_ENV || "development";
  const report = verifyEnvironment(process.env, phase as EnvironmentPhase);
  if (report.ok) {
    console.log(`Environment check passed (${report.phase}).`);
  } else {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  }
}
