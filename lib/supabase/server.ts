import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabaseProjectUrl } from "./admin";

/**
 * Public Supabase configuration: the project URL and the publishable key, the only Supabase values
 * that may reach a browser (spec §3 ruling 10). A secret key in the publishable slot is refused here
 * and by scripts/verify-env.ts at build time.
 *
 * Task 5 needs no publishable-key client: leads never touch Supabase from the browser or with the
 * anon role (ruling R25), and the lead tables grant anon nothing. `createSupabaseServerClient` is the
 * planned home for server reads under RLS; Task 8 adds cookie sessions here (via @supabase/ssr) for
 * staff sign-in. Until then nothing imports it.
 */
export interface SupabasePublicEnvironment {
  url: string;
  publishableKey: string;
}

export function getSupabasePublicEnvironment(env: Record<string, string | undefined> = process.env): SupabasePublicEnvironment | null {
  const url = supabaseProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey || /^sb_secret_/i.test(publishableKey)) return null;
  return { url, publishableKey };
}

/** A stateless publishable-key client, acting as `anon` under RLS; null while Supabase is unconfigured. */
export function createSupabaseServerClient(env: Record<string, string | undefined> = process.env): SupabaseClient | null {
  const config = getSupabasePublicEnvironment(env);
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
