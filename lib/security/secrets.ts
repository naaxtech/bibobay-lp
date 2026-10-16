/**
 * Shared minimums for server secrets (Task 5 re-review N4). Plain TypeScript with no imports, so
 * the server (lib/leads/dependencies.ts), the cron route and the build check (scripts/verify-env.ts,
 * run by tsx without the "@/" alias) all read the one value.
 *
 * Review M8: with a shorter client-address hashing secret, anyone holding the rate-limit table
 * could brute-force it over the IPv4 space. The outbox worker's `CRON_SECRET` uses the same
 * minimum (Task 8a): a shorter one counts as unconfigured.
 */
export const SERVER_SECRET_MIN_LENGTH = 32;

/** The client-address hashing secret, or null when missing or too short (also keys the download links, lib/freebies/token.ts). */
export function hashSecretFrom(env: Record<string, string | undefined>): string | null {
  const secret = env.LEAD_IP_HASH_SECRET?.trim();
  return secret && secret.length >= SERVER_SECRET_MIN_LENGTH ? secret : null;
}
