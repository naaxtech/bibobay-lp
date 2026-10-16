import Link from "next/link";

import type { Product } from "@/lib/content/types";
import { AddToOrder } from "./AddToOrder";
import { productPath } from "./catalogue";
import { PRODUCT_ART_WIDTH, productArt } from "./product-art";
import { ProductPicture } from "./ProductPicture";

export interface ProductCardProps {
  product: Product;
  /** h2 in an ungrouped catalogue, h3 under a category heading. */
  headingLevel: 2 | 3;
}

/**
 * One product in the catalogue: its picture, name, short description and "Add to order". The name
 * is the one link to the product page for keyboards and screen readers; the picture repeats it for
 * pointers only. No price exists to show (spec §10).
 */
export function ProductCard({ product, headingLevel }: ProductCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const href = productPath(product);
  return (
    <div className="product-card">
      <Link href={href} className="product-card__picture" tabIndex={-1} aria-hidden="true">
        <ProductPicture art={productArt(product.images[0], PRODUCT_ART_WIDTH.card)} name={product.name} sizes="(min-width: 64rem) 24rem, (min-width: 40rem) 45vw, 90vw" />
      </Link>
      <Heading className="product-card__name">
        <Link href={href} className="product-card__link">
          {product.name}
        </Link>
      </Heading>
      {product.description ? <p className="product-card__description">{product.description}</p> : null}
      <AddToOrder productId={product.id} productName={product.name} />
    </div>
  );
}
