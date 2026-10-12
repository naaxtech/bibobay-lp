import { BayBackdrop } from "@/components/brand/BayBackdrop";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { ArtImage } from "./CmsArt";
import { CtaLink } from "./CtaLink";
import { SectionShell } from "./SectionShell";
import { isReachable, type LinkContext, type StageArt } from "./sections";

export interface HeroProps {
  section: SectionConfig;
  hero: LandingPageContent["hero"];
  links: LinkContext;
  /** The CMS hero image, resolved on the server: it takes the postcard in place of the illustrated Bay. */
  art?: StageArt;
}

/**
 * Asymmetric opening: the promise in large type on the left, the Bay as a die-cut paper postcard
 * on the right, captioned with the CMS greeting. The illustrated Bay is named by its CMS
 * description; an approved CMS image replaces it, carries its own alt text and loads first.
 * The headline is sized to sit on two lines on a desktop screen and the opening keeps its natural
 * height, so the promise, both CTAs and the Bay share the first viewport with no floating gap.
 */
export function Hero({ section, hero, links, art }: HeroProps) {
  const primary = isReachable(hero.primaryCta.href, links) ? hero.primaryCta : null;
  const secondary = isReachable(hero.secondaryCta.href, links) ? hero.secondaryCta : null;
  return (
    <SectionShell section={section} headingId="hero-heading" className="overflow-x-clip" bay={art ? undefined : "drift"}>
      <div className="landing-container grid items-center gap-x-10 gap-y-12 pb-section pt-10 sm:pt-14 lg:grid-cols-12 lg:pb-24 lg:pt-16">
        <div className="lg:col-span-7">
          <h1 id="hero-heading" className="hero-title font-display font-semibold">
            {hero.title}
          </h1>
          <p className="mt-6 max-w-[38ch] text-lead text-(--ink-soft)">{hero.description}</p>
          {primary || secondary ? (
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              {primary ? <CtaLink cta={primary} variant="primary" /> : null}
              {secondary ? <CtaLink cta={secondary} variant="paper" /> : null}
            </div>
          ) : null}
        </div>
        <figure className="hero-postcard lg:col-span-5 lg:col-start-8">
          {hero.eyebrow ? <figcaption className="paper-tape hero-postcard__label">{hero.eyebrow}</figcaption> : null}
          {art ? (
            <div className="hero-postcard__art">
              <ArtImage art={art} sizes="(min-width: 80rem) 30rem, (min-width: 64rem) 40vw, 100vw" priority />
            </div>
          ) : (
            <div className="hero-postcard__art" role="img" aria-label={hero.artworkDescription}>
              <BayBackdrop className="absolute inset-0" />
            </div>
          )}
        </figure>
      </div>
    </SectionShell>
  );
}
