import type { EcosystemEntry, SectionConfig, SectionIntro } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { CtaLink } from "./CtaLink";
import { SectionShell, Tape } from "./SectionShell";
import { isReachable, type LinkContext, type StageArt } from "./sections";
import { UI_COPY } from "./ui-copy";

export interface EcosystemProps {
  section: SectionConfig;
  intro: SectionIntro;
  entries: EcosystemEntry[];
  links: LinkContext;
  /** Approved Sanity art by entry id: a small print beside that entry. */
  art: Readonly<Record<string, StageArt>>;
  /** The section's own CMS image: a paper print beside the heading. */
  introArt?: StageArt;
}

/**
 * The wider BIBO world as an index, each envisioned place tagged with its true status from the
 * CMS. A link appears only for a place the CMS marks available, and never into a disabled shop.
 * The heading and its caveat read as one stacked block, the caveat directly under the heading.
 */
export function Ecosystem({ section, intro, entries, links, art, introArt }: EcosystemProps) {
  return (
    <SectionShell section={section} headingId="ecosystem-heading" className="py-section">
      <div className="landing-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="ecosystem-heading" className="mt-4 font-display text-h2 font-semibold">
              {intro.heading}
            </h2>
            {intro.description ? <p className="mt-4 max-w-[52ch] text-(--ink-soft)">{intro.description}</p> : null}
          </div>
          {introArt ? (
            <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 20rem, 90vw" className="max-w-[20rem] lg:col-span-4 lg:col-start-9" />
          ) : null}
        </div>
        <ul className="eco-index mt-12 lg:mt-16">
          {entries.map((entry) => {
            const cta = entry.status === "available" && entry.cta && isReachable(entry.cta.href, links) ? entry.cta : null;
            const entryArt = art[entry.id];
            return (
              <li key={entry.id} className="eco-entry" data-art={entryArt ? "" : undefined}>
                {entryArt ? <CmsArt frame="thumb" art={entryArt} sizes="5rem" className="eco-entry__art" /> : null}
                <div className="eco-entry__text">
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
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionShell>
  );
}
