import type { Metadata } from "next";

import SiteNotFound from "@/app/not-found";
import { ORDER_COPY } from "@/components/forms/order-copy";
import { CtaLink } from "@/components/landing/CtaLink";
import { SimplePageShell } from "@/components/legal/SimplePageShell";
import { NOT_FOUND_COPY } from "@/components/legal/legal-copy";
import { isTrackingEnabled } from "@/lib/commerce/gate";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { getSiteSettings } from "@/lib/sanity/fetch";

/** Titled like every 404, so the title says nothing about orders. */
export const metadata: Metadata = { title: `${NOT_FOUND_COPY.title} | ${SAFE_FALLBACK_SETTINGS.title}` };

/**
 * The 404 for /orders/<token> (Task 7c). While tracking is on, one generic sentence for every miss
 * (unknown, expired, malformed) with the way to look an order up by its reference. While it is off,
 * the site's ordinary 404 page, so a switched-off site says nothing about orders.
 */
export default async function OrderNotFound() {
  const settings = await getSiteSettings();
  if (!isTrackingEnabled(settings)) return SiteNotFound();
  return (
    <SimplePageShell settings={settings} title={ORDER_COPY.orderLink.notFoundTitle} preview={false}>
      <div className="prose-paper simple-page__prose">
        <p>{ORDER_COPY.tracking.notFound}</p>
      </div>
      <p className="simple-page__actions">
        <CtaLink cta={{ label: ORDER_COPY.orderLink.trackLink, href: "/track" }} variant="primary" />
      </p>
    </SimplePageShell>
  );
}
