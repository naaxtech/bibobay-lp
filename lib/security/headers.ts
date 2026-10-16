/*
 * Browser security headers (ruling R34).
 *
 * src: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md · next 16.3.8 · 2026-10-13
 * The page HTML carries 20+ inline scripts (the React Server Components payload, `self.__next_f.push`).
 * The documented strict options are a per-request nonce (proxy.ts) or experimental SRI; SRI only
 * covers external files, so it cannot make those inline scripts pass without 'unsafe-inline'. This
 * site therefore uses the nonce approach: proxy.ts makes a fresh nonce per request, Next reads it from
 * the request's Content-Security-Policy header and stamps it on its own scripts, and 'strict-dynamic'
 * lets those scripts load the rest. Pages must render per request for that (app/layout.tsx).
 *
 * The functions here are pure, so tests (and Task 10M, which appends monitoring hosts to
 * `connect-src`) build the exact policy production sends.
 */

import { ORDER_LINK_SOURCE } from "../privacy/private-links";

export const NONCE_HEADER = "x-nonce";

export interface SecurityEnvironment {
  /** `next dev`: React needs eval for its debugging aids and the dev overlay injects style elements. */
  development: boolean;
  /** Any Vercel deployment (preview or production): always served over https. */
  vercelDeployment: boolean;
  /** The production Vercel deployment: the only one that may send HSTS. */
  vercelProduction: boolean;
  /** The Sanity Studio origin allowed to frame the site (Presentation), when configured and valid. */
  studioOrigin: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Exact hostnames only: letters, digits, dots and hyphens (no wildcards, no spaces, no IPv6 brackets). */
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The origin of an exact https URL (or local http when allowed), or null for anything else. */
function exactOrigin(value: string | undefined, { allowLocalHttp }: { allowLocalHttp: boolean }): string | null {
  const raw = value?.trim();
  if (!raw || /\s|;|,|'/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || !HOSTNAME.test(url.hostname)) return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && allowLocalHttp && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/**
 * SANITY_STUDIO_ORIGIN as a CSP source: an https origin, or a local Studio (`npx sanity dev`) over
 * http, which securityEnvironment accepts only for the development server.
 */
export function studioOriginFrom(value: string | undefined): string | null {
  return exactOrigin(value, { allowLocalHttp: true });
}

export function securityEnvironment(env: Env = process.env): SecurityEnvironment {
  const development = env.NODE_ENV === "development";
  const vercelEnv = env.VERCEL_ENV?.trim();
  const studio = studioOriginFrom(env.SANITY_STUDIO_ORIGIN);
  return {
    development,
    vercelDeployment: vercelEnv === "production" || vercelEnv === "preview",
    vercelProduction: vercelEnv === "production",
    studioOrigin: studio && (studio.startsWith("https:") || development) ? studio : null,
  };
}

/** A fresh 128-bit nonce, base64. Web Crypto, so it works in any runtime the proxy may use. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The nonce grammar Next accepts (get-script-nonce-from-header.js); anything else could break the header. */
const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface PolicyOptions {
  nonce: string;
  environment: SecurityEnvironment;
  /** Extra exact https origins for `connect-src` (Task 10M: Sentry, PostHog), only when configured. */
  extraConnectSources?: readonly string[];
}

export function buildContentSecurityPolicy({ nonce, environment, extraConnectSources = [] }: PolicyOptions): string {
  if (!NONCE.test(nonce)) throw new Error("Invalid CSP nonce");
  const connect = [...new Set(extraConnectSources.map((source) => exactOrigin(source, { allowLocalHttp: false })).filter((origin): origin is string => origin !== null))];

  const directives: Array<[string, ...string[]]> = [
    ["default-src", "'self'"],
    // Development only: React rebuilds server error stacks with eval. Never sent by a production build.
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(environment.development ? ["'unsafe-eval'"] : [])],
  ];
  if (environment.development) {
    // The dev overlay and fast refresh inject <style> elements without the nonce.
    directives.push(["style-src", "'self'", "'unsafe-inline'"]);
  } else {
    // Style elements need the nonce. Style *attributes* stay allowed: React server-renders style
    // attributes (CMS accent colours, image sizing) and GSAP animates inline styles; an attribute
    // cannot run script. style-src is the fallback for browsers without the CSP3 split directives.
    directives.push(["style-src-elem", "'self'", `'nonce-${nonce}'`]);
    directives.push(["style-src-attr", "'unsafe-inline'"]);
    directives.push(["style-src", "'self'", "'unsafe-inline'"]);
  }
  directives.push(
    // Sanity's image CDN serves CMS art; data:/blob: cover inline SVG data and generated images.
    ["img-src", "'self'", "data:", "blob:", "https://cdn.sanity.io"],
    // next/font self-hosts the brand faces; nothing loads from a font CDN.
    ["font-src", "'self'"],
    // The lead form posts to /api/leads on this origin; the browser never talks to Supabase or Resend.
    ["connect-src", "'self'", ...connect],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    // Sanity Presentation shows the site in an iframe inside the Studio.
    ["frame-ancestors", "'self'", ...(environment.studioOrigin ? [environment.studioOrigin] : [])],
  );
  // A local `next start` is served over plain http; upgrading its requests would break it.
  if (environment.vercelDeployment && !environment.development) directives.push(["upgrade-insecure-requests"]);
  return directives.map((parts) => parts.join(" ")).join("; ");
}

/** The policy for API responses: JSON is never a document, so nothing may load or frame it. */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** Headers every response carries (next.config.ts). The CSP itself is per request (proxy.ts). */
export function staticSecurityHeaders(environment: SecurityEnvironment): Array<{ key: string; value: string }> {
  return [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // No `preload` until the custom domain is verified and every subdomain serves https.
    ...(environment.vercelProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}

/**
 * Task 7b: the private order pages (/orders/<token>, Task 7c) carry their tracking token in the
 * address, so they send no referrer at all: a link or a picture on them never hands the token to
 * another site, or to another page of this one. next.config.ts lists this rule after the site-wide
 * one; when two rules set the same header, the last one wins.
 *
 * Task 7c: nor may anything keep or index them. `private, no-store` covers every answer under the
 * path, its 404s included. Next only fills in its own Cache-Control when none is set yet
 * (next/dist/server/send-payload.js, next 16.3.8), and its own value for this dynamic page also says
 * `no-store`, so either way no copy is kept. X-Robots-Tag keeps search engines away even from an
 * answer that never reaches the page's robots meta tag.
 */
export const PRIVATE_LINK_HEADER_RULE: { source: string; headers: Array<{ key: string; value: string }> } = {
  source: ORDER_LINK_SOURCE,
  headers: [
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cache-Control", value: "private, no-store" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ],
};

/**
 * R140: the signed download answers carry a token in the address, so they get the same private
 * rule as the order pages. Listed after the site-wide rule in next.config.ts so these values win;
 * the route handler sets the same headers itself.
 */
export const FREEBIE_DOWNLOAD_HEADER_RULE: { source: string; headers: Array<{ key: string; value: string }> } = {
  source: "/api/freebies/download",
  headers: PRIVATE_LINK_HEADER_RULE.headers.map((header) => ({ ...header })),
};

/**
 * Task 8b (ruling R99): the staff pages and the staff API are private in the same way. Their
 * answers carry a staff session and order details, so nothing may keep, index or refer them.
 * `/admin/:path*` matches `/admin` itself too. next.config.ts lists these after the site-wide rule.
 */
export const ADMIN_HEADER_RULES: ReadonlyArray<{ source: string; headers: Array<{ key: string; value: string }> }> = ["/admin/:path*", "/api/admin/:path*"].map((source) => ({
  source,
  headers: PRIVATE_LINK_HEADER_RULE.headers.map((header) => ({ ...header })),
}));
