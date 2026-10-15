"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { ORDER_PAD_MAX_QUANTITY } from "@/lib/orders/constants";
import { useOrderPad } from "./OrderPadProvider";

export interface ListedProduct {
  id: string;
  name: string;
}

/**
 * The order pad at a glance (Task 6): each pad product found in `listed`, with its quantity
 * (1 to 999) and a remove button, and a link to review the order. Product names come from the
 * catalogue the server passes in, never from the device. Products missing from `listed` are hidden,
 * not deleted: a page may pass part of the catalogue (the order page prunes with the whole one).
 * Renders nothing without an order pad (commerce disabled) or before the device has been read.
 */
export function OrderPadSummary({ listed }: { listed: ListedProduct[] }) {
  const pad = useOrderPad();
  const headingId = useId();
  const names = useMemo(() => new Map(listed.map((product) => [product.id, product.name])), [listed]);

  if (!pad?.lines) return null;
  const lines = pad.lines.filter((line) => names.has(line.productId));

  return (
    <section className="order-pad" aria-labelledby={headingId}>
      <h2 id={headingId} className="order-pad__title">
        {UI_COPY.orderPad.title}
      </h2>
      {lines.length === 0 ? (
        <p className="order-pad__empty">{UI_COPY.orderPad.empty}</p>
      ) : (
        <>
          <ul className="order-pad__lines">
            {lines.map((line) => {
              const name = names.get(line.productId)!;
              return (
                <li key={line.productId} className="order-pad__line">
                  <span className="order-pad__name">{name}</span>
                  <QuantityField name={name} saved={line.quantity} onSave={(quantity) => pad.setQuantity(line.productId, quantity)} />
                  <button type="button" className="text-link order-pad__remove" onClick={() => pad.setQuantity(line.productId, 0)}>
                    {UI_COPY.orderPad.remove}
                    <span className="sr-only">: {name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/order" className="btn btn-primary order-pad__review" prefetch={false}>
            {UI_COPY.orderPad.review}
          </Link>
        </>
      )}
    </section>
  );
}

/**
 * A quantity the visitor can clear and retype; saved when the field loses focus or on Enter. A
 * change saved elsewhere (another tab, a cap) replaces the draft.
 */
function QuantityField({ name, saved, onSave }: { name: string; saved: number; onSave: (quantity: number) => void }) {
  const [draft, setDraft] = useState(String(saved));
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    // Adjusting state while rendering (react.dev "You Might Not Need an Effect").
    setShown(saved);
    setDraft(String(saved));
  }
  const commit = () => {
    const quantity = Number.parseInt(draft, 10);
    if (Number.isInteger(quantity) && quantity >= 1 && String(quantity) === draft.trim()) {
      const next = Math.min(quantity, ORDER_PAD_MAX_QUANTITY);
      setDraft(String(next));
      if (next !== saved) onSave(next);
    } else {
      setDraft(String(saved));
    }
  };
  return (
    <label className="order-pad__quantity">
      <span className="sr-only">
        {UI_COPY.orderPad.quantity}: {name}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={ORDER_PAD_MAX_QUANTITY}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}
