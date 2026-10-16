import type { MetadataRoute } from "next";

import { productPath, SHOP_PATH } from "@/components/shop/catalogue";
import { isCommerceEnabled } from "@/lib/commerce/gate";
import type { SiteSettings } from "@/lib/content/types";
import { getLegalSettings, getListedProducts, getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment, sitemapFor } from "@/lib/seo/metadata";

/** /shop and every listed product page the CMS lets search engines index; nothing while commerce is off. */
async function commerceRoutes(settings: SiteSettings): Promise<string[]> {
  if (!isCommerceEnabled(settings)) return [];
  const products = await getListedProducts();
  return [SHOP_PATH, ...products.filter((product) => product.seo?.noIndex !== true).map(productPath)];
}

/**
 * Ruling R35: the home page, plus the legal pages once their Sanity text is reviewed, plus (Task 7b)
 * the shop and its listed products while commerce is on. The catalogue is not read otherwise.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [settings, legal] = await Promise.all([getSiteSettings(), getLegalSettings()]);
  return sitemapFor({ seo: seoEnvironment(settings), settings, legal, commerceRoutes: await commerceRoutes(settings) });
}
