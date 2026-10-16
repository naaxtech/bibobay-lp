import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { isSameOriginRequest } from "@/lib/admin/http";
import { handleSignIn, handleSignOut, type SessionDependencies } from "@/lib/admin/session";
import { createMemoryRateLimiter } from "@/lib/security/rate-limit";
import { cookiesMayBeInsecure, staffSignInFrom, type StaffSession } from "@/lib/supabase/auth";
import { STAFF_AUTH_TIMEOUT_MS, STAFF_SESSION_COOKIE, createStaffAuthClient, expireStaffSessionCookies, staffCookieOptions, type StaffCookieJar } from "@/lib/supabase/staff-session";

/*
 * Fix round 1 for Task 8b. R110 (I1): the same-origin rule and the cookie Secure decision read the
 * browser's own host and protocol from the request headers, never `request.url` (which on
 * `next start -H 127.0.0.1` says localhost). R111 (I2): when Auth does not confirm a sign-out, the
 * route expires the session cookies itself.
 */

const post = (url: string, headers: Record<string, string>) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });

describe("isSameOriginRequest never reads request.url (R110)", () => {
  const LOCAL = "http://localhost:3000/api/admin/session";

  it("passes Sec-Fetch-Site same-origin whatever the url says (127.0.0.1 browser, localhost url)", () => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(post(LOCAL, { "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it.each(["cross-site", "same-site", "none"])("refuses Sec-Fetch-Site %s even with a matching Origin and host", (site) => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": site }))).toBe(false);
  });

  it("without Sec-Fetch-Site, accepts an Origin equal to the host header, or to x-forwarded-host (first value wins)", () => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOriginRequest(post(LOCAL, { origin: "https://bibobay.example", host: "localhost:3000", "x-forwarded-host": "bibobay.example, proxy.internal", "x-forwarded-proto": "https" }))).toBe(true);
  });

  it("without Sec-Fetch-Site, refuses a foreign Origin, a wrong scheme, no host, or no Origin", () => {
    expect(isSameOriginRequest(post(LOCAL, { origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://localhost:3000", host: "localhost:3000", "x-forwarded-host": "bibobay.example" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://bibobay.example", host: "bibobay.example", "x-forwarded-proto": "https" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { origin: "http://localhost:3000" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { origin: "null", host: "localhost:3000" }))).toBe(false);
    expect(isSameOriginRequest(post(LOCAL, { host: "localhost:3000" }))).toBe(false);
  });
});

describe("cookiesMayBeInsecure resolves host and protocol from the headers (R110)", () => {
  const request = (url: string, headers: Record<string, string>) => new Request(url, { headers });

  it("is Secure behind a proxy that speaks https, even when request.url says localhost", () => {
    expect(cookiesMayBeInsecure(request("http://localhost:3000/", { host: "localhost:3000", "x-forwarded-proto": "https" }))).toBe(false);
    expect(cookiesMayBeInsecure(request("http://localhost:3000/", { host: "bibobay.example" }))).toBe(false);
    expect(cookiesMayBeInsecure(request("http://localhost:3000/", {}))).toBe(false);
  });

  it("may be insecure only for a local host over plain http", () => {
    expect(cookiesMayBeInsecure(request("http://localhost:3000/", { host: "127.0.0.1:3000" }))).toBe(true);
    expect(cookiesMayBeInsecure(request("http://localhost:3000/", { host: "[::1]:3000" }))).toBe(true);
    expect(cookiesMayBeInsecure(request("https://bibobay.example/", { host: "localhost:3000", "x-forwarded-host": "bibobay.example" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R111
// ---------------------------------------------------------------------------

const PROJECT = { url: "https://bibo-test.supabase.co", publishableKey: "sb_publishable_fixture_only" } as const;
const USER_ID = "00000000-0000-4000-8000-000000000001";
const b64url = (value: string) => Buffer.from(value).toString("base64url");
const jwt = () =>
  `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" }))}.sig`;

function memoryJar() {
  const values = new Map<string, string>();
  const writes: Array<{ name: string; options: Record<string, unknown> }> = [];
  const jar: StaffCookieJar = {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set(name, value, options) {
      writes.push({ name, options: { ...options } });
      if (options.maxAge === 0) values.delete(name);
      else values.set(name, value);
    },
  };
  return { jar, values, writes };
}

const sessionCookies = (values: Map<string, string>) => [...values.keys()].filter((name) => STAFF_SESSION_COOKIE.test(name));

/** Supabase Auth over a fake network: a sign-in works, /logout never answers. */
function hangingLogoutFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/auth/v1/logout") return new Promise<Response>(() => {});
    const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "staff@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
    if (url.pathname === "/auth/v1/token") {
      const body = { access_token: jwt(), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-fixture", user };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  });
}

afterEach(() => vi.useRealTimers());

describe("expireStaffSessionCookies (R111)", () => {
  it("expires every session cookie chunk with the enforced options, and nothing else", () => {
    const { jar, values, writes } = memoryJar();
    for (const name of ["sb-bibo-test-auth-token", "sb-bibo-test-auth-token.0", "sb-bibo-test-auth-token.1", "other"]) values.set(name, "v");
    expireStaffSessionCookies(jar, true);
    expect([...values.keys()]).toEqual(["other"]);
    expect(writes).toHaveLength(3);
    for (const write of writes) expect(write.options).toEqual({ ...staffCookieOptions(true), maxAge: 0 });
  });
});

describe("sign-out whose Auth logout never answers (R111)", () => {
  function signedInDevice() {
    const device = memoryJar();
    const client = createStaffAuthClient(PROJECT, device.jar, { secure: true, fetch: hangingLogoutFetch() });
    return { ...device, client };
  }

  it("ends with an empty cookie jar and still answers 200 signed out, logging the unavailable revoke", async () => {
    const { client, jar, values, writes } = signedInDevice();
    expect((await client.auth.signInWithPassword({ email: "staff@example.com", password: "correct horse" })).error).toBeNull();
    expect(sessionCookies(values).length).toBeGreaterThan(0);
    writes.length = 0;

    const log = vi.fn();
    const auth = staffSignInFrom(client, undefined, () => expireStaffSessionCookies(jar, true));
    vi.useFakeTimers();
    const answered = handleSignOut(
      new Request("http://localhost:3000/api/admin/session", { method: "DELETE", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } }),
      { auth, log },
    );
    await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS);
    const response = await answered;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: ADMIN_COPY.session.signedOut });
    expect(log).toHaveBeenCalledWith({ event: "staff_sign_out_unavailable" });
    expect(sessionCookies(values)).toEqual([]);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write.options).toEqual({ ...staffCookieOptions(true), maxAge: 0 });
  });

  it("leaves no session cookie after a sign-in refused as not_staff, when the follow-up logout hangs too", async () => {
    const { client, jar, values } = signedInDevice();
    const notStaff: StaffSession = { verifiedUserId: async () => USER_ID, database: { select: async () => ({ data: [], error: null }), rpc: vi.fn() } };
    const dependencies: SessionDependencies = {
      auth: staffSignInFrom(client, notStaff, () => expireStaffSessionCookies(jar, true)),
      rateLimiter: createMemoryRateLimiter(),
      clientKey: "a".repeat(64),
      emailKey: () => "b".repeat(64),
      log: vi.fn(),
    };
    vi.useFakeTimers();
    const answered = handleSignIn(
      new Request("http://localhost:3000/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ email: "visitor@example.com", password: "correct horse" }),
      }),
      dependencies,
    );
    await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS + 1000);
    const response = await answered;

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, message: ADMIN_COPY.session.refused });
    expect(sessionCookies(values)).toEqual([]);
  });
});
