import type { MetadataRoute } from "next";

import { getLegalSettings, getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment, sitemapFor } from "@/lib/seo/metadata";

/**
 * Ruling R35: the home page, plus the legal pages once their Sanity text is reviewed. Shop and
 * product URLs join through `commerceRoutes` (Task 7) and only while commerce is enabled.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [settings, legal] = await Promise.all([getSiteSettings(), getLegalSettings()]);
  return sitemapFor({ seo: seoEnvironment(settings), settings, legal, commerceRoutes: [] });
}
