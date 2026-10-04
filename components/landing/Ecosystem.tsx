import type { EcosystemEntry, SectionConfig, SectionIntro } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { SectionShell, Tape } from "./SectionShell";
import { isReachable, type LinkContext } from "./sections";
import { UI_COPY } from "./ui-copy";

export interface EcosystemProps {
  section: SectionConfig;
  intro: SectionIntro;
  entries: EcosystemEntry[];
  links: LinkContext;
}

/**
 * The wider BIBO world as an index, each envisioned place tagged with its true status from the
 * CMS. A link appears only for a place the CMS marks available, and never into a disabled shop.
 */
export function Ecosystem({ section, intro, entries, links }: EcosystemProps) {
  return (
    <SectionShell section={section} headingId="ecosystem-heading" className="py-section">
      <div className="landing-container">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-6">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="ecosystem-heading" className="mt-4 font-display text-h2 font-semibold">
              {intro.heading}
            </h2>
          </div>
          {intro.description ? (
            <p className="max-w-[48ch] text-(--ink-soft) lg:col-span-5 lg:col-start-8">{intro.description}</p>
          ) : null}
        </div>
        <ul className="eco-index mt-12 lg:mt-16">
          {entries.map((entry) => {
            const cta = entry.status === "available" && entry.cta && isReachable(entry.cta.href, links) ? entry.cta : null;
            return (
              <li key={entry.id} className="eco-entry">
                <div className="eco-entry__line">
                  <h3 className="eco-entry__name">{entry.name}</h3>
                  <span className="eco-entry__leader" aria-hidden="true" />
                  <span className="eco-status" data-status={entry.status}>
                    {UI_COPY.ecosystemStatus[entry.status]}
                  </span>
                </div>
                {entry.tagline ? <p className="eco-entry__tagline">{entry.tagline}</p> : null}
                {entry.description ? <p className="eco-entry__description">{entry.description}</p> : null}
                {cta ? <CtaLink cta={cta} variant="text" className="mt-2 inline-block" /> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </SectionShell>
  );
}
