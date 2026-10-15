"use client";

import { useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { ORDER_PAD_MAX_LINES } from "@/lib/orders/constants";
import { useOrderPad } from "./OrderPadProvider";

/**
 * "Add to order" for one listed product (Task 6). Renders nothing without an order pad, that is
 * while commerce is disabled. The outcome is announced politely and is always true: added (with
 * the new quantity, so each add is announced), already at the most one order holds, or the pad is
 * full. Nothing is said when nothing could be added for another reason.
 */
export function AddToOrder({ productId, productName }: { productId: string; productName: string }) {
  const pad = useOrderPad();
  const [message, setMessage] = useState("");
  if (!pad) return null;
  const onAdd = () => {
    const { outcome, quantity } = pad.add(productId);
    if (outcome === "added") setMessage(UI_COPY.orderPad.added(quantity));
    else if (outcome === "at-most") setMessage(UI_COPY.orderPad.atMost(quantity));
    else if (outcome === "full") setMessage(UI_COPY.orderPad.full(ORDER_PAD_MAX_LINES));
    else setMessage("");
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
