"use client";

import { useEffect, useEffectEvent, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true" && !element.closest("[inert]"),
  );
}

const noSubscription = () => () => {};
/** False on the server and while hydrating; true once the page runs in the browser. */
const useIsBrowser = () => useSyncExternalStore(noSubscription, () => true, () => false);

export interface DialogProps {
  open: boolean;
  /** Called on Escape; the owner closes the dialog by setting `open` to false. */
  onClose: () => void;
  /** The dialog's accessible name, rendered as its heading. */
  title: ReactNode;
  /** Keep the title for assistive technology only. */
  hideTitle?: boolean;
  /** Receives focus on open; defaults to the first focusable element inside. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Receives focus on close; defaults to whatever was focused when the dialog opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * When `.current` is true as the dialog closes, focus is not returned to the opener (the owner
   * moves it somewhere better, such as the section a menu link points at). Escape and Close leave
   * it false, so they keep the restore. The dialog resets it to false once it has been honoured.
   */
  skipFocusReturnRef?: RefObject<boolean>;
  className?: string;
  children: ReactNode;
}

/**
 * A modal dialog: rendered into <body>, named by its title, focus moved in on open and kept
 * inside (Tab and Shift+Tab wrap), Escape closes, focus returns to its opener, page scroll is
 * locked and everything behind it is inert while it is open.
 * src: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ · WAI-ARIA APG (living document) · 2026-10-05
 */
export function Dialog({ open, onClose, title, hideTitle = false, initialFocusRef, returnFocusRef, skipFocusReturnRef, className, children }: DialogProps) {
  const isBrowser = useIsBrowser();
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // src: https://react.dev/reference/react/useEffectEvent · react 19.3.0 · 2026-10-05
  // Reads the latest onClose without re-running (and re-trapping) the open effect on every render.
  const requestClose = useEffectEvent(() => onClose());

  useEffect(() => {
    const layer = layerRef.current;
    const dialog = dialogRef.current;
    if (!open || !layer || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTo = returnFocusRef?.current ?? opener;

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousGutter = root.style.getPropertyValue("scrollbar-gutter");
    root.style.overflow = "hidden";
    // Keeps the scrollbar's space so the page behind does not shift sideways.
    root.style.setProperty("scrollbar-gutter", "stable");

    const madeInert = Array.from(document.body.children).filter((element) => element !== layer && !element.hasAttribute("inert"));
    for (const element of madeInert) element.setAttribute("inert", "");

    (initialFocusRef?.current ?? focusableIn(dialog)[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableIn(dialog);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const element of madeInert) element.removeAttribute("inert");
      root.style.overflow = previousOverflow;
      if (previousGutter) root.style.setProperty("scrollbar-gutter", previousGutter);
      else root.style.removeProperty("scrollbar-gutter");
      // Inert is lifted first: an inert element cannot take focus.
      if (skipFocusReturnRef?.current) skipFocusReturnRef.current = false;
      else if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open, isBrowser, initialFocusRef, returnFocusRef, skipFocusReturnRef]);

  if (!open || !isBrowser) return null;
  return createPortal(
    <div ref={layerRef} className="dialog-layer">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={className ? `dialog ${className}` : "dialog"}
      >
        <h2 id={titleId} className={hideTitle ? "sr-only" : "dialog__title"}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
