import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UI_COPY } from "@/components/landing/ui-copy";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { ImageWithAlt, Product, ProductCategory, SiteSettings } from "@/lib/content/types";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getGateSettings, getListedProducts, getProductBySlug } = vi.hoisted(() => ({ getGateSettings: vi.fn(), getListedProducts: vi.fn(), getProductBySlug: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getGateSettings, getListedProducts, getProductBySlug }));

// Sanity's image CDN, as lib/sanity/image.ts builds it once a project is configured.
vi.mock("@/lib/sanity/image", () => ({
  sanityImageUrl: (image: ImageWithAlt | undefined, width?: number) => (image?.asset?._ref ? `https://cdn.sanity.io/images/test/production/${image.asset._ref}.png?w=${width ?? 0}` : undefined),
}));

import ShopPage, { generateMetadata as shopMetadata } from "@/app/(commerce)/shop/page";
import ProductPage, { generateMetadata as productPageMetadata } from "@/app/(commerce)/shop/[slug]/page";

/**
 * Task 7b, spec §10: the catalogue and product pages. Commerce off (the default), both answer 404
 * before any catalogue read. On, they show listed products without a price anywhere, each with
 * its "Add to order" control, and a product page shows a sold-out product as sold out.
 */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
/** Anything that reads as a price: a currency sign or code, or an amount with cents. */
const PRICE = /[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|NZD|CAD)\b|\d+[.,]\d{2}\b/;

const ON: SiteSettings = { ...structuredClone(SAFE_FALLBACK_SETTINGS), commerceEnabled: true, navigation: { ...SAFE_FALLBACK_SETTINGS.navigation, commerceLabel: "Bay shop" } };

const image = (ref: string, alt: string): ImageWithAlt => ({ asset: { _ref: `image-${ref}-800x800-png` }, alt });
const plush: ProductCategory = { id: "category-plush", name: "Plush friends", slug: "plush-friends", description: "Soft friends from the Bay.", order: 1 };
const cards: ProductCategory = { id: "category-cards", name: "Activity cards", slug: "activity-cards", description: "", order: 2 };

const product = (edit: Partial<Product> & Pick<Product, "id" | "name" | "slug">): Product => ({ description: "", details: [], images: [], status: "listed", order: 0, ...edit });
const tula = product({ id: "product-tula", name: "Tula plush", slug: "tula-plush", description: "A soft Tula to hug.", category: plush, images: [image("tula", "Tula the turtle plush on a sandy blanket")], order: 1 });
const bob = product({ id: "product-bob", name: "Bob plush", slug: "bob-plush", description: "Bob, ready for bath time.", category: plush, order: 2 });
const breathing = product({ id: "product-breathing", name: "Bubble breathing cards", slug: "bubble-breathing-cards", description: "Calm-down cards.", category: cards, order: 3 });
const sticker = product({ id: "product-stickers", name: "Sticker sheet", slug: "sticker-sheet", description: "Sea friends stickers.", order: 4 });

const withPad = (node: ReactNode) => render(<OrderPadProvider>{node}</OrderPadProvider>);
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  draft.isEnabled = false;
  getGateSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getListedProducts.mockReset().mockResolvedValue([tula, bob, breathing, sticker]);
  getProductBySlug.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe("/shop while commerce is off (the default)", () => {
  it("answers 404 before reading the catalogue", async () => {
    await expect(ShopPage()).rejects.toMatchObject(NOT_FOUND);
    await expect(shopMetadata()).rejects.toMatchObject(NOT_FOUND);
    expect(getListedProducts).not.toHaveBeenCalled();
  });

  it("accepts only a literal true", async () => {
    getGateSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: "yes" as unknown as boolean });
    await expect(ShopPage()).rejects.toMatchObject(NOT_FOUND);
    expect(getListedProducts).not.toHaveBeenCalled();
  });
});

describe("/shop while commerce is on", () => {
  beforeEach(() => {
    getGateSettings.mockResolvedValue(ON);
  });

  it("is headed with the CMS shop label and explains the order request, with no price anywhere", async () => {
    withPad(await ShopPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bay shop");
    const main = screen.getByRole("main");
    expect(main.textContent).toContain(UI_COPY.shop.intro);
    expect(main.textContent).not.toMatch(PRICE);
    expect(document.body.innerHTML).not.toMatch(/itemprop="(?:price|priceCurrency)"|data-price/);
  });

  it("shows each listed product with its picture, name, description, a link to its page and Add to order", async () => {
    withPad(await ShopPage());
    for (const entry of [tula, bob, breathing, sticker]) {
      const link = screen.getByRole("link", { name: entry.name });
      expect(link.getAttribute("href")).toBe(`/shop/${entry.slug}`);
      expect(screen.getByText(entry.description)).toBeTruthy();
      expect(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: ${entry.name}` })).toBeTruthy();
    }
    const picture = document.querySelector<HTMLImageElement>('img[src*="image-tula-800x800-png"]');
    expect(picture?.getAttribute("alt")).toBe("Tula the turtle plush on a sandy blanket");
    // One link per product for keyboard and screen-reader users: the picture's link is hidden from both.
    expect(screen.getAllByRole("link", { name: /Tula plush/ })).toHaveLength(1);
  });

  it("groups products under their categories in CMS order, with the rest last", async () => {
    withPad(await ShopPage());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Plush friends", "Activity cards", UI_COPY.shop.moreProducts]);
    const plushGroup = screen.getByRole("region", { name: "Plush friends" });
    expect(within(plushGroup).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Tula plush", "Bob plush"]);
    expect(within(plushGroup).getByText("Soft friends from the Bay.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: UI_COPY.shop.moreProducts })).getByRole("heading", { level: 3 }).textContent).toBe("Sticker sheet");
  });

  it("lists products without group headings when no product has a category", async () => {
    getListedProducts.mockResolvedValue([{ ...tula, category: undefined }, sticker]);
    withPad(await ShopPage());
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Tula plush", "Sticker sheet"]);
  });

  it("says honestly when nothing is listed, and offers the way home", async () => {
    getListedProducts.mockResolvedValue([]);
    withPad(await ShopPage());
    expect(screen.getByText(UI_COPY.shop.empty)).toBeTruthy();
    expect(screen.getByRole("link", { name: UI_COPY.shop.backHome }).getAttribute("href")).toBe("/");
    expect(document.querySelector(".shop-grid")).toBeNull();
  });

  it("links to the order review", async () => {
    withPad(await ShopPage());
    expect(screen.getByRole("link", { name: UI_COPY.orderPad.review }).getAttribute("href")).toBe("/order");
  });

  it("reads drafts while an editor previews", async () => {
    draft.isEnabled = true;
    withPad(await ShopPage());
    expect(getGateSettings).toHaveBeenCalledWith({ preview: true });
    expect(getListedProducts).toHaveBeenCalledWith({ preview: true });
  });

  it("is titled with the shop label and the site title", async () => {
    expect((await shopMetadata()).title).toBe(`Bay shop | ${ON.title}`);
  });
});

describe("/shop/[slug]", () => {
  const detailed = product({
    ...tula,
    images: [image("tula", "Tula the turtle plush on a sandy blanket"), image("tula-back", "The back of the Tula plush")],
    details: [
      { _type: "block", _key: "h", style: "h2", children: [{ _type: "span", _key: "h1", text: "Made for hugs" }] },
      { _type: "block", _key: "p", style: "normal", children: [{ _type: "span", _key: "p1", text: "Machine washable at 30 degrees." }] },
    ],
    sku: "BB-TULA-01",
    variant: "Medium",
    pack: "Single",
    commerceNotice: { title: "Made in small batches", body: "We check availability before we quote.", cta: { label: "Read the FAQ", href: "/#faq" } },
    seo: { title: "Tula the turtle plush", description: "Soft and washable." },
  });

  it("answers 404 while commerce is off, before reading the catalogue", async () => {
    await expect(ProductPage(params("tula-plush"))).rejects.toMatchObject(NOT_FOUND);
    await expect(productPageMetadata(params("tula-plush"))).rejects.toMatchObject(NOT_FOUND);
    expect(getProductBySlug).not.toHaveBeenCalled();
  });

  it("answers 404 for a draft or unknown product", async () => {
    getGateSettings.mockResolvedValue(ON);
    await expect(ProductPage(params("not-a-product"))).rejects.toMatchObject(NOT_FOUND);
    await expect(productPageMetadata(params("not-a-product"))).rejects.toMatchObject(NOT_FOUND);
    expect(getProductBySlug).toHaveBeenCalledWith("not-a-product", { preview: false });
  });

  it("shows the product: pictures with their alt text, details, codes, the CMS notice and Add to order", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue(detailed);
    withPad(await ProductPage(params("tula-plush")));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tula plush");
    expect(screen.getByText("A soft Tula to hug.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Tula the turtle plush on a sandy blanket" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "The back of the Tula plush" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: UI_COPY.shop.details })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Made for hugs" })).toBeTruthy();
    expect(screen.getByText("Machine washable at 30 degrees.")).toBeTruthy();
    const facts = Object.fromEntries(Array.from(document.querySelectorAll("dt")).map((term) => [term.textContent, term.nextElementSibling?.textContent]));
    expect(facts).toEqual({ [UI_COPY.shop.facts.sku]: "BB-TULA-01", [UI_COPY.shop.facts.variant]: "Medium", [UI_COPY.shop.facts.pack]: "Single" });
    expect(screen.getByRole("heading", { name: "Made in small batches" })).toBeTruthy();
    expect(screen.getByText("We check availability before we quote.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read the FAQ" }).getAttribute("href")).toBe("/#faq");
    expect(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` })).toBeTruthy();
    expect(screen.getByRole("link", { name: UI_COPY.shop.backToShop }).getAttribute("href")).toBe("/shop");
    expect(screen.getByRole("link", { name: UI_COPY.orderPad.review }).getAttribute("href")).toBe("/order");
    expect(screen.getByRole("main").textContent).not.toMatch(PRICE);
  });

  it("leaves out the codes, notice and details a product does not have", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue(bob);
    withPad(await ProductPage(params("bob-plush")));
    expect(document.querySelector("dl")).toBeNull();
    expect(screen.queryByRole("heading", { name: UI_COPY.shop.details })).toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Bob plush` })).toBeTruthy();
  });

  // A picture without a file reference resolves to no URL (as lib/sanity/image.ts does), so it is never shown.
  it("draws no empty list of more pictures when none of them can be shown (review Minor 7)", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue({ ...detailed, images: [detailed.images[0]!, { asset: { _ref: "" }, alt: "A picture whose file is missing" }] });
    withPad(await ProductPage(params("tula-plush")));
    expect(screen.queryByRole("list", { name: UI_COPY.shop.morePictures("Tula plush") })).toBeNull();
  });

  it("puts the CMS notice in a named region, not a complementary landmark inside main (review Minor 7)", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue(detailed);
    withPad(await ProductPage(params("tula-plush")));
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("complementary")).toBeNull();
    expect(within(main).getByRole("region", { name: "Made in small batches" })).toBeTruthy();
  });

  it("shows a sold-out product as sold out, with no way to add it", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue({ ...detailed, status: "sold-out" });
    withPad(await ProductPage(params("tula-plush")));
    expect(screen.getByText(UI_COPY.shop.soldOut)).toBeTruthy();
    expect(screen.getByText(UI_COPY.shop.soldOutNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(UI_COPY.orderPad.add) })).toBeNull();
  });

  it("takes its metadata from the product SEO with the site title, and shares the first picture", async () => {
    getGateSettings.mockResolvedValue(ON);
    getProductBySlug.mockResolvedValue(detailed);
    const meta = await productPageMetadata(params("tula-plush"));
    expect(meta.title).toBe(`Tula the turtle plush | ${ON.title}`);
    expect(meta.description).toBe("Soft and washable.");
    expect(meta.openGraph).toMatchObject({ images: [{ alt: "Tula the turtle plush on a sandy blanket" }] });
  });
});
