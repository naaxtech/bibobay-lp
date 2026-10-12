import type { CSSProperties } from "react";

import { brandTokens } from "@/lib/brand/tokens";
import type { LandingPageContent, SectionConfig } from "@/lib/content/types";
import { CmsArt } from "./CmsArt";
import { SectionShell, Tape } from "./SectionShell";
import type { StageArt } from "./sections";

const { color } = brandTokens;

/** A hand-drawn loop around the diagram's centre (viewBox 0 0 400 400). */
const LOOP_PATH = "M200 46C288 44 356 112 354 200C352 290 286 356 198 354C112 352 44 286 46 198C48 112 114 48 200 46Z";
const LOOP_RADIUS = 154;
const STEP_COLORS = [color.teal, color.yellow, color.orange, color.purple, color.ocean, color.seagrass] as const;

/** Clockwise from twelve o'clock, so the static order reads like the loop it is. */
function stepAngle(index: number, count: number) {
  return -Math.PI / 2 + (index * 2 * Math.PI) / count;
}

/** How far round the loop (0 to 1, clockwise from twelve o'clock, where the path starts) a mark sits; motion draws it in then. */
const loopAt = (turns: number, count: number) => (turns / count).toFixed(3);

const stepColor = (index: number) => STEP_COLORS[index % STEP_COLORS.length]!;
const colorStyle = (value: string) => ({ "--step-color": value }) as CSSProperties;

export interface OfflineLoopProps {
  section: SectionConfig;
  offline: LandingPageContent["offline"];
  /** The section's CMS image: a round cut-out at the heart of the loop, in place of the paper sun. */
  art?: StageArt;
}

/**
 * From screen to real life: the steps as an ordered list (the readable source of truth) beside a
 * decorative loop that carries them round and back to the start. Motion may draw the path later;
 * it is fully drawn without it. The loop's marks repeat the list, so they are hidden from
 * assistive technology; a CMS image at its centre is real content and keeps its alt text.
 */
export function OfflineLoop({ section, offline, art }: OfflineLoopProps) {
  const count = offline.steps.length;
  return (
    <SectionShell section={section} headingId="offline-heading" className="overflow-x-clip py-section">
      <div className="landing-container grid gap-x-12 gap-y-10 lg:grid-cols-12">
        <div className="lg:col-span-6">
          {offline.eyebrow ? <Tape>{offline.eyebrow}</Tape> : null}
          <h2 id="offline-heading" className="mt-4 max-w-[12ch] font-display text-h1 font-semibold">
            {offline.heading}
          </h2>
          {offline.description ? <p className="mt-5 max-w-[42ch] text-lead text-(--ink-soft)">{offline.description}</p> : null}
        </div>

        <div className="loop-diagram lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:self-center">
          <svg className="loop-diagram__drawing" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
            {art ? null : (
              <>
                <circle cx={204} cy={206} r={58} fill={color.navy} fillOpacity={0.08} />
                <circle cx={200} cy={200} r={58} fill={color.yellow} />
              </>
            )}
            <path d={LOOP_PATH} transform="translate(3 5)" fill="none" stroke={color.navy} strokeOpacity={0.1} strokeWidth={10} />
            {/* pathLength 1 lets motion draw the loop by its share of the way round; it changes nothing static. */}
            <path data-loop-path pathLength={1} d={LOOP_PATH} fill="none" stroke={color.navy} strokeWidth={4} strokeLinecap="round" />
            {offline.steps.map((step, index) => {
              const angle = stepAngle(index, count) + Math.PI / count;
              const x = 200 + LOOP_RADIUS * Math.cos(angle);
              const y = 200 + LOOP_RADIUS * Math.sin(angle);
              return (
                <path
                  key={`arrow-${index}`}
                  data-loop-at={loopAt(index + 0.5, count)}
                  d="M-7 -9L5 0L-7 9"
                  transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((angle * 180) / Math.PI + 90).toFixed(1)})`}
                  fill="none"
                  stroke={color.navy}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </svg>
          {offline.steps.map((step, index) => {
            const angle = stepAngle(index, count);
            return (
              <span
                key={index}
                className="loop-node"
                aria-hidden="true"
                data-loop-at={loopAt(index, count)}
                style={{
                  ...colorStyle(stepColor(index)),
                  left: `${(50 + (LOOP_RADIUS / 4) * Math.cos(angle)).toFixed(2)}%`,
                  top: `${(50 + (LOOP_RADIUS / 4) * Math.sin(angle)).toFixed(2)}%`,
                }}
              >
                {step.title}
              </span>
            );
          })}
          {art ? <CmsArt frame="round" art={art} sizes="12rem" className="loop-diagram__art" /> : null}
        </div>

        <ol className="loop-steps lg:col-span-6 lg:row-start-2">
          {offline.steps.map((step, index) => (
            <li key={index} className="loop-step" style={colorStyle(stepColor(index))}>
              <span className="loop-step__marker" aria-hidden="true" />
              <div>
                <h3 className="font-display text-h3 font-semibold">{step.title}</h3>
                <p className="mt-1 max-w-[42ch] text-(--ink-soft)">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </SectionShell>
  );
}
