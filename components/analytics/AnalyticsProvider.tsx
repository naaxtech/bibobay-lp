"use client";

import { useEffect } from "react";

import { classifyClick } from "@/lib/analytics/classify";
import { startAnalytics, track } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";

/**
 * Starts visit statistics on every public page (ruling R70) and counts what visitors do: one
 * click listener reads what each click means from the page (YouTube links, the free download,
 * calls to action, tabs, questions, the menu), and each section is counted once when it crosses
 * the middle of the screen. Page views, page leaves and where the visit came from are PostHog's
 * own events. Renders nothing; does nothing without a configuration or in the editors' Studio.
 */
export function AnalyticsProvider({ config }: { config: AnalyticsConfig | null }) {
  const key = config?.key;
  const apiHost = config?.apiHost;

  useEffect(() => {
    if (!key || !apiHost || window.location.pathname.startsWith("/studio")) return;
    void startAnalytics({ key, apiHost });

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const click = classifyClick(event.target);
      if (click) track(click.event, click.properties);
    };
    document.addEventListener("click", onClick, { capture: true });

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      const counted = new Set<string>();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const section = (entry.target as HTMLElement).dataset.section;
            if (!entry.isIntersecting || !section || counted.has(section)) continue;
            counted.add(section);
            track("section_viewed", { section });
            observer?.unobserve(entry.target);
          }
        },
        // A section counts once it reaches the middle fifth of the screen, however tall it is.
        { rootMargin: "-40% 0px -40% 0px" },
      );
      for (const section of document.querySelectorAll("[data-section]")) observer.observe(section);
    }

    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      observer?.disconnect();
    };
  }, [key, apiHost]);

  return null;
}
