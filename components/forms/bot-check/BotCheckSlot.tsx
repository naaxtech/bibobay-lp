import type { RefObject } from "react";

/**
 * Where Turnstile draws, directly above the submit button. With the check off it renders nothing.
 * Deliberately no live region: the form already owns its one status line (R199).
 */
export function BotCheckSlot({ enabled, containerRef, visible }: { enabled: boolean; containerRef: RefObject<HTMLDivElement | null>; visible: boolean }) {
  if (!enabled) return null;
  return <div ref={containerRef} className="bot-check" data-visible={visible ? "" : undefined} />;
}
