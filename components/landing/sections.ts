import type { Cta, LandingPageContent, SectionConfig, SectionId, SectionTheme, SiteSettings, Testimonial } from "@/lib/content/types";

/** The paper and accent each section is printed on unless its CMS theme says otherwise. */
const DEFAULT_SECTION_THEMES: Record<SectionId, Required<SectionTheme>> = {
  hero: { background: "paper", accent: "yellow" },
  trust: { background: "paper", accent: "yellow" },
  promise: { background: "paper", accent: "orange" },
  characters: { background: "sea", accent: "teal" },
  episodes: { background: "paper", accent: "purple" },
  offline: { background: "sand", accent: "orange" },
  pillars: { background: "paper", accent: "teal" },
  ecosystem: { background: "navy", accent: "yellow" },
  testimonials: { background: "paper", accent: "purple" },
  lead: { background: "sea", accent: "teal" },
  faq: { background: "paper", accent: "purple" },
  finalCta: { background: "paper", accent: "yellow" },
};

export function sectionTheme(section: SectionConfig): Required<SectionTheme> {
  const fallback = DEFAULT_SECTION_THEMES[section.id];
  return {
    background: section.theme?.background ?? fallback.background,
    accent: section.theme?.accent ?? fallback.accent,
  };
}

/** Testimonials are proof: only entries an editor explicitly verified may ever render. */
export function verifiedTestimonials(content: LandingPageContent): Testimonial[] {
  return content.testimonials.filter((entry) => entry.verified === true);
}

function hasContent(id: SectionId, content: LandingPageContent, settings: SiteSettings): boolean {
  switch (id) {
    case "trust":
      return content.trust.items.length > 0;
    case "characters":
      return content.characters.length > 0;
    case "episodes":
      return content.episodes.length > 0;
    case "offline":
      return content.offline.steps.length > 0;
    case "pillars":
      return content.pillars.length > 0;
    case "ecosystem":
      return content.ecosystem.length > 0;
    case "testimonials":
      return settings.testimonialsEnabled && verifiedTestimonials(content).length > 0;
    case "faq":
      return content.faqs.length > 0;
    case "hero":
    case "promise":
    case "lead":
    case "finalCta":
      return true;
  }
}

/**
 * The sections to render, in CMS order: visible in the CMS and with something to show.
 * An empty collection hides its section instead of rendering an empty shell.
 */
export function renderableSections(content: LandingPageContent, settings: SiteSettings): SectionConfig[] {
  return content.sections.filter((section) => section.visible && hasContent(section.id, content, settings));
}

/** Approved Sanity artwork resolved on the server: a ready image URL and its alt text ("" when decorative). */
export interface StageArt {
  src: string;
  alt: string;
}

/** Where links on this page may lead. */
export interface LinkContext {
  anchors: ReadonlySet<string>;
  commerceEnabled: boolean;
}

export const SHOP_PATH = "/shop";
const SHOP_ROUTE = /^\/shop(?:[/?#]|$)/;

export function linkContext(sections: readonly SectionConfig[], settings: SiteSettings): LinkContext {
  return { anchors: new Set(sections.map((section) => section.id)), commerceEnabled: settings.commerceEnabled };
}

/** False for a link that leads nowhere: an anchor whose section is not rendered, or the shop while commerce is off. */
export function isReachable(href: string, context: LinkContext): boolean {
  const anchor = href.startsWith("#") ? href.slice(1) : href.startsWith("/#") ? href.slice(2) : null;
  if (anchor !== null) return context.anchors.has(anchor);
  if (SHOP_ROUTE.test(href)) return context.commerceEnabled;
  return true;
}

export function reachableCtas(ctas: readonly Cta[], context: LinkContext): Cta[] {
  return ctas.filter((cta) => isReachable(cta.href, context));
}
