import { SHOP_PATH } from "@/components/landing/sections";
import { UI_COPY } from "@/components/landing/ui-copy";
import type { Product } from "@/lib/content/types";

export { SHOP_PATH };
/** The order review page (Task 7c builds it). */
export const ORDER_PATH = "/order";
export const productPath = (product: Pick<Product, "slug">) => `${SHOP_PATH}/${product.slug}`;

export interface CatalogueGroup {
  /** Stable key and the base of the heading id. */
  id: string;
  /** Absent when the catalogue has no categories at all: one list, no group heading. */
  heading?: string;
  description?: string;
  products: Product[];
}

/**
 * The catalogue as the shop shows it (Task 7b). Without any category it is one list in CMS order.
 * With categories, each gets a group in the CMS category order (then by name), its products in the
 * order the catalogue gave them, and products without a category close the page under their own
 * heading. Nothing is dropped or reordered within a group.
 */
export function catalogueGroups(products: readonly Product[]): CatalogueGroup[] {
  if (products.length === 0) return [];
  if (!products.some((product) => product.category)) return [{ id: "all", products: [...products] }];
  const groups = new Map<string, { order: number; group: CatalogueGroup }>();
  const rest: Product[] = [];
  for (const product of products) {
    const category = product.category;
    if (!category) {
      rest.push(product);
      continue;
    }
    const entry = groups.get(category.id) ?? { order: category.order, group: { id: `category-${category.slug}`, heading: category.name, ...(category.description ? { description: category.description } : {}), products: [] } };
    entry.group.products.push(product);
    groups.set(category.id, entry);
  }
  const ordered = [...groups.values()]
    .sort((a, b) => a.order - b.order || (a.group.heading ?? "").localeCompare(b.group.heading ?? ""))
    .map(({ group }) => group);
  if (rest.length > 0) ordered.push({ id: "more", heading: UI_COPY.shop.moreProducts, products: rest });
  return ordered;
}
