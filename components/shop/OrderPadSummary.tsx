"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { stegaCleanText } from "@/lib/content/stega";
import { ORDER_PAD_MAX_QUANTITY } from "@/lib/orders/constants";
import { ORDER_PAD_ANNOUNCE } from "./order-pad-copy";
import { useOrderPad } from "./OrderPadProvider";

export interface ListedProduct {
  id: string;
  name: string;
}

/**
 * The order pad at a glance (Task 6): each pad product found in `listed`, with its quantity
 * (1 to 999) and a remove button, and a link to review the order (left out on the order page itself,
 * Task 7c). Product names come from the catalogue the server passes in, never from the device.
 * Products missing from `listed` are hidden, not deleted: a page may pass part of the catalogue (the
 * order page prunes with the whole one). Renders nothing without an order pad (commerce disabled)
 * or before the device has been read. After a removal focus moves to the next row's remove button,
 * else the previous row's, else the pad heading (so it never falls to the page body), and one polite
 * status line says what happened: "<product> removed", or a quantity held to the most one order can
 * hold or refused.
 */
export function OrderPadSummary({ listed, reviewLink = true }: { listed: readonly ListedProduct[]; reviewLink?: boolean }) {
  const pad = useOrderPad();
  const headingId = useId();
  const names = useMemo(() => new Map(listed.map((product) => [product.id, product.name])), [listed]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  /** Where focus goes once the removal has rendered: a product id, or null for the heading. */
  const focusAfter = useRef<{ productId: string | null } | null>(null);
  const [notice, setNotice] = useState("");

  const lines = pad?.lines ? pad.lines.filter((line) => names.has(line.productId)) : null;
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const next = target.productId ? removeButtons.current.get(target.productId) : undefined;
    (next ?? headingRef.current)?.focus();
  }, [lines]);

  if (!pad || !lines) return null;

  const remove = (index: number, name: string) => {
    const neighbour = lines[index + 1] ?? lines[index - 1];
    focusAfter.current = { productId: neighbour?.productId ?? null };
    setNotice(ORDER_PAD_ANNOUNCE.removed(name));
    pad.setQuantity(lines[index]!.productId, 0);
  };

  return (
    <section className="order-pad" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="order-pad__title">
        {UI_COPY.orderPad.title}
      </h2>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {notice}
      </p>
      {lines.length === 0 ? (
        <p className="order-pad__empty">{UI_COPY.orderPad.empty}</p>
      ) : (
        <>
          <ul className="order-pad__lines">
            {lines.map((line, index) => {
              const name = names.get(line.productId)!;
              return (
                <li key={line.productId} className="order-pad__line">
                  <span className="order-pad__name">{name}</span>
                  <QuantityField name={name} saved={line.quantity} onSave={(quantity) => pad.setQuantity(line.productId, quantity)} onNotice={setNotice} />
                  <button
                    type="button"
                    className="text-link order-pad__remove"
                    ref={(node) => {
                      if (node) removeButtons.current.set(line.productId, node);
                      else removeButtons.current.delete(line.productId);
                    }}
                    onClick={() => remove(index, name)}
                    aria-label={`${UI_COPY.orderPad.remove}: ${stegaCleanText(name)}`}
                  >
                    {UI_COPY.orderPad.remove}
                  </button>
                </li>
              );
            })}
          </ul>
          {reviewLink ? (
            <Link href="/order" className="btn btn-primary order-pad__review" prefetch={false}>
              {UI_COPY.orderPad.review}
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * A quantity the visitor can clear and retype; saved when the field loses focus or on Enter. A
 * change saved elsewhere (another tab, a cap) replaces the draft.
 */
function QuantityField({ name, saved, onSave, onNotice }: { name: string; saved: number; onSave: (quantity: number) => void; onNotice: (text: string) => void }) {
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
      if (next !== quantity) onNotice(ORDER_PAD_ANNOUNCE.capped(name, ORDER_PAD_MAX_QUANTITY));
      if (next !== saved) onSave(next);
    } else {
      setDraft(String(saved));
      onNotice(ORDER_PAD_ANNOUNCE.refused(name, saved, ORDER_PAD_MAX_QUANTITY));
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
