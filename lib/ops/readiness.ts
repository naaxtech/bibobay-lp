import "server-only";

import { getEmailEnvironment } from "@/lib/email/client";
import { leadStorageConfigured } from "@/lib/leads/dependencies";
import { getSanityEnvironment } from "@/lib/sanity/env";

/*
 * Readiness (Task 9 ruling R37): which production dependencies this deployment has configured.
 * Booleans only, computed from the presence and shape of settings; no value is ever returned or
 * logged, and nothing here calls an external API.
 */

export interface Readiness {
  /** True when everything the site needs to serve real content and store leads is configured. */
  ready: boolean;
  /** Sanity project and dataset (content). */
  sanity: boolean;
  /** Supabase URL, service-role key and the lead address-hash secret (lead storage). */
  supabase: boolean;
  /** Resend key and sender (reported; not required: emails wait in the outbox). */
  email: boolean;
  /** SANITY_REVALIDATE_SECRET (published edits reach the site). */
  revalidation: boolean;
  /** Both legal pages carry versioned Sanity text (reported; not required, ruling R30). */
  legalReviewed: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readinessChecks(env: Env, { legalReviewed }: { legalReviewed: boolean }): Readiness {
  const sanity = getSanityEnvironment(env as NodeJS.ProcessEnv) !== null;
  const supabase = leadStorageConfigured(env);
  const email = getEmailEnvironment(env) !== null;
  const revalidation = Boolean(env.SANITY_REVALIDATE_SECRET?.trim());
  return { ready: sanity && supabase && revalidation, sanity, supabase, email, revalidation, legalReviewed };
}
