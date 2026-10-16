/*
 * The staff session's cookies (Task 8b, ruling R94), shared by the route handlers
 * (lib/supabase/auth.ts) and proxy.ts, which refreshes the session on /admin and /api/admin
 * requests. No `server-only` import and no "@/" import: proxy.ts and its tests import this module.
 * It holds nothing secret: the publishable key and the user's own session.
 *
 * Staff sign in with email and password through @supabase/ssr. The session (access and refresh
 * token) lives in cookies that only the server writes: httpOnly, so page scripts never see them;
 * Secure outside localhost; SameSite=Lax, so other sites' requests do not carry them on cross-site
 * POSTs; path /. The options are enforced on every write, whatever the library passes.
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type Env = Readonly<Record<string, string | undefined>>;

export interface StaffAuthEnvironment {
  url: string;
  publishableKey: string;
}

/**
 * NEXT_PUBLIC_SUPABASE_URL (https, or local http) and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or null.
 * The same rule as getSupabasePublicEnvironment (lib/supabase/server.ts), which is server-only and
 * so cannot be imported here; tests/admin/staff-auth.test.ts pins the two to the same answers.
 */
export function staffAuthEnvironment(env: Env = process.env): StaffAuthEnvironment | null {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!raw || !publishableKey || /^sb_secret_/i.test(publishableKey)) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return { url: url.origin, publishableKey };
  } catch {
    return null;
  }
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The local dev server's hosts: the only ones where the cookies go without Secure (plain http). */
export const isLocalHostname = (hostname: string) => LOCAL_HOSTNAMES.has(hostname.toLowerCase());

export function staffCookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/" };
}

/** Supabase's session cookie: `sb-<project ref>-auth-token`, split into `.0`, `.1`… when long. */
export const STAFF_SESSION_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:\.\d+)?$/;

export interface StaffCookieJar {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options: CookieOptions): void;
}

/**
 * A Supabase client for one request, acting as the signed-in user (the publishable key plus the
 * user's own token): its reads and RPCs run under row level security. Never shared between
 * requests. `fetch` is for tests.
 */
export function createStaffAuthClient(
  config: StaffAuthEnvironment,
  jar: StaffCookieJar,
  { secure, fetch }: { secure: boolean; fetch?: typeof globalThis.fetch },
): SupabaseClient {
  const enforced = staffCookieOptions(secure);
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: enforced,
    cookies: {
      getAll: () => jar.getAll(),
      setAll(cookies) {
        for (const { name, value, options } of cookies) jar.set(name, value, { ...options, ...enforced });
      },
    },
    ...(fetch ? { global: { fetch } } : {}),
  });
}

/** Paths whose requests carry and refresh the staff session (proxy.ts). */
export function isStaffPath(pathname: string): boolean {
  return /^\/(?:api\/)?admin(?:\/|$)/.test(pathname);
}

/**
 * How long a staff request waits for Supabase Auth. On a network failure auth-js retries a token
 * refresh with backoff for up to 30 seconds (AUTO_REFRESH_TICK_DURATION_MS), and fetch itself has
 * no deadline, so every staff Auth call is bounded: past this, the answer is "Auth unavailable".
 */
export const STAFF_AUTH_TIMEOUT_MS = 5000;

/** The work's value, or `timedOut` when it takes longer than `ms`. The work itself is not cancelled. */
export async function withinStaffAuthTimeout<T>(work: Promise<T>, ms: number = STAFF_AUTH_TIMEOUT_MS): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
