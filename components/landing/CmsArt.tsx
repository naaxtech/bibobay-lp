import Image from "next/image";

import type { StageArt } from "./sections";

/**
 * Where an editor's image sits on the page, and the paper it is printed on:
 * - `print`: a die-cut paper print with a white border and lifted shadow (a section's own art);
 * - `sticker`: a round die-cut sticker (beside a value, in the trust band);
 * - `thumb`: a small square print beside an index entry;
 * - `round`: a round cut-out at the heart of the screen-to-life loop.
 */
export type ArtFrame = "print" | "sticker" | "thumb" | "round";

interface ArtImageProps {
  art: StageArt;
  /** The `sizes` hint for the slot (how wide the frame renders). */
  sizes: string;
  /** For above-the-fold art: load at once and at high priority instead of lazily. */
  priority?: boolean;
}

/**
 * Art filling its frame. Approved Sanity art: the URL is resolved on the server at the slot's width
 * (lib/sanity/image.ts, with the editor's crop); Sanity's CDN already sizes and encodes it, so Next
 * serves it as-is. Repository brand art carries its pre-sized files (`srcSet`, ruling R65) and is a
 * plain responsive image: the browser picks the file for the slot's width, nothing resizes at
 * request time. The editor's hotspot (or the still's own focus) stays in view when the frame crops
 * further. Decorative art carries an empty alt and is announced to nobody.
 */
export function ArtImage({ art, sizes, priority = false }: ArtImageProps) {
  if (art.srcSet) {
    return (
      // Pre-sized static files (ruling R65): next/image would route them through the runtime optimiser.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={art.src}
        srcSet={art.srcSet}
        sizes={sizes}
        alt={art.alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className="art-fill object-cover"
        style={art.position ? { objectPosition: art.position } : undefined}
      />
    );
  }
  return (
    <Image
      src={art.src}
      alt={art.alt}
      fill
      sizes={sizes}
      unoptimized
      // src: https://nextjs.org/docs/app/api-reference/components/image#preload · next 16.3.8 · 2026-10-11
      // Next 16 deprecates `priority`; eager loading at high fetch priority is the documented choice for an LCP image.
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      className="object-cover"
      style={art.position ? { objectPosition: art.position } : undefined}
    />
  );
}

export interface CmsArtProps extends ArtImageProps {
  frame: ArtFrame;
  className?: string;
}

/** An editor's image in its own paper frame, for slots that have no illustrated frame of their own. */
export function CmsArt({ frame, className, ...image }: CmsArtProps) {
  const classes = ["cms-art", `cms-art--${frame}`, className].filter(Boolean).join(" ");
  return (
    <div className={classes} data-cms-art={frame}>
      <ArtImage {...image} />
    </div>
  );
}
