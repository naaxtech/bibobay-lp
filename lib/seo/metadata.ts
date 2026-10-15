import type { Metadata, MetadataRoute } from "next";

import { BIBO_LOGO_ASSETS } from "@/components/brand/BiboLogo";
import { UI_COPY } from "@/components/landing/ui-copy";
import { LEGAL_PAGE_COPY, THANK_YOU_COPY } from "@/components/legal/legal-copy";
import { brandTokens } from "@/lib/brand/tokens";
import type { LandingPageContent, LegalSettings, Product, SiteSettings } from "@/lib/content/types";

/*
 * Metadata, robots, sitemap, manifest and structured data (Task 9 rulings R35, R36), as pure
 * functions of CMS content and the deployment environment so every rule is tested without Next.
 *
 * src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md · next 16.3.8 · 2026-10-13
 * src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/{robots,sitemap,manifest}.md · next 16.3.8 · 2026-10-13
 * src: node_modules/next/dist/docs/01-app/02-guides/json-ld.md · next 16.3.8 · 2026-10-13
 */

type Env = Readonly<Record<string, string | undefined>>;

export interface SeoEnvironment {
  /** Only the production deployment may be indexed; previews and local servers never are. */
  indexable: boolean;
  /** The verified public origin (CMS canonical URL, else NEXT_PUBLIC_APP_URL), or null when unknown. */
  baseUrl: URL | null;
}

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function verifiedOrigin(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !HOSTNAME.test(url.hostname)) return null;
    return new URL("/", url.origin);
  } catch {
    return null;
  }
}

export function seoEnvironment(settings: SiteSettings, env: Env = process.env): SeoEnvironment {
  return {
    indexable: env.VERCEL_ENV === "production",
    // normalizeSiteSettings keeps canonicalUrl only when an editor marked it verified.
    baseUrl: verifiedOrigin(settings.canonicalUrl) ?? verifiedOrigin(env.NEXT_PUBLIC_APP_URL),
  };
}

const NOINDEX_NOFOLLOW = { index: false, follow: false } as const;
const NOINDEX_FOLLOW = { index: false, follow: true } as const;
const INDEX = { index: true, follow: true } as const;

export interface HomeMetadataInput {
  content: LandingPageContent;
  settings: SiteSettings;
  seo: SeoEnvironment;
  draft: boolean;
  /** A CMS SEO image already resolved to a Sanity CDN URL; without one, app/opengraph-image.tsx is used. */
  image?: { url: string; alt: string };
}

/** The home page: landing SEO from the CMS (the repository fallback when Sanity is absent). */
export function homeMetadata({ content, settings, seo, draft, image }: HomeMetadataInput): Metadata {
  const { title, description } = content.seo;
  const indexable = seo.indexable && !draft;
  const cmsNoIndex = content.seo.noIndex === true || settings.seo.noIndex === true;
  const canonical = indexable && !cmsNoIndex && seo.baseUrl !== null;
  return {
    title,
    description,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    ...(canonical ? { alternates: { canonical: "/" } } : {}),
    robots: !indexable ? NOINDEX_NOFOLLOW : cmsNoIndex ? NOINDEX_FOLLOW : INDEX,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: settings.title,
      ...(canonical ? { url: "/" } : {}),
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
    // A large card is honest now: app/opengraph-image.tsx draws a real image for every page.
    // No `site`/`creator` handles: none is verified.
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image.url] } : {}) },
  };
}

export type LegalKind = "privacy" | "terms";
export type LegalPageState = { source: "fallback"; indexable: false } | { source: "cms"; indexable: false } | { source: "cms"; indexable: true; version: string };

/**
 * Ruling R30: Sanity text with a version number is reviewed and may be indexed; Sanity text without
 * one, or the repository fallback, stays out of search results.
 */
export function legalPageState(kind: LegalKind, legal: LegalSettings): LegalPageState {
  if (legal[kind].length === 0) return { source: "fallback", indexable: false };
  const version = kind === "privacy" ? legal.privacyVersion : legal.termsVersion;
  return version ? { source: "cms", indexable: true, version } : { source: "cms", indexable: false };
}

/** Both legal pages carry reviewed Sanity text: the readiness `legalReviewed` flag. */
export function legalReviewed(legal: LegalSettings): boolean {
  return legalPageState("privacy", legal).indexable && legalPageState("terms", legal).indexable;
}

export function legalMetadata({ kind, legal, settings, seo, draft }: { kind: LegalKind; legal: LegalSettings; settings: SiteSettings; seo: SeoEnvironment; draft: boolean }): Metadata {
  const copy = LEGAL_PAGE_COPY[kind];
  const title = `${copy.title} | ${settings.title}`;
  const indexable = seo.indexable && !draft && legalPageState(kind, legal).indexable;
  return {
    title,
    description: copy.description,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    ...(indexable && seo.baseUrl ? { alternates: { canonical: `/${kind}` } } : {}),
    robots: indexable ? INDEX : NOINDEX_FOLLOW,
    openGraph: { type: "website", title, description: copy.description, siteName: settings.title },
  };
}

/** Ruling R31: never indexed; a visit proves nothing about a signup. */
export function thankYouMetadata({ settings, seo }: { settings: SiteSettings; seo: SeoEnvironment }): Metadata {
  return {
    title: `${THANK_YOU_COPY.title} | ${settings.title}`,
    description: THANK_YOU_COPY.description,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    robots: NOINDEX_FOLLOW,
  };
}

export interface ShopMetadataInput {
  settings: SiteSettings;
  seo: SeoEnvironment;
  draft: boolean;
}

/**
 * The catalogue (Task 7b), titled with the CMS shop label like the other pages. The page itself
 * exists only while commerce is on, so this is never asked for otherwise.
 */
export function shopMetadata({ settings, seo, draft }: ShopMetadataInput): Metadata {
  const title = `${settings.navigation.commerceLabel} | ${settings.title}`;
  const description = UI_COPY.shop.metaDescription;
  const indexable = seo.indexable && !draft;
  return {
    title,
    description,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    ...(indexable && seo.baseUrl ? { alternates: { canonical: "/shop" } } : {}),
    robots: indexable ? INDEX : NOINDEX_NOFOLLOW,
    openGraph: { type: "website", title, description, siteName: settings.title, ...(indexable && seo.baseUrl ? { url: "/shop" } : {}) },
  };
}

export interface ProductMetadataInput extends ShopMetadataInput {
  product: Product;
  /** A product picture already resolved to a Sanity CDN URL; without one, app/opengraph-image.tsx is used. */
  image?: { url: string; alt: string };
}

/**
 * A product page (Task 7b): the product's CMS SEO, else its name and description, with the site
 * title appended. Never a price, an offer or Product structured data (spec §14). A sold-out product
 * keeps its page for shared links but stays out of search results, as the CMS can ask for any product.
 */
export function productMetadata({ product, settings, seo, draft, image }: ProductMetadataInput): Metadata {
  const title = `${product.seo?.title ?? product.name} | ${settings.title}`;
  const description = product.seo?.description || product.description || UI_COPY.shop.metaDescription;
  const path = `/shop/${product.slug}`;
  const deployable = seo.indexable && !draft;
  const indexable = deployable && product.seo?.noIndex !== true && product.status === "listed";
  return {
    title,
    description,
    ...(seo.baseUrl ? { metadataBase: seo.baseUrl } : {}),
    ...(indexable && seo.baseUrl ? { alternates: { canonical: path } } : {}),
    robots: !deployable ? NOINDEX_NOFOLLOW : indexable ? INDEX : NOINDEX_FOLLOW,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: settings.title,
      ...(indexable && seo.baseUrl ? { url: path } : {}),
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
  };
}

/** Private, transactional and future commerce paths stay out of crawls (ruling R35). */
export const ROBOTS_DISALLOW: readonly string[] = Object.freeze(["/api/", "/admin", "/order", "/orders/", "/track", "/thank-you"]);

export function robotsFor(seo: SeoEnvironment): MetadataRoute.Robots {
  if (!seo.indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    ...(seo.baseUrl ? { sitemap: new URL("sitemap.xml", seo.baseUrl).href } : {}),
  };
}

/** A same-site shop path: `/shop` or `/shop/<slug>`. Task 7 passes product routes through this hook. */
const COMMERCE_ROUTE = /^\/shop(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export interface SitemapInput {
  seo: SeoEnvironment;
  settings: SiteSettings;
  legal: LegalSettings;
  /** Typed hook for Task 7: shop and product paths, listed only while commerce is enabled. */
  commerceRoutes?: readonly string[];
}

export function sitemapFor({ seo, settings, legal, commerceRoutes = [] }: SitemapInput): MetadataRoute.Sitemap {
  const base = seo.baseUrl;
  if (!seo.indexable || !base) return [];
  const paths = ["/"];
  for (const kind of ["privacy", "terms"] as const) if (legalPageState(kind, legal).indexable) paths.push(`/${kind}`);
  if (settings.commerceEnabled) for (const route of commerceRoutes) if (COMMERCE_ROUTE.test(route) && !paths.includes(route)) paths.push(route);
  return paths.map((path) => ({ url: new URL(path, base).href }));
}

/** Organization and WebSite only. No Product, Offer or price, whatever commerce does (spec §14). */
export function structuredData(settings: SiteSettings, seo: SeoEnvironment): Array<Record<string, unknown>> {
  const url = seo.baseUrl?.href;
  const sameAs = settings.socialLinks.filter((link) => link.verified === true).map((link) => link.url);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: settings.title,
      ...(url ? { url, logo: new URL(BIBO_LOGO_ASSETS.full.src, url).href } : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: settings.title,
      description: settings.description,
      ...(url ? { url } : {}),
    },
  ];
}

/** JSON for a `<script type="application/ld+json">`; `<` is escaped so CMS text cannot close the element. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function manifestFor(settings: SiteSettings): MetadataRoute.Manifest {
  return {
    name: settings.title,
    short_name: settings.title,
    description: settings.description,
    start_url: "/",
    // A website, not an installable app: no standalone display is claimed.
    display: "browser",
    background_color: brandTokens.color.cream,
    theme_color: brandTokens.color.cream,
    // app/icon.svg, generated from the canonical logo (scripts/generate-brand-assets.ts).
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
