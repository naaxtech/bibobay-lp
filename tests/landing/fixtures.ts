import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { LandingPageContent, SiteSettings } from "@/lib/content/types";

/** A fresh copy of the safe fallback landing content, optionally edited for one test. */
export function landingContent(edit?: (draft: LandingPageContent) => void): LandingPageContent {
  const draft = structuredClone(SAFE_FALLBACK_CONTENT);
  edit?.(draft);
  return draft;
}

/** A fresh copy of the safe fallback site settings, optionally edited for one test. */
export function siteSettings(edit?: (draft: SiteSettings) => void): SiteSettings {
  const draft = structuredClone(SAFE_FALLBACK_SETTINGS);
  edit?.(draft);
  return draft;
}

/** The fallback narrative, in order, with testimonials hidden by default. */
export const DEFAULT_RENDERED_SECTIONS = [
  "hero",
  "trust",
  "promise",
  "characters",
  "episodes",
  "offline",
  "pillars",
  "ecosystem",
  "lead",
  "faq",
  "finalCta",
] as const;
