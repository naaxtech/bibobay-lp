import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import type { StaffDatabase } from "@/lib/orders/admin";
import { StaffAuthUnavailableError, requireStaffUser, staffSessionFrom, type StaffIdentity, type StaffSession } from "@/lib/supabase/auth";
import { createStaffAuthClient, staffAuthEnvironment, type StaffCookieJar } from "@/lib/supabase/staff-session";

/**
 * What a staff PAGE learns about its visitor (Task 8c, ruling R100). The staff APIs answer with
 * status codes (lib/supabase/auth.ts requireStaffUser); a page needs one of four outcomes it can
 * render or redirect on:
 *   staff        an Auth-verified user with an active staff row; `db` reads under that user's RLS
 *   signed_out   no session, a session Auth refuses, or a signed-in user who is not active staff
 *                (the session API signs such a user out at once, so the page treats them alike)
 *   unconfigured Supabase is not configured on this deployment
 *   unavailable  Auth or the database did not answer (an outage, or the bounded wait ran out)
 * Never throws for an auth state. Anything else that throws is a defect and is left to throw.
 *
 * A Server Component may only READ cookies (Next 16: writes throw outside a Route Handler or
 * Server Action), so the jar below drops writes; proxy.ts refreshes an expired staff session on
 * /admin before the page renders.
 */
export type StaffPageAccess =
  | { kind: "staff"; identity: StaffIdentity; db: StaffDatabase }
  | { kind: "signed_out" }
  | { kind: "unconfigured" }
  | { kind: "unavailable" };

export interface StaffPageAccessOptions {
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** The request's cookies; defaults to Next's cookie store. */
  cookies?: ReadonlyArray<{ name: string; value: string }>;
  /** For tests: the network the Supabase client uses. */
  fetch?: typeof globalThis.fetch;
  /** For tests: a ready session in place of the cookie client (skips env and cookies). */
  session?: StaffSession | null;
}

export async function staffPageAccessWith(options: StaffPageAccessOptions = {}): Promise<StaffPageAccess> {
  const session = options.session !== undefined ? options.session : await sessionFromCookies(options);
  if (!session) return { kind: "unconfigured" };
  try {
    const access = await requireStaffUser(session);
    if (access.ok) return { kind: "staff", identity: access.staff, db: access.database };
    return access.reason === "unconfigured" ? { kind: "unconfigured" } : { kind: "signed_out" };
  } catch (error) {
    if (error instanceof StaffAuthUnavailableError) return { kind: "unavailable" };
    throw error;
  }
}

async function sessionFromCookies({ env = process.env, cookies: given, fetch }: StaffPageAccessOptions): Promise<StaffSession | null> {
  const config = staffAuthEnvironment(env);
  if (!config) return null;
  const present = given ?? (await cookies()).getAll();
  const jar: StaffCookieJar = {
    getAll: () => present.map(({ name, value }) => ({ name, value })),
    // A page render cannot set cookies; the proxy already refreshed the session for this request.
    set: () => {},
  };
  return staffSessionFrom(createStaffAuthClient(config, jar, { secure: true, ...(fetch ? { fetch } : {}) }));
}

/**
 * The page-level entry point: the layout and the page of one request share a single answer
 * (React's per-request cache), so Auth is asked once per render.
 */
export const staffPageAccess = cache(() => staffPageAccessWith());
