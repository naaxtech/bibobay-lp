import type { BrandPillar, SectionConfig, SectionIntro } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

export interface PillarsProps {
  section: SectionConfig;
  intro: SectionIntro;
  pillars: BrandPillar[];
  /** Approved Sanity art by value id: a small print beside that value's name. */
  art: Readonly<Record<string, StageArt>>;
  /** The section's own CMS image: a paper print beside the heading. */
  introArt?: StageArt;
}

/**
 * What children can practise, as a staggered typographic list: each value set large, its meaning
 * and a few conversation starters beside it. Not a grid of equal feature cards. A value with
 * approved art shows it as a small print in place of its paper cut-out mark.
 */
export function Pillars({ section, intro, pillars, art, introArt }: PillarsProps) {
  return (
    <SectionShell section={section} headingId="pillars-heading" className="overflow-x-clip py-section">
      <div className="landing-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="max-w-[44rem] lg:col-span-8">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="pillars-heading" className="mt-4 font-display text-h1 font-semibold">
              {intro.heading}
            </h2>
            {intro.description ? <p className="mt-5 max-w-[46ch] text-lead text-(--ink-soft)">{intro.description}</p> : null}
          </div>
          {introArt ? (
            <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 20rem, 90vw" className="max-w-[20rem] lg:col-span-4 lg:col-start-9" />
          ) : null}
        </div>
        <ul className="pillar-list mt-12 lg:mt-16">
          {pillars.map((pillar) => {
            const pillarArt = art[pillar.id];
            return (
              <li key={pillar.id} className="pillar" data-art={pillarArt ? "" : undefined}>
                <div className="pillar__head">
                  {pillarArt ? <CmsArt frame="thumb" art={pillarArt} sizes="5rem" /> : null}
                  <h3 className="pillar__title">
                    <span className="pillar__ink">{pillar.title}</span>
                  </h3>
                </div>
                <div className="pillar__body">
                  {pillar.description ? <p>{pillar.description}</p> : null}
                  {pillar.prompts.length > 0 ? (
                    <ul className="pillar__prompts">
                      {pillar.prompts.map((prompt, index) => (
                        <li key={index}>{prompt}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionShell>
  );
}
