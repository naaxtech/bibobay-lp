import { afterEach, describe, expect, it, vi } from "vitest";

import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { LegalSettings, PortableContent } from "@/lib/content/types";
import {
  ROBOTS_DISALLOW,
  homeMetadata,
  legalMetadata,
  legalPageState,
  manifestFor,
  robotsFor,
  seoEnvironment,
  serializeJsonLd,
  sitemapFor,
  structuredData,
  thankYouMetadata,
} from "@/lib/seo/metadata";
import { landingContent, siteSettings } from "../landing/fixtures";

vi.mock("server-only", () => ({}));

const block = (text: string): PortableContent => [{ _type: "block", children: [{ _type: "span", text }] }];
const reviewedLegal: LegalSettings = { privacy: block("Privacy text from Sanity."), terms: block("Terms text from Sanity."), privacyVersion: "2026-10", termsVersion: "2026-10", consentCopyVersion: "1" };

const PRODUCTION = { VERCEL_ENV: "production" };
const PREVIEW = { VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://preview.bibo.example" };

describe("seo environment", () => {
  it("indexes only the production deployment", () => {
    expect(seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION).indexable).toBe(true);
    for (const env of [PREVIEW, { VERCEL_ENV: "development" }, {}]) expect(seoEnvironment(SAFE_FALLBACK_SETTINGS, env).indexable).toBe(false);
  });

  it("takes the canonical origin from verified CMS settings first, then NEXT_PUBLIC_APP_URL", () => {
    expect(seoEnvironment(siteSettings((s) => { s.canonicalUrl = "https://bibobay.example/"; }), { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://other.example" }).baseUrl?.href).toBe("https://bibobay.example/");
    expect(seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://app.bibo.example/some/path" }).baseUrl?.href).toBe("https://app.bibo.example/");
  });

  it.each(["", "http://bibo.example", "localhost:3000", "https://user:pw@bibo.example", "javascript:alert(1)"])("has no canonical origin for an unverified value %j", (value) => {
    expect(seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: value }).baseUrl).toBeNull();
  });
});

describe("home metadata", () => {
  const prodSeo = seoEnvironment(siteSettings((s) => { s.canonicalUrl = "https://bibobay.example/"; }), PRODUCTION);

  it("uses the landing page SEO from the CMS, falling back to the repository copy", () => {
    const fallback = homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: false });
    expect(fallback.title).toBe(SAFE_FALLBACK_CONTENT.seo.title);
    expect(fallback.description).toBe(SAFE_FALLBACK_CONTENT.seo.description);
    const cms = homeMetadata({ content: landingContent((c) => { c.seo = { title: "CMS title", description: "CMS description" }; }), settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: false });
    expect(cms.title).toBe("CMS title");
    expect(cms.openGraph).toMatchObject({ title: "CMS title", description: "CMS description", type: "website", siteName: SAFE_FALLBACK_SETTINGS.title });
  });

  it("is indexable with a canonical URL only in production with a verified origin", () => {
    const meta = homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: false });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe("/");
    expect(String(meta.metadataBase)).toBe("https://bibobay.example/");
    const noBase = homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION), draft: false });
    expect(noBase.alternates).toBeUndefined();
    expect(noBase.metadataBase).toBeUndefined();
  });

  it("is noindex on preview deployments, in draft mode, and when the CMS asks for it", () => {
    const preview = homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PREVIEW), draft: false });
    expect(preview.robots).toEqual({ index: false, follow: false });
    expect(preview.alternates).toBeUndefined();
    expect(homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: true }).robots).toEqual({ index: false, follow: false });
    const cmsNoIndex = landingContent((c) => { c.seo = { ...c.seo, noIndex: true }; });
    expect(homeMetadata({ content: cmsNoIndex, settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: false }).robots).toMatchObject({ index: false });
    const settingsNoIndex = siteSettings((s) => { s.seo = { ...s.seo, noIndex: true }; });
    expect(homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: settingsNoIndex, seo: prodSeo, draft: false }).robots).toMatchObject({ index: false });
  });

  it("carries no unverified social metadata: no handles, no sameAs, no invented images", () => {
    const meta = homeMetadata({ content: SAFE_FALLBACK_CONTENT, settings: SAFE_FALLBACK_SETTINGS, seo: prodSeo, draft: false });
    expect(meta.twitter).toEqual({ card: "summary_large_image", title: SAFE_FALLBACK_CONTENT.seo.title, description: SAFE_FALLBACK_CONTENT.seo.description });
    expect(JSON.stringify(meta)).not.toMatch(/"site"|"creator"|sameAs|facebook|instagram/i);
    // The image is the generated app/opengraph-image.tsx, which Next adds itself; nothing else is claimed.
    expect(meta.openGraph && "images" in meta.openGraph).toBe(false);
  });
});

describe("legal pages", () => {
  it("are fallback and noindex when Sanity has no legal text", () => {
    expect(legalPageState("privacy", SAFE_FALLBACK_LEGAL)).toEqual({ source: "fallback", indexable: false });
    expect(legalPageState("terms", SAFE_FALLBACK_LEGAL)).toEqual({ source: "fallback", indexable: false });
    const meta = legalMetadata({ kind: "privacy", legal: SAFE_FALLBACK_LEGAL, settings: SAFE_FALLBACK_SETTINGS, seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" }), draft: false });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
  });

  it("stay noindex while the Sanity text has no reviewed version", () => {
    const unversioned: LegalSettings = { ...reviewedLegal, privacyVersion: undefined };
    expect(legalPageState("privacy", unversioned)).toEqual({ source: "cms", indexable: false });
    expect(legalPageState("terms", unversioned)).toEqual({ source: "cms", indexable: true, version: "2026-10" });
  });

  it("are indexable with a canonical path once reviewed Sanity text exists in production", () => {
    const seo = seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" });
    const meta = legalMetadata({ kind: "terms", legal: reviewedLegal, settings: SAFE_FALLBACK_SETTINGS, seo, draft: false });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe("/terms");
    expect(legalMetadata({ kind: "terms", legal: reviewedLegal, settings: SAFE_FALLBACK_SETTINGS, seo, draft: true }).robots).toMatchObject({ index: false });
    expect(legalMetadata({ kind: "terms", legal: reviewedLegal, settings: SAFE_FALLBACK_SETTINGS, seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PREVIEW), draft: false }).robots).toMatchObject({ index: false });
  });
});

describe("thank-you page", () => {
  it("is always noindex", () => {
    expect(thankYouMetadata({ settings: SAFE_FALLBACK_SETTINGS, seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION) }).robots).toEqual({ index: false, follow: true });
  });
});

describe("robots.txt", () => {
  it("disallows everything outside production", () => {
    for (const env of [PREVIEW, {}]) {
      expect(robotsFor(seoEnvironment(SAFE_FALLBACK_SETTINGS, env))).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    }
  });

  it("keeps private and transactional paths out of production crawls and points at the sitemap", () => {
    expect(ROBOTS_DISALLOW).toEqual(["/api/", "/admin", "/order", "/orders/", "/track", "/thank-you"]);
    const robots = robotsFor(seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" }));
    expect(robots).toEqual({ rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }, sitemap: "https://bibobay.example/sitemap.xml" });
    expect(robotsFor(seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION))).toEqual({ rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW } });
  });
});

describe("sitemap.xml", () => {
  const seo = seoEnvironment(SAFE_FALLBACK_SETTINGS, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" });
  const urls = (entries: Array<{ url: string }>) => entries.map((entry) => entry.url);

  it("lists only the home page while the legal pages are fallback text", () => {
    expect(urls(sitemapFor({ seo, settings: SAFE_FALLBACK_SETTINGS, legal: SAFE_FALLBACK_LEGAL }))).toEqual(["https://bibobay.example/"]);
  });

  it("adds reviewed legal pages, and never /thank-you", () => {
    const list = urls(sitemapFor({ seo, settings: SAFE_FALLBACK_SETTINGS, legal: reviewedLegal }));
    expect(list).toEqual(["https://bibobay.example/", "https://bibobay.example/privacy", "https://bibobay.example/terms"]);
    expect(list.join()).not.toContain("thank-you");
  });

  it("is empty outside production or without a verified origin", () => {
    expect(sitemapFor({ seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PREVIEW), settings: SAFE_FALLBACK_SETTINGS, legal: reviewedLegal })).toEqual([]);
    expect(sitemapFor({ seo: seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION), settings: SAFE_FALLBACK_SETTINGS, legal: reviewedLegal })).toEqual([]);
  });

  it("lists no /shop or product URL while commerce is off, even when routes are supplied", () => {
    const commerceRoutes = ["/shop", "/shop/sea-friends-tote"];
    const off = urls(sitemapFor({ seo, settings: SAFE_FALLBACK_SETTINGS, legal: reviewedLegal, commerceRoutes }));
    expect(off.some((url) => url.includes("/shop"))).toBe(false);
    const on = urls(sitemapFor({ seo, settings: siteSettings((s) => { s.commerceEnabled = true; }), legal: reviewedLegal, commerceRoutes }));
    expect(on).toEqual(expect.arrayContaining(["https://bibobay.example/shop", "https://bibobay.example/shop/sea-friends-tote"]));
  });

  it("refuses commerce routes that are not same-site shop paths", () => {
    const on = urls(sitemapFor({ seo, settings: siteSettings((s) => { s.commerceEnabled = true; }), legal: SAFE_FALLBACK_LEGAL, commerceRoutes: ["https://evil.example/shop", "//evil.example/shop", "/admin", "/shop/../admin"] }));
    expect(on).toEqual(["https://bibobay.example/"]);
  });
});

describe("structured data", () => {
  it("describes the Organization and WebSite from settings, with no URL until one is verified", () => {
    const [org, site] = structuredData(SAFE_FALLBACK_SETTINGS, seoEnvironment(SAFE_FALLBACK_SETTINGS, PRODUCTION));
    expect(org).toEqual({ "@context": "https://schema.org", "@type": "Organization", name: SAFE_FALLBACK_SETTINGS.title });
    expect(site).toEqual({ "@context": "https://schema.org", "@type": "WebSite", name: SAFE_FALLBACK_SETTINGS.title, description: SAFE_FALLBACK_SETTINGS.description });
  });

  it("adds the URL, logo and verified social profiles when known", () => {
    const settings = siteSettings((s) => { s.socialLinks = [{ platform: "instagram", url: "https://instagram.com/bibobay", verified: true }]; });
    const [org, site] = structuredData(settings, seoEnvironment(settings, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" }));
    expect(org).toMatchObject({ url: "https://bibobay.example/", logo: "https://bibobay.example/bibo-logo.svg", sameAs: ["https://instagram.com/bibobay"] });
    expect(site).toMatchObject({ url: "https://bibobay.example/" });
  });

  it("never contains an Offer, price or product, even with commerce on", () => {
    const settings = siteSettings((s) => { s.commerceEnabled = true; });
    const text = JSON.stringify(structuredData(settings, seoEnvironment(settings, { ...PRODUCTION, NEXT_PUBLIC_APP_URL: "https://bibobay.example" })));
    expect(text).not.toMatch(/Offer|price|Product|availability/i);
  });

  it("serialises safely inside a script element", () => {
    const settings = siteSettings((s) => { s.title = "</script><script>alert(1)</script>"; });
    const text = serializeJsonLd(structuredData(settings, seoEnvironment(settings, PRODUCTION)));
    expect(text).not.toContain("<");
    expect(JSON.parse(text)[0].name).toBe(settings.title);
  });
});

describe("web app manifest", () => {
  it("comes from settings and the brand tokens, with the generated icon", () => {
    expect(manifestFor(SAFE_FALLBACK_SETTINGS)).toEqual({
      name: SAFE_FALLBACK_SETTINGS.title,
      short_name: SAFE_FALLBACK_SETTINGS.title,
      description: SAFE_FALLBACK_SETTINGS.description,
      start_url: "/",
      display: "browser",
      background_color: "#f8f3e9",
      theme_color: "#f8f3e9",
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    });
  });
});

describe("metadata routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("app/robots.ts disallows all crawling without a production deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { default: robots } = await import("@/app/robots");
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("app/sitemap.ts lists the home page only, in production with a verified origin and fallback legal text", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://bibobay.example");
    const { default: sitemap } = await import("@/app/sitemap");
    expect((await sitemap()).map((entry) => entry.url)).toEqual(["https://bibobay.example/"]);
  });

  it("app/manifest.ts serves the fallback settings without Sanity", async () => {
    const { default: manifest } = await import("@/app/manifest");
    expect((await manifest()).name).toBe(SAFE_FALLBACK_SETTINGS.title);
  });

  it("app/opengraph-image.tsx describes the image it draws", async () => {
    const og = await import("@/app/opengraph-image");
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(og.contentType).toBe("image/png");
    expect(og.alt).toMatch(/BIBO/);
  });
});
