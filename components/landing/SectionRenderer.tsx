import { Fragment, type ReactNode } from "react";

import type { ImageWithAlt, LandingPageContent, SectionConfig, SiteSettings } from "@/lib/content/types";
import { sanityImageUrl } from "@/lib/sanity/image";
import { Characters } from "./Characters";
import { Ecosystem } from "./Ecosystem";
import { Episodes } from "./Episodes";
import { Faq } from "./Faq";
import { FinalCta } from "./FinalCta";
import { Hero } from "./Hero";
import { LeadCapture } from "./LeadCapture";
import { OfflineLoop } from "./OfflineLoop";
import { Pillars } from "./Pillars";
import { PromiseSection } from "./Promise";
import { linkContext, renderableSections, verifiedTestimonials, type LinkContext, type StageArt } from "./sections";
import { Testimonials } from "./Testimonials";
import { TrustStrip } from "./TrustStrip";

/** Stage and cover art is requested at twice its largest rendered width. */
const ART_WIDTH = 1200;

/** Resolves approved Sanity art on the server; anything without a usable asset keeps its placeholder. */
function artById(entries: ReadonlyArray<{ id: string; image?: ImageWithAlt }>): Record<string, StageArt> {
  const art: Record<string, StageArt> = {};
  for (const entry of entries) {
    const src = sanityImageUrl(entry.image, ART_WIDTH);
    if (src && entry.image) art[entry.id] = { src, alt: entry.image.decorative ? "" : entry.image.alt };
  }
  return art;
}

interface RenderContext {
  content: LandingPageContent;
  links: LinkContext;
  leadForm?: ReactNode;
}

function renderSection(section: SectionConfig, { content, links, leadForm }: RenderContext): ReactNode {
  switch (section.id) {
    case "hero":
      return <Hero section={section} hero={content.hero} links={links} />;
    case "trust":
      return <TrustStrip section={section} trust={content.trust} />;
    case "promise":
      return <PromiseSection section={section} promise={content.promise} />;
    case "characters":
      return <Characters section={section} intro={content.charactersIntro} characters={content.characters} art={artById(content.characters)} />;
    case "episodes":
      return <Episodes section={section} intro={content.episodesIntro} episodes={content.episodes} art={artById(content.episodes)} />;
    case "offline":
      return <OfflineLoop section={section} offline={content.offline} />;
    case "pillars":
      return <Pillars section={section} intro={content.pillarsIntro} pillars={content.pillars} />;
    case "ecosystem":
      return <Ecosystem section={section} intro={content.ecosystemIntro} entries={content.ecosystem} links={links} />;
    case "testimonials":
      return <Testimonials section={section} intro={content.testimonialsIntro} testimonials={verifiedTestimonials(content)} />;
    case "lead":
      return <LeadCapture section={section} lead={content.lead} form={leadForm} />;
    case "faq":
      return <Faq section={section} intro={content.faqIntro} faqs={content.faqs} />;
    case "finalCta":
      return <FinalCta section={section} finalCta={content.finalCta} links={links} />;
  }
}

export interface SectionRendererProps {
  content: LandingPageContent;
  settings: SiteSettings;
  /** Slot for the founding-family form, rendered inside the lead section. */
  leadForm?: ReactNode;
}

/**
 * Renders the landing sections in CMS order, keyed by their Sanity section ids. Hidden sections,
 * sections with nothing to show, and testimonials without the setting and a verified entry are left out.
 */
export function SectionRenderer({ content, settings, leadForm }: SectionRendererProps) {
  const sections = renderableSections(content, settings);
  const context: RenderContext = { content, links: linkContext(sections, settings), leadForm };
  return sections.map((section) => <Fragment key={section.id}>{renderSection(section, context)}</Fragment>);
}
