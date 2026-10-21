import { NextResponse, type NextRequest } from "next/server";

import { botCheckFrameSources } from "./lib/bot-check/config";
import { monitoringConnectSources } from "./lib/observability/monitoring-env";
import { NONCE_HEADER, buildContentSecurityPolicy, createNonce, securityEnvironment } from "./lib/security/headers";
import { STAFF_SESSION_COOKIE, cookiesMayBeInsecureFor, createStaffAuthClient, isStaffPath, staffAuthEnvironment, withinStaffAuthTimeout } from "./lib/supabase/staff-session";

type CookieWrite = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Task 8b (brief item 6, ruling R94): on /admin and /api/admin requests only, refresh the staff
 * session before the page or route runs. A server page cannot write cookies, and a refresh token
 * may be used once, so the refresh happens here: the new session goes to the browser (Set-Cookie,
 * httpOnly) AND to the page or route (the forwarded request cookies), which then sees the current
 * session instead of trying the used refresh token again.
 *
 * Only with Supabase configured and a session cookie present: an anonymous visitor costs no call.
 * `getSession()` reads the cookie and refreshes only an expired session; it is not the
 * authorization check (that is `auth.getUser()` plus an active staff row, lib/supabase/auth.ts).
 * If Auth cannot be reached within STAFF_AUTH_TIMEOUT_MS the request goes on unchanged and the
 * route answers it (cookie writes from a late refresh are dropped, never half-applied).
 */
async function refreshStaffSession(request: NextRequest): Promise<CookieWrite[]> {
  const settings = staffAuthEnvironment();
  if (!settings || !request.cookies.getAll().some(({ name }) => STAFF_SESSION_COOKIE.test(name))) return [];
  const writes: CookieWrite[] = [];
  const client = createStaffAuthClient(
    settings,
    {
      getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      set(name, value, options) {
        writes.push({ name, value, options: options as CookieWrite["options"] });
        if (options.maxAge === 0) request.cookies.delete(name);
        else request.cookies.set(name, value);
      },
    },
    { secure: !cookiesMayBeInsecureFor(request.headers) },
  );
  try {
    // Bounded: auth-js retries a failed refresh for up to 30 s. Past the bound, nothing is refreshed.
    const refreshed = await withinStaffAuthTimeout(client.auth.getSession());
    if (refreshed.timedOut) return [];
  } catch {
    // Auth unreachable: nothing is refreshed; the route finds no valid session and says so.
  }
  return writes;
}

/**
 * Per-request Content-Security-Policy with a fresh nonce (ruling R34).
 *
 * src: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md#adding-a-nonce-with-proxy · next 16.3.8 · 2026-10-13
 * Next reads the nonce from the *request* header while rendering and adds it to its scripts, so the
 * policy is set on both the forwarded request and the response. The staff API (/api/admin, Task 8b)
 * gets no page policy: API answers keep next.config.ts's fixed deny-all policy.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookies = isStaffPath(pathname) ? await refreshStaffSession(request) : [];

  // Built after the refresh, so the forwarded cookies are the current ones.
  const requestHeaders = new Headers(request.headers);
  let response: NextResponse;
  if (pathname.startsWith("/api/")) {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    const nonce = createNonce();
    // Monitoring hosts, connect-src only (Task 10M-a, ruling R70): the Sentry ingest origin and the
    // PostHog host, each only when configured. The SDKs are bundled; script-src stays nonce-only.
    const policy = buildContentSecurityPolicy({ nonce, environment: securityEnvironment(), extraConnectSources: monitoringConnectSources(), extraFrameSources: botCheckFrameSources(process.env) });
    requestHeaders.set(NONCE_HEADER, nonce);
    requestHeaders.set("content-security-policy", policy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("content-security-policy", policy);
  }
  for (const { name, value, options } of sessionCookies) response.cookies.set(name, value, options);
  return response;
}

export const config = {
  // src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md#matcher · next 16.3.8 · 2026-10-13
  // Documents, and the staff API (Task 8b, for the session refresh only). Other API routes get a
  // fixed deny-all policy from next.config.ts and need nothing here; build assets, public files and
  // generated metadata files (icon, robots, sitemap, manifest, Open Graph image) are not documents;
  // link prefetches are RSC payloads, not HTML.
  matcher: [
    {
      source:
        "/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$|icon\\.svg$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|opengraph-image|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|txt|xml|webmanifest|js|css|map|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    { source: "/api/admin/:path*" },
  ],
};
