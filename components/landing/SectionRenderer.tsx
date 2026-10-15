import { Fragment, type ReactNode } from "react";

import type { ImageWithAlt, LandingPageContent, SectionConfig, SiteSettings } from "@/lib/content/types";
import { BRAND_ART, friendArt, pillarArt, videoArt, type BrandArt } from "@/lib/content/brand-art";
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

/** Approved Sanity art resolved on the server; without a usable asset (or Sanity) there is none. */
function resolveArt(image: ImageWithAlt | undefined, size: ArtSize): StageArt | undefined {
  const src = sanityImageUrl(image, ART_WIDTH[size]);
  if (!src || !image) return undefined;
  const position = artPosition(image);
  return { src, alt: image.decorative ? "" : image.alt, ...(position ? { position } : {}) };
}

/** Repository brand art for a slot the CMS leaves empty (ruling R58); `alt` overrides the still's own. */
function brandArt(art: BrandArt | undefined, alt?: string): StageArt | undefined {
  if (!art) return undefined;
  return { src: art.src, srcSet: art.srcSet, alt: alt ?? art.alt, ...(art.position ? { position: art.position } : {}) };
}

/** A slot's art: the editor's image, else the repository's, else none (the drawn placeholder stays). */
function slotArt(image: ImageWithAlt | undefined, size: ArtSize, fallback: BrandArt | undefined, alt?: string): StageArt | undefined {
  return resolveArt(image, size) ?? brandArt(fallback, alt);
}

/** Art for each entry of a collection that has some, by entry id. */
function artById<T extends { id: string; image?: ImageWithAlt }>(
  entries: readonly T[],
  size: ArtSize = "stage",
  fallback: (entry: T) => BrandArt | undefined = () => undefined,
): Record<string, StageArt> {
  const art: Record<string, StageArt> = {};
  for (const entry of entries) {
    const resolved = slotArt(entry.image, size, fallback(entry));
    if (resolved) art[entry.id] = resolved;
  }
  return art;
}

const SCENES = BRAND_ART.sections;

interface RenderContext {
  content: LandingPageContent;
  links: LinkContext;
  leadForm?: ReactNode;
}

function renderSection(section: SectionConfig, { content, links, leadForm }: RenderContext): ReactNode {
  switch (section.id) {
    case "hero":
      return <Hero section={section} hero={content.hero} links={links} art={slotArt(content.hero.image, "stage", SCENES.hero, content.hero.artworkDescription || undefined)} />;
    case "trust":
      return <TrustStrip section={section} trust={content.trust} art={resolveArt(content.trust.image, "thumb")} />;
    case "promise":
      return <PromiseSection section={section} promise={content.promise} art={slotArt(content.promise.image, "print", SCENES.promise)} />;
    case "characters":
      return (
        <Characters
          section={section}
          intro={content.charactersIntro}
          characters={content.characters}
          art={artById(content.characters, "stage", friendArt)}
          introArt={resolveArt(content.charactersIntro.image, "print")}
        />
      );
    case "episodes":
      return (
        <Episodes
          section={section}
          intro={content.episodesIntro}
          episodes={content.episodes}
          art={artById(content.episodes, "stage", (episode) => videoArt(episode.mediaUrl))}
          introArt={resolveArt(content.episodesIntro.image, "print")}
        />
      );
    case "offline":
      return <OfflineLoop section={section} offline={content.offline} art={slotArt(content.offline.image, "print", SCENES.offline)} />;
    case "pillars":
      return (
        <Pillars
          section={section}
          intro={content.pillarsIntro}
          pillars={content.pillars}
          art={artById(content.pillars, "thumb", pillarArt)}
          introArt={slotArt(content.pillarsIntro.image, "print", SCENES.pillars)}
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
      return <LeadCapture section={section} lead={content.lead} form={leadForm} art={slotArt(content.lead.image, "print", SCENES.lead)} />;
    case "faq":
      return <Faq section={section} intro={content.faqIntro} faqs={content.faqs} introArt={resolveArt(content.faqIntro.image, "print")} />;
    case "finalCta":
      return <FinalCta section={section} finalCta={content.finalCta} links={links} art={slotArt(content.finalCta.image, "stage", SCENES.finalCta)} />;
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
