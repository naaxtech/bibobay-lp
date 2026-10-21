import "server-only";

import type { SiteSettings } from "@/lib/content/types";
import { contactFormOpen } from "@/lib/contact/availability";
import { getEmailEnvironment } from "@/lib/email/client";
import { leadStorageConfigured } from "@/lib/leads/dependencies";
import { removalChannelFrom } from "@/lib/leads/removal-channel";
import { getSanityEnvironment } from "@/lib/sanity/env";

/*
 * Readiness (Task 9 ruling R37): which production dependencies this deployment has configured.
 * Booleans only, computed from the presence and shape of settings; no value is ever returned or
 * logged, and nothing here calls an external API.
 */

export interface Readiness {
  /**
   * True when everything the site needs to serve real content and store leads is configured: Sanity,
   * lead storage, revalidation and (P-I1, Ruling R125) a way for a person to ask to be removed.
   */
  ready: boolean;
  /** Sanity project and dataset (content). */
  sanity: boolean;
  /** Supabase URL, service-role key and the lead address-hash secret (lead storage). */
  supabase: boolean;
  /** Resend key and sender (reported; not required on its own: emails wait in the outbox). */
  email: boolean;
  /**
   * P-I1 (Ruling R125): a removal channel exists (email sending, so a reply to the acknowledgement
   * reaches BIBO Bay, or a valid `siteSettings.contactEmail`). Required: without it /api/leads
   * refuses every signup with 503.
   */
  leadRemovalChannel: boolean;
  /**
   * The contact form is open (R173): lead storage, email sending, a staff address and the hash
   * secret. Reported; not required, so `ready` is unchanged.
   */
  contact: boolean;
  /** SANITY_REVALIDATE_SECRET (published edits reach the site). */
  revalidation: boolean;
  /** Both legal pages carry versioned Sanity text (reported; not required, ruling R30). */
  legalReviewed: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readinessChecks(
  env: Env,
  { legalReviewed, settings }: { legalReviewed: boolean; settings: Pick<SiteSettings, "contactEmail"> },
): Readiness {
  const sanity = getSanityEnvironment(env as NodeJS.ProcessEnv) !== null;
  const supabase = leadStorageConfigured(env);
  const email = getEmailEnvironment(env) !== null;
  const leadRemovalChannel = removalChannelFrom(settings, env) !== null;
  const contact = contactFormOpen(env);
  const revalidation = Boolean(env.SANITY_REVALIDATE_SECRET?.trim());
  return { ready: sanity && supabase && revalidation && leadRemovalChannel, sanity, supabase, email, leadRemovalChannel, contact, revalidation, legalReviewed };
}
