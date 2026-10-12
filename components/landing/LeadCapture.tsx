import type { ReactNode } from "react";

import { brandTokens } from "@/lib/brand/tokens";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { PaperEdge, SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

const { color } = brandTokens;

const COVE_SHAPES = [
  { d: "M-20 96C160 80 330 88 500 98C670 108 830 92 1000 86C1170 80 1310 90 1460 98V200H-20Z", fill: color.ocean },
  { d: "M-20 132C190 120 380 128 560 136C740 144 920 128 1100 124C1250 121 1360 130 1460 136V200H-20Z", fill: color.teal },
  { d: "M700 200C800 162 950 140 1110 136C1250 132 1370 142 1460 152V200Z", fill: color.sand },
] as const;

/** A quiet cove: two shallow tides and a curl of sand at the foot of the section. Decorative. */
function Cove() {
  return (
    <svg className="lead-cove" viewBox="0 0 1440 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {COVE_SHAPES.map((shape) => (
        <g key={shape.d}>
          <path d={shape.d} transform="translate(6 9)" fill={color.navy} fillOpacity={0.08} />
          <path d={shape.d} fill={shape.fill} />
        </g>
      ))}
    </svg>
  );
}

export interface LeadCaptureProps {
  section: SectionConfig;
  lead: LandingPageContent["lead"];
  /**
   * The founding-family form (Task 5's LeadForm). This section never builds or imitates one and
   * never shows an outcome; with no form supplied it shows the CMS copy alone.
   */
  form?: ReactNode;
  /**
   * The section's CMS image: a paper print in the cove. It takes the form's column while there is
   * no form, and sits under the copy once Task 5's form fills that column.
   */
  art?: StageArt;
}

export function LeadCapture({ section, lead, form, art }: LeadCaptureProps) {
  const magnet = lead.leadMagnet?.available && lead.leadMagnet.fileUrl ? lead.leadMagnet : null;
  const artBeside = art && !form;
  return (
    <SectionShell section={section} headingId="lead-heading" className="relative overflow-x-clip pb-40 pt-16 sm:pb-48 sm:pt-24">
      <PaperEdge />
      <div className="landing-container relative z-[1] grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className={form ? "lg:col-span-6" : "lg:col-span-7"}>
          {lead.eyebrow ? <Tape>{lead.eyebrow}</Tape> : null}
          <h2 id="lead-heading" className="mt-4 max-w-[14ch] font-display text-h1 font-semibold">
            {lead.heading}
          </h2>
          {lead.description ? <p className="mt-5 max-w-[46ch] text-lead text-(--ink-soft)">{lead.description}</p> : null}
          {magnet ? (
            <p className="lead-magnet mt-8">
              <a href={magnet.fileUrl} className="text-link font-display text-lead font-semibold">
                {magnet.title}
              </a>
              {magnet.description ? <span className="mt-1 block text-(--ink-soft)">{magnet.description}</span> : null}
            </p>
          ) : null}
          {art && form ? <CmsArt frame="print" art={art} sizes="(min-width: 64rem) 20rem, 90vw" className="mt-10 max-w-[20rem]" /> : null}
        </div>
        {form ? <div className="lead-slot lg:col-span-5 lg:col-start-8">{form}</div> : null}
        {artBeside ? (
          <CmsArt frame="print" art={art} sizes="(min-width: 64rem) 22rem, 90vw" className="max-w-[22rem] lg:col-span-4 lg:col-start-9 lg:self-center" />
        ) : null}
      </div>
      <Cove />
    </SectionShell>
  );
}
