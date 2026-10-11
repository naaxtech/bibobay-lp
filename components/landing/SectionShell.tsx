"use client";

import { useRef, type ReactNode } from "react";

import { useSectionReveal, type BayMotion } from "@/components/motion/useSectionReveal";
import type { SectionConfig } from "@/lib/content/types";
import { sectionTheme } from "./sections";

export interface SectionShellProps {
  section: SectionConfig;
  /** id of the heading that names this section (the region's accessible name). */
  headingId: string;
  className?: string;
  /** How this section's cut-paper bay layers follow the scroll, if it has a bay (see `useSectionReveal`). */
  bay?: BayMotion;
  children: ReactNode;
}

/**
 * The stable root every landing section shares: `id` for anchors, `data-section` for motion
 * hooks, and `data-ground` / `data-accent` for the paper and ink its CMS theme picks.
 * Content inside always renders fully visible; motion may enhance it but never reveals it.
 * The section's narrative motion attaches here, and only runs below a `GsapProvider` allowing it.
 */
export function SectionShell({ section, headingId, className, bay, children }: SectionShellProps) {
  const theme = sectionTheme(section);
  const scope = useRef<HTMLElement>(null);
  useSectionReveal(scope, { bay });
  return (
    <section
      ref={scope}
      id={section.id}
      data-section={section.id}
      data-ground={theme.background}
      data-accent={theme.accent}
      data-surface={theme.background === "navy" ? "navy" : undefined}
      aria-labelledby={headingId}
      className={className ? `landing-section ${className}` : "landing-section"}
    >
      {children}
    </section>
  );
}

/** A section's CMS eyebrow, set on a strip of torn paper tape. */
export function Tape({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={className ? `paper-tape ${className}` : "paper-tape"}>{children}</p>;
}

/** A hand-cut wave along a section's top edge, in that section's own paper. */
export function PaperEdge() {
  return (
    <svg className="paper-edge" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 40V22C130 9 250 5 380 13C510 21 610 33 740 30C870 27 980 11 1110 8C1240 5 1340 14 1440 21V40Z" />
    </svg>
  );
}
