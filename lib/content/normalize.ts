import { isCountryCode } from "../orders/countries";
import { FREEBIE_PATH } from "./freebie";
import { DEFAULT_SECTION_IDS, SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "./fallback";
import type { BrandPillar, Character, Cta, EcosystemEntry, EpisodePreview, FaqItem, ImageWithAlt, LandingPageContent, LegalSettings, PortableContent, SectionConfig, SectionId, SectionIntro, Seo, SiteSettings, SocialLink, Testimonial } from "./types";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = ""): string => typeof value === "string" && value.trim() ? value.trim() : fallback;
const optionalText = (value: unknown): string | undefined => text(value) || undefined;
const stringList = (value: unknown, fallback: string[]): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : fallback;
const validUrl = (value: unknown): string | undefined => { if (typeof value !== "string") return; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined; } catch { return; } };
/** A download: an https file, or a PDF in content/freebies, served only by the signed route (R140). */
const fileUrl = (value: unknown): string | undefined => typeof value === "string" && FREEBIE_PATH.test(value) ? value : validUrl(value);
/**
 * The lead section's download. A CMS lead section decides for itself (its reference, or none); a
 * landing document with no lead section keeps the repository's pack like every other fallback.
 * Only an available file at an accepted location is offered.
 */
const leadMagnet = (rawLead: unknown, fallback: LandingPageContent["lead"]["leadMagnet"]): { leadMagnet?: NonNullable<typeof fallback> } => {
  if (!rawLead || typeof rawLead !== "object") return fallback ? { leadMagnet: fallback } : {};
  const magnet = record(record(rawLead).leadMagnet), url = fileUrl(magnet.fileUrl);
  return magnet.available === true && url ? { leadMagnet: { title: text(magnet.title), description: text(magnet.description), fileUrl: url, available: true } } : {};
};
const href = (value: unknown): string | undefined => typeof value === "string" && /^\/(?!\/)[\w/#?=&%-]*$|^#[a-zA-Z][\w-]*$/.test(value) ? value : validUrl(value);
const cta = (raw: unknown, fallback: Cta): Cta => {
  const value = record(raw);
  const own = href(value.href);
  // A CTA that falls back to the repository destination keeps that destination's new-tab flag; an
  // editor's own destination is external only when the editor says so.
  const external = own ? value.external === true : fallback.external === true;
  return { label: text(value.label, fallback.label), href: own ?? fallback.href, ...(external ? { external: true } : {}) };
};
const imageGeometry = (raw: unknown, keys: string[]): Record<string, number> | undefined => {
  const value = record(raw);
  if (!keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) >= 0 && (value[key] as number) <= 1)) return;
  return Object.fromEntries(keys.map((key) => [key, value[key] as number]));
};
export const normalizeImage = (raw: unknown, identity: string): ImageWithAlt | undefined => {
  const value = record(raw); const asset = record(value.asset);
  const ref = text(asset._ref);
  if (!/^image-[a-zA-Z0-9_-]+-\d+x\d+-[a-zA-Z0-9]+$/.test(ref)) return undefined;
  const crop = imageGeometry(value.crop, ["top", "bottom", "left", "right"]);
  const hotspot = imageGeometry(value.hotspot, ["x", "y", "width", "height"]);
  return { asset: { _ref: ref }, alt: value.decorative === true ? "" : text(value.alt, `${identity} illustration`), ...(value.decorative === true ? { decorative: true } : {}), ...(optionalText(value.caption) ? { caption: text(value.caption) } : {}), ...(crop && crop.left! + crop.right! < 1 && crop.top! + crop.bottom! < 1 ? { crop } : {}), ...(hotspot ? { hotspot } : {}) };
};
const image = normalizeImage;
const intro = (raw: unknown, fallback: SectionIntro): SectionIntro => {
  const v = record(raw); const normalizedImage = image(v.image, text(v.heading, fallback.heading));
  return { eyebrow: text(v.eyebrow, fallback.eyebrow), heading: text(v.heading, fallback.heading), description: text(v.description, fallback.description), ...(normalizedImage ? { image: normalizedImage } : fallback.image ? { image: fallback.image } : {}) };
};
const DECORATORS = new Set(["strong", "em", "code", "underline", "strike-through"]);
export const normalizePortableContent = (value: unknown, fallback: PortableContent = []): PortableContent => Array.isArray(value) ? value.map(record).filter((b) => b._type === "block" && Array.isArray(b.children)).map((block) => {
  const markDefs = list(block.markDefs).map(record).filter((mark) => mark._type === "link" && optionalText(mark._key) && href(mark.href)).map((mark) => ({ _type: "link" as const, _key: text(mark._key), href: href(mark.href)! }));
  const keys = new Set(markDefs.map((mark) => mark._key));
  const children = list(block.children).map(record).filter((span) => span._type === "span" && typeof span.text === "string").map((span) => {
    const marks = list(span.marks).filter((mark): mark is string => typeof mark === "string" && (DECORATORS.has(mark) || keys.has(mark)));
    return { _type: "span" as const, ...(optionalText(span._key) ? { _key: text(span._key) } : {}), text: String(span.text), ...(Array.isArray(span.marks) ? { marks } : {}) };
  });
  const style = ["normal", "h2", "h3"].includes(String(block.style)) ? block.style as "normal" | "h2" | "h3" : undefined;
  return { _type: "block" as const, ...(optionalText(block._key) ? { _key: text(block._key) } : {}), ...(style ? { style } : {}), children, markDefs };
}).filter((block) => block.children.length > 0) : fallback;
const seo = (raw: unknown, fallback: Seo): Seo => { const v = record(raw); const art = image(v.image, text(v.title, fallback.title)); return { title: text(v.title, fallback.title), description: text(v.description, fallback.description), ...(art ? { image: art } : {}), ...(v.noIndex === true || fallback.noIndex === true ? { noIndex: true } : {}) }; };
const section = (id: SectionId, visible: boolean, raw: RecordValue): SectionConfig => {
  const theme = record(raw.theme);
  const background = ["paper", "sea", "sand", "navy"].includes(String(theme.background)) ? theme.background as NonNullable<SectionConfig["theme"]>["background"] : undefined;
  const accent = ["teal", "yellow", "orange", "purple"].includes(String(theme.accent)) ? theme.accent as NonNullable<SectionConfig["theme"]>["accent"] : undefined;
  return { id, visible, ...((background || accent) ? { theme: { ...(background ? { background } : {}), ...(accent ? { accent } : {}) } } : {}) };
};
const orderedSections = (raw: unknown, testimonialsEnabled: boolean): SectionConfig[] => {
  const candidates = Array.isArray(raw) && raw.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry)) ? raw : SAFE_FALLBACK_CONTENT.sections;
  const result: SectionConfig[] = []; const seen = new Set<SectionId>();
  for (const entry of candidates) { const v = record(entry); if (!DEFAULT_SECTION_IDS.includes(v.id as SectionId) || seen.has(v.id as SectionId)) continue;
    const id = v.id as SectionId; seen.add(id); result.push(section(id, id === "testimonials" && !testimonialsEnabled ? false : v.visible !== false, v));
  }
  return result;
};
const itemId = (v: RecordValue): string => text(v.id, text(v._id, text(v._key)));
const items = <T>(value: unknown, fallback: T[], parse: (value: RecordValue) => T | undefined): T[] => Array.isArray(value) ? list(value).map(record).map(parse).filter((entry): entry is T => entry !== undefined) : fallback;

export function normalizeLandingContent(raw: unknown, options: { testimonialsEnabled?: boolean } = {}): LandingPageContent {
  const v = record(raw); if (!Object.keys(v).length) return SAFE_FALLBACK_CONTENT;
  const f = SAFE_FALLBACK_CONTENT;
  const characters = items(v.characters, f.characters, (entry): Character | undefined => {
    const id = itemId(entry), name = text(entry.name); if (!id || !name) return;
    const art = image(entry.image, `${name} character concept`);
    return { id, name, species: text(entry.species), role: text(entry.role), description: text(entry.description), personality: text(entry.personality), catchphrase: text(entry.catchphrase), favoriteActivity: text(entry.favoriteActivity), teaches: stringList(entry.teaches, []), status: entry.status === "published" ? "published" : "concept", ...(art ? { image: art } : {}), ...(optionalText(entry.accentColor) ? { accentColor: text(entry.accentColor) } : {}) };
  });
  const episodes = items(v.episodes, f.episodes, (entry): EpisodePreview | undefined => {
    const id = itemId(entry), title = text(entry.title); if (!id || !title) return;
    const art = image(entry.image, `${title} story concept`);
    return { id, title, summary: text(entry.summary), characterFocus: text(entry.characterFocus), learningFocus: stringList(entry.learningFocus, []), offlinePrompt: text(entry.offlinePrompt), status: entry.status === "published" ? "published" : "concept", ...(art ? { image: art } : {}), ...(entry.status === "published" && validUrl(entry.mediaUrl) ? { mediaUrl: validUrl(entry.mediaUrl) } : {}) };
  });
  const testimonials = items(v.testimonials, [], (entry): Testimonial | undefined => { const id = itemId(entry), quote = text(entry.quote), attribution = text(entry.attribution); return entry.verified === true && id && quote && attribution ? { id, quote, attribution, verified: true } : undefined; });
  const allowProof = options.testimonialsEnabled === true && testimonials.length > 0;
  const steps = items(record(v.offline).steps, f.offline.steps, (entry) => { const title = text(entry.title), description = text(entry.description); return title && description ? { title, description } : undefined; });
  const hero = record(v.hero), trust = record(v.trust), promise = record(v.promise), lead = record(v.lead), finalCta = record(v.finalCta), episodesIntro = record(v.episodesIntro);
  return {
    sections: orderedSections(v.sections, allowProof), seo: seo(v.seo, f.seo),
    hero: { ...intro(hero, f.hero), title: text(hero.title, text(hero.heading, f.hero.title)), primaryCta: cta(hero.primaryCta, f.hero.primaryCta), secondaryCta: cta(hero.secondaryCta, f.hero.secondaryCta), artworkDescription: text(hero.artworkDescription, f.hero.artworkDescription) },
    trust: { ...intro(trust, f.trust), items: stringList(trust.items, f.trust.items) },
    promise: { ...intro(promise, f.promise), quote: text(promise.quote, f.promise.quote), body: normalizePortableContent(promise.body, f.promise.body) },
    charactersIntro: intro(v.charactersIntro, f.charactersIntro), characters,
    episodesIntro: { ...intro(episodesIntro, f.episodesIntro), conceptLabel: text(episodesIntro.conceptLabel, f.episodesIntro.conceptLabel), cta: cta(episodesIntro.cta, f.episodesIntro.cta) }, episodes,
    offline: { ...intro(v.offline, f.offline), steps },
    pillarsIntro: intro(v.pillarsIntro, f.pillarsIntro), pillars: items(v.pillars, f.pillars, (entry): BrandPillar | undefined => { const id = itemId(entry), title = text(entry.title); if (!id || !title) return; const art = image(entry.image, title); return { id, title, description: text(entry.description), prompts: stringList(entry.prompts, []), ...(art ? { image: art } : {}) }; }),
    ecosystemIntro: intro(v.ecosystemIntro, f.ecosystemIntro), ecosystem: items(v.ecosystem, f.ecosystem, (entry): EcosystemEntry | undefined => { const id = itemId(entry), name = text(entry.name); if (!id || !name) return; const art = image(entry.image, name); return { id, name, tagline: text(entry.tagline), description: text(entry.description), status: entry.status === "available" || entry.status === "in-development" ? entry.status : "idea", ...(art ? { image: art } : {}), ...(entry.status === "available" && record(entry.cta).label ? { cta: cta(entry.cta, { label: name, href: "#ecosystem" }) } : {}) }; }),
    testimonialsIntro: intro(v.testimonialsIntro, f.testimonialsIntro), testimonials: allowProof ? testimonials : [],
    lead: { ...intro(lead, f.lead), buttonLabel: text(lead.buttonLabel, f.lead.buttonLabel), consentCopy: text(lead.consentCopy, f.lead.consentCopy), successMessage: text(lead.successMessage, f.lead.successMessage), errorMessage: text(lead.errorMessage, f.lead.errorMessage), ...leadMagnet(v.lead, f.lead.leadMagnet) },
    faqIntro: intro(v.faqIntro, f.faqIntro), faqs: items(v.faqs, f.faqs, (entry): FaqItem | undefined => { const id = itemId(entry), question = text(entry.question), answer = text(entry.answer); return id && question && answer ? { id, question, answer } : undefined; }),
    finalCta: { ...intro(finalCta, f.finalCta), cta: cta(finalCta.cta, f.finalCta.cta) },
  };
}

/** R85: assigned country codes only, in capitals, once each, in the editor's order; empty means every country. */
const orderCountries = (value: unknown): string[] => [...new Set(list(value).filter((code): code is string => typeof code === "string").map((code) => code.trim().toUpperCase()).filter(isCountryCode))];
const SOCIAL_HOSTS: Record<string, string[]> = { instagram: ["instagram.com"], youtube: ["youtube.com", "youtu.be"], facebook: ["facebook.com"], tiktok: ["tiktok.com"], pinterest: ["pinterest.com"] };
export function normalizeSiteSettings(raw: unknown): SiteSettings {
  const v = record(raw); if (!Object.keys(v).length) return SAFE_FALLBACK_SETTINGS;
  const f = SAFE_FALLBACK_SETTINGS;
  const socialLinks = items(v.socialLinks, [], (entry): SocialLink | undefined => { const platform = text(entry.platform), safeUrl = validUrl(entry.url); if (entry.verified !== true || !safeUrl || !SOCIAL_HOSTS[platform]) return; const host = new URL(safeUrl).hostname.toLowerCase(); if (!SOCIAL_HOSTS[platform].some((domain) => host === domain || host === `www.${domain}`)) return; return { platform: platform as SocialLink["platform"], url: safeUrl, verified: true }; });
  const nav = record(v.navigation), footer = record(v.footer);
  return { title: text(v.title, f.title), description: text(v.description, f.description), seo: seo(v.seo, f.seo),
    ...(v.canonicalUrlVerified === true && validUrl(v.canonicalUrl) ? { canonicalUrl: validUrl(v.canonicalUrl) } : {}),
    commerceEnabled: v.commerceEnabled === true, trackingEnabled: v.trackingEnabled === true, testimonialsEnabled: v.testimonialsEnabled === true,
    orderCountries: orderCountries(v.orderCountries),
    ...(optionalText(v.contactEmail) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(v.contactEmail)) ? { contactEmail: text(v.contactEmail) } : {}),
    ...(validUrl(v.studioUrl) ? { studioUrl: validUrl(v.studioUrl) } : {}), socialLinks,
    navigation: { links: items(nav.links, f.navigation.links, (entry) => text(entry.label) && href(entry.href) ? cta(entry, f.navigation.primaryCta) : undefined), primaryCta: cta(nav.primaryCta, f.navigation.primaryCta), commerceLabel: text(nav.commerceLabel, f.navigation.commerceLabel) },
    footer: { text: text(footer.text, f.footer.text), legalLinks: items(footer.legalLinks, f.footer.legalLinks, (entry) => text(entry.label) && href(entry.href) ? cta(entry, f.footer.legalLinks[0]!) : undefined), contactLabel: text(footer.contactLabel, f.footer.contactLabel) },
  };
}
export function normalizeLegalSettings(raw: unknown): LegalSettings {
  const v = record(raw), f = SAFE_FALLBACK_LEGAL;
  // R82: the order consent sentence and its version come together, so an order never records a
  // version for words the buyer did not see.
  const orderCopy = text(v.orderConsentCopy), orderVersion = text(v.orderConsentCopyVersion);
  const orderConsent = orderCopy && orderVersion ? { orderConsentCopy: orderCopy, orderConsentCopyVersion: orderVersion } : { orderConsentCopy: f.orderConsentCopy, orderConsentCopyVersion: f.orderConsentCopyVersion };
  return { privacy: normalizePortableContent(v.privacy, f.privacy), terms: normalizePortableContent(v.terms, f.terms), ...(optionalText(v.privacyVersion) ? { privacyVersion: text(v.privacyVersion) } : {}), ...(optionalText(v.termsVersion) ? { termsVersion: text(v.termsVersion) } : {}), consentCopyVersion: text(v.consentCopyVersion, f.consentCopyVersion), ...orderConsent };
}
