import type { MetadataRoute } from "next";

import { getSiteSettings } from "@/lib/sanity/fetch";
import { robotsFor, seoEnvironment } from "@/lib/seo/metadata";

/** Ruling R35: production crawl rules, or "disallow everything" on previews and local servers. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  return robotsFor(seoEnvironment(await getSiteSettings()));
}
