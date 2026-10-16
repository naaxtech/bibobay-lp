import "server-only";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { reportError } from "@/lib/observability/report";
import type { RateLimiter } from "@/lib/security/rate-limit";
import { StaffAuthUnavailableError, type StaffSignIn } from "@/lib/supabase/auth";
import { adminJson, codeOf, isAdminWrite, readAdminJson, type AdminLogEvent } from "./http";

/**
 * POST /api/admin/session (sign in) and DELETE /api/admin/session (sign out): Task 8b, ruling R94.
 *
 * Staff sign in with the email and password the owner gave their Supabase Auth account (Task 11).
 * There is no sign-up, password reset or magic link here. Sign-in, in this order:
 *   403 cross-site or not JSON (no detail; nothing counted or tried)
 *   503 Supabase or the shared rate limiter unconfigured: no sign-in is ever tried unthrottled
 *   400 a body that is not { email, password } (not counted)
 *   429 too many attempts from this client, or for this email (the Task 5 shared limiter, under a
 *       keyed hash of the client address and a keyed digest of the email: neither is stored)
 *   401 one generic refusal for a wrong email or password, AND for a correct password on an account
 *       with no active staff row (that session is signed out again at once), so the answer never
 *       tells which accounts exist or which are staff
 *   503 Auth or the limiter did not answer · 200 signed in (the session cookies are set).
 * Sign-out clears this device's session cookies (and Auth revokes the session) and answers 200,
 * also when no one was signed in.
 */

/** Ten attempts per client, and five per email, in each 15-minute window (shared by every instance). */
export const STAFF_SIGN_IN_RATE_LIMIT = {
  client: { scope: "staff-login", maxHits: 10, windowSeconds: 900 },
  email: { scope: "staff-login-email", maxHits: 5, windowSeconds: 900 },
} as const;

export interface SessionDependencies {
  /** Sign-in over this request's cookies, or null while Supabase is unconfigured. */
  auth: StaffSignIn | null;
  /** The shared limiter (service role); null: sign-in answers 503. */
  rateLimiter: RateLimiter | null;
  /** A keyed hash of the client address (lib/leads/http.ts), never the address. */
  clientKey: string;
  /** A keyed digest of the normalised email, never the email. */
  emailKey(email: string): string;
  log(event: AdminLogEvent): void;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PASSWORD_MAX_LENGTH = 1024;

function credentialsFrom(value: unknown): { email: string; password: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Object.keys(input).every((key) => key === "email" || key === "password")) return null;
  const { email, password } = input;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalised = email.trim().toLowerCase();
  if (normalised.length < 3 || normalised.length > 254 || !EMAIL_PATTERN.test(normalised)) return null;
  if (password.length === 0 || password.length > PASSWORD_MAX_LENGTH) return null;
  return { email: normalised, password };
}

const forbidden = () => adminJson(403, { ok: false, message: ADMIN_COPY.api.forbidden });
const refused = () => adminJson(401, { ok: false, message: ADMIN_COPY.session.refused });
const unavailable = () => adminJson(503, { ok: false, message: ADMIN_COPY.api.unavailable });
const rateLimited = (retryAfterSeconds: number) =>
  adminJson(429, { ok: false, message: ADMIN_COPY.session.rateLimited }, { "retry-after": String(Math.max(1, Math.ceil(retryAfterSeconds))) });

export async function handleSignIn(request: Request, deps: SessionDependencies): Promise<Response> {
  try {
    if (!isAdminWrite(request)) {
      deps.log({ event: "admin_request_refused", reason: "cross_site" });
      return forbidden();
    }
    const { auth, rateLimiter } = deps;
    if (!auth || !rateLimiter) {
      deps.log({ event: "admin_unconfigured" });
      return adminJson(503, { ok: false, message: ADMIN_COPY.api.unconfigured });
    }

    const read = await readAdminJson(request);
    const credentials = read.ok ? credentialsFrom(read.value) : null;
    if (!credentials) return adminJson(400, { ok: false, message: ADMIN_COPY.session.checkDetails });

    for (const [rule, key] of [
      [STAFF_SIGN_IN_RATE_LIMIT.client, deps.clientKey],
      [STAFF_SIGN_IN_RATE_LIMIT.email, deps.emailKey(credentials.email)],
    ] as const) {
      let decision;
      try {
        decision = await rateLimiter.consume(`${rule.scope}:${key}`, { maxHits: rule.maxHits, windowSeconds: rule.windowSeconds });
      } catch (error) {
        deps.log({ event: "staff_sign_in_unavailable", code: codeOf(error) });
        return unavailable();
      }
      if (!decision.allowed) {
        deps.log({ event: "staff_sign_in_rate_limited" });
        return rateLimited(decision.retryAfterSeconds);
      }
    }

    const outcome = await auth.signIn(credentials.email, credentials.password);
    if (outcome === "rate_limited") {
      deps.log({ event: "staff_sign_in_rate_limited" });
      return rateLimited(60);
    }
    if (outcome === "unavailable") {
      deps.log({ event: "staff_sign_in_unavailable", code: "auth" });
      return unavailable();
    }
    if (outcome === "refused") {
      deps.log({ event: "staff_sign_in_refused" });
      return refused();
    }

    let access;
    try {
      access = await auth.access();
    } catch (error) {
      await auth.signOut();
      deps.log({ event: "staff_sign_in_unavailable", code: error instanceof StaffAuthUnavailableError ? error.code : codeOf(error) });
      return unavailable();
    }
    if (!access.ok) {
      // R95: signed in without an active staff row is no access; the same answer as a wrong password.
      await auth.signOut();
      deps.log({ event: "staff_sign_in_refused" });
      return refused();
    }
    deps.log({ event: "staff_signed_in" });
    return adminJson(200, { ok: true, message: ADMIN_COPY.session.signedIn });
  } catch (error) {
    deps.log({ event: "admin_action_failed", code: codeOf(error) });
    reportError(error, { area: "admin", event: "staff_sign_in_failed" });
    return adminJson(500, { ok: false, message: ADMIN_COPY.api.failed });
  }
}

export async function handleSignOut(request: Request, deps: Pick<SessionDependencies, "auth" | "log">): Promise<Response> {
  try {
    if (!isAdminWrite(request)) {
      deps.log({ event: "admin_request_refused", reason: "cross_site" });
      return forbidden();
    }
    if (!deps.auth) {
      deps.log({ event: "admin_unconfigured" });
      return adminJson(503, { ok: false, message: ADMIN_COPY.api.unconfigured });
    }
    const revoked = await deps.auth.signOut();
    // The cookies are cleared either way; an unconfirmed revoke is worth a warning.
    deps.log(revoked ? { event: "staff_signed_out" } : { event: "staff_sign_out_unavailable" });
    return adminJson(200, { ok: true, message: ADMIN_COPY.session.signedOut });
  } catch (error) {
    deps.log({ event: "admin_action_failed", code: codeOf(error) });
    reportError(error, { area: "admin", event: "staff_sign_out_failed" });
    return adminJson(500, { ok: false, message: ADMIN_COPY.api.failed });
  }
}
