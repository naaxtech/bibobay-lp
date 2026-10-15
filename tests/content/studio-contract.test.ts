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
  // The channel's real videos (ruling R55), checked on 2026-10-15; the seed may link nothing else.
  const VERIFIED_VIDEO_IDS = new Set(["3birY6XZ3_c", "1pp8G-bKeik", "6URNMNeC_3Y", "RNfHUxM-Bso", "CvQeoCVk_mc", "yrpyvb5dVbA", "V4HEDvQD7vg"]);

  it("provides idempotent fixed-ID singletons with the channel's cast and real videos only", () => {
    const docs = buildSeedDocuments();
    expect(new Set(docs.map((d) => d._id)).size).toBe(docs.length);
    expect(docs.filter((d) => d._type === "character")).toHaveLength(3);
    expect(docs.filter((d) => d._type === "episodePreview")).toHaveLength(7);
    expect(docs.filter((d) => d._type === "ecosystemEntry")).toHaveLength(8);
    for (const [id, type] of [["siteSettings", "siteSettings"], ["landingPage", "landingPage"], ["legalSettings", "legalSettings"]]) expect(docs.find((d) => d._id === id)?._type).toBe(type);
    const site = docs.find((d) => d._id === "siteSettings")!;
    expect([site.commerceEnabled, site.trackingEnabled, site.testimonialsEnabled]).toEqual([false, false, false]);
    // The one owner-confirmed account: the Bibo Bay YouTube channel.
    expect(site.socialLinks).toEqual([{ _type: "socialLink", _key: "youtube", platform: "youtube", url: "https://www.youtube.com/@bibobay-tv", verified: true }]);
    const landing = docs.find((d) => d._id === "landingPage")!;
    expect(landing.testimonials).toEqual([]);
    expect(landing.episodes).toHaveLength(7);
    expect(landing.characters).toHaveLength(3);
    expect(landing.ecosystem).toHaveLength(8);
    expect((landing.sections as Array<{ id: string; visible: boolean }>).find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect((landing.lead as Record<string, unknown>).leadMagnet).toBeUndefined();
    for (const episode of docs.filter((d) => d._type === "episodePreview")) {
      expect(episode.status).toBe("published");
      const id = /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})$/.exec(String(episode.mediaUrl))?.[1];
      expect(id && VERIFIED_VIDEO_IDS.has(id), `${episode._id} links a verified channel video`).toBe(true);
    }
    for (const character of docs.filter((d) => d._type === "character")) expect(character.status).toBe("published");
    // Media and verification appear only where checked above; prices, private contacts and downloads never.
    const others = docs.filter((d) => d._type !== "episodePreview" && d._id !== "siteSettings");
    expect(JSON.stringify(others)).not.toMatch(/"(?:verified|mediaUrl)"\s*:/);
    expect(JSON.stringify(docs)).not.toMatch(/"(?:price|currency|canonicalUrl|studioUrl|contactEmail|fileUrl)"\s*:/);
  });
});

describe("hero artwork description (rebrand re-review N3)", () => {
  it("tells editors when the description is used, since channel art normally fills the hero", () => {
    const field = (types.get("heroSection")?.fields as Array<Field & { description?: string }> | undefined)?.find((f) => f.name === "artworkDescription");
    expect(field?.description).toMatch(/only when/i);
    expect(field?.description).toMatch(/channel/i);
  });
});
