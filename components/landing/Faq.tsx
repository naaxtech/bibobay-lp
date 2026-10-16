import type { FaqItem, SectionConfig, SectionIntro } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

/** A cut-paper plus that turns into a cross while its answer is open. */
function ToggleMark() {
  return (
    <svg className="faq-item__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.5V19.5M4.5 12H19.5" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export interface FaqProps {
  section: SectionConfig;
  intro: SectionIntro;
  faqs: FaqItem[];
  /** The section's own CMS image: a paper print under the sticky heading. */
  introArt?: StageArt;
}

/**
 * Questions as native disclosures: the browser owns the expanded state, so it is always exposed
 * correctly, and every answer is in the server HTML and opens without JavaScript.
 */
export function Faq({ section, intro, faqs, introArt }: FaqProps) {
  return (
    <SectionShell section={section} headingId="faq-heading" className="py-section">
      <div className="landing-container grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:sticky lg:top-[calc(var(--site-header-height)+2rem)] lg:col-span-4 lg:self-start">
          {intro.eyebrow ? <Tape>{intro.eyebrow}</Tape> : null}
          <h2 id="faq-heading" className="mt-4 max-w-[14ch] font-display text-h2 font-semibold">
            {intro.heading}
          </h2>
          {intro.description ? <p className="mt-4 max-w-[36ch] text-(--ink-soft)">{intro.description}</p> : null}
          {introArt ? <CmsArt frame="print" art={introArt} sizes="(min-width: 64rem) 16rem, 70vw" className="mt-8 max-w-[16rem]" /> : null}
        </div>
        <div className="faq-list lg:col-span-7 lg:col-start-6">
          {faqs.map((faq, index) => (
            <details key={faq.id} className="faq-item" open={index === 0}>
              <summary className="faq-item__question">
                {faq.question}
                <ToggleMark />
              </summary>
              <div className="faq-item__answer">
                <p>{faq.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
