import { ArtImage } from "@/components/landing/CmsArt";
import type { StageArt } from "@/components/landing/sections";

export interface ProductPictureProps {
  art: StageArt | undefined;
  /** The product's name: its first letter marks a product that has no picture yet. */
  name: string;
  sizes: string;
  /** For the product page's main picture: load it at once. */
  priority?: boolean;
  className?: string;
}

/**
 * A product picture printed on paper, square, like the landing's die-cut prints. A product without a
 * picture shows an honest blank print with its initial, hidden from assistive technology: the name
 * beside it says everything.
 */
export function ProductPicture({ art, name, sizes, priority = false, className }: ProductPictureProps) {
  const classes = ["product-print", art ? null : "product-print--empty", className].filter(Boolean).join(" ");
  if (!art) {
    return (
      <div className={classes} aria-hidden="true">
        <span className="product-print__initial">{name.trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className={classes}>
      <ArtImage art={art} sizes={sizes} priority={priority} />
    </div>
  );
}
