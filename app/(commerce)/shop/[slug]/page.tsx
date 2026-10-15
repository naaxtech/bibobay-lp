import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CtaLink } from "@/components/landing/CtaLink";
import { PortableText } from "@/components/landing/PortableText";
import { UI_COPY } from "@/components/landing/ui-copy";
import { AddToOrder } from "@/components/shop/AddToOrder";
import { SHOP_PATH } from "@/components/shop/catalogue";
import { PRODUCT_ART_WIDTH, productArt } from "@/components/shop/product-art";
import { ProductPicture } from "@/components/shop/ProductPicture";
import { ShopFrame } from "@/components/shop/ShopFrame";
import { isCommerceEnabled } from "@/lib/commerce/gate";
import type { Product } from "@/lib/content/types";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getProductBySlug, getSiteSettings } from "@/lib/sanity/fetch";
import { productMetadata, seoEnvironment } from "@/lib/seo/metadata";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * One product (Task 7b, spec §10): its pictures, CMS details, codes and notice, and "Add to order";
 * a sold-out product says so and offers no way to add it. A draft or unknown slug is a 404, and
 * while commerce is off (the default) every slug is, decided before the catalogue is read.
 */
async function load(params: ProductPageProps["params"]) {
  const preview = await isDraftMode();
  const settings = await getSiteSettings({ preview });
  if (!isCommerceEnabled(settings)) notFound();
  const { slug } = await params;
  const product = await getProductBySlug(slug, { preview });
  if (!product) notFound();
  return { preview, settings, product };
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { preview, settings, product } = await load(params);
  const first = product.images[0];
  const shared = first && !first.decorative ? productArt(first, PRODUCT_ART_WIDTH.hero) : undefined;
  return productMetadata({ product, settings, seo: seoEnvironment(settings), draft: preview, ...(shared ? { image: { url: shared.src, alt: shared.alt } } : {}) });
}

/** The product's codes an order snapshots (R80), shown when the CMS has them. */
function facts(product: Product): Array<[label: string, value: string]> {
  const { sku, variant, pack } = UI_COPY.shop.facts;
  return ([[sku, product.sku], [variant, product.variant], [pack, product.pack]] as const).flatMap(([label, value]) => (value ? [[label, value] as [string, string]] : []));
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { preview, settings, product } = await load(params);
  const [first, ...more] = product.images;
  const productFacts = facts(product);
  const soldOut = product.status === "sold-out";
  const notice = product.commerceNotice;
  return (
    <ShopFrame settings={settings} preview={preview}>
      <div className="landing-container">
        <p className="product-page__back">
          <CtaLink cta={{ label: UI_COPY.shop.backToShop, href: SHOP_PATH }} variant="text" />
        </p>
        <div className="product-page">
          <div className="product-page__gallery">
            <ProductPicture art={productArt(first, PRODUCT_ART_WIDTH.hero)} name={product.name} sizes="(min-width: 64rem) 36rem, 92vw" priority className="product-print--hero" />
            {more.length > 0 ? (
              <ul className="product-page__thumbs" aria-label={UI_COPY.shop.morePictures(product.name)}>
                {more.map((image, index) => {
                  const art = productArt(image, PRODUCT_ART_WIDTH.thumb);
                  return art ? (
                    <li key={`${index}-${image.asset._ref}`}>
                      <ProductPicture art={art} name={product.name} sizes="7rem" className="product-print--thumb" />
                    </li>
                  ) : null;
                })}
              </ul>
            ) : null}
          </div>
          <div className="product-page__info">
            {product.category ? <p className="product-page__category">{product.category.name}</p> : null}
            <h1 className="product-page__title">{product.name}</h1>
            {product.description ? <p className="product-page__lead">{product.description}</p> : null}
            <div className="product-page__order">
              {soldOut ? (
                <div className="product-sold-out">
                  <p className="paper-stamp">{UI_COPY.shop.soldOut}</p>
                  <p>{UI_COPY.shop.soldOutNote}</p>
                </div>
              ) : (
                <AddToOrder productId={product.id} productName={product.name} />
              )}
            </div>
            {notice ? (
              <aside className="product-notice" aria-labelledby="product-notice-title">
                <h2 id="product-notice-title" className="product-notice__title">
                  {notice.title}
                </h2>
                <p className="product-notice__body">{notice.body}</p>
                {notice.cta ? <CtaLink cta={notice.cta} variant="text" className="product-notice__link" /> : null}
              </aside>
            ) : null}
            {productFacts.length > 0 ? (
              <dl className="product-facts">
                {productFacts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
        {product.details.length > 0 ? (
          <section className="product-details" aria-labelledby="product-details-title">
            <h2 id="product-details-title" className="product-details__title">
              {UI_COPY.shop.details}
            </h2>
            <PortableText value={product.details} headingLevel={3} className="prose-paper product-details__prose" />
          </section>
        ) : null}
      </div>
    </ShopFrame>
  );
}
