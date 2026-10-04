import { describe, expect, it, vi } from "vitest";
import { LISTED_PRODUCTS_QUERY, PRODUCT_BY_SLUG_QUERY } from "@/lib/sanity/queries";

vi.mock("server-only", () => ({}));
const fetch = vi.fn();
vi.mock("@/lib/sanity/client", () => ({ getSanityClient: () => ({ fetch }) }));

import { getListedProducts, getProductBySlug } from "@/lib/sanity/fetch";

describe("public catalogue never contains prices", () => {
  it("projects only editorial fields in every public GROQ product response", () => {
    for (const query of [LISTED_PRODUCTS_QUERY, PRODUCT_BY_SLUG_QUERY]) {
      expect(query).not.toMatch(/\{\s*\.\.\./);
      expect(query).not.toMatch(/\b(price|currency)\b/i);
    }
  });

  it("strips prices from both list and detail even when a legacy document contains them", async () => {
    const product = { _id: "product-1", id: "product-1", name: "A concept", slug: "a-concept", status: "listed", description: "Concept", price: 123, currency: "USD" };
    fetch.mockImplementation((query: string) => query.includes("siteSettings")
      ? { commerceEnabled: true }
      : query.includes("$slug") ? product : [product]);
    const products = await getListedProducts();
    const detail = await getProductBySlug("a-concept");
    expect(products).toHaveLength(1);
    expect(products[0]).not.toHaveProperty("price");
    expect(products[0]).not.toHaveProperty("currency");
    expect(detail).not.toHaveProperty("price");
    expect(detail).not.toHaveProperty("currency");
  });

  it("retains a safe editor-authored product notice CTA and image caption", async () => {
    fetch.mockImplementation((query: string) => query.includes("siteSettings")
      ? { commerceEnabled: true }
      : { id: "p", name: "Concept", slug: "concept", status: "listed", commerceNotice: { title: "Request details", body: "We will reply.", cta: { label: "Contact", href: "#lead" } }, images: [{ asset: { _ref: "image-abc-120x100-png" }, alt: "Concept art", caption: "Artwork concept" }] });
    const detail = await getProductBySlug("concept");
    expect(detail?.commerceNotice?.cta).toEqual({ label: "Contact", href: "#lead" });
    expect(detail?.images[0]?.caption).toBe("Artwork concept");
  });
});
