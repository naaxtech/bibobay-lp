import "server-only";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "../content/fallback";
import { normalizeLandingContent, normalizeLegalSettings, normalizeSiteSettings } from "../content/normalize";
import type { ImageWithAlt, PortableContent, Product, ProductCategory } from "../content/types";
import { getSanityClient } from "./client";
import { LANDING_PAGE_QUERY, LEGAL_SETTINGS_QUERY, LISTED_PRODUCTS_QUERY, PRODUCT_BY_SLUG_QUERY, SITE_SETTINGS_QUERY } from "./queries";

export interface ContentOptions { preview?: boolean }

async function query<T>(groq: string, params: Record<string, string>, tags: string[], options: ContentOptions): Promise<T | null> {
  const client = getSanityClient(options);
  if (!client) return null;
  try {
    // No CDN for either variant; tags require fresh origin data after invalidation.
    return await client.fetch<T>(groq, params, options.preview
      ? { cache: "no-store", perspective: "drafts" }
      : { next: { tags, revalidate: false }, perspective: "published" });
  } catch {
    // Bad config, permissions, or network outage must not take down the public page.
    return null;
  }
}

export async function getSiteSettings(options: ContentOptions = {}) {
  return normalizeSiteSettings(await query<unknown>(SITE_SETTINGS_QUERY, {}, ["siteSettings"], options)) ?? SAFE_FALLBACK_SETTINGS;
}
export async function getLandingPage(options: ContentOptions = {}) {
  const settings = await getSiteSettings(options);
  const raw = await query<unknown>(LANDING_PAGE_QUERY, {}, ["landingPage", "character", "episodePreview", "brandPillar", "ecosystemEntry", "testimonial", "faqItem"], options);
  return raw === null ? SAFE_FALLBACK_CONTENT : normalizeLandingContent(raw, { testimonialsEnabled: settings.testimonialsEnabled });
}
export async function getLegalSettings(options: ContentOptions = {}) {
  const raw = await query<unknown>(LEGAL_SETTINGS_QUERY, {}, ["legalSettings"], options);
  return raw === null ? SAFE_FALLBACK_LEGAL : normalizeLegalSettings(raw);
}

const rec = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const str = (raw: unknown): string => typeof raw === "string" ? raw.trim() : "";
const slug = (raw: unknown): string => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(str(raw)) ? str(raw) : "";
const asset = (raw: unknown, label: string): ImageWithAlt | undefined => {
  const v = rec(raw), ref = str(rec(v.asset)._ref);
  if (!/^image-[a-zA-Z0-9_-]+-\d+x\d+-[a-zA-Z0-9]+$/.test(ref)) return;
  return { asset: { _ref: ref }, alt: v.decorative === true ? "" : str(v.alt) || `${label} product illustration`, ...(v.decorative === true ? { decorative: true } : {}), ...(str(v.caption) ? { caption: str(v.caption) } : {}) };
};
const category = (raw: unknown): ProductCategory | undefined => {
  const v = rec(raw), id = str(v.id), name = str(v.name), handle = slug(v.slug);
  if (!id || !name || !handle) return;
  const art = asset(v.image, name);
  return { id, name, slug: handle, description: str(v.description), order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0, ...(art ? { image: art } : {}) };
};
function normalizeProduct(raw: unknown): Product | null {
  const v = rec(raw), id = str(v.id) || str(v._id), name = str(v.name), handle = slug(v.slug);
  if (!id || !name || !handle || v.status !== "listed") return null;
  const images = Array.isArray(v.images) ? v.images.map((entry) => asset(entry, name)).filter((a): a is ImageWithAlt => !!a) : [];
  const linkedCategory = category(v.category);

  const details: PortableContent = Array.isArray(v.details) ? v.details.map(rec).filter((block) => block._type === "block" && Array.isArray(block.children)).map((block) => ({
    _type: "block" as const,
    children: (block.children as unknown[]).map(rec).filter((child) => child._type === "span" && typeof child.text === "string").map((child) => ({ _type: "span" as const, text: String(child.text) })),
    markDefs: [],
  })).filter((block) => block.children.length > 0) : [];
  const meta = rec(v.seo), notice = rec(v.commerceNotice);
  const seo = str(meta.title) && str(meta.description) ? { title: str(meta.title), description: str(meta.description), ...(meta.noIndex === true ? { noIndex: true } : {}), ...(asset(meta.image, name) ? { image: asset(meta.image, name) } : {}) } : undefined;
  const noticeCta = rec(notice.cta), ctaHref = str(noticeCta.href);
  let safeHref = /^\/(?!\/)[\w/#?=&%-]*$|^#[a-zA-Z][\w-]*$/.test(ctaHref) ? ctaHref : "";
  if (!safeHref) { try { const url = new URL(ctaHref); if (url.protocol === "https:" && !url.username && !url.password) safeHref = url.toString(); } catch { /* invalid link is omitted */ } }
  const commerceNotice = str(notice.title) && str(notice.body) ? { title: str(notice.title), body: str(notice.body), ...(str(noticeCta.label) && safeHref ? { cta: { label: str(noticeCta.label), href: safeHref, ...(noticeCta.external === true ? { external: true } : {}) } } : {}) } : undefined;
  return { id, name, slug: handle, description: str(v.description), details, images, status: "listed", order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0,
    ...(linkedCategory ? { category: linkedCategory } : {}),
    ...(seo ? { seo } : {}), ...(commerceNotice ? { commerceNotice } : {}) };
}
export async function getListedProducts(options: ContentOptions = {}): Promise<Product[]> {
  const settings = await getSiteSettings(options);
  if (!settings.commerceEnabled) return [];
  const raw = await query<unknown>(LISTED_PRODUCTS_QUERY, {}, ["product", "productCategory"], options);
  return Array.isArray(raw) ? raw.map(normalizeProduct).filter((entry): entry is Product => entry !== null) : [];
}
export async function getProductBySlug(handle: string, options: ContentOptions = {}): Promise<Product | null> {
  if (!slug(handle)) return null;
  const settings = await getSiteSettings(options);
  if (!settings.commerceEnabled) return null;
  const raw = await query<unknown>(PRODUCT_BY_SLUG_QUERY, { slug: handle }, ["product", "productCategory"], options);
  return normalizeProduct(raw);
}
