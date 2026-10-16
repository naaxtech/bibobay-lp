"use client";

import { useId, useRef, useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
import { nextOrderStatuses, type OrderStatus } from "@/lib/orders/constants";
import { PAGE_COPY } from "./page-copy";
import type { Perform } from "./useOrderAction";

const COPY = PAGE_COPY.controls.status;
const DIALOG = PAGE_COPY.controls.cancelDialog;

export interface StatusControlsProps {
  /** The status the page rendered: it is the `from` of every request. */
  status: OrderStatus;
  busy: boolean;
  perform: Perform;
}

/**
 * The status buttons (Task 8c, ruling R104): only the steps `nextOrderStatuses(status)` allows,
 * each posting `{ from: <the status rendered>, to }`, so a change somebody else made in between is
 * refused by the server (409) instead of overwritten. Cancelling asks first, in a dialog whose
 * safe choice has focus. A closed or cancelled order has no next step, so nothing is rendered.
 */
export function StatusControls({ status, busy, perform }: StatusControlsProps) {
  const headingId = useId();
  const [confirming, setConfirming] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const next = nextOrderStatuses(status);
  if (next.length === 0) return null;
  const advances = next.filter((to): to is Exclude<OrderStatus, "new" | "cancelled"> => to !== "cancelled" && to !== "new");
  const canCancel = next.includes("cancelled");

  const move = (to: OrderStatus) => perform("status", { from: status, to });
  const confirmCancel = async () => {
    setConfirming(false);
    await move("cancelled");
  };

  return (
    <div role="group" aria-labelledby={headingId} className="admin-status-controls">
      <h3 id={headingId} className="admin-section-title">
        {COPY.heading}
      </h3>
      <p className="admin-hint">{COPY.lead}</p>
      <div className="admin-actions">
        {advances.map((to) => (
          <button key={to} type="button" className="btn btn-primary" onClick={() => void move(to)} disabled={busy} aria-busy={busy}>
            {COPY.advance[to]}
          </button>
        ))}
        {canCancel ? (
          <button ref={cancelRef} type="button" className="admin-button admin-button--danger" onClick={() => setConfirming(true)} disabled={busy}>
            {COPY.cancel}
          </button>
        ) : null}
      </div>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={DIALOG.title} initialFocusRef={keepRef} returnFocusRef={cancelRef} className="admin-dialog">
        <p className="admin-dialog__text">{DIALOG.body}</p>
        <div className="admin-actions">
          <button ref={keepRef} type="button" className="btn btn-primary" onClick={() => setConfirming(false)}>
            {DIALOG.keep}
          </button>
          <button type="button" className="admin-button admin-button--danger" onClick={() => void confirmCancel()}>
            {DIALOG.confirm}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
