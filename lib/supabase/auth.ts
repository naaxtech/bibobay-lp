import "server-only";

import { cookies } from "next/headers";
import { isAuthApiError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";

import type { StaffDatabase, StaffSelect } from "@/lib/orders/admin";
import { createStaffAuthClient, isLocalHostname, staffAuthEnvironment, withinStaffAuthTimeout, type StaffCookieJar } from "./staff-session";

/**
 * Staff authorization (Task 8b; spec §5 "Staff routes", §11; rulings R94, R95).
 *
 * A request is staff only when BOTH hold:
 *   1. Supabase Auth vouches for its user: `auth.getUser()` asks the Auth server to verify the
 *      session's token. `getSession()` alone only decodes the cookie, so it is never the check.
 *   2. That user's own staff_users row is active, read with the user's own client under row level
 *      security (migration 0007): a signed-in user without an active row gets the same refusal as
 *      a signed-out one from the routes.
 *
 * requireStaffUser never throws for an auth state; it answers a typed refusal:
 *   unconfigured (no Supabase settings) · signed_out (no session, or one Auth refuses) · not_staff.
 * When Auth or the database cannot answer at all it throws (StaffAuthUnavailableError, RpcError):
 * an outage is not a signed-out user, and the route answers 503 or 500.
 */

export interface StaffIdentity {
  userId: string;
  displayName: string | null;
}

export type StaffRefusal = "signed_out" | "not_staff" | "unconfigured";

export type StaffAccess =
  | { ok: true; staff: StaffIdentity; database: StaffDatabase }
  | { ok: false; reason: StaffRefusal };

export interface StaffSession {
  /** The user id Supabase Auth vouches for, or null. Throws StaffAuthUnavailableError when Auth cannot answer. */
  verifiedUserId(): Promise<string | null>;
  /** The same user's client: reads under RLS, and the staff RPCs. */
  database: StaffDatabase;
}

/** Supabase Auth did not answer (network, or a server error): the request's user is unknown. */
export class StaffAuthUnavailableError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`staff auth unavailable (${code})`);
    this.name = "StaffAuthUnavailableError";
    this.code = code;
  }
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function requireStaffUser(session: StaffSession | null): Promise<StaffAccess> {
  if (!session) return { ok: false, reason: "unconfigured" };
  const userId = await session.verifiedUserId();
  if (!userId) return { ok: false, reason: "signed_out" };

  const { data, error } = await session.database.select({
    table: "staff_users",
    columns: ["user_id", "display_name", "active"],
    match: { user_id: userId },
    limit: 1,
  });
  if (error || !Array.isArray(data)) throw new StaffAuthUnavailableError(`staff_users_${error?.code && /^[A-Za-z0-9_]{1,16}$/.test(error.code) ? error.code : "bad_response"}`);
  const row = data[0] as Record<string, unknown> | undefined;
  if (!row || row.user_id !== userId || row.active !== true) return { ok: false, reason: "not_staff" };
  const displayName = typeof row.display_name === "string" ? row.display_name : null;
  return { ok: true, staff: { userId, displayName }, database: session.database };
}

/** The narrow staff database over a Supabase client acting as the signed-in user. */
export function staffDatabaseFrom(client: SupabaseClient): StaffDatabase {
  return {
    async select({ table, columns, match, order, limit }: StaffSelect) {
      let query = client.from(table).select(columns.join(","));
      for (const [column, value] of Object.entries(match ?? {})) query = query.eq(column, value);
      if (order) query = query.order(order.column, { ascending: order.ascending });
      if (limit) query = query.limit(limit);
      const { data, error } = await query;
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
  };
}

export function staffSessionFrom(client: SupabaseClient): StaffSession {
  return {
    async verifiedUserId() {
      let answer: Awaited<ReturnType<typeof withinStaffAuthTimeout<Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>>>>;
      try {
        // Bounded (STAFF_AUTH_TIMEOUT_MS): an expired session is refreshed first, and auth-js
        // retries a failed refresh for up to 30 s.
        answer = await withinStaffAuthTimeout(client.auth.getUser());
      } catch {
        throw new StaffAuthUnavailableError("auth_exception");
      }
      if (answer.timedOut) throw new StaffAuthUnavailableError("auth_timeout");
      const { data, error } = answer.value;
      if (error) {
        // No session, or a token Auth refuses (expired, revoked, a deleted user): signed out.
        if (isAuthSessionMissingError(error) || (isAuthApiError(error) && error.status < 500)) return null;
        throw new StaffAuthUnavailableError("auth_unavailable");
      }
      return isUuid(data.user?.id) ? data.user.id : null;
    },
    database: staffDatabaseFrom(client),
  };
}

/**
 * Password sign-in and sign-out for the session route (R94), over a cookie client: a sign-in writes
 * the session cookies, a sign-out clears them. `access` is requireStaffUser for the same client,
 * so it sees the session the sign-in just made.
 */
export interface StaffSignIn {
  /** ok, refused (wrong email or password: Auth answered), rate_limited (Auth's own limit), unavailable. */
  signIn(email: string, password: string): Promise<"ok" | "refused" | "rate_limited" | "unavailable">;
  access(): Promise<StaffAccess>;
  /** Clears this device's session; true when Auth also revoked it, false when only the cookies went. */
  signOut(): Promise<boolean>;
}

export function staffSignInFrom(client: SupabaseClient, session: StaffSession = staffSessionFrom(client)): StaffSignIn {
  return {
    async signIn(email, password) {
      let error: unknown;
      try {
        const answer = await withinStaffAuthTimeout(client.auth.signInWithPassword({ email, password }));
        // A late answer may still write cookies into a response already sent: they are dropped.
        if (answer.timedOut) return "unavailable";
        ({ error } = answer.value);
      } catch {
        return "unavailable";
      }
      if (!error) return "ok";
      if (isAuthApiError(error) && error.status === 429) return "rate_limited";
      if (isAuthApiError(error) && error.status < 500) return "refused";
      return "unavailable";
    },
    access: () => requireStaffUser(session),
    async signOut() {
      try {
        // `local`: this device only. The session's refresh token is revoked by Auth; even when Auth
        // cannot be reached, the library still removes the session, so the cookies are cleared.
        const answer = await withinStaffAuthTimeout(client.auth.signOut({ scope: "local" }));
        if (answer.timedOut) return false;
        const { error } = answer.value;
        return !error || isAuthSessionMissingError(error);
      } catch {
        return false;
      }
    },
  };
}

/** Whether this request's cookies may go without Secure: only on the local dev server. */
export function cookiesMayBeInsecure(request: Request): boolean {
  return isLocalHostname(new URL(request.url).hostname);
}

/**
 * The staff client and session for one route request, over Next's cookie store, or null while
 * Supabase is not configured. Route handlers can write cookies (a sign-in, a refreshed token);
 * server components cannot, so a write there is dropped and proxy.ts refreshes instead.
 */
export async function staffClientForRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<{ client: SupabaseClient; session: StaffSession } | null> {
  const config = staffAuthEnvironment(env);
  if (!config) return null;
  const store = await cookies();
  const jar: StaffCookieJar = {
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    set(name, value, options) {
      try {
        store.set(name, value, options as Parameters<typeof store.set>[2]);
      } catch {
        // A server component render: cookies are read-only there (the proxy refreshes them).
      }
    },
  };
  const client = createStaffAuthClient(config, jar, { secure: !cookiesMayBeInsecure(request) });
  return { client, session: staffSessionFrom(client) };
}
