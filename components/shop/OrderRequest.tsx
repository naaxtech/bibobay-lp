"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { OrderForm, type OrderReceipt } from "@/components/forms/OrderForm";
import { ORDER_COPY } from "@/components/forms/order-copy";
import { CtaLink } from "@/components/landing/CtaLink";
import { UI_COPY } from "@/components/landing/ui-copy";
import type { CountryOption } from "@/lib/orders/countries";
import { SHOP_PATH } from "./catalogue";
import { useOrderPad } from "./OrderPadProvider";
import { OrderPadSummary, type ListedProduct } from "./OrderPadSummary";

/** The tracking page (Task 7c); it exists only while tracking is on. */
const TRACK_PATH = "/track";

export interface OrderRequestProps {
  /** The whole listed catalogue, as the server read it: ids and names only. */
  products: readonly ListedProduct[];
  consentCopy: string;
  countries: readonly CountryOption[];
  /** Commerce and tracking on: the private link and the tracking page exist. */
  trackingEnabled: boolean;
  /** Shown beside the form, under the order (how paying works). */
  aside?: ReactNode;
}

/**
 * The order page's working part (Task 7c): the order pad with the server's names beside the order
 * form; once the server has stored the order, what happens next.
 *
 * The pad is pruned with the whole catalogue (`keepListed`), and only when the catalogue loaded: an
 * empty one may mean it could not be read, so the pad is kept and no form is offered. An empty pad
 * gets an honest empty state with the way back to the shop.
 */
export function OrderRequest({ products, consentCopy, countries, trackingEnabled, aside }: OrderRequestProps) {
  const pad = useOrderPad();
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const ids = useMemo(() => products.map((product) => product.id), [products]);
  const keepListed = pad?.keepListed;
  const padHasListed = Boolean(pad?.lines?.some((line) => ids.includes(line.productId)));
  /** True once this visit has shown a product on the pad: the pad then emptying is a removal, not an arrival. */
  const [hadProducts, setHadProducts] = useState(false);
  if (padHasListed && !hadProducts) setHadProducts(true); // adjusting state while rendering (react.dev "You Might Not Need an Effect")

  useEffect(() => {
    if (keepListed && ids.length > 0) keepListed(new Set(ids));
  }, [keepListed, ids]);

  if (!pad) return null;
  if (receipt) return <OrderReceived receipt={receipt} trackingEnabled={trackingEnabled} />;
  if (products.length === 0) return <OrderEmpty text={UI_COPY.shop.empty} />;
  const padEmpty = Boolean(pad.lines) && !padHasListed;
  if (padEmpty && !hadProducts) return <OrderEmpty text={ORDER_COPY.page.empty} />;

  /*
   * Final fix wave C-I2: a visitor who removes the last product stays in this tree, so the pad's
   * heading (the focus target) and its status line ("<product> removed") remain mounted. The form
   * gives way to the empty state's text and the way back to the shop.
   */
  return (
    <div className="order-layout">
      <div className="order-layout__aside">
        <OrderPadSummary listed={products} reviewLink={false} />
        {padEmpty ? <OrderEmpty text={ORDER_COPY.page.empty} /> : aside}
      </div>
      {padEmpty ? null : (
        <div className="order-layout__form">
          <OrderForm consentCopy={consentCopy} countries={countries} listedIds={ids} onReceived={setReceipt} />
        </div>
      )}
    </div>
  );
}

function OrderEmpty({ text }: { text: string }) {
  return (
    <div className="shop-empty">
      <p>{text}</p>
      <CtaLink cta={{ label: ORDER_COPY.page.backToShop, href: SHOP_PATH }} variant="primary" />
    </div>
  );
}

/**
 * The stored order: the reference, the private link with its warning (a new order with tracking
 * on), and the way to /track while tracking is on. Takes focus, as the form it replaces had it.
 */
function OrderReceived({ receipt, trackingEnabled }: { receipt: OrderReceipt; trackingEnabled: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const message = !receipt.duplicate ? ORDER_COPY.outcome.received : trackingEnabled ? ORDER_COPY.outcome.alreadyReceived : ORDER_COPY.outcome.alreadyReceivedUntracked;
  const privateLink = trackingEnabled && receipt.trackingToken ? `/orders/${receipt.trackingToken}` : null;
  return (
    <section className="order-received" aria-labelledby="order-received-title">
      <h2 id="order-received-title" ref={headingRef} tabIndex={-1} className="order-received__title">
        {ORDER_COPY.received.title}
      </h2>
      <p className="order-received__message">{message}</p>
      <dl className="order-received__reference">
        <dt>{ORDER_COPY.received.referenceLabel}</dt>
        <dd>{receipt.reference}</dd>
      </dl>
      {privateLink ? (
        <div className="order-received__private">
          <h3 className="order-received__subtitle">{ORDER_COPY.received.privateLinkTitle}</h3>
          <p>
            {/*
              A plain link (Task 7c review M2): the private page loads as a document of its own, so its
              Referrer-Policy no-referrer and no-store apply. A client-side move would keep this page's
              document, and same-origin requests would then carry the token as their Referer. Nothing
              is prefetched: the private page is looked up only when the buyer opens it.
            */}
            <a href={privateLink} className="text-link">
              {ORDER_COPY.received.privateLink}
            </a>
          </p>
          <p className="order-received__note">{ORDER_COPY.received.privateNote}</p>
        </div>
      ) : null}
      {trackingEnabled ? (
        <p className="order-received__track">
          {ORDER_COPY.received.trackNote}{" "}
          <Link href={TRACK_PATH} prefetch={false} className="text-link">
            {ORDER_COPY.received.trackLink}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
