"use client";

import { useEffect, useRef } from "react";

import type { OrderStatus } from "@/lib/orders/constants";
import { PAGE_COPY } from "./page-copy";
import { QuoteForm, type QuoteFigures } from "./QuoteForm";
import { StatusControls } from "./StatusControls";
import { TrackingLinkControl } from "./TrackingLinkControl";
import { useOrderAction } from "./useOrderAction";

export interface OrderControlsProps {
  /** The order's reference as stored (canonical), used in every request path. */
  reference: string;
  /** The status the page rendered. */
  status: OrderStatus;
  /** The quote the page rendered. */
  quote: QuoteFigures;
}

/** The statuses in which the database lets a quote be saved or queued (migration 0007). */
const QUOTABLE: readonly OrderStatus[] = ["new", "confirmed"];
const FINISHED: readonly OrderStatus[] = ["closed", "cancelled"];

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled)";

/**
 * The staff controls of one order (Task 8c, rulings R102-R104): the quote form, the status buttons
 * and the tracking-link control, split into sibling files by control. This component owns what they
 * share: one request at a time (every control is disabled while one is in flight), one polite live
 * region for the API's message (never focused, so nothing is announced twice), and the focus
 * return. After a 200 or a 409 the page is refreshed (useOrderAction), so everything on screen
 * about the order comes from the server.
 *
 * Disabling the button that was clicked drops focus to <body>; once the request has finished, and
 * again when the refreshed order arrives (the clicked button may be gone), focus goes back to the
 * control that was used, or to the first control, unless the person already moved it.
 */
export function OrderControls({ reference, status, quote }: OrderControlsProps) {
  const { busy, message, perform, announce, clear } = useOrderAction(reference);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastControl = useRef<Element | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (busy || !armed.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const root = rootRef.current;
    if (!root) return;
    const back = lastControl.current instanceof HTMLElement && root.contains(lastControl.current) && !lastControl.current.hasAttribute("disabled") ? lastControl.current : null;
    (back ?? root.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, [busy, status, quote.revision]);

  const run: typeof perform = (endpoint, body) => {
    armed.current = true;
    lastControl.current = document.activeElement;
    return perform(endpoint, body);
  };

  const finished = FINISHED.includes(status);
  return (
    <div ref={rootRef} className="order-controls">
      <p role="status" aria-live="polite" aria-atomic="true" className="admin-status admin-status--controls" data-tone={message?.tone}>
        {message?.text ?? ""}
      </p>

      {QUOTABLE.includes(status) ? (
        <QuoteForm quote={quote} busy={busy} perform={run} clearMessage={clear} />
      ) : finished ? null : (
        <p className="admin-hint">{PAGE_COPY.controls.quote.notAllowed}</p>
      )}

      {finished ? <p className="admin-hint">{PAGE_COPY.controls.status.finished}</p> : <StatusControls status={status} busy={busy} perform={run} />}

      <TrackingLinkControl busy={busy} perform={run} announce={announce} />
    </div>
  );
}
