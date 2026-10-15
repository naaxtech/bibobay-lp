import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { CtaLink } from "@/components/landing/CtaLink";
import { UI_COPY } from "@/components/landing/ui-copy";
import { SiteFrame } from "@/components/legal/SiteFrame";
import { SHOP_PATH } from "@/components/shop/catalogue";
import { OrderRequest } from "@/components/shop/OrderRequest";
import { isCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import { countryOptions, orderCountryCodes } from "@/lib/orders/countries";
import { orderConsentFrom } from "@/lib/orders/dependencies";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getLegalSettings, getListedProducts, getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment } from "@/lib/seo/metadata";

/**
 * The order page (Task 7c, spec §10 steps 3 and 4). Inside the commerce route group, so the order
 * pad mounted for /shop carries over. Commerce off (the default): a 404 decided from the CMS
 * settings before the catalogue or the legal settings are read. Never indexed.
 *
 * The server reads the whole listed catalogue, so the pad shows names from the CMS (never from the
 * device) and drops products no longer listed; the order consent sentence comes paired with the
 * version an order records (R82); the countries are the CMS list, or every country (R85).
 */
async function load() {
  const preview = await isDraftMode();
  const settings = await getSiteSettings({ preview });
  if (!isCommerceEnabled(settings)) notFound();
  return { preview, settings };
}

export async function generateMetadata(): Promise<Metadata> {
  const { settings } = await load();
  const seo = seoEnvironment(settings);
  return {
    title: `${ORDER_COPY.page.title} | ${settings.title}`,
    description: ORDER_COPY.page.metaDescription,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    robots: { index: false, follow: false },
  };
}

export default async function OrderPage() {
  const { preview, settings } = await load();
  const [products, legal] = await Promise.all([getListedProducts({ preview }), getLegalSettings({ preview })]);
  const consent = orderConsentFrom(legal);
  const countries = countryOptions(orderCountryCodes(settings.orderCountries));
  return (
    <SiteFrame
      settings={settings}
      preview={preview}
      mainClassName="shop-page order-page"
      headerAction={<CtaLink cta={{ label: UI_COPY.shop.backToShop, href: SHOP_PATH }} variant="paper" className="shop-review" />}
    >
      <div className="landing-container">
        <header className="shop-intro">
          <h1 className="shop-intro__title">{ORDER_COPY.page.title}</h1>
          <p className="shop-intro__lead">{ORDER_COPY.page.intro}</p>
        </header>
        <OrderRequest
          products={products.map(({ id, name }) => ({ id, name }))}
          consentCopy={consent.copy}
          countries={countries}
          trackingEnabled={isTrackingEnabled(settings)}
          aside={
            <section className="order-payment" aria-labelledby="order-payment-title">
              <h2 id="order-payment-title" className="order-payment__title">
                {ORDER_COPY.page.paymentTitle}
              </h2>
              <ul className="order-payment__list">
                {ORDER_COPY.page.payment.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
            </section>
          }
        />
      </div>
    </SiteFrame>
  );
}
