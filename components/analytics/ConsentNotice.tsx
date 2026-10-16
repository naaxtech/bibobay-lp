"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { resumeAnalytics, stopAnalytics } from "@/lib/analytics/client";
import type { AnalyticsConfig } from "@/lib/analytics/config";
import { isExcludedPagePath } from "@/lib/analytics/events";
import { declinedByBrowser, readChoice, subscribeChoice } from "@/lib/analytics/preference";

const noSubscription = () => () => {};
/** A browser's Global Privacy Control or Do Not Track does not change while a page is open. */
const browserMayBeAsked = () => !declinedByBrowser();
/**
 * The server never asks: the answer lives in the browser. React uses these server snapshots for the
 * server's HTML and again while hydrating, so both are empty and agree; the browser's own snapshots
 * take over right after, and only then can the notice appear.
 * src: https://react.dev/reference/react/useSyncExternalStore · react 19.3 · 2026-10-17
 */
const notOnTheServer = () => false;
const noAnswerOnTheServer = () => null;

/** The notice's height, kept on <html> while it is shown; consent-notice.css pads the page by it. */
const SPACE_PROPERTY = "--consent-notice-space";

/**
 * Ruling R153: answering removes the notice and the button with it, which would drop focus to the
 * page body and leave a screen-reader user nowhere. Focus moves to where the skip link leads when
 * that element can take focus, otherwise to the skip link itself (LandingPage, SiteFrame and
 * AdminFrame each render one). The page does not scroll. On a page without a skip link the browser
 * decides, as before.
 */
function moveFocusPastTheNotice(): void {
  const skipLink = document.querySelector<HTMLAnchorElement>("a.skip-link[href^='#']");
  if (!skipLink) return;
  const target = document.getElementById(decodeURIComponent(skipLink.hash.slice(1)));
  const focusable = target !== null && (target.tabIndex >= 0 || target.hasAttribute("tabindex"));
  const destination = focusable ? target : skipLink;
  destination.focus({ preventScroll: true });
}

/**
 * The consent notice (rulings R144, R148): asks once whether visits may be counted, and only
 * where there is something to ask about: analytics configured (R49/R146), no answer kept on this
 * device yet, a browser that sends neither Global Privacy Control nor Do Not Track (R147), and not
 * on the staff pages or the editors' Studio. Nothing is counted before a "yes".
 *
 * Non-modal: it never takes focus when it appears, the page stays usable without an answer, and
 * both answers are the same kind of button. After an answer, focus moves past it (ruling R153). It goes away through the answer itself (this tab, the footer dialog or
 * another tab), never through a local "dismissed" state, so it cannot disagree with what is stored.
 * It holds no live region: the signup form's status is the page's only one.
 */
export function ConsentNotice({ config }: { config: AnalyticsConfig | null }) {
  const pathname = usePathname();
  const choice = useSyncExternalStore(subscribeChoice, readChoice, noAnswerOnTheServer);
  const askable = useSyncExternalStore(noSubscription, browserMayBeAsked, notOnTheServer);
  const shown = config !== null && askable && choice === null && !isExcludedPagePath(pathname);
  const noticeRef = useRef<HTMLElement>(null);

  // A fixed notice covers the foot of the page; the page is padded by its height while it is shown.
  useEffect(() => {
    const notice = noticeRef.current;
    if (!shown || !notice) return;
    const root = document.documentElement;
    const reserve = () => root.style.setProperty(SPACE_PROPERTY, `${Math.ceil(notice.getBoundingClientRect().height)}px`);
    reserve();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reserve);
    observer?.observe(notice);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(SPACE_PROPERTY);
    };
  }, [shown]);

  if (!shown) return null;
  const copy = UI_COPY.consentNotice;
  return (
    <section ref={noticeRef} className="consent-notice" role="region" aria-labelledby="consent-notice-title" data-consent-notice="">
      <h2 id="consent-notice-title" className="consent-notice__title">
        {copy.title}
      </h2>
      <p className="consent-notice__text">{copy.body}</p>
      <div className="consent-notice__actions">
        <button
          type="button"
          className="btn btn-paper"
          onClick={() => {
            moveFocusPastTheNotice();
            void resumeAnalytics(config);
          }}
        >
          {copy.accept}
        </button>
        <button
          type="button"
          className="btn btn-paper"
          onClick={() => {
            moveFocusPastTheNotice();
            stopAnalytics();
          }}
        >
          {copy.decline}
        </button>
        <Link href="/privacy" prefetch={false} className="consent-notice__link">
          {copy.privacy}
        </Link>
      </div>
    </section>
  );
}
