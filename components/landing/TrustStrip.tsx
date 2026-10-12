import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

export interface TrustStripProps {
  section: SectionConfig;
  trust: LandingPageContent["trust"];
  /** The section's CMS image: a round die-cut sticker on the band, beside the heading. */
  art?: StageArt;
}

/**
 * A single strip of masking tape across the page: how BIBO works, as plain principles set in a
 * row and parted by hand-drawn rules, not cards and not bullet dots.
 */
export function TrustStrip({ section, trust, art }: TrustStripProps) {
  return (
    <SectionShell section={section} headingId="trust-heading" className="overflow-x-clip py-8 sm:py-12">
      <div className="trust-band">
        <div className="landing-container flex flex-col gap-5 py-7 lg:flex-row lg:items-center lg:gap-12 lg:py-8">
          <div className={art ? "flex shrink-0 items-center gap-5 lg:w-[22rem]" : "shrink-0 lg:w-[15rem]"}>
            {art ? <CmsArt frame="sticker" art={art} sizes="6rem" /> : null}
            <div>
              {trust.eyebrow ? <Tape>{trust.eyebrow}</Tape> : null}
              <h2 id="trust-heading" className="mt-3 font-display text-h3 font-semibold">
                {trust.heading}
              </h2>
            </div>
          </div>
          <ul className="trust-list lg:flex-1">
            {trust.items.map((item, index) => (
              <li key={index} className="trust-list__item">
                {item}
              </li>
            ))}
          </ul>
          {trust.description ? (
            <p className="max-w-[24ch] font-display text-lead font-medium lg:text-end">{trust.description}</p>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
