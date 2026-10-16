import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "@/next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import {
  NONCE_HEADER,
  buildContentSecurityPolicy,
  createNonce,
  securityEnvironment,
  staticSecurityHeaders,
  studioOriginFrom,
} from "@/lib/security/headers";

/** A policy as a map of directive name to its sources. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name!, sources];
      }),
  );
}

const PRODUCTION = { NODE_ENV: "production", VERCEL_ENV: "production" } as const;
const PREVIEW = { NODE_ENV: "production", VERCEL_ENV: "preview" } as const;
const LOCAL_START = { NODE_ENV: "production" } as const;
const DEV = { NODE_ENV: "development" } as const;

describe("content security policy", () => {
  it("is strict in production: nonce + strict-dynamic scripts, no eval, no inline scripts", () => {
    const policy = directives(buildContentSecurityPolicy({ nonce: "abc123", environment: securityEnvironment(PRODUCTION) }));
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(policy.get("img-src")).toEqual(["'self'", "data:", "blob:", "https://cdn.sanity.io"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'self'"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
    const text = buildContentSecurityPolicy({ nonce: "abc123", environment: securityEnvironment(PRODUCTION) });
    expect(text).not.toContain("'unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("keeps inline styles to style attributes in production (GSAP and React set them); style elements need the nonce", () => {
    const policy = directives(buildContentSecurityPolicy({ nonce: "abc123", environment: securityEnvironment(PRODUCTION) }));
    // CSP3 browsers use the two specific directives; style-src is only the fallback for older ones.
    expect(policy.get("style-src-elem")).toEqual(["'self'", "'nonce-abc123'"]);
    expect(policy.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("allows eval and inline styles only for the development server", () => {
    const dev = buildContentSecurityPolicy({ nonce: "n", environment: securityEnvironment(DEV) });
    expect(directives(dev).get("script-src")).toEqual(["'self'", "'nonce-n'", "'strict-dynamic'", "'unsafe-eval'"]);
    expect(directives(dev).get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives(dev).has("style-src-elem")).toBe(false);
    expect(directives(dev).has("upgrade-insecure-requests")).toBe(false);
    for (const env of [PRODUCTION, PREVIEW, LOCAL_START, { NODE_ENV: "test" }]) {
      expect(buildContentSecurityPolicy({ nonce: "n", environment: securityEnvironment(env) })).not.toContain("unsafe-eval");
    }
  });

  it("upgrades insecure requests on Vercel deployments only, so a local `next start` over http keeps working", () => {
    expect(directives(buildContentSecurityPolicy({ nonce: "n", environment: securityEnvironment(PREVIEW) })).has("upgrade-insecure-requests")).toBe(true);
    expect(directives(buildContentSecurityPolicy({ nonce: "n", environment: securityEnvironment(LOCAL_START) })).has("upgrade-insecure-requests")).toBe(false);
  });

  it("lets the configured Studio origin frame the site for Presentation", () => {
    const environment = securityEnvironment({ ...PRODUCTION, SANITY_STUDIO_ORIGIN: "https://bibobay.sanity.studio/desk?x=1" });
    expect(directives(buildContentSecurityPolicy({ nonce: "n", environment })).get("frame-ancestors")).toEqual(["'self'", "https://bibobay.sanity.studio"]);
  });

  it.each([
    "http://studio.example.com",
    "javascript:alert(1)",
    "https://studio.example.com; script-src *",
    "https://*.example.com",
    "https://user:pass@studio.example.com",
    "not a url",
  ])("ignores an unsafe Studio origin: %s", (value) => {
    expect(studioOriginFrom(value)).toBeNull();
    const environment = securityEnvironment({ ...PRODUCTION, SANITY_STUDIO_ORIGIN: value });
    expect(directives(buildContentSecurityPolicy({ nonce: "n", environment })).get("frame-ancestors")).toEqual(["'self'"]);
  });

  it("accepts a local Studio over http only for development", () => {
    expect(studioOriginFrom("http://localhost:3333")).toBe("http://localhost:3333");
    expect(studioOriginFrom("http://127.0.0.1:3333/")).toBe("http://127.0.0.1:3333");
  });

  it("lets monitoring (Task 10M) append exact https hosts, refusing anything that could widen the policy", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "n",
      environment: securityEnvironment(PRODUCTION),
      extraConnectSources: ["https://o1.ingest.sentry.io", "https://eu.i.posthog.com/", "*", "https://*.evil.test", "http://plain.test", "https://x.test; script-src *", "'unsafe-inline'"],
    });
    expect(directives(policy).get("connect-src")).toEqual(["'self'", "https://o1.ingest.sentry.io", "https://eu.i.posthog.com"]);
    expect(directives(policy).get("script-src")).toEqual(["'self'", "'nonce-n'", "'strict-dynamic'"]);
  });

  it("refuses a nonce that could break out of the header", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "a'; script-src *", environment: securityEnvironment(PRODUCTION) })).toThrow();
  });

  it("creates a fresh base64 nonce of at least 128 bits each time", () => {
    const a = createNonce(), b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(a, "base64").length).toBeGreaterThanOrEqual(16);
  });
});

describe("static security headers", () => {
  const byKey = (headers: Array<{ key: string; value: string }>) => Object.fromEntries(headers.map(({ key, value }) => [key, value]));

  it("sends the browser hardening headers everywhere", () => {
    const headers = byKey(staticSecurityHeaders(securityEnvironment(PREVIEW)));
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    const permissions = headers["Permissions-Policy"]!.split(",").map((part) => part.trim());
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) expect(permissions).toContain(`${feature}=()`);
  });

  it("sends HSTS only from the production deployment, without preload", () => {
    expect(byKey(staticSecurityHeaders(securityEnvironment(PRODUCTION)))["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    for (const env of [PREVIEW, LOCAL_START, DEV]) expect(byKey(staticSecurityHeaders(securityEnvironment(env)))["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("next.config.ts headers()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the hardening headers to every path and a locked-down policy to API responses", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all?.headers.map((header) => header.key)).toEqual(expect.arrayContaining(["Referrer-Policy", "X-Content-Type-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy", "Strict-Transport-Security"]));
    const api = rules.find((rule) => rule.source === "/api/:path*");
    expect(api?.headers).toContainEqual({ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" });
  });

  it("sends no referrer from the private order pages, so the token in their address never leaves them (Task 7b)", async () => {
    const rules = await nextConfig.headers!();
    const everywhere = rules.findIndex((rule) => rule.source === "/:path*");
    const orders = rules.findIndex((rule) => rule.source === "/orders/:path*");
    expect(orders).toBeGreaterThan(-1);
    // Task 7c: the token page is private and never cached or indexed, whatever answers it.
    expect(rules[orders]?.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]);
    // Next applies matching rules in order and the last value of a header wins (next.config headers docs).
    expect(orders).toBeGreaterThan(everywhere);
  });

  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("proxy.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("puts a fresh nonce in the response policy and hands the same policy to the renderer", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const first = await proxy(new NextRequest("https://bibo.example/privacy"));
    const second = await proxy(new NextRequest("https://bibo.example/privacy"));
    const policy = first.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).not.toContain("unsafe-eval");
    // Next reads the request's Content-Security-Policy header to nonce its own scripts.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    expect(first.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(nonce);
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("skips API routes, build assets, metadata files and link prefetches", () => {
    const [matcher] = proxyConfig.matcher;
    const source = new RegExp(`^${matcher!.source}$`);
    for (const path of ["/", "/privacy", "/terms", "/thank-you", "/studio"]) expect(source.test(path), path).toBe(true);
    for (const path of ["/api/leads", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/icon.svg", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/opengraph-image", "/bibo-logo.svg", "/brand/bibo-mark.svg"]) {
      expect(source.test(path), path).toBe(false);
    }
    expect(matcher!.missing).toEqual(expect.arrayContaining([{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }]));
  });
});

describe("freebie download response headers (ruling R140)", () => {
  it("come after the site-wide rule and are private", async () => {
    const { FREEBIE_DOWNLOAD_HEADER_RULE } = await import("@/lib/security/headers");
    const rules = await nextConfig.headers!();
    const index = rules.findIndex((rule) => rule.source === "/api/freebies/download");
    expect(index).toBeGreaterThan(rules.findIndex((rule) => rule.source === "/:path*"));
    expect(index).toBeGreaterThan(rules.findIndex((rule) => rule.source === "/api/:path*"));
    expect(rules[index]!.headers).toEqual([
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]);
    expect(FREEBIE_DOWNLOAD_HEADER_RULE.source).toBe("/api/freebies/download");
  });
});
