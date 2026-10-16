import { useSyncExternalStore } from "react";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
}

function subscribe(onChange: () => void) {
  const query = reducedMotionQuery();
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** A browser that cannot be asked gets the still page: motion is opt-in, never assumed. */
const prefersReducedMotion = () => reducedMotionQuery()?.matches ?? true;

/** The server cannot ask either, so server HTML and the hydrating render are the still page. */
const serverPrefersReducedMotion = () => true;

/**
 * True while the reader asks for reduced motion (or the browser cannot say), following the setting
 * live. It is true on the server and through hydration, so motion only ever starts afterwards.
 * src: https://react.dev/reference/react/useSyncExternalStore · react 19.3 · 2026-10-11
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, serverPrefersReducedMotion);
}
