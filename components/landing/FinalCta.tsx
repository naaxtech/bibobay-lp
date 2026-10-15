import { BayBackdrop } from "@/components/brand/BayBackdrop";
import { ReefBackdrop } from "@/components/brand/ReefBackdrop";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { ArtImage } from "./CmsArt";
import { CtaLink } from "./CtaLink";
import { SectionShell, Tape } from "./SectionShell";
import { isReachable, type LinkContext, type StageArt } from "./sections";

export interface FinalCtaProps {
  section: SectionConfig;
  finalCta: LandingPageContent["finalCta"];
  links: LinkContext;
  /** The closing scene: the CMS image, else the channel's reef (ruling R58); without either, the drawn Bay horizon. */
  art?: StageArt;
}

/**
 * The close of the story: one invitation above the whole reef, the water the page began in.
 * Centred on purpose: it is the page's one closing invitation, and the scene beneath it runs edge
 * to edge. Bubbles and the sandy floor are drawn over the scene's foot and settle into place as it
 * scrolls in; the sand leads into the footer.
 */
export function FinalCta({ section, finalCta, links, art }: FinalCtaProps) {
  const cta = isReachable(finalCta.cta.href, links) ? finalCta.cta : null;
  return (
    <SectionShell section={section} headingId="finalCta-heading" className="overflow-x-clip pt-section" bay="settle">
      <div className="landing-container flex flex-col items-center text-center">
        {finalCta.eyebrow ? <Tape>{finalCta.eyebrow}</Tape> : null}
        <h2 id="finalCta-heading" className="mt-4 max-w-[16ch] font-display text-h1 font-semibold">
          {finalCta.heading}
        </h2>
        {finalCta.description ? <p className="mt-5 max-w-[40ch] text-lead text-(--ink-soft)">{finalCta.description}</p> : null}
        {cta ? <CtaLink cta={cta} variant="primary" className="mt-9" /> : null}
      </div>
      <div className={art ? "final-bay final-bay--art" : "final-bay"}>
        {art ? (
          <div className="final-bay__scene">
            <ArtImage art={art} sizes="100vw" />
          </div>
        ) : (
          <BayBackdrop className="absolute inset-0" />
        )}
        {art ? <ReefBackdrop className="final-bay__reef" /> : null}
      </div>
    </SectionShell>
  );
}
