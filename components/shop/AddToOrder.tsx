"use client";

import { useEffect, useRef, useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { ORDER_PAD_MAX_LINES } from "@/lib/orders/constants";
import { useOrderPad } from "./OrderPadProvider";

/**
 * "Add to order" for one listed product (Task 6). Renders nothing without an order pad, that is
 * while commerce is disabled. The outcome is announced politely and is always true: added (with
 * the new quantity, so each add is announced), already at the most one order holds, or the pad is
 * full; and when only this page could keep it, that too. Nothing is said when nothing could be
 * added for another reason. A repeated message is cleared first, so screen readers announce it again.
 */
export function AddToOrder({ productId, productName }: { productId: string; productName: string }) {
  const pad = useOrderPad();
  const [message, setMessage] = useState("");
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  if (!pad) return null;
  const announce = (text: string) => {
    clearTimeout(pending.current);
    if (text !== message) {
      setMessage(text);
      return;
    }
    // The same words again: empty the region first, or screen readers stay silent.
    setMessage("");
    pending.current = setTimeout(() => setMessage(text), 60);
  };
  const onAdd = () => {
    const { outcome, quantity, saved } = pad.add(productId);
    if (outcome === "added") announce(saved ? UI_COPY.orderPad.added(quantity) : `${UI_COPY.orderPad.added(quantity)} ${UI_COPY.orderPad.notSaved}`);
    else if (outcome === "at-most") announce(UI_COPY.orderPad.atMost(quantity));
    else if (outcome === "full") announce(UI_COPY.orderPad.full(ORDER_PAD_MAX_LINES));
    else announce("");
  };
  return (
    <div className="add-to-order">
      <button type="button" className="btn btn-primary" onClick={onAdd}>
        {UI_COPY.orderPad.add}
        <span className="sr-only">: {productName}</span>
      </button>
      <p role="status" className="add-to-order__status">
        {message}
      </p>
    </div>
  );
}
