import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { SectionShell, Tape } from "./SectionShell";

export interface TrustStripProps {
  section: SectionConfig;
  trust: LandingPageContent["trust"];
}

/** A single strip of masking tape across the page: how BIBO works, as plain principles, not cards. */
export function TrustStrip({ section, trust }: TrustStripProps) {
  return (
    <SectionShell section={section} headingId="trust-heading" className="overflow-x-clip py-8 sm:py-12">
      <div className="trust-band">
        <div className="landing-container flex flex-col gap-5 py-7 lg:flex-row lg:items-center lg:gap-12 lg:py-8">
          <div className="shrink-0 lg:w-[15rem]">
            {trust.eyebrow ? <Tape>{trust.eyebrow}</Tape> : null}
            <h2 id="trust-heading" className="mt-3 font-display text-h3 font-semibold">
              {trust.heading}
            </h2>
          </div>
          <ul className="trust-list flex flex-wrap gap-x-8 gap-y-3 lg:flex-1">
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
