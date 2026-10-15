import { NextResponse, type NextRequest } from "next/server";

import { monitoringConnectSources } from "./lib/observability/monitoring-env";
import { NONCE_HEADER, buildContentSecurityPolicy, createNonce, securityEnvironment } from "./lib/security/headers";

/**
 * Per-request Content-Security-Policy with a fresh nonce (ruling R34).
 *
 * src: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md#adding-a-nonce-with-proxy · next 16.3.8 · 2026-10-13
 * Next reads the nonce from the *request* header while rendering and adds it to its scripts, so the
 * policy is set on both the forwarded request and the response.
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  // Monitoring hosts, connect-src only (Task 10M-a, ruling R70): the Sentry ingest origin and the
  // PostHog host, each only when configured. The SDKs are bundled; script-src stays nonce-only.
  const policy = buildContentSecurityPolicy({ nonce, environment: securityEnvironment(), extraConnectSources: monitoringConnectSources() });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  // src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md#matcher · next 16.3.8 · 2026-10-13
  // Documents only. API routes get a fixed deny-all policy from next.config.ts; build assets, public
  // files and generated metadata files (icon, robots, sitemap, manifest, Open Graph image) are not
  // documents; link prefetches are RSC payloads, not HTML.
  matcher: [
    {
      source:
        "/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$|icon\\.svg$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|opengraph-image|.*\\.(?:svg|png|jpe?g|gif|webp|avif|ico|txt|xml|webmanifest|js|css|map|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
