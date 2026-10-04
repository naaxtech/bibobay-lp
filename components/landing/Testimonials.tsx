import type { SectionConfig, SectionIntro, Testimonial } from "@/lib/content/types";
import { SectionShell, Tape } from "./SectionShell";

export interface TestimonialsProps {
  section: SectionConfig;
  intro: SectionIntro;
  /** Verified entries only; the renderer never passes anything else. */
  testimonials: Testimonial[];
}

/**
 * Family voices, pinned up as paper notes. Rendered only when the site setting is on and an
 * editor has verified at least one entry; no photography, no counts, no invented attribution.
 */
export function Testimonials({ section, intro, testimonials }: TestimonialsProps) {
  return (
    <SectionShell section={section} headingId="testimonials-heading" className="py-section">
      <div className="landing-container">
        <div className="max-w-[44rem]">
          {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
          <h2 id="testimonials-heading" className="mt-4 font-display text-h2 font-semibold">
            {intro.heading}
          </h2>
          {intro.description ? <p className="mt-4 max-w-[46ch] text-(--ink-soft)">{intro.description}</p> : null}
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
