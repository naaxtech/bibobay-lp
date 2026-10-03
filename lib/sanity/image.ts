import "server-only";
import imageUrlBuilder from "@sanity/image-url";
import type { ImageWithAlt } from "../content/types";
import { getSanityClient } from "./client";

/** No asset means no URL; render an honest placeholder instead. */
export function sanityImageUrl(image: ImageWithAlt | undefined, width?: number): string | undefined {
  if (!image?.asset?._ref || !image.alt?.trim()) return undefined;
  const client = getSanityClient();
  if (!client) return undefined;
  const builder = imageUrlBuilder(client).image(image);
  return width && Number.isSafeInteger(width) && width > 0 ? builder.width(width).auto("format").url() : builder.auto("format").url();
}
