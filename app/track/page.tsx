import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { TrackOrderForm } from "@/components/forms/TrackOrderForm";
import { SiteFrame } from "@/components/legal/SiteFrame";
import { isTrackingEnabled } from "@/lib/commerce/gate";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment } from "@/lib/seo/metadata";

/**
 * The tracking page (Task 7c, spec §10 step 11): find an order by its reference and the email it
 * was placed with. Outside the commerce route group, so no order pad is loaded here. Commerce or
 * tracking off (anything but a literal true): a 404 decided from the CMS settings. Never indexed.
 */
async function load() {
  const preview = await isDraftMode();
  const settings = await getSiteSettings({ preview });
  if (!isTrackingEnabled(settings)) notFound();
  return { preview, settings };
}

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await load();
  const seo = seoEnvironment(settings);
  return {
    title: `${ORDER_COPY.track.title} | ${settings.title}`,
    description: ORDER_COPY.track.metaDescription,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    robots: { index: false, follow: false },
  };
}

export default async function TrackPage() {
  const { preview, settings } = await load();
  return (
    <SiteFrame settings={settings} preview={preview} mainClassName="shop-page track-page">
      <div className="landing-container track-layout">
        <header className="shop-intro">
          <h1 className="shop-intro__title">{ORDER_COPY.track.title}</h1>
          <p className="shop-intro__lead">{ORDER_COPY.track.intro}</p>
        </header>
        <TrackOrderForm />
      </div>
    </SiteFrame>
  );
}
