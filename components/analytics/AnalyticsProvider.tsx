"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { classifyClick } from "@/lib/analytics/classify";
import { analyticsActive, startAnalytics, track } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";

/**
 * Starts visit statistics on every public page (ruling R70) and counts what visitors do: one
 * click listener reads what each click means from the page (YouTube links, the free download,
 * calls to action, tabs, questions, the menu), including links opened with the middle button, and
 * each section is counted once per page view when it crosses the middle of the screen. Page views,
 * page leaves and where the visit came from are PostHog's own events. Renders nothing; does
 * nothing without a configuration or in the editors' Studio.
 */
export function AnalyticsProvider({ config }: { config: AnalyticsConfig | null }) {
  const key = config?.key;
  const apiHost = config?.apiHost;
  const pathname = usePathname();

  useEffect(() => {
    if (!key || !apiHost || window.location.pathname.startsWith("/studio")) return;
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
  }, [key, apiHost]);

  // Review M4: re-observed on every page, including pages reached by client-side navigation.
  useEffect(() => {
    if (!key || !apiHost || typeof IntersectionObserver === "undefined" || window.location.pathname.startsWith("/studio")) return;
    const counted = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const section = (entry.target as HTMLElement).dataset.section;
          // A section seen while statistics are off stays watched, so it counts once they are on.
          if (!entry.isIntersecting || !section || counted.has(section) || !analyticsActive()) continue;
          counted.add(section);
          track("section_viewed", { section });
          observer.unobserve(entry.target);
        }
      },
      // A section counts once it reaches the middle fifth of the screen, however tall it is.
      { rootMargin: "-40% 0px -40% 0px" },
    );
    for (const section of document.querySelectorAll("[data-section]")) observer.observe(section);
    return () => observer.disconnect();
  }, [key, apiHost, pathname]);

  return null;
}
