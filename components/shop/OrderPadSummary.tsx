"use client";

import Link from "next/link";
import { useEffect, useId, useMemo } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { ORDER_PAD_MAX_QUANTITY } from "@/lib/orders/constants";
import { useOrderPad } from "./OrderPadProvider";

export interface ListedProduct {
  id: string;
  name: string;
}

/**
 * The order pad at a glance (Task 6): each product the catalogue still lists, with its quantity
 * (1 to 999) and a remove button, and a link to review the order. Product names come from the
 * catalogue the server passes in, never from the device. Lines for products no longer listed are
 * dropped. Renders nothing without an order pad (commerce disabled).
 */
export function OrderPadSummary({ listed }: { listed: ListedProduct[] }) {
  const pad = useOrderPad();
  const headingId = useId();
  const names = useMemo(() => new Map(listed.map((product) => [product.id, product.name])), [listed]);
  const keepListed = pad?.keepListed;

  useEffect(() => {
    keepListed?.(new Set(names.keys()));
  }, [keepListed, names]);

  if (!pad) return null;
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
                      value={line.quantity}
                      onChange={(event) => {
                        const quantity = Number.parseInt(event.target.value, 10);
                        if (Number.isInteger(quantity) && quantity >= 1) pad.setQuantity(line.productId, quantity);
                      }}
                    />
                  </label>
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
