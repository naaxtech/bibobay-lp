import type { BrandPillar, SectionConfig, SectionIntro } from "@/lib/content/types";
import { SectionShell, Tape } from "./SectionShell";

export interface PillarsProps {
  section: SectionConfig;
  intro: SectionIntro;
  pillars: BrandPillar[];
}

/**
 * What children can practise, as a staggered typographic list: each value set large, its meaning
 * and a few conversation starters beside it. Not a grid of equal feature cards.
 */
export function Pillars({ section, intro, pillars }: PillarsProps) {
  return (
    <SectionShell section={section} headingId="pillars-heading" className="overflow-x-clip py-section">
      <div className="landing-container">
        <div className="max-w-[44rem]">
          {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
          <h2 id="pillars-heading" className="mt-4 font-display text-h1 font-semibold">
            {intro.heading}
          </h2>
          {intro.description ? <p className="mt-5 max-w-[46ch] text-lead text-(--ink-soft)">{intro.description}</p> : null}
        </div>
        <ul className="pillar-list mt-12 lg:mt-16">
          {pillars.map((pillar) => (
            <li key={pillar.id} className="pillar">
              <h3 className="pillar__title">{pillar.title}</h3>
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
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}
