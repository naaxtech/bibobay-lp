import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS, SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import { getLandingPage, getSiteSettings, getLegalSettings, getListedProducts, getProductBySlug } from "@/lib/sanity/fetch";
import { LANDING_PAGE_QUERY, SITE_SETTINGS_QUERY, LEGAL_SETTINGS_QUERY } from "@/lib/sanity/queries";
import { getSanityClient } from "@/lib/sanity/client";
import { getSanityEnvironment } from "@/lib/sanity/env";
import { resolvePresentationUrl } from "@/lib/sanity/presentation";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sanity/client", () => ({ getSanityClient: vi.fn(() => null) }));

describe("Sanity data access", () => {
  it("keeps Studio tooling out of the public site's production dependencies", () => {
    const { dependencies } = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(dependencies["@sanity/client"]).toBe("8.9.0");
    expect(dependencies).not.toHaveProperty("next-sanity");
    expect(dependencies).not.toHaveProperty("sanity");
  });

  it("targets immutable singleton IDs rather than arbitrary first documents", () => {
    expect(LANDING_PAGE_QUERY).toContain('"landingPage"');
    expect(SITE_SETTINGS_QUERY).toContain('"siteSettings"');
    expect(LEGAL_SETTINGS_QUERY).toContain('"legalSettings"');
    expect(LANDING_PAGE_QUERY).toContain("_id ==");
  });

  it("returns safe values for absent configuration, including draft preview", async () => {
    expect(await getLandingPage()).toEqual(SAFE_FALLBACK_CONTENT);
    expect(await getLandingPage({ preview: true })).toEqual(SAFE_FALLBACK_CONTENT);
    expect(await getSiteSettings()).toEqual(SAFE_FALLBACK_SETTINGS);
    expect(await getLegalSettings()).toEqual(SAFE_FALLBACK_LEGAL);
    expect(await getListedProducts()).toEqual([]);
    expect(await getProductBySlug("item")).toBeNull();
  });

  it("uses published tags without CDN and preview no-store with a server read token", async () => {
    const fetch = vi.fn().mockResolvedValue(null);
    vi.mocked(getSanityClient).mockReturnValue({ fetch } as never);
    await getLandingPage();
    expect(fetch).toHaveBeenCalledWith(LANDING_PAGE_QUERY, {}, expect.objectContaining({ next: expect.objectContaining({ tags: expect.arrayContaining(["landingPage"]), revalidate: false }) }));
    await getLandingPage({ preview: true });
    expect(fetch).toHaveBeenLastCalledWith(LANDING_PAGE_QUERY, {}, expect.objectContaining({ cache: "no-store", perspective: "drafts" }));
  });

  it("never returns unverified testimonials even when the section was enabled", async () => {
    const fetch = vi.fn().mockResolvedValue({ sections: [{ id: "testimonials", visible: true }], testimonials: [{ id: "a", quote: "unverified" }] });
    vi.mocked(getSanityClient).mockReturnValue({ fetch } as never);
    expect((await getLandingPage()).testimonials).toEqual([]);
  });

  it("preserves product detail, SEO and notice content when commerce is explicitly enabled", async () => {
    const product = { id: "p1", name: "Paper Boat", slug: "paper-boat", status: "listed", description: "A product concept", details: [{ _type: "block", children: [{ _type: "span", text: "Care notes" }] }], seo: { title: "Paper Boat", description: "Care notes" }, commerceNotice: { title: "Request only", body: "A staff member will follow up." }, images: [{ asset: { _ref: "image-abc-120x100-png" }, alt: "" }] };
    const fetch = vi.fn().mockImplementation((query: string) => Promise.resolve(query === SITE_SETTINGS_QUERY ? { commerceEnabled: true } : [product]));
    vi.mocked(getSanityClient).mockReturnValue({ fetch } as never);
    const [result] = await getListedProducts();
    expect(result?.details[0]?.children?.[0]?.text).toBe("Care notes");
    expect(result?.seo?.title).toBe("Paper Boat");
    expect(result?.commerceNotice?.body).toBe("A staff member will follow up.");
    expect(result?.images[0]?.alt).toBe("Paper Boat product illustration");
  });

  it("denies products when configuration fails and handles origin errors safely", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("origin unavailable"));
    vi.mocked(getSanityClient).mockReturnValue({ fetch } as never);
    expect(await getListedProducts()).toEqual([]);
    expect(await getProductBySlug("bad\"slug")).toBeNull();
    expect(await getLandingPage()).toEqual(SAFE_FALLBACK_CONTENT);
  });
});

describe("server configuration and presentation routes", () => {
  it("requires both valid public project coordinates", () => {
    expect(getSanityEnvironment({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getSanityEnvironment({ NEXT_PUBLIC_SANITY_PROJECT_ID: "x-project", NEXT_PUBLIC_SANITY_DATASET: "production", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual({ projectId: "x-project", dataset: "production", apiVersion: "2026-03-01" });
  });
  it("maps only known route types and slug-safe product paths", () => {
    expect(resolvePresentationUrl("legalSettings")).toBe("/privacy");
    expect(resolvePresentationUrl("product", "paper-boat")).toBe("/shop/paper-boat");
    expect(resolvePresentationUrl("product", "../private")).toBeNull();
  });
  it("never embeds the draft token in a published client and bypasses CDN for preview", async () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    vi.stubEnv("SANITY_API_READ_TOKEN", "test-private-token");
    try {
      const { getSanityClient: actualClient } = await vi.importActual<typeof import("@/lib/sanity/client")>("@/lib/sanity/client");
      expect(actualClient()?.config().useCdn).toBe(false);
      expect(actualClient()?.config().token).toBeUndefined();
      expect(actualClient({ preview: true })?.config().token).toBe("test-private-token");
      expect(actualClient({ preview: true })?.config().useCdn).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });
});
