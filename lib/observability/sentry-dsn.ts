/**
 * The browser-safe half of the Sentry environment (Task 10M-a): DSN checks and the browser's
 * environment tag. Client code (instrumentation-client.ts, app/global-error.tsx) imports only this
 * file, so no server-only variable name reaches the client bundle (verify:bundle checks).
 */

/** An https DSN with a public key, no secret part, an exact host and a numeric project; else null. */
export function sentryDsnFrom(value: string | undefined): string | null {
  const dsn = value?.trim() ?? "";
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    if (url.protocol !== "https:" || !url.username || url.password || url.search || url.hash) return null;
    if (url.hostname.includes("*") || !/^\/\d+$/.test(url.pathname)) return null;
    return dsn;
  } catch {
    return null;
  }
}

/** Where the browser SDK posts events: the DSN's origin (for CSP connect-src). */
export function sentryIngestOrigin(dsn: string | null): string | null {
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

export const VERCEL_ENVIRONMENTS: ReadonlySet<string> = new Set(["production", "preview", "development"]);

/** In the browser: Vercel's public environment name (NEXT_PUBLIC_VERCEL_ENV), else development. */
export function browserSentryEnvironment(vercelEnvironment: string | undefined): string {
  const value = vercelEnvironment?.trim();
  return value && VERCEL_ENVIRONMENTS.has(value) ? value : "development";
}
