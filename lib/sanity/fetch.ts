import "server-only";
import { SAFE_FALLBACK_CONTACT_PAGE, SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "../content/fallback";
import { normalizeContactPage, normalizeImage, normalizeLandingContent, normalizeLegalSettings, normalizePortableContent, normalizeSiteSettings } from "../content/normalize";
import type { ImageWithAlt, Product, ProductCategory } from "../content/types";
import { plain, stegaCleanText, stegaText } from "../content/stega";
import { getSanityClient } from "./client";
import { readPreviewPerspective } from "./draft-mode";
import { CONTACT_PAGE_QUERY, LANDING_PAGE_QUERY, LEGAL_SETTINGS_QUERY, LISTED_PRODUCTS_QUERY, ORDER_PRODUCTS_QUERY, PRODUCT_BY_SLUG_QUERY, SITE_SETTINGS_QUERY } from "./queries";

export interface ContentOptions { preview?: boolean }

/**
 * `revalidate` (published reads only): `false` caches until the tag is revalidated (the default);
 * a number of seconds also expires the entry on its own after that long.
 */
async function query<T>(groq: string, params: Record<string, string>, tags: string[], options: ContentOptions, revalidate: number | false = false): Promise<T | null> {
  const client = getSanityClient(options);
  if (!client) return null;
  try {
    // No CDN for either variant; tags require fresh origin data after invalidation. A preview reads
    // with the perspective the Studio picked (drafts unless it chose published or a release, R162).
    return await client.fetch<T>(groq, params, options.preview
      ? { cache: "no-store", perspective: await readPreviewPerspective() }
      : { next: { tags, revalidate }, perspective: "published" });
  } catch {
    // Bad config, permissions, or network outage must not take down the public page.
    return null;
  }
}

export async function getSiteSettings(options: ContentOptions = {}) {
  return normalizeSiteSettings(await query<unknown>(SITE_SETTINGS_QUERY, {}, ["siteSettings"], options)) ?? SAFE_FALLBACK_SETTINGS;
}

/**
 * Fix wave D-M2, Ruling R127: the longest a server gate may act on a cached commerce switch.
 * src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/fetch.md (options.next.revalidate) · next 16.3.8 · 2026-10-16
 */
export const GATE_SETTINGS_REVALIDATE_SECONDS = 300;

/**
 * The site settings for a server gate (`isCommerceEnabled` / `isTrackingEnabled` on the order and
 * tracking API routes): the same document as `getSiteSettings`, tagged `siteSettings` as well, but
 * cached for at most GATE_SETTINGS_REVALIDATE_SECONDS. If the revalidation webhook breaks (say,
 * SANITY_REVALIDATE_SECRET rotated on one side only), switching commerce off in Studio still stops
 * orders within five minutes instead of never. The landing page keeps `getSiteSettings`, tag-only.
 */
export async function getGateSettings(options: ContentOptions = {}) {
  return normalizeSiteSettings(await query<unknown>(SITE_SETTINGS_QUERY, {}, ["siteSettings"], options, GATE_SETTINGS_REVALIDATE_SECONDS)) ?? SAFE_FALLBACK_SETTINGS;
}
export async function getLandingPage(options: ContentOptions = {}) {
  const settings = await getSiteSettings(options);
  const raw = await query<unknown>(LANDING_PAGE_QUERY, {}, ["landingPage", "character", "episodePreview", "brandPillar", "ecosystemEntry", "testimonial", "faqItem"], options);
  return raw === null ? SAFE_FALLBACK_CONTENT : normalizeLandingContent(raw, { testimonialsEnabled: settings.testimonialsEnabled });
}
/** R158, R163: the /contact copy; the repository fallback when Sanity is absent, unreadable or has no document. */
export async function getContactPage(options: ContentOptions = {}) {
  const raw = await query<unknown>(CONTACT_PAGE_QUERY, {}, ["contactPage"], options);
  return raw === null ? SAFE_FALLBACK_CONTACT_PAGE : normalizeContactPage(raw);
}
export async function getLegalSettings(options: ContentOptions = {}) {
  const raw = await query<unknown>(LEGAL_SETTINGS_QUERY, {}, ["legalSettings"], options);
  return raw === null ? SAFE_FALLBACK_LEGAL : normalizeLegalSettings(raw);
}

const rec = (raw: unknown): Record<string, unknown> => raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
/** Display text; keeps a Studio preview's click-to-edit payload (R160). */
const str = (raw: unknown): string => stegaText(raw);
/** An id, slug, link or code: never with a payload (R160). */
const code = (raw: unknown): string => typeof raw === "string" ? stegaCleanText(raw).trim() : "";
const slug = (raw: unknown): string => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code(raw)) ? code(raw) : "";
const asset = (raw: unknown, label: string): ImageWithAlt | undefined => normalizeImage(raw, `${label} product`);
const category = (raw: unknown): ProductCategory | undefined => {
  const v = rec(raw), id = code(v.id), name = str(v.name), handle = slug(v.slug);
  if (!id || !name || !handle) return;
  const art = asset(v.image, name);
  return { id, name, slug: handle, description: str(v.description), order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0, ...(art ? { image: art } : {}) };
};
/** Statuses a public page may show: the catalogue lists only `listed`; a product page also shows `sold-out`. */
type PublicStatus = Exclude<Product["status"], "draft">;
const isPublicStatus = (value: unknown, accepted: readonly PublicStatus[]): value is PublicStatus => accepted.includes(value as PublicStatus);
function normalizeProduct(raw: unknown, accepted: readonly PublicStatus[] = ["listed"]): Product | null {
  const v = rec(raw), id = code(v.id) || code(v._id), name = str(v.name), handle = slug(v.slug), status = plain(v.status);
  if (!id || !name || !handle || !isPublicStatus(status, accepted)) return null;
  const images = Array.isArray(v.images) ? v.images.map((entry) => asset(entry, name)).filter((a): a is ImageWithAlt => !!a) : [];
  const linkedCategory = category(v.category);

  const details = normalizePortableContent(v.details);
  const meta = rec(v.seo), notice = rec(v.commerceNotice);
  const seo = str(meta.title) && str(meta.description) ? { title: str(meta.title), description: str(meta.description), ...(meta.noIndex === true ? { noIndex: true } : {}), ...(asset(meta.image, name) ? { image: asset(meta.image, name) } : {}) } : undefined;
  const noticeCta = rec(notice.cta), ctaHref = code(noticeCta.href);
  let safeHref = /^\/(?!\/)[\w/#?=&%-]*$|^#[a-zA-Z][\w-]*$/.test(ctaHref) ? ctaHref : "";
  if (!safeHref) { try { const url = new URL(ctaHref); if (url.protocol === "https:" && !url.username && !url.password) safeHref = url.toString(); } catch { /* invalid link is omitted */ } }
  const commerceNotice = str(notice.title) && str(notice.body) ? { title: str(notice.title), body: str(notice.body), ...(str(noticeCta.label) && safeHref ? { cta: { label: str(noticeCta.label), href: safeHref, ...(noticeCta.external === true ? { external: true } : {}) } } : {}) } : undefined;
  // R80: optional order snapshot fields; a blank or non-text value is left out.
  const codes = Object.fromEntries((["sku", "variant", "pack"] as const).flatMap((key) => (code(v[key]) ? [[key, code(v[key])]] : []))) as Pick<Product, "sku" | "variant" | "pack">;
  return { id, name, slug: handle, description: str(v.description), details, images, status, order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0,
    ...(linkedCategory ? { category: linkedCategory } : {}), ...codes,
    ...(seo ? { seo } : {}), ...(commerceNotice ? { commerceNotice } : {}) };
}
export async function getListedProducts(options: ContentOptions = {}): Promise<Product[]> {
  const settings = await getSiteSettings(options);
  if (!settings.commerceEnabled) return [];
  const raw = await query<unknown>(LISTED_PRODUCTS_QUERY, {}, ["product", "productCategory"], options);
  return Array.isArray(raw) ? raw.map((entry) => normalizeProduct(entry)).filter((entry): entry is Product => entry !== null) : [];
}
export async function getProductBySlug(handle: string, options: ContentOptions = {}): Promise<Product | null> {
  if (!slug(handle)) return null;
  const settings = await getSiteSettings(options);
  if (!settings.commerceEnabled) return null;
  const raw = await query<unknown>(PRODUCT_BY_SLUG_QUERY, { slug: handle }, ["product", "productCategory"], options);
  // A sold-out product keeps its page (shared links keep working, marked sold out); drafts do not.
  return normalizeProduct(raw, ["listed", "sold-out"]);
}

/**
 * The CMS documents an order may snapshot (lib/orders/catalogue.ts): read fresh from the published
 * dataset on every order, never from the Data Cache, so a product unlisted a moment ago cannot be
 * ordered from a stale copy. Null when Sanity is unconfigured, unreachable or answers oddly.
 */
export async function getOrderableProducts(ids: readonly string[]): Promise<unknown[] | null> {
  const client = getSanityClient();
  if (!client) return null;
  try {
    const raw = await client.fetch<unknown>(ORDER_PRODUCTS_QUERY, { ids: [...ids] }, { cache: "no-store", perspective: "published" });
    return Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}
