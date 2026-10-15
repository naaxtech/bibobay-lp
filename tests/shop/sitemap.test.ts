import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { Product } from "@/lib/content/types";

vi.mock("server-only", () => ({}));

const { getSiteSettings, getLegalSettings, getListedProducts } = vi.hoisted(() => ({ getSiteSettings: vi.fn(), getLegalSettings: vi.fn(), getListedProducts: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getLegalSettings, getListedProducts }));

import sitemapRoute from "@/app/sitemap";
import { seoEnvironment, sitemapFor } from "@/lib/seo/metadata";

/**
 * Task 7b, spec §10 "Server gating": the sitemap lists /shop and the listed products' pages only
 * while commerce is on, and never reads the catalogue while it is off.
 */
const product = (slug: string, edit: Partial<Product> = {}): Product => ({ id: `product-${slug}`, name: slug, slug, description: "", details: [], images: [], status: "listed", order: 0, ...edit });
const urls = async () => (await sitemapRoute()).map((entry) => entry.url);

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://bibobay.example");
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getLegalSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_LEGAL);
  getListedProducts.mockReset().mockResolvedValue([product("tula-plush"), product("bubble-cards")]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("app/sitemap.ts and the shop", () => {
  it("lists no shop URL while commerce is off, and does not read the catalogue", async () => {
    expect(await urls()).toEqual(["https://bibobay.example/"]);
    expect(getListedProducts).not.toHaveBeenCalled();
  });

  it("lists /shop and every listed product page while commerce is on", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true });
    expect(await urls()).toEqual(["https://bibobay.example/", "https://bibobay.example/shop", "https://bibobay.example/shop/tula-plush", "https://bibobay.example/shop/bubble-cards"]);
  });

  it("never lists the order, tracking or private order pages, with commerce and tracking on (Task 7c)", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: true });
    const listed = await urls();
    expect(listed.filter((url) => /\/(?:order|orders|track)(?:\/|$)/.test(new URL(url).pathname))).toEqual([]);
    const seo = seoEnvironment({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true });
    const pinned = sitemapFor({ seo, settings: { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: true }, legal: SAFE_FALLBACK_LEGAL, commerceRoutes: ["/shop", "/order", "/track", "/orders/abc", `/orders/${"a".repeat(64)}`] });
    expect(pinned.map((entry) => entry.url)).toEqual(["https://bibobay.example/", "https://bibobay.example/shop"]);
  });

  it("leaves out a product the CMS keeps out of search results", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true });
    getListedProducts.mockResolvedValue([product("tula-plush", { seo: { title: "T", description: "D", noIndex: true } }), product("bubble-cards")]);
    expect(await urls()).toEqual(["https://bibobay.example/", "https://bibobay.example/shop", "https://bibobay.example/shop/bubble-cards"]);
  });
});
