import { BayBackdrop } from "@/components/brand/BayBackdrop";
import { ReefBackdrop } from "@/components/brand/ReefBackdrop";
import { stegaCleanText } from "@/lib/content/stega";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { ArtImage } from "./CmsArt";
import { CtaLink } from "./CtaLink";
import { SectionShell } from "./SectionShell";
import { isReachable, sectionTheme, type LinkContext, type StageArt } from "./sections";

export interface HeroProps {
  section: SectionConfig;
  hero: LandingPageContent["hero"];
  links: LinkContext;
  /**
   * The hero art, resolved on the server: the CMS image, else the channel's own trio (ruling R58).
   * The illustrated Bay, named by the CMS artwork description, stands in only if neither exists.
   */
  art?: StageArt;
  /** The next section is printed on sand, so the reef's front dune runs on into it. */
  meetsSand?: boolean;
}

/**
 * The headline split into its sentences, one per line in the logo's inks (teal, orange, purple),
 * like the channel's own tagline card. The words and spaces are the CMS title's, so the heading
 * reads exactly as written.
 */
function HeroTitle({ title }: { title: string }) {
  const sentences = title.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return <>{title}</>;
  return (
    <>
      {sentences.map((sentence, index) => (
        <span key={index} className="hero-title__line" data-ink={index % 3}>
          {index > 0 ? " " : null}
          {sentence}
        </span>
      ))}
    </>
  );
}

/**
 * Asymmetric opening in the sunlit water of the Bay: the promise in large type on the left, the
 * friends on the reef in a white-bordered window on the right, captioned with the CMS greeting.
 * Sunbeams, bubbles and the sandy floor are drawn behind (decorative); the sand meets the section
 * below. The opening keeps its natural height, so the promise, both CTAs and the friends share the
 * first viewport.
 */
export function Hero({ section, hero, links, art, meetsSand = false }: HeroProps) {
  const primary = isReachable(hero.primaryCta.href, links) ? hero.primaryCta : null;
  const secondary = isReachable(hero.secondaryCta.href, links) ? hero.secondaryCta : null;
  // The reef is the sea ground's own scenery: a hero an editor prints on another ground gets none.
  const underwater = sectionTheme(section).background === "sea";
  return (
    <SectionShell section={section} headingId="hero-heading" className="hero overflow-x-clip" bay={underwater ? "drift" : undefined}>
      {underwater ? <ReefBackdrop className="hero__reef" frontDune={meetsSand} /> : null}
      <div className="landing-container hero__grid">
        <div className="hero__copy">
          <h1 id="hero-heading" className="hero-title font-display font-semibold">
            <HeroTitle title={hero.title} />
          </h1>
          <p className="hero__lead">{hero.description}</p>
          {primary || secondary ? (
            <div className="hero__ctas">
              {primary ? <CtaLink cta={primary} variant="primary" /> : null}
              {secondary ? <CtaLink cta={secondary} variant="paper" /> : null}
            </div>
          ) : null}
        </div>
        <figure className="hero-postcard">
          {hero.eyebrow ? <figcaption className="hero-postcard__label">{hero.eyebrow}</figcaption> : null}
          {art ? (
            <div className="hero-postcard__art">
              <ArtImage art={art} sizes="(min-width: 80rem) 44rem, (min-width: 64rem) 56vw, 100vw" priority />
            </div>
          ) : (
            <div className="hero-postcard__art" role="img" aria-label={stegaCleanText(hero.artworkDescription)}>
              <BayBackdrop className="absolute inset-0" />
            </div>
          )}
        </figure>
      </div>
    </SectionShell>
  );
}
