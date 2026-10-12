import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { RpcClient } from "./rpc";

/**
 * The service-role Supabase client for server routes (ruling R25). It may only ever run on the
 * server: `server-only` makes any client-bundle import a build error, and the key's name has no
 * public prefix (scripts/verify-env.ts rejects a NEXT_PUBLIC_ copy of it, by name and by value).
 *
 * The lead tables grant nothing to any API role, this one included; the key's only use is calling
 * the `security definer` RPCs from migration 0001, which grant execute to `service_role` alone.
 */
export interface SupabaseAdminEnvironment {
  url: string;
  serviceRoleKey: string;
}

/** The project URL, as an origin: https, or plain http for a local Supabase stack only. */
export function supabaseProjectUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.username || url.password) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The server key and project URL, or null while Supabase is not configured for this environment. */
export function getSupabaseAdminEnvironment(env: Record<string, string | undefined> = process.env): SupabaseAdminEnvironment | null {
  const url = supabaseProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // A publishable key in the server slot would only ever be refused by the database; treat it as missing.
  if (!url || !serviceRoleKey || /^sb_publishable_/i.test(serviceRoleKey)) return null;
  return { url, serviceRoleKey };
}

/** A stateless service-role client: no session storage, no token refresh, no URL session detection. */
export function createSupabaseAdminClient({ url, serviceRoleKey }: SupabaseAdminEnvironment): RpcClient {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    async rpc(fn, args) {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
  };
}
