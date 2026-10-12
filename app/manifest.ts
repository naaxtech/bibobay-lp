import type { MetadataRoute } from "next";

import { getSiteSettings } from "@/lib/sanity/fetch";
import { manifestFor } from "@/lib/seo/metadata";

/** Ruling R36: the web app manifest from site settings and the brand tokens. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return manifestFor(await getSiteSettings());
}
