import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const cookieStore = {
  getAll: vi.fn(() => [] as Array<{ name: string; value: string }>),
  set: vi.fn(() => {
    throw new Error("cookies are read-only in a page render");
  }),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

import { staffPageAccess, staffPageAccessWith } from "@/lib/admin/access";
import { StaffAuthUnavailableError, type StaffSession } from "@/lib/supabase/auth";
import { createStaffAuthClient, type StaffCookieJar } from "@/lib/supabase/staff-session";

/*
 * Task 8c, ruling R100: what a staff PAGE learns about the visitor. It reads the session from
 * Next's cookies (read-only in a page render; proxy.ts refreshes expired sessions), asks Supabase
 * Auth who the user is, and reads the user's own active staff row. It answers one of four kinds
 * and never throws for an auth state: not_staff collapses into signed_out (the API signs such a
 * session out at once), an Auth outage or timeout is "unavailable", no settings is "unconfigured".
 */
const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://bibo-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only" };
const STAFF_ID = "00000000-0000-4000-8000-0000000000b1";

const b64url = (value: string) => Buffer.from(value).toString("base64url");
const jwt = (sub: string) => `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" }))}.signature`;
const user = (id: string) => ({ id, aud: "authenticated", role: "authenticated", email: "staff@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" });

function fakeSupabase({ staffRows, userStatus = 200 }: { staffRows: unknown[] | { status: number }; userStatus?: number }) {
  const calls: string[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/token") {
      return json(200, { access_token: jwt(STAFF_ID), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh-fixture", user: user(STAFF_ID) });
    }
    if (url.pathname === "/auth/v1/user") {
      if (userStatus === 0) throw new TypeError("fetch failed");
      return userStatus === 200 ? json(200, user(STAFF_ID)) : json(userStatus, { code: userStatus, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/rest/v1/staff_users") return Array.isArray(staffRows) ? json(200, staffRows) : json(staffRows.status, { code: "PGRST000", message: "down" });
    return json(404, { message: "not found" });
  });
  return { fetch, calls };
}

/** The cookies a real sign-in leaves behind, so the page sees what a browser would send. */
async function signedInCookies() {
  const values = new Map<string, string>();
  const jar: StaffCookieJar = {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    set: (name, value) => void values.set(name, value),
  };
  const client = createStaffAuthClient({ url: ENV.NEXT_PUBLIC_SUPABASE_URL, publishableKey: ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, jar, {
    secure: true,
    fetch: fakeSupabase({ staffRows: [] }).fetch,
  });
  const { error } = await client.auth.signInWithPassword({ email: "staff@example.com", password: "correct horse" });
  expect(error).toBeNull();
  return jar.getAll();
}

const staffRow = (overrides: Record<string, unknown> = {}) => ({ user_id: STAFF_ID, display_name: "Jo", active: true, ...overrides });

const noDatabase = { select: async () => ({ data: [], error: null }), rpc: async () => ({ data: null, error: null }) };

beforeEach(() => {
  cookieStore.getAll.mockReset().mockReturnValue([]);
  cookieStore.set.mockClear();
});

describe("staffPageAccessWith", () => {
  it("is unconfigured without Supabase settings, and asks nothing", async () => {
    const { fetch } = fakeSupabase({ staffRows: [] });
    expect(await staffPageAccessWith({ env: {}, cookies: [], fetch })).toEqual({ kind: "unconfigured" });
    expect(await staffPageAccessWith({ env: { NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL }, cookies: [], fetch })).toEqual({ kind: "unconfigured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is signed_out without a session cookie, and never reads the staff table", async () => {
    const { fetch, calls } = fakeSupabase({ staffRows: [staffRow()] });
    expect(await staffPageAccessWith({ env: ENV, cookies: [], fetch })).toEqual({ kind: "signed_out" });
    expect(calls).not.toContain("/rest/v1/staff_users");
  });

  it("is staff for a verified user with an active staff row, with the identity and a database to read through", async () => {
    const { fetch, calls } = fakeSupabase({ staffRows: [staffRow()] });
    const access = await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch });
    expect(access.kind).toBe("staff");
    if (access.kind !== "staff") return;
    expect(access.identity).toEqual({ userId: STAFF_ID, displayName: "Jo" });
    expect(typeof access.db.select).toBe("function");
    expect(typeof access.db.rpc).toBe("function");
    expect(calls).toContain("/auth/v1/user");
  });

  it("is signed_out (not a different answer) for a signed-in user without an active staff row", async () => {
    for (const rows of [[], [staffRow({ active: false })], [staffRow({ user_id: "00000000-0000-4000-8000-0000000000b9" })]]) {
      const { fetch } = fakeSupabase({ staffRows: rows });
      expect(await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch })).toEqual({ kind: "signed_out" });
    }
  });

  it("is signed_out when Auth refuses the session (expired, revoked, a deleted user)", async () => {
    const { fetch } = fakeSupabase({ staffRows: [staffRow()], userStatus: 401 });
    expect(await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch })).toEqual({ kind: "signed_out" });
  });

  it("is unavailable when Auth cannot be reached or answers with a server error", async () => {
    const down = fakeSupabase({ staffRows: [staffRow()], userStatus: 0 });
    expect(await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch: down.fetch })).toEqual({ kind: "unavailable" });
    const broken = fakeSupabase({ staffRows: [staffRow()], userStatus: 503 });
    expect(await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch: broken.fetch })).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when the staff row cannot be read", async () => {
    const { fetch } = fakeSupabase({ staffRows: { status: 500 } });
    expect(await staffPageAccessWith({ env: ENV, cookies: await signedInCookies(), fetch })).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when the session check itself reports it cannot answer (timeout)", async () => {
    const session: StaffSession = {
      async verifiedUserId() {
        throw new StaffAuthUnavailableError("auth_timeout");
      },
      database: noDatabase,
    };
    expect(await staffPageAccessWith({ session })).toEqual({ kind: "unavailable" });
  });

  it("does not hide a programming error as an auth state", async () => {
    const session: StaffSession = {
      async verifiedUserId() {
        throw new TypeError("bug");
      },
      database: noDatabase,
    };
    await expect(staffPageAccessWith({ session })).rejects.toThrow("bug");
  });

  it("reads the request's cookies from Next when none are given, and never writes one", async () => {
    cookieStore.getAll.mockReturnValue(await signedInCookies());
    const { fetch } = fakeSupabase({ staffRows: [staffRow()] });
    const access = await staffPageAccessWith({ env: ENV, fetch });
    expect(access.kind).toBe("staff");
    expect(cookieStore.getAll).toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});

describe("staffPageAccess", () => {
  it("answers unconfigured while the environment has no Supabase settings", async () => {
    const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      expect(await staffPageAccess()).toEqual({ kind: "unconfigured" });
    } finally {
      if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
      if (saved.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = saved.key;
    }
  });
});
