import { BayBackdrop } from "@/components/brand/BayBackdrop";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { SectionShell, Tape } from "./SectionShell";
import { isReachable, type LinkContext } from "./sections";

export interface FinalCtaProps {
  section: SectionConfig;
  finalCta: LandingPageContent["finalCta"];
  links: LinkContext;
}

/** The close of the story: one invitation above the whole Bay, the horizon the page began with. */
export function FinalCta({ section, finalCta, links }: FinalCtaProps) {
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
      <div className="final-bay">
        <BayBackdrop className="absolute inset-0" />
      </div>
    </SectionShell>
  );
}
