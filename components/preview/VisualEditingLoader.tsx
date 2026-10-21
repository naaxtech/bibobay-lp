"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import { PreviewBoundary } from "./PreviewBoundary";
import { inPresentationNow, notInPresentationOnServer, subscribeNever } from "./presentation-context";

/**
 * Ruling R161: the Visual Editing code (the overlays, Sanity UI, styled-components) is its own async
 * chunk. Only a draft-mode page renders this loader, and it asks for the chunk only inside the
 * Studio's Presentation tool; a draft opened in a normal tab, and every public page, never downloads it.
 */
const VisualEditingClient = dynamic(() => import("./VisualEditingClient"), { ssr: false });

export function VisualEditingLoader() {
  const inStudio = useSyncExternalStore(subscribeNever, inPresentationNow, notInPresentationOnServer);
  // R169: an overlay failure (or a chunk that will not load) leaves the page as it is.
  return inStudio ? (
    <PreviewBoundary>
      <VisualEditingClient />
    </PreviewBoundary>
  ) : null;
}
