import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { CtaLink } from "@/components/landing/CtaLink";
import { SiteFrame } from "@/components/legal/SiteFrame";
import { OrderStatusView } from "@/components/orders/OrderStatusView";
import { isTrackingEnabled } from "@/lib/commerce/gate";
import { createTrackingDependencies } from "@/lib/orders/dependencies";
import { TRACKING_TOKEN_PATTERN } from "@/lib/orders/fields";
import { trackOrderByToken } from "@/lib/orders/track";
import { getSiteSettings } from "@/lib/sanity/fetch";

/**
 * A private order link (Task 7c, spec §10 step 11 and §11): /orders/<token>, the token issued once
 * with the order. Commerce or tracking off: a 404 before anything is looked up. A malformed token
 * is a 404 without a lookup; a well-formed one goes through the same gate, shared rate limit and
 * lookup as the tracking API (lib/orders/track.ts), and a miss is the same 404, whose page
 * (./not-found.tsx) never says why. Storage unconfigured, a refused lookup or a failure show the
 * tracking failure copy instead.
 *
 * The token is never rendered, logged or put in the metadata. lib/security/headers.ts sends this
 * path with no referrer, no-store and noindex; the robots metadata says noindex too.
 */
async function gate() {
  const settings = await getSiteSettings();
  if (!isTrackingEnabled(settings)) notFound();
  return settings;
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await gate();
  return { title: `${ORDER_COPY.orderLink.title} | ${settings.title}`, robots: { index: false, follow: false } };
}

export default async function OrderLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const settings = await gate();
  const { token } = await params;
  if (!TRACKING_TOKEN_PATTERN.test(token)) notFound();
  const result = await trackOrderByToken(token, createTrackingDependencies(await headers(), settings));
  if (result.status === 404) notFound();
  return (
    <SiteFrame settings={settings} preview={false} mainClassName="shop-page order-link-page">
      <div className="landing-container order-link">
        {result.status === 200 ? (
          <>
            <h1 className="shop-intro__title">{ORDER_COPY.orderLink.title}</h1>
            <OrderStatusView order={result.body.order} />
          </>
        ) : (
          <div className="order-link__failure">
            <h1 className="shop-intro__title">{ORDER_COPY.orderLink.failureTitle}</h1>
            <p className="shop-intro__lead">{result.body.message}</p>
          </div>
        )}
        <p className="order-link__track">
          <CtaLink cta={{ label: ORDER_COPY.orderLink.trackLink, href: "/track" }} variant="paper" />
        </p>
      </div>
    </SiteFrame>
  );
}
