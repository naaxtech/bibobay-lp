import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { sentryDsnFrom } from "./lib/observability/monitoring-env";
import { API_CONTENT_SECURITY_POLICY, securityEnvironment, staticSecurityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // src: https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins · next 16.3.8 · 2026-10-05
  // Dev only. Playwright opens the dev server at 127.0.0.1 while `next dev` starts as localhost; without this
  // entry Next blocks the HMR socket from 127.0.0.1 and the page never hydrates, so no interaction can be tested.
  allowedDevOrigins: ["127.0.0.1"],
  // src: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/poweredByHeader.md · next 16.3.8 · 2026-10-13
  // No `X-Powered-By: Next.js`: nothing to gain from naming the framework to scanners.
  poweredByHeader: false,
  // src: node_modules/next/dist/docs/01-app/03-api-reference/05-config/02-typescript.md#custom-tsconfig-path · next 16.3.8 · 2026-10-13
  // `next build` type-checks the program this file selects. tsconfig.build.json is the root tsconfig
  // minus tests/ and e2e/: two unit tests import the Studio schema, which needs `sanity` from
  // studio/node_modules, and Vercel installs the root only. `npm run typecheck` still checks the tests.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  images: {
    // src: node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md#remotepatterns · next 16.3.8 · 2026-10-12
    // CMS art comes only from Sanity's image CDN (lib/sanity/image.ts); every other remote host stays blocked.
    // Landing art is already sized and encoded by Sanity and rendered `unoptimized`; the pattern keeps any
    // future optimised use to this one host.
    remotePatterns: [{ protocol: "https", hostname: "cdn.sanity.io", pathname: "/images/**" }],
  },
  // src: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md · next 16.3.8 · 2026-10-13
  // Ruling R34. The hardening headers go on every response; the page CSP is per request (proxy.ts,
  // which needs a fresh nonce), and API responses get a fixed deny-all policy. Next evaluates this
  // at build time into the routes manifest, so each Vercel build's VERCEL_ENV decides HSTS (Vercel
  // exposes its system variables to the build).
  async headers() {
    return [
      { source: "/:path*", headers: staticSecurityHeaders(securityEnvironment()) },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }] },
    ];
  },
};

/*
 * Task 10M-a: wrapped for Sentry only when the build has a DSN. Source maps are uploaded (and then
 * deleted from the deployment) only with SENTRY_AUTH_TOKEN; without it nothing is uploaded and no
 * browser source maps are published. Keyless builds are the plain config above.
 */
const sentryBuild = sentryDsnFrom(process.env.NEXT_PUBLIC_SENTRY_DSN) !== null;
const sentryToken = process.env.SENTRY_AUTH_TOKEN?.trim();

const config: NextConfig = sentryBuild
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: sentryToken,
      silent: true,
      telemetry: false,
      widenClientFileUpload: true,
      sourcemaps: { disable: !sentryToken },
    })
  : nextConfig;

export default config;
