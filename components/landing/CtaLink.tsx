import Link from "next/link";
import type { ReactNode } from "react";

import { YouTubeMark, isYouTubeHref } from "@/components/brand/YouTubeMark";
import type { Cta } from "@/lib/content/types";
import { UI_COPY } from "./ui-copy";

export type CtaVariant = "primary" | "paper" | "text" | "plain";

const VARIANT_CLASS: Record<CtaVariant, string> = {
  primary: "btn btn-primary",
  paper: "btn btn-paper",
  text: "text-link",
  plain: "",
};

export interface CtaLinkProps {
  cta: Cta;
  variant?: CtaVariant;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

/**
 * Internal routes this site is known to serve (Task 9). Only these are prefetched; any other CMS
 * route may not exist yet, and a prefetch of a missing route is a 404 in production builds.
 */
export const PREFETCHABLE_ROUTES: ReadonlySet<string> = new Set(["/", "/privacy", "/terms"]);

/**
 * One CMS call to action. Page anchors stay plain links so the browser scrolls (and moves the
 * focus starting point) itself; internal routes use next/link; an external link opens a new tab,
 * says so to assistive technology and never hands the new page a reference to this one.
 */
export function CtaLink({ cta, variant = "plain", className, onClick, children }: CtaLinkProps) {
  const classes = [VARIANT_CLASS[variant], className].filter(Boolean).join(" ") || undefined;
  const label = children ?? cta.label;
  if (cta.external) {
    return (
      <a href={cta.href} className={classes} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {isYouTubeHref(cta.href) ? <YouTubeMark /> : null}
        {label}
        <span className="sr-only"> {UI_COPY.opensInNewTab}</span>
      </a>
    );
  }
  if (cta.href.startsWith("/") && !cta.href.startsWith("/#")) {
    // src: https://nextjs.org/docs/app/api-reference/components/link#prefetch · next 16.3.8 · 2026-10-05
    // CMS links may name routes that do not exist yet; a viewport prefetch of a missing route is a 404
    // and a console error on every visit. Routes this site serves (PREFETCHABLE_ROUTES, Task 9) keep
    // Next's default prefetch. Navigation stays client-side either way.
    return (
      <Link href={cta.href} className={classes} onClick={onClick} {...(PREFETCHABLE_ROUTES.has(cta.href) ? {} : { prefetch: false })}>
        {label}
      </Link>
    );
  }
  return (
    <a href={cta.href} className={classes} onClick={onClick}>
      {isYouTubeHref(cta.href) ? <YouTubeMark /> : null}
      {label}
    </a>
  );
}
