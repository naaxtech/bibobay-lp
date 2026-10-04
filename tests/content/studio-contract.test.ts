import { describe, expect, it } from "vitest";
import { schemaTypes } from "@/studio/schemaTypes";
import { buildSeedDocuments } from "@/studio/scripts/seed-data";
import { LANDING_PAGE_QUERY } from "@/lib/sanity/queries";

type Field = { name: string; type: string; of?: Array<{ type: string; to?: Array<{ type: string }> }>; to?: Array<{ type: string }>; fields?: Field[]; initialValue?: unknown };
type Schema = { name: string; type: string; fields?: Field[] };
const types = new Map((schemaTypes as Schema[]).map((s) => [s.name, s]));
const fields = (name: string) => new Map(types.get(name)?.fields?.map((f) => [f.name, f]) ?? []);
const covers = (name: string, keys: string[]) => {
  const actual = fields(name);
  for (const key of keys) expect(actual.has(key), `${name}.${key} must be editable`).toBe(true);
};

describe("Studio content model", () => {
  it("models every public contract field with editable typed data", () => {
    covers("siteSettings", ["title", "description", "canonicalUrl", "canonicalUrlVerified", "seo", "commerceEnabled", "trackingEnabled", "testimonialsEnabled", "contactEmail", "studioUrl", "socialLinks", "navigation", "footer"]);
    covers("landingPage", ["sections", "seo", "hero", "trust", "promise", "charactersIntro", "characters", "episodesIntro", "episodes", "offline", "pillarsIntro", "pillars", "ecosystemIntro", "ecosystem", "testimonialsIntro", "testimonials", "lead", "faqIntro", "faqs", "finalCta"]);
    covers("legalSettings", ["privacy", "terms", "privacyVersion", "termsVersion", "consentCopyVersion"]);
    covers("character", ["name", "species", "role", "description", "personality", "catchphrase", "favoriteActivity", "teaches", "image", "status", "accentColor"]);
    covers("episodePreview", ["title", "summary", "characterFocus", "learningFocus", "offlinePrompt", "image", "mediaUrl", "status"]);
    covers("brandPillar", ["title", "description", "prompts", "image"]);
    covers("ecosystemEntry", ["name", "tagline", "description", "status", "image", "cta"]);
    covers("testimonial", ["quote", "attribution", "verified"]);
    covers("faqItem", ["question", "answer"]);
    covers("leadMagnet", ["title", "description", "fileUrl", "available"]);
    covers("productCategory", ["name", "slug", "description", "image", "order"]);
    covers("product", ["name", "slug", "description", "details", "images", "category", "status", "order", "seo", "commerceNotice"]);
    for (const type of ["imageWithAlt", "cta", "seo", "socialLink", "sectionTheme", "commerceNotice", "sectionIntro", "landingSection", "heroSection", "trustSection", "promiseSection", "episodesSectionIntro", "offlineSection", "leadSection", "finalCtaSection", "navigationSettings", "footerSettings"]) expect(types.has(type), `${type} object schema`).toBe(true);
    expect(types.get("imageWithAlt")?.type).toBe("image"); // Sanity image owns asset, crop and hotspot intrinsically.
    covers("imageWithAlt", ["alt", "caption", "decorative"]);
    covers("cta", ["label", "href", "external"]);
    covers("socialLink", ["platform", "url", "verified"]);
    covers("seo", ["title", "description", "image", "noIndex"]);
    covers("landingSection", ["id", "visible", "theme"]);
    covers("heroSection", ["eyebrow", "heading", "description", "image", "title", "primaryCta", "secondaryCta", "artworkDescription"]);
    covers("trustSection", ["eyebrow", "heading", "description", "image", "items"]);
    covers("promiseSection", ["eyebrow", "heading", "description", "image", "quote", "body"]);
    covers("leadSection", ["eyebrow", "heading", "description", "image", "buttonLabel", "consentCopy", "successMessage", "errorMessage", "leadMagnet"]);
    covers("navigationSettings", ["links", "primaryCta", "commerceLabel"]);
    covers("footerSettings", ["text", "legalLinks", "contactLabel"]);
    expect(fields("product").has("price")).toBe(false);
    expect(fields("product").has("currency")).toBe(false);
    for (const flag of ["commerceEnabled", "trackingEnabled", "testimonialsEnabled"]) expect(fields("siteSettings").get(flag)?.initialValue).toBe(false);
  });

  it("dereferences each landing collection and lead magnet to the normalizer shape", () => {
    const landing = fields("landingPage");
    for (const [field, target] of Object.entries({ characters: "character", episodes: "episodePreview", pillars: "brandPillar", ecosystem: "ecosystemEntry", testimonials: "testimonial", faqs: "faqItem" })) {
      expect(landing.get(field)?.of?.[0]?.to?.[0]?.type).toBe(target);
      expect(LANDING_PAGE_QUERY).toContain(`"${field}": ${field}[]->`);
    }
    expect(fields("leadSection").get("leadMagnet")?.to?.[0]?.type).toBe("leadMagnet");
    expect(LANDING_PAGE_QUERY).toMatch(/"leadMagnet"\s*:\s*leadMagnet->/);
  });
});

describe("claim-safe editorial seed", () => {
  it("provides idempotent fixed-ID singletons and real concepts only", () => {
    const docs = buildSeedDocuments();
    expect(new Set(docs.map((d) => d._id)).size).toBe(docs.length);
    expect(docs.filter((d) => d._type === "character")).toHaveLength(6);
    expect(docs.filter((d) => d._type === "episodePreview")).toHaveLength(3);
    expect(docs.filter((d) => d._type === "ecosystemEntry")).toHaveLength(8);
    for (const [id, type] of [["siteSettings", "siteSettings"], ["landingPage", "landingPage"], ["legalSettings", "legalSettings"]]) expect(docs.find((d) => d._id === id)?._type).toBe(type);
    const site = docs.find((d) => d._id === "siteSettings")!;
    expect([site.commerceEnabled, site.trackingEnabled, site.testimonialsEnabled]).toEqual([false, false, false]);
    expect(site.socialLinks).toEqual([]);
    const landing = docs.find((d) => d._id === "landingPage")!;
    expect(landing.testimonials).toEqual([]);
    expect(landing.episodes).toHaveLength(3);
    expect(landing.characters).toHaveLength(6);
    expect(landing.ecosystem).toHaveLength(8);
    expect((landing.sections as Array<{ id: string; visible: boolean }>).find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect((landing.lead as Record<string, unknown>).leadMagnet).toBeUndefined();
    for (const episode of docs.filter((d) => d._type === "episodePreview")) {
      expect(episode.status).toBe("concept");
      expect(episode.mediaUrl).toBeUndefined();
    }
    expect(JSON.stringify(docs)).not.toMatch(/"(?:price|currency|canonicalUrl|studioUrl|contactEmail|fileUrl|verified|mediaUrl)"\s*:/);
  });
});
