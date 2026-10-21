"use client";

import { useSyncExternalStore } from "react";

import { PREVIEW_COPY } from "@/components/legal/legal-copy";
import { DRAFT_DISABLE_PATH } from "@/lib/sanity/draft-mode-paths";
import { inPresentationNow, notInPresentationOnServer, subscribeNever } from "./presentation-context";

/**
 * Ruling R164: the way out of draft mode. Inside the Studio's Presentation tool it would leave the
 * editor looking at published content with no overlays, so it hides there; the Studio has its own
 * controls. A plain link: the disable route is an API redirect, never something to prefetch.
 */
export function PreviewExitLink() {
  const inStudio = useSyncExternalStore(subscribeNever, inPresentationNow, notInPresentationOnServer);
  if (inStudio) return null;
  return (
    <a href={DRAFT_DISABLE_PATH} className="preview-notice__exit">
      {PREVIEW_COPY.exit}
    </a>
  );
}
