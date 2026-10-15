import type { StageArt } from "@/components/landing/sections";
import { artPosition } from "@/components/landing/sections";
import type { ImageWithAlt } from "@/lib/content/types";
import { sanityImageUrl } from "@/lib/sanity/image";

/** Pixel widths product pictures are requested at: about twice their largest rendered width. */
export const PRODUCT_ART_WIDTH = { card: 800, hero: 1200, thumb: 240 } as const;

/**
 * A product picture resolved on the server, like the landing's CMS art: the Sanity CDN URL at the
 * slot's width with the editor's crop, the hotspot kept in view, and the editor's alt text (empty
 * when the editor marked it decorative). Without a usable asset, or without Sanity, there is none.
 */
export function productArt(image: ImageWithAlt | undefined, width: number): StageArt | undefined {
  const src = sanityImageUrl(image, width);
  if (!src || !image) return undefined;
  const position = artPosition(image);
  return { src, alt: image.decorative ? "" : image.alt, ...(position ? { position } : {}) };
}
