import { BayBackdrop } from "@/components/brand/BayBackdrop";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { SectionShell } from "./SectionShell";
import { isReachable, type LinkContext } from "./sections";

export interface HeroProps {
  section: SectionConfig;
  hero: LandingPageContent["hero"];
  links: LinkContext;
}

/**
 * Asymmetric opening: the promise in large type on the left, the Bay as a die-cut paper postcard
 * on the right, captioned with the CMS greeting. The artwork is named by its CMS description.
 */
export function Hero({ section, hero, links }: HeroProps) {
  const primary = isReachable(hero.primaryCta.href, links) ? hero.primaryCta : null;
  const secondary = isReachable(hero.secondaryCta.href, links) ? hero.secondaryCta : null;
  return (
    <SectionShell section={section} headingId="hero-heading" className="overflow-x-clip" bay="drift">
      <div className="landing-container grid items-center gap-x-10 gap-y-14 pb-section pt-10 sm:pt-14 lg:min-h-[calc(100svh-var(--site-header-height))] lg:grid-cols-12 lg:py-16">
        <div className="lg:col-span-6">
          <h1 id="hero-heading" className="max-w-[12ch] font-display text-display font-semibold tracking-[-0.015em]">
            {hero.title}
          </h1>
          <p className="mt-6 max-w-[36ch] text-lead text-(--ink-soft)">{hero.description}</p>
          {primary || secondary ? (
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              {primary ? <CtaLink cta={primary} variant="primary" /> : null}
              {secondary ? <CtaLink cta={secondary} variant="paper" /> : null}
            </div>
          ) : null}
        </div>
        <figure className="hero-postcard lg:col-span-6 lg:col-start-7">
          {hero.eyebrow ? <figcaption className="paper-tape hero-postcard__label">{hero.eyebrow}</figcaption> : null}
          <div className="hero-postcard__art" role="img" aria-label={hero.artworkDescription}>
            <BayBackdrop className="absolute inset-0" />
          </div>
        </figure>
      </div>
    </SectionShell>
  );
}
