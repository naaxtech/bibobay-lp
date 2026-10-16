/*
 * Vercel Deployment Protection bypass for automation (final review O-I3).
 *
 * A protected preview answers a login wall to anything without the project's "Protection Bypass for
 * Automation" secret, sent as the `x-vercel-protection-bypass` header. The verifier rebuilds every
 * follow-up URL from the origin (`new URL(path, origin)`), which drops a `?x-vercel-protection-bypass=`
 * query string, so the token travels as a header on every request to the named origin instead. The
 * secret is read from VERCEL_AUTOMATION_BYPASS_SECRET (set in the shell or the CI secret store, never in
 * a file of the repository), is sent to the origin the operator named and to no other host, and is never
 * printed: no function here returns, logs or throws it.
 * src: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation · 2026-10-16
 */
export const BYPASS_HEADER = "x-vercel-protection-bypass";
export const BYPASS_ENV = "VERCEL_AUTOMATION_BYPASS_SECRET";

/** The secret from the environment, or null when unset or blank. */
export function bypassSecretFrom(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env[BYPASS_ENV]?.trim();
  return value ? value : null;
}

/** A fetch that adds the bypass header to every request whose URL is on `origin`, and changes nothing else. */
export function bypassFetch(fetcher: typeof fetch, origin: string, secret: string): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== origin) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    headers.set(BYPASS_HEADER, secret);
    return fetcher(input, { ...init, headers });
  }) as typeof fetch;
}

/** Whether a browser request to `url` should carry the bypass header: same origin as the named deployment only. */
export const carriesBypass = (url: string, origin: string): boolean => new URL(url).origin === origin;
