import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { STAFF_SIGN_IN_RATE_LIMIT, handleSignIn, handleSignOut, type SessionDependencies } from "@/lib/admin/session";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import { StaffAuthUnavailableError, requireStaffUser, staffSessionFrom, staffSignInFrom, type StaffAccess, type StaffSession, type StaffSignIn } from "@/lib/supabase/auth";
import { getSupabasePublicEnvironment } from "@/lib/supabase/server";
import { STAFF_AUTH_TIMEOUT_MS, STAFF_SESSION_COOKIE, createStaffAuthClient, isLocalHostname, staffAuthEnvironment, staffCookieOptions, type StaffCookieJar } from "@/lib/supabase/staff-session";
import { STAFF_FIXTURE, pgliteStaffDatabase, seedStaff } from "@/tests/support/pglite-staff";
import { applyMigrations, createSupabaseStandIn, migrationFiles } from "@/tests/support/supabase-db";

/*
 * Staff access (spec §5 "Staff routes", rulings R94, R95): Supabase Auth plus an ACTIVE staff_users
 * row. Being signed in grants nothing. requireStaffUser asks the Auth server who the user is
 * (auth.getUser, never the cookie alone), then reads the user's own staff row under row level
 * security, and answers a typed refusal (signed_out | not_staff | unconfigured) for every auth state.
 * Sessions live in cookies set on the server only: httpOnly, Secure outside localhost, SameSite=Lax,
 * path /.
 */

const PROJECT = { url: "https://bibo-test.supabase.co", publishableKey: "sb_publishable_fixture_only" } as const;
const COOKIE_NAME = "sb-bibo-test-auth-token";

function memoryJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const jar: StaffCookieJar = {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set(name, value, options) {
      writes.push({ name, value, options: { ...options } });
      if (options.maxAge === 0) values.delete(name);
      else values.set(name, value);
    },
  };
  return { jar, values, writes };
}

const b64url = (value: string) => Buffer.from(value).toString("base64url");
function jwt(sub: string, expiresInSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub, exp, role: "authenticated", aud: "authenticated" }))}.signature`;
}

function user(id: string) {
  return { id, aud: "authenticated", role: "authenticated", email: "staff@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
}

function sessionBody(id: string, accessToken = jwt(id)) {
  return { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-fixture", user: user(id) };
}

/** A stand-in for the Supabase network: Auth's token and user endpoints and PostgREST's staff_users. */
function fakeSupabase({ staffRows = [] as unknown[], userStatus = 200 } = {}) {
  const calls: Array<{ method: string; url: string; authorization: string | null }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ method: init?.method ?? "GET", url: url.pathname + url.search, authorization: headers.get("authorization") });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/auth/v1/token") return json(200, sessionBody(STAFF_FIXTURE.active));
    if (url.pathname === "/auth/v1/user") {
      if (userStatus === 0) throw new TypeError("fetch failed");
      return userStatus === 200 ? json(200, user(STAFF_FIXTURE.active)) : json(userStatus, { code: userStatus, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/rest/v1/staff_users") return json(200, staffRows);
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    return json(404, { message: "not found" });
  });
  return { fetch, calls };
}

describe("the staff session cookies (R94)", () => {
  it("are httpOnly, SameSite=Lax, path / and Secure, written by the server when staff sign in", async () => {
    const { jar, writes } = memoryJar();
    const { fetch } = fakeSupabase();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch });
    const { error } = await client.auth.signInWithPassword({ email: "staff@example.com", password: "correct horse" });
    expect(error).toBeNull();
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.name).toMatch(STAFF_SESSION_COOKIE);
      expect(write.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    }
    expect(writes[0]!.name.startsWith(COOKIE_NAME)).toBe(true);
  });

  it("drop Secure only on localhost, where the dev server speaks plain http", async () => {
    const { jar, writes } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: false, fetch: fakeSupabase().fetch });
    await client.auth.signInWithPassword({ email: "staff@example.com", password: "correct horse" });
    for (const write of writes) expect(write.options).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    expect(staffCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    for (const host of ["localhost", "127.0.0.1", "[::1]", "LOCALHOST"]) expect(isLocalHostname(host), host).toBe(true);
    for (const host of ["bibobay.example", "localhost.example", "127.0.0.1.example"]) expect(isLocalHostname(host), host).toBe(false);
  });

  it("are cleared on sign-out", async () => {
    const { jar, values } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch: fakeSupabase().fetch });
    await client.auth.signInWithPassword({ email: "staff@example.com", password: "correct horse" });
    expect([...values.keys()].some((name) => STAFF_SESSION_COOKIE.test(name))).toBe(true);
    const signedIn = memoryJar(Object.fromEntries(values));
    const again = createStaffAuthClient(PROJECT, signedIn.jar, { secure: true, fetch: fakeSupabase().fetch });
    await again.auth.signOut({ scope: "local" });
    expect([...signedIn.values.keys()].filter((name) => STAFF_SESSION_COOKIE.test(name))).toEqual([]);
    for (const write of signedIn.writes) expect(write.options).toMatchObject({ httpOnly: true, maxAge: 0 });
  });

  it("read the same public settings as lib/supabase/server.ts, which the proxy cannot import", () => {
    const cases: Array<Record<string, string | undefined>> = [
      {},
      { NEXT_PUBLIC_SUPABASE_URL: PROJECT.url },
      { NEXT_PUBLIC_SUPABASE_URL: PROJECT.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PROJECT.publishableKey },
      { NEXT_PUBLIC_SUPABASE_URL: ` ${PROJECT.url}/ `, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ` ${PROJECT.publishableKey} ` },
      { NEXT_PUBLIC_SUPABASE_URL: PROJECT.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_wrong_slot" },
      { NEXT_PUBLIC_SUPABASE_URL: "http://bibo-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PROJECT.publishableKey },
      { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PROJECT.publishableKey },
      { NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@bibo-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PROJECT.publishableKey },
      { NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PROJECT.publishableKey },
      { NEXT_PUBLIC_SUPABASE_URL: PROJECT.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "   " },
    ];
    for (const env of cases) expect(staffAuthEnvironment(env), JSON.stringify(env)).toEqual(getSupabasePublicEnvironment(env));
  });
});

describe("staffSessionFrom: who the Auth server says the user is (R95)", () => {
  async function signedInJar() {
    const { jar, values } = memoryJar();
    await createStaffAuthClient(PROJECT, jar, { secure: true, fetch: fakeSupabase().fetch }).auth.signInWithPassword({ email: "staff@example.com", password: "x" });
    return memoryJar(Object.fromEntries(values));
  }

  it("asks Auth for the user (getUser), never trusting the cookie alone", async () => {
    const { jar } = await signedInJar();
    const network = fakeSupabase();
    const session = staffSessionFrom(createStaffAuthClient(PROJECT, jar, { secure: true, fetch: network.fetch }));
    expect(await session.verifiedUserId()).toBe(STAFF_FIXTURE.active);
    expect(network.calls.map((call) => `${call.method} ${call.url.split("?")[0]}`)).toEqual(["GET /auth/v1/user"]);
  });

  it("answers null with no session, and for a token Auth refuses", async () => {
    expect(await staffSessionFrom(createStaffAuthClient(PROJECT, memoryJar().jar, { secure: true, fetch: fakeSupabase().fetch })).verifiedUserId()).toBeNull();
    const { jar } = await signedInJar();
    expect(await staffSessionFrom(createStaffAuthClient(PROJECT, jar, { secure: true, fetch: fakeSupabase({ userStatus: 403 }).fetch })).verifiedUserId()).toBeNull();
  });

  it("throws StaffAuthUnavailableError when Auth cannot answer: an outage is not a signed-out user", async () => {
    for (const userStatus of [0, 500, 503]) {
      const { jar } = await signedInJar();
      const session = staffSessionFrom(createStaffAuthClient(PROJECT, jar, { secure: true, fetch: fakeSupabase({ userStatus }).fetch }));
      await expect(session.verifiedUserId(), String(userStatus)).rejects.toBeInstanceOf(StaffAuthUnavailableError);
    }
  });

  it("gives up on an Auth server that does not answer within STAFF_AUTH_TIMEOUT_MS: unavailable, not hung", async () => {
    const { jar } = await signedInJar();
    const hanging = vi.fn(() => new Promise<Response>(() => {}));
    const session = staffSessionFrom(createStaffAuthClient(PROJECT, jar, { secure: true, fetch: hanging }));
    vi.useFakeTimers();
    try {
      const answer = session.verifiedUserId().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS);
      const error = await answer;
      expect(error).toBeInstanceOf(StaffAuthUnavailableError);
      expect((error as StaffAuthUnavailableError).code).toBe("auth_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the staff row with the user's own token, so row level security decides", async () => {
    const { jar } = await signedInJar();
    const network = fakeSupabase({ staffRows: [{ user_id: STAFF_FIXTURE.active, display_name: "Jo", active: true }] });
    const access = await requireStaffUser(staffSessionFrom(createStaffAuthClient(PROJECT, jar, { secure: true, fetch: network.fetch })));
    expect(access).toMatchObject({ ok: true, staff: { userId: STAFF_FIXTURE.active, displayName: "Jo" } });
    const read = network.calls.find((call) => call.url.startsWith("/rest/v1/staff_users"));
    expect(read?.url).toContain("select=user_id%2Cdisplay_name%2Cactive");
    expect(read?.url).toContain(`user_id=eq.${STAFF_FIXTURE.active}`);
    expect(read?.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.signature$/);
    expect(read?.authorization).not.toContain(PROJECT.publishableKey);
  });
});

describe("requireStaffUser (R95) against the real policies", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createSupabaseStandIn();
    await applyMigrations(db, migrationFiles());
    await seedStaff(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const sessionFor = (userId: string | null, verified: string | null = userId): StaffSession => ({
    verifiedUserId: async () => verified,
    database: pgliteStaffDatabase(db, userId),
  });

  it("answers unconfigured without Supabase", async () => {
    expect(await requireStaffUser(null)).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("answers signed_out when Auth vouches for nobody", async () => {
    expect(await requireStaffUser(sessionFor(null))).toEqual({ ok: false, reason: "signed_out" });
  });

  it("answers not_staff for a signed-in user with no staff row: authenticated alone grants nothing", async () => {
    expect(await requireStaffUser(sessionFor(STAFF_FIXTURE.visitor))).toEqual({ ok: false, reason: "not_staff" });
  });

  it("answers not_staff for inactive staff", async () => {
    expect(await requireStaffUser(sessionFor(STAFF_FIXTURE.inactive))).toEqual({ ok: false, reason: "not_staff" });
  });

  it("answers the staff identity and the user's own database for active staff", async () => {
    const access = await requireStaffUser(sessionFor(STAFF_FIXTURE.active));
    expect(access).toMatchObject({ ok: true, staff: { userId: STAFF_FIXTURE.active, displayName: "Jo" } });
  });

  it("never takes another user's row: the read runs as the verified user", async () => {
    // A session whose database acts as someone else than Auth vouched for finds no row of its own.
    expect(await requireStaffUser(sessionFor(STAFF_FIXTURE.visitor, STAFF_FIXTURE.active))).toEqual({ ok: false, reason: "not_staff" });
  });

  it("takes effect at once when the owner deactivates someone", async () => {
    await db.exec(`update public.staff_users set active = false, disabled_at = now() where user_id = '${STAFF_FIXTURE.active}'`);
    try {
      expect(await requireStaffUser(sessionFor(STAFF_FIXTURE.active))).toEqual({ ok: false, reason: "not_staff" });
    } finally {
      await db.exec(`update public.staff_users set active = true, disabled_at = null where user_id = '${STAFF_FIXTURE.active}'`);
    }
  });

  it("never throws for an auth state, but does when the staff row cannot be read", async () => {
    const broken: StaffSession = { verifiedUserId: async () => STAFF_FIXTURE.active, database: { select: async () => ({ data: null, error: { code: "42501", message: "x" } }), rpc: async () => ({ data: null, error: null }) } };
    await expect(requireStaffUser(broken)).rejects.toThrow(/staff_users/);
  });
});

describe("staffSignInFrom: Supabase password sign-in over the cookie client (R94)", () => {
  function network(tokenStatus: number) {
    const base = fakeSupabase();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/auth/v1/token" && tokenStatus !== 200) {
        if (tokenStatus === 0) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ code: tokenStatus, error_code: tokenStatus === 400 ? "invalid_credentials" : tokenStatus === 429 ? "over_request_rate_limit" : "unexpected_failure", msg: "x" }), { status: tokenStatus, headers: { "content-type": "application/json" } });
      }
      return base.fetch(input, init);
    });
    return fetch;
  }

  it("signs in, writing the session cookies", async () => {
    const { jar, values } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch: network(200) });
    expect(await staffSignInFrom(client).signIn("staff@example.com", "correct horse")).toBe("ok");
    expect([...values.keys()].some((name) => STAFF_SESSION_COOKIE.test(name))).toBe(true);
  });

  it.each([
    [400, "refused"],
    [422, "refused"],
    [429, "rate_limited"],
    [500, "unavailable"],
    [0, "unavailable"],
  ] as const)("answers a %s from Auth as %s, writing no session", async (status, outcome) => {
    const { jar, values } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch: network(status) });
    expect(await staffSignInFrom(client).signIn("staff@example.com", "wrong")).toBe(outcome);
    expect([...values.keys()].filter((name) => STAFF_SESSION_COOKIE.test(name))).toEqual([]);
  });

  it("answers a sign-in Auth does not answer within STAFF_AUTH_TIMEOUT_MS as unavailable", async () => {
    const { jar, values } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch: vi.fn(() => new Promise<Response>(() => {})) });
    vi.useFakeTimers();
    try {
      const outcome = staffSignInFrom(client).signIn("staff@example.com", "x");
      await vi.advanceTimersByTimeAsync(STAFF_AUTH_TIMEOUT_MS);
      expect(await outcome).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
    expect([...values.keys()].filter((name) => STAFF_SESSION_COOKIE.test(name))).toEqual([]);
  });

  it("signs out, clearing the cookies", async () => {
    const { jar, values } = memoryJar();
    const client = createStaffAuthClient(PROJECT, jar, { secure: true, fetch: network(200) });
    const signIn = staffSignInFrom(client);
    await signIn.signIn("staff@example.com", "correct horse");
    await signIn.signOut();
    expect([...values.keys()].filter((name) => STAFF_SESSION_COOKIE.test(name))).toEqual([]);
  });
});

describe("POST and DELETE /api/admin/session (R94, R99)", () => {
  const ORIGIN = "https://bibobay.example";
  const signInRequest = (body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/admin/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const signOutRequest = (headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/admin/session`, { method: "DELETE", headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers } });

  /** A stand-in for the keyed email digest: one distinct 64-hex key per email. */
  const digestOf = (email: string) => Buffer.from(email).toString("hex").padEnd(64, "0").slice(0, 64);
  const ACTIVE: StaffAccess = { ok: true, staff: { userId: STAFF_FIXTURE.active, displayName: "Jo" }, database: { select: vi.fn(), rpc: vi.fn() } };

  function deps({ outcome = "ok" as Awaited<ReturnType<StaffSignIn["signIn"]>>, access = async (): Promise<StaffAccess> => ACTIVE, limiter = createMemoryRateLimiter() as RateLimiter | null, clientKey = "a".repeat(64), auth = true } = {}) {
    const signIn = vi.fn(async () => outcome);
    const signOut = vi.fn(async () => true);
    const consumed: string[] = [];
    const log = vi.fn();
    const rateLimiter: RateLimiter | null = limiter
      ? { consume: async (key, rule) => { consumed.push(key); return limiter.consume(key, rule); } }
      : null;
    const dependencies: SessionDependencies = {
      auth: auth ? { signIn, signOut, access: vi.fn(access) } : null,
      rateLimiter,
      clientKey,
      emailKey: digestOf,
      log,
    };
    return { dependencies, signIn, signOut, consumed, log };
  }

  const read = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers });
  const CREDENTIALS = { email: "Staff@Example.com ", password: "correct horse" };

  it("signs active staff in, privately", async () => {
    const { dependencies, signIn, log } = deps();
    const { status, body, headers } = await read(await handleSignIn(signInRequest(CREDENTIALS), dependencies));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, message: ADMIN_COPY.session.signedIn });
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(signIn).toHaveBeenCalledExactlyOnceWith("staff@example.com", "correct horse");
    expect(log).toHaveBeenCalledWith({ event: "staff_signed_in" });
  });

  it("answers a wrong password, a user without a staff row and inactive staff with one generic 401, signing the non-staff out again", async () => {
    const wrong = deps({ outcome: "refused" });
    const notStaff = deps({ access: async () => ({ ok: false, reason: "not_staff" }) });
    const answers = [];
    for (const { dependencies } of [wrong, notStaff]) answers.push(await read(await handleSignIn(signInRequest(CREDENTIALS), dependencies)));
    for (const answer of answers) expect(answer).toMatchObject({ status: 401, body: { ok: false, message: ADMIN_COPY.session.refused } });
    expect(answers[0]!.body).toEqual(answers[1]!.body);
    expect(wrong.signOut).not.toHaveBeenCalled();
    expect(notStaff.signOut).toHaveBeenCalledTimes(1);
  });

  it("counts every attempt per client and per email digest, never storing the email", async () => {
    const { dependencies, consumed } = deps({ outcome: "refused" });
    await handleSignIn(signInRequest(CREDENTIALS), dependencies);
    expect(consumed).toEqual([`${STAFF_SIGN_IN_RATE_LIMIT.client.scope}:${"a".repeat(64)}`, `${STAFF_SIGN_IN_RATE_LIMIT.email.scope}:${digestOf("staff@example.com")}`]);
    expect(consumed.join(" ")).not.toMatch(/staff@|example/i);
  });

  it("stops a client after its attempts, before asking Auth again", async () => {
    const limiter = createMemoryRateLimiter();
    const { dependencies, signIn } = deps({ outcome: "refused", limiter });
    for (let attempt = 0; attempt < STAFF_SIGN_IN_RATE_LIMIT.client.maxHits; attempt += 1) {
      await handleSignIn(signInRequest({ email: `person${attempt}@example.com`, password: "x" }), dependencies);
    }
    const { status, body, headers } = await read(await handleSignIn(signInRequest(CREDENTIALS), dependencies));
    expect(status).toBe(429);
    expect(body).toEqual({ ok: false, message: ADMIN_COPY.session.rateLimited });
    expect(Number(headers.get("retry-after"))).toBeGreaterThan(0);
    expect(signIn).toHaveBeenCalledTimes(STAFF_SIGN_IN_RATE_LIMIT.client.maxHits);
  });

  it("stops guessing one account's password from many clients", async () => {
    const limiter = createMemoryRateLimiter();
    let signIns = 0;
    for (let attempt = 0; attempt < STAFF_SIGN_IN_RATE_LIMIT.email.maxHits; attempt += 1) {
      const { dependencies, signIn } = deps({ outcome: "refused", limiter, clientKey: String(attempt).padStart(64, "0") });
      await handleSignIn(signInRequest(CREDENTIALS), dependencies);
      signIns += signIn.mock.calls.length;
    }
    const last = deps({ outcome: "refused", limiter, clientKey: "9".repeat(64) });
    expect((await handleSignIn(signInRequest(CREDENTIALS), last.dependencies)).status).toBe(429);
    expect(last.signIn).not.toHaveBeenCalled();
    expect(signIns).toBe(STAFF_SIGN_IN_RATE_LIMIT.email.maxHits);
    expect(STAFF_SIGN_IN_RATE_LIMIT.email.maxHits).toBeLessThan(STAFF_SIGN_IN_RATE_LIMIT.client.maxHits);
  });

  it("refuses cross-site and non-JSON sign-ins with 403 and no detail, counting and trying nothing", async () => {
    const { dependencies, signIn, consumed } = deps();
    for (const request of [
      signInRequest(CREDENTIALS, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      signInRequest("email=staff%40example.com&password=x", { "content-type": "application/x-www-form-urlencoded" }),
    ]) {
      expect(await read(await handleSignIn(request, dependencies))).toMatchObject({ status: 403, body: { ok: false, message: ADMIN_COPY.api.forbidden } });
    }
    expect(signIn).not.toHaveBeenCalled();
    expect(consumed).toEqual([]);
  });

  it("answers 503 without Supabase, or without the shared limiter: no sign-in is attempted unthrottled", async () => {
    for (const { dependencies, signIn } of [deps({ auth: false }), deps({ limiter: null })]) {
      expect(await read(await handleSignIn(signInRequest(CREDENTIALS), dependencies))).toMatchObject({ status: 503, body: { ok: false, message: ADMIN_COPY.api.unconfigured } });
      expect(signIn).not.toHaveBeenCalled();
    }
  });

  it("answers 503 when Auth or the limiter cannot answer", async () => {
    expect((await handleSignIn(signInRequest(CREDENTIALS), deps({ outcome: "unavailable" }).dependencies)).status).toBe(503);
    expect((await handleSignIn(signInRequest(CREDENTIALS), deps({ access: async () => { throw new StaffAuthUnavailableError("auth_unavailable"); } }).dependencies)).status).toBe(503);
    const broken = deps({ limiter: { consume: async () => { throw new Error("db down"); } } });
    expect((await handleSignIn(signInRequest(CREDENTIALS), broken.dependencies)).status).toBe(503);
    expect(broken.signIn).not.toHaveBeenCalled();
  });

  it("answers Auth's own rate limit as 429", async () => {
    expect((await handleSignIn(signInRequest(CREDENTIALS), deps({ outcome: "rate_limited" }).dependencies)).status).toBe(429);
  });

  it.each([
    ["no body", ""],
    ["not JSON", "{"],
    ["no password", { email: "staff@example.com" }],
    ["an empty password", { email: "staff@example.com", password: "" }],
    ["no email", { password: "x" }],
    ["not an email", { email: "staff", password: "x" }],
    ["an extra key", { ...CREDENTIALS, remember: true }],
    ["a number for a password", { email: "staff@example.com", password: 1234 }],
    ["a very long password", { email: "staff@example.com", password: "x".repeat(1025) }],
  ] as const)("answers 400 for %s, counting nothing", async (_case, body) => {
    const { dependencies, signIn, consumed } = deps();
    expect((await handleSignIn(signInRequest(body), dependencies)).status).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
    expect(consumed).toEqual([]);
  });

  it("never logs the email or the password", async () => {
    for (const outcome of ["ok", "refused", "unavailable", "rate_limited"] as const) {
      const { dependencies, log } = deps({ outcome });
      await handleSignIn(signInRequest(CREDENTIALS), dependencies);
      expect(JSON.stringify(log.mock.calls), outcome).not.toMatch(/staff@|example\.com|correct horse/i);
    }
  });

  it("signs out with DELETE, same-origin JSON only", async () => {
    const { dependencies, signOut, log } = deps();
    expect(await read(await handleSignOut(signOutRequest(), dependencies))).toMatchObject({ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedOut } });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: "staff_signed_out" });
    const crossSite = deps();
    expect((await handleSignOut(signOutRequest({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), crossSite.dependencies)).status).toBe(403);
    expect((await handleSignOut(signOutRequest({ "content-type": "text/plain" }), crossSite.dependencies)).status).toBe(403);
    expect(crossSite.signOut).not.toHaveBeenCalled();
    expect((await handleSignOut(signOutRequest(), deps({ auth: false }).dependencies)).status).toBe(503);
  });
});
