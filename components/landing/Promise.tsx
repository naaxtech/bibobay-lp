import { brandTokens } from "@/lib/brand/tokens";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { PortableText } from "./PortableText";
import { SectionShell, Tape } from "./SectionShell";

const { color } = brandTokens;

/** A chunky cut-paper opening quote mark, drawn in the section accent. */
function PaperQuoteMark() {
  const comma = "M30 94C14 94 4 82 4 66C4 44 18 22 42 8L50 18C38 28 32 38 31 46C33 45.5 35 45 38 45C52 45 60 55 60 69C60 84 47 94 30 94Z";
  return (
    <svg className="promise-quote-mark" viewBox="0 0 132 100" aria-hidden="true" focusable="false">
      {[0, 66].map((x) => (
        <g key={x} transform={`translate(${x} 0)`}>
          <path d={comma} transform="translate(4 6)" fill={color.navy} fillOpacity={0.1} />
          <path d={comma} className="promise-quote-mark__piece" />
        </g>
      ))}
    </svg>
  );
}

/** The sun dot and three rays of the logo's "i", used as a signature mark. */
function SunRays() {
  return (
    <svg className="sun-rays" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <g strokeWidth={5} strokeLinecap="round">
        <path d="M9 18L15 24" stroke={color.orange} />
        <path d="M24 5V13" stroke={color.amber} />
        <path d="M39 18L33 24" stroke={color.teal} />
      </g>
      <circle cx={24} cy={34} r={10} fill={color.yellow} />
    </svg>
  );
}

export interface PromiseProps {
  section: SectionConfig;
  promise: LandingPageContent["promise"];
}

/**
 * The promise as a large pull quote beside a short philosophy, signed with the brand idea.
 * (Named PromiseSection so it never shadows the global Promise where it is imported.)
 */
export function PromiseSection({ section, promise }: PromiseProps) {
  return (
    <SectionShell section={section} headingId="promise-heading" className="py-section">
      <div className="landing-container grid gap-x-10 gap-y-10 lg:grid-cols-12">
        <div className="relative lg:col-span-7">
          {promise.eyebrow ? <Tape>{promise.eyebrow}</Tape> : null}
          <PaperQuoteMark />
          <h2 id="promise-heading" className="relative max-w-[13ch] font-display text-h1 font-semibold">
            {promise.heading}
          </h2>
        </div>
        <div className="lg:col-span-5 lg:pt-28">
          {promise.description ? <p className="max-w-[44ch] text-lead">{promise.description}</p> : null}
          <PortableText value={promise.body} headingLevel={3} className="prose-paper mt-6 max-w-[60ch] text-(--ink-soft)" />
          {promise.quote ? (
            <p className="mt-10 flex items-center gap-4 font-display text-h3 font-semibold">
              <SunRays />
              <span>{promise.quote}</span>
            </p>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
