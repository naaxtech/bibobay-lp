"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { classifyClick } from "@/lib/analytics/classify";
import { analyticsActive, startAnalytics, track } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import { isExcludedPagePath } from "@/lib/analytics/events";
import { readChoice, subscribeChoice } from "@/lib/analytics/preference";

/** The server knows no answer: the answer lives in the browser. */
const noAnswerOnTheServer = () => null;

/**
 * Visit statistics on every public page, opt-in (ruling R144, replacing R70's opt-out): nothing
 * starts until the visitor says yes, in the consent notice, the footer's "Analytics choices" or
 * another tab; this component follows that answer and starts statistics the moment it is "on".
 * Then it counts what visitors do: one click listener reads what each click means from the page
 * (YouTube links, the free download, calls to action, tabs, questions, the menu), including links
 * opened with the middle button, and each section is counted once per page view when it crosses
 * the middle of the screen. Page views, page leaves and where the visit came from are PostHog's own
 * events. Renders nothing; does nothing without a configuration, and counts nothing on the staff
 * pages or in the editors' Studio (8c-M1: the capture filter `cleanCapture` drops them, so
 * client-side navigations are covered too).
 */
export function AnalyticsProvider({ config }: { config: AnalyticsConfig | null }) {
  const key = config?.key;
  const apiHost = config?.apiHost;
  const pathname = usePathname();
  const choice = useSyncExternalStore(subscribeChoice, readChoice, noAnswerOnTheServer);
  /** Sections already counted on this page view; kept across an off and on, cleared by a new page. */
  const counted = useRef<Set<string>>(new Set());
  const countedOn = useRef(pathname);

  useEffect(() => {
    if (!key || !apiHost || choice !== "on" || isExcludedPagePath(window.location.pathname)) return;
    void startAnalytics({ key, apiHost });

    const count = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const click = classifyClick(target);
      if (click) track(click.event, click.properties);
    };
    const onClick = (event: MouseEvent) => count(event.target);
    // Review M13: a middle-click opens a link in a new tab without a click event.
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) count(event.target);
    };
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("auxclick", onAuxClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("auxclick", onAuxClick, { capture: true });
    };
  }, [key, apiHost, choice]);

  // Review M4: re-observed on every page, including pages reached by client-side navigation, and
  // again after a "yes": an observer reports the sections already in view as soon as it watches them.
  useEffect(() => {
    if (countedOn.current !== pathname) {
      countedOn.current = pathname;
      counted.current.clear();
    }
    if (!key || !apiHost || choice !== "on" || typeof IntersectionObserver === "undefined" || isExcludedPagePath(window.location.pathname)) return;
    const sections = counted.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const section = (entry.target as HTMLElement).dataset.section;
          if (!entry.isIntersecting || !section || sections.has(section) || !analyticsActive()) continue;
          sections.add(section);
          track("section_viewed", { section });
          observer.unobserve(entry.target);
        }
      },
      // A section counts once it reaches the middle fifth of the screen, however tall it is.
      { rootMargin: "-40% 0px -40% 0px" },
    );
    for (const section of document.querySelectorAll("[data-section]")) observer.observe(section);
    return () => observer.disconnect();
  }, [key, apiHost, pathname, choice]);

  return null;
}
