import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import nextConfig from "@/next.config";
import { config as proxyConfig, proxy } from "@/proxy";
import { ADMIN_HEADER_RULES } from "@/lib/security/headers";
import { ROBOTS_DISALLOW, robotsFor, sitemapFor } from "@/lib/seo/metadata";
import { SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { STAFF_AUTH_TIMEOUT_MS, isStaffPath } from "@/lib/supabase/staff-session";

/*
 * Ruling R99 and brief item 6 (Task 8b): /admin and /api/admin answers are private, never cached,
 * never indexed and send no referrer; robots.txt disallows them and the sitemap never lists them;
 * proxy.ts refreshes the staff session cookies on those paths only, and keeps the per-request CSP
 * nonce on every page.
 */
const require = createRequire(import.meta.url);
const { pathToRegexp } = require("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string) => RegExp };

const PRIVATE = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "private, no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

describe("admin response headers (next.config.ts)", () => {
  it("cover every admin page and API path, and nothing else", () => {
    const sources = ADMIN_HEADER_RULES.map((rule) => pathToRegexp(rule.source));
    const covered = (path: string) => sources.some((source) => source.test(path));
    for (const path of ["/admin", "/admin/", "/admin/login", "/admin/orders", "/admin/orders/BB-1A2B-3C4D", "/api/admin/session", "/api/admin/orders/BB-1A2B-3C4D/quote"]) expect(covered(path), path).toBe(true);
    for (const path of ["/", "/administrator", "/api/orders", "/api/leads", "/shop/admin"]) expect(covered(path), path).toBe(false);
    for (const rule of ADMIN_HEADER_RULES) expect(rule.headers).toEqual(PRIVATE);
  });

  it("come after the site-wide rule, so their values win", async () => {
    const rules = await nextConfig.headers!();
    const everywhere = rules.findIndex((rule) => rule.source === "/:path*");
    const api = rules.findIndex((rule) => rule.source === "/api/:path*");
    for (const admin of ADMIN_HEADER_RULES) {
      const index = rules.findIndex((rule) => rule.source === admin.source);
      expect(index, admin.source).toBeGreaterThan(Math.max(everywhere, api));
      expect(rules[index]!.headers).toEqual(PRIVATE);
    }
  });

  it("keep admin paths out of robots.txt's allowed paths and out of the sitemap", () => {
    expect(ROBOTS_DISALLOW).toEqual(expect.arrayContaining(["/admin", "/api/"]));
    const seo = { indexable: true, baseUrl: new URL("https://bibobay.example") };
    const robots = robotsFor(seo);
    const rules = Array.isArray(robots.rules) ? robots.rules[0]! : robots.rules;
    expect(rules.disallow).toEqual(expect.arrayContaining(["/admin", "/api/"]));
    const sitemap = sitemapFor({
      seo,
      settings: SAFE_FALLBACK_SETTINGS,
      legal: SAFE_FALLBACK_LEGAL,
      commerceRoutes: ["/shop"],
    });
    expect(sitemap.map((entry) => entry.url).filter((url) => url.includes("/admin"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// proxy.ts
// ---------------------------------------------------------------------------

const SUPABASE = "https://bibo-test.supabase.co";
const COOKIE = "sb-bibo-test-auth-token";
const b64url = (value: string) => Buffer.from(value).toString("base64url");
const jwt = (exp: number) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: "00000000-0000-4000-8000-0000000000b1", exp, role: "authenticated" }))}.sig`;
const user = { id: "00000000-0000-4000-8000-0000000000b1", aud: "authenticated", role: "authenticated", email: "staff@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };

function sessionCookie({ expired }: { expired: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = expired ? now - 60 : now + 3600;
  const session = { access_token: jwt(expiresAt), refresh_token: "refresh-old", expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user };
  return `${COOKIE}=base64-${b64url(JSON.stringify(session))}`;
}

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url.replace(SUPABASE, ""));
      if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
        const now = Math.floor(Date.now() / 1000);
        return Response.json({ access_token: jwt(now + 3600), refresh_token: "refresh-new", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user });
      }
      return Response.json({ message: "unexpected" }, { status: 500 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const configure = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture_only");
};

const request = (path: string, cookie?: string) => new NextRequest(`https://bibobay.example${path}`, { headers: cookie ? { cookie } : {} });

/** The cookies the proxy hands on to the route or page (Next's x-middleware-request-cookie). */
const forwardedCookies = (response: Response) => response.headers.get("x-middleware-request-cookie") ?? "";

describe("proxy.ts and the staff session (Task 8b)", () => {
  it("knows which paths are staff paths", () => {
    for (const path of ["/admin", "/admin/login", "/admin/orders/BB-1A2B-3C4D", "/api/admin", "/api/admin/session"]) expect(isStaffPath(path), path).toBe(true);
    for (const path of ["/", "/administrator", "/api/administrator", "/api/orders", "/shop/admin", "/orders/abc"]) expect(isStaffPath(path), path).toBe(false);
  });

  it("runs on the staff API paths as well as on pages, and still skips every other API route", () => {
    // The page matcher is a regular expression with a look-ahead; the staff API matcher is a path pattern.
    const regexFor = (source: string) => (source.includes("(?!") ? new RegExp(`^${source}$`) : pathToRegexp(source));
    const matched = (path: string) => proxyConfig.matcher.some((entry) => regexFor(entry.source).test(path));
    expect(proxyConfig.matcher.length).toBeGreaterThan(1);
    for (const path of ["/api/admin/session", "/api/admin/orders/BB-1A2B-3C4D/status", "/admin", "/admin/orders"]) expect(matched(path), path).toBe(true);
    for (const path of ["/api/leads", "/api/orders", "/api/cron/email-outbox", "/api/administrator"]) expect(matched(path), path).toBe(false);
  });

  it("never calls Supabase off the staff paths, even with a session cookie", async () => {
    configure();
    const response = await proxy(request("/privacy", sessionCookie({ expired: true })));
    expect(calls).toEqual([]);
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("never calls Supabase for an admin visitor without a session", async () => {
    configure();
    const response = await proxy(request("/admin/login"));
    expect(calls).toEqual([]);
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/);
  });

  it("leaves a current session alone", async () => {
    configure();
    await proxy(request("/admin/orders", sessionCookie({ expired: false })));
    expect(calls).toEqual([]);
  });

  it("refreshes an expired session on an admin page: new httpOnly cookies to the browser and to the page, nonce kept", async () => {
    configure();
    const response = await proxy(request("/admin/orders", sessionCookie({ expired: true })));
    expect(calls).toEqual(["/auth/v1/token?grant_type=refresh_token"]);
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain(`${COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    const forwarded = forwardedCookies(response);
    expect(forwarded).toContain(`${COOKIE}=base64-`);
    expect(Buffer.from(forwarded.split(`${COOKIE}=base64-`)[1]!.split(";")[0]!, "base64url").toString()).toContain("refresh-new");
    expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(response.headers.get("content-security-policy"));
  });

  it("refreshes on the staff API too, without the page policy (the API keeps its own deny-all policy)", async () => {
    configure();
    const response = await proxy(request("/api/admin/orders/BB-1A2B-3C4D/status", sessionCookie({ expired: true })));
    expect(calls).toEqual(["/auth/v1/token?grant_type=refresh_token"]);
    expect(response.headers.getSetCookie().join("\n")).toMatch(/HttpOnly/i);
    expect(forwardedCookies(response)).toContain(`${COOKIE}=base64-`);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });

  it("drops Secure only on the local dev server", async () => {
    configure();
    const response = await proxy(new NextRequest("http://127.0.0.1:3000/admin/orders", { headers: { cookie: sessionCookie({ expired: true }) } }));
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("still answers, within STAFF_AUTH_TIMEOUT_MS, when Supabase cannot refresh (auth-js alone would retry for 30 s)", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    vi.useFakeTimers();
    try {
      let settled = false;
      const answer = proxy(request("/admin/orders", sessionCookie({ expired: true }))).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS);
      expect(settled).toBe(true);
      const response = await answer;
      expect(response.headers.get("content-security-policy")).toMatch(/'nonce-[^']+'/);
      expect(response.headers.getSetCookie()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for an Auth server that never answers", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    vi.useFakeTimers();
    try {
      const answer = proxy(request("/api/admin/session", sessionCookie({ expired: true })));
      await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS);
      expect((await answer).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing with Supabase unconfigured", async () => {
    const response = await proxy(request("/admin/orders", sessionCookie({ expired: true })));
    expect(calls).toEqual([]);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
