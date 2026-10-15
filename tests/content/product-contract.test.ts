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

  it("projects the SKU, variant and pack an order snapshots (R80)", () => {
    for (const query of [LISTED_PRODUCTS_QUERY, PRODUCT_BY_SLUG_QUERY]) {
      for (const field of ["sku", "variant", "pack"]) expect(query, field).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("keeps a product's SKU, variant and pack, trimmed, and leaves out blank or missing ones", async () => {
    fetch.mockImplementation((query: string) => query.includes("siteSettings")
      ? { commerceEnabled: true }
      : { id: "p", name: "Concept", slug: "concept", status: "listed", sku: " BB-TULA-01 ", variant: "Large", pack: "  " });
    const detail = await getProductBySlug("concept");
    expect(detail).toMatchObject({ sku: "BB-TULA-01", variant: "Large" });
    expect(detail).not.toHaveProperty("pack");
    fetch.mockImplementation((query: string) => query.includes("siteSettings") ? { commerceEnabled: true } : { id: "p", name: "Concept", slug: "concept", status: "listed", sku: 42 });
    const bare = await getProductBySlug("concept");
    expect(bare).not.toHaveProperty("sku");
    expect(bare).not.toHaveProperty("variant");
  });

  it("retains a safe editor-authored product notice CTA and image caption", async () => {
    fetch.mockImplementation((query: string) => query.includes("siteSettings")
      ? { commerceEnabled: true }
      : { id: "p", name: "Concept", slug: "concept", status: "listed", commerceNotice: { title: "Request details", body: "We will reply.", cta: { label: "Contact", href: "#lead" } }, images: [{ asset: { _ref: "image-abc-120x100-png" }, alt: "Concept art", caption: "Artwork concept" }] });
    const detail = await getProductBySlug("concept");
    expect(detail?.commerceNotice?.cta).toEqual({ label: "Contact", href: "#lead" });
    expect(detail?.images[0]?.caption).toBe("Artwork concept");
  });

  it("retains product detail heading and linked bold span without an unsafe link", async () => {
    const details = [{ _type: "block", _key: "details", style: "h3", children: [
      { _type: "span", _key: "s", text: "Details", marks: ["strong", "more", "bad"] },
    ], markDefs: [
      { _type: "link", _key: "more", href: "https://example.com/details" },
      { _type: "link", _key: "bad", href: "data:text/html,unsafe" },
    ] }];
    fetch.mockImplementation((query: string) => query.includes("siteSettings") ? { commerceEnabled: true } : { id: "p", name: "Concept", slug: "concept", status: "listed", details });
    expect((await getProductBySlug("concept"))?.details).toEqual([{ _type: "block", _key: "details", style: "h3", children: [
      { _type: "span", _key: "s", text: "Details", marks: ["strong", "more"] },
    ], markDefs: [{ _type: "link", _key: "more", href: "https://example.com/details" }] }]);
  });

  it("retains product, category and SEO image crop/hotspot and decorative alt", async () => {
    const geometry = { crop: { top: 0.1, bottom: 0.1, left: 0, right: 0 }, hotspot: { x: 0.6, y: 0.4, width: 0.3, height: 0.3 } };
    const image = { asset: { _ref: "image-abc-1200x1000-png" }, alt: "", decorative: true, ...geometry };
    fetch.mockImplementation((query: string) => query.includes("siteSettings") ? { commerceEnabled: true } : {
      id: "p", name: "Concept", slug: "concept", status: "listed", images: [image],
      category: { id: "category", name: "Art", slug: "art", image },
      seo: { title: "Art", description: "Art concept", image },
    });
    const result = await getProductBySlug("concept");
    expect(result?.images[0]).toEqual(image);
    expect(result?.category?.image).toEqual(image);
    expect(result?.seo?.image).toEqual(image);
  });
});
