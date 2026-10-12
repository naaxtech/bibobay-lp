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
import { artPosition, linkContext, renderableSections, verifiedTestimonials, type LinkContext, type StageArt } from "./sections";
import { Testimonials } from "./Testimonials";
import { TrustStrip } from "./TrustStrip";

/**
 * Pixel widths art is requested at: about twice the largest width its frame renders, so it stays
 * sharp on a 2x screen. Stage: the hero postcard, friend stages, story covers, the closing image.
 * Print: a section's own art beside its heading. Thumb: a small print beside a value or an index entry.
 */
const ART_WIDTH = { stage: 1200, print: 800, thumb: 240 } as const;
type ArtSize = keyof typeof ART_WIDTH;

/** Approved Sanity art resolved on the server; without a usable asset (or Sanity) there is none and the placeholder stays. */
function resolveArt(image: ImageWithAlt | undefined, size: ArtSize): StageArt | undefined {
  const src = sanityImageUrl(image, ART_WIDTH[size]);
  if (!src || !image) return undefined;
  const position = artPosition(image);
  return { src, alt: image.decorative ? "" : image.alt, ...(position ? { position } : {}) };
}

/** Art for each entry of a collection that has some, by entry id. */
function artById(entries: ReadonlyArray<{ id: string; image?: ImageWithAlt }>, size: ArtSize = "stage"): Record<string, StageArt> {
  const art: Record<string, StageArt> = {};
  for (const entry of entries) {
    const resolved = resolveArt(entry.image, size);
    if (resolved) art[entry.id] = resolved;
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
      return <Hero section={section} hero={content.hero} links={links} art={resolveArt(content.hero.image, "stage")} />;
    case "trust":
      return <TrustStrip section={section} trust={content.trust} art={resolveArt(content.trust.image, "thumb")} />;
    case "promise":
      return <PromiseSection section={section} promise={content.promise} art={resolveArt(content.promise.image, "print")} />;
    case "characters":
      return (
        <Characters
          section={section}
          intro={content.charactersIntro}
          characters={content.characters}
          art={artById(content.characters)}
          introArt={resolveArt(content.charactersIntro.image, "print")}
        />
      );
    case "episodes":
      return (
        <Episodes
          section={section}
          intro={content.episodesIntro}
          episodes={content.episodes}
          art={artById(content.episodes)}
          introArt={resolveArt(content.episodesIntro.image, "print")}
        />
      );
    case "offline":
      return <OfflineLoop section={section} offline={content.offline} art={resolveArt(content.offline.image, "print")} />;
    case "pillars":
      return (
        <Pillars
          section={section}
          intro={content.pillarsIntro}
          pillars={content.pillars}
          art={artById(content.pillars, "thumb")}
          introArt={resolveArt(content.pillarsIntro.image, "print")}
        />
      );
    case "ecosystem":
      return (
        <Ecosystem
          section={section}
          intro={content.ecosystemIntro}
          entries={content.ecosystem}
          links={links}
          art={artById(content.ecosystem, "thumb")}
          introArt={resolveArt(content.ecosystemIntro.image, "print")}
        />
      );
    case "testimonials":
      return (
        <Testimonials
          section={section}
          intro={content.testimonialsIntro}
          testimonials={verifiedTestimonials(content)}
          introArt={resolveArt(content.testimonialsIntro.image, "print")}
        />
      );
    case "lead":
      return <LeadCapture section={section} lead={content.lead} form={leadForm} art={resolveArt(content.lead.image, "print")} />;
    case "faq":
      return <Faq section={section} intro={content.faqIntro} faqs={content.faqs} introArt={resolveArt(content.faqIntro.image, "print")} />;
    case "finalCta":
      return <FinalCta section={section} finalCta={content.finalCta} links={links} art={resolveArt(content.finalCta.image, "stage")} />;
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
