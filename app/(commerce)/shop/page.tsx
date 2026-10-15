import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CtaLink } from "@/components/landing/CtaLink";
import { UI_COPY } from "@/components/landing/ui-copy";
import { catalogueGroups } from "@/components/shop/catalogue";
import { ProductCard } from "@/components/shop/ProductCard";
import { ShopFrame } from "@/components/shop/ShopFrame";
import { isCommerceEnabled } from "@/lib/commerce/gate";
import type { Product } from "@/lib/content/types";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getListedProducts, getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment, shopMetadata } from "@/lib/seo/metadata";

/**
 * The catalogue (Task 7b, spec §10): every listed product, without a price anywhere, each with
 * "Add to order". Spec §10 "Server gating": while commerce is off (the default) this route is a
 * 404, decided from the CMS settings (or the repository fallback) before the catalogue is read.
 */
async function load() {
  const preview = await isDraftMode();
  const settings = await getSiteSettings({ preview });
  if (!isCommerceEnabled(settings)) notFound();
  return { preview, settings };
}

export async function generateMetadata(): Promise<Metadata> {
  const { preview, settings } = await load();
  return shopMetadata({ settings, seo: seoEnvironment(settings), draft: preview });
}

function ProductGrid({ products, headingLevel }: { products: readonly Product[]; headingLevel: 2 | 3 }) {
  return (
    <ul className="shop-grid">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export default async function ShopPage() {
  const { preview, settings } = await load();
  const groups = catalogueGroups(await getListedProducts({ preview }));
  const grouped = groups.some((group) => group.heading);
  return (
    <ShopFrame settings={settings} preview={preview}>
      <div className="landing-container">
        <header className="shop-intro">
          <h1 className="shop-intro__title">{settings.navigation.commerceLabel}</h1>
          <p className="shop-intro__lead">{UI_COPY.shop.intro}</p>
        </header>
        {groups.length === 0 ? (
          <div className="shop-empty">
            <p>{UI_COPY.shop.empty}</p>
            <CtaLink cta={{ label: UI_COPY.shop.backHome, href: "/" }} variant="primary" />
          </div>
        ) : grouped ? (
          groups.map((group) => (
            <section key={group.id} className="shop-group" aria-labelledby={`shop-group-${group.id}`}>
              <h2 id={`shop-group-${group.id}`} className="shop-group__title">
                {group.heading}
              </h2>
              {group.description ? <p className="shop-group__description">{group.description}</p> : null}
              <ProductGrid products={group.products} headingLevel={3} />
            </section>
          ))
        ) : (
          <ProductGrid products={groups[0]!.products} headingLevel={2} />
        )}
      </div>
    </ShopFrame>
  );
}
