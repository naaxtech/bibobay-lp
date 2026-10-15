"use client";

import { useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { useOrderPad } from "./OrderPadProvider";

/**
 * "Add to order" for one listed product (Task 6). Renders nothing without an order pad, that is
 * while commerce is disabled. The outcome is announced politely: added, or the pad is full.
 */
export function AddToOrder({ productId, productName }: { productId: string; productName: string }) {
  const pad = useOrderPad();
  const [message, setMessage] = useState("");
  if (!pad) return null;
  return (
    <div className="add-to-order">
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setMessage(pad.add(productId) === "full" ? UI_COPY.orderPad.full : UI_COPY.orderPad.added)}
      >
        {UI_COPY.orderPad.add}
        <span className="sr-only">: {productName}</span>
      </button>
      <p role="status" className="add-to-order__status">
        {message}
      </p>
    </div>
  );
}
