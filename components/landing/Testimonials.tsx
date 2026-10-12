import type { SectionConfig, SectionIntro, Testimonial } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

export interface TestimonialsProps {
  section: SectionConfig;
  intro: SectionIntro;
  /** Verified entries only; the renderer never passes anything else. */
  testimonials: Testimonial[];
  /** The section's own CMS image: a paper print beside the heading (never a portrait of a family). */
  introArt?: StageArt;
}

/**
 * Family voices, pinned up as paper notes. Rendered only when the site setting is on and an
 * editor has verified at least one entry; no photography of families, no counts, no invented attribution.
 */
export function Testimonials({ section, intro, testimonials, introArt }: TestimonialsProps) {
  return (
    <SectionShell section={section} headingId="testimonials-heading" className="py-section">
      <div className="landing-container">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="max-w-[44rem] lg:col-span-8">
            {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
            <h2 id="testimonials-heading" className="mt-4 font-display text-h2 font-semibold">
              {intro.heading}
            </h2>
            {intro.description ? <p className="mt-4 max-w-[46ch] text-(--ink-soft)">{intro.description}</p> : null}
          </div>
          {introArt ? (
            <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 18rem, 90vw" className="max-w-[18rem] lg:col-span-4 lg:col-start-9" />
          ) : null}
        </div>
        <ul className="voice-notes mt-12">
          {testimonials
            .filter((entry) => entry.verified === true)
            .map((entry) => (
              <li key={entry.id}>
                <figure className="voice-note">
                  <blockquote>
                    <p>{entry.quote}</p>
                  </blockquote>
                  <figcaption className="voice-note__attribution">{entry.attribution}</figcaption>
                </figure>
              </li>
            ))}
        </ul>
      </div>
    </SectionShell>
  );
}
