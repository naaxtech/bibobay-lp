import { describe, expect, it, vi } from "vitest";
import { schemaTypes } from "@/studio/schemaTypes";
import { buildSeedDocuments } from "@/studio/scripts/seed-data";
import { LANDING_PAGE_QUERY } from "@/lib/sanity/queries";
import { SAFE_FALLBACK_CONTACT_PAGE, SAFE_FALLBACK_LEGAL } from "@/lib/content/fallback";
import { DELIVERY_CLAIM_PATTERN } from "@/lib/content/claims";
import { normalizeContactPage } from "@/lib/content/normalize";
import { DELIVERY_CLAIM_PATTERN as STUDIO_DELIVERY_CLAIM_PATTERN, deliveryClaimProblem } from "@/studio/schemaTypes/contact";
import { SINGLETON_IDS } from "@/studio/structure";
import { mainDocuments, locations } from "@/studio/presentation/resolve";
import { ISO_COUNTRY_CODES } from "@/lib/orders/countries";
import { ORDER_COUNTRY_CODES, orderCountriesProblem } from "@/studio/schemaTypes/countries";
import { CONSENT_VERSION as STUDIO_CONSENT_VERSION, orderConsentVersionProblem } from "@/studio/schemaTypes/consent";
import { CONSENT_VERSION_PATTERN } from "@/lib/leads/dependencies";

// lib/leads/dependencies is server-only; this test reads one constant from it.
vi.mock("server-only", () => ({}));

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
    covers("legalSettings", ["privacy", "terms", "privacyVersion", "termsVersion", "consentCopyVersion", "orderConsentCopy", "orderConsentCopyVersion"]);
    // R85: the countries an order may be delivered to; empty means every country.
    covers("siteSettings", ["orderCountries"]);
    covers("character", ["name", "species", "role", "description", "personality", "catchphrase", "favoriteActivity", "teaches", "image", "status", "accentColor"]);
    covers("episodePreview", ["title", "summary", "characterFocus", "learningFocus", "offlinePrompt", "image", "mediaUrl", "status"]);
    covers("brandPillar", ["title", "description", "prompts", "image"]);
    covers("ecosystemEntry", ["name", "tagline", "description", "status", "image", "cta"]);
    covers("testimonial", ["quote", "attribution", "verified"]);
    covers("faqItem", ["question", "answer"]);
    covers("leadMagnet", ["title", "description", "fileUrl", "available"]);
    covers("productCategory", ["name", "slug", "description", "image", "order"]);
    // R80: SKU, variant and pack are what an order snapshots (spec §10 step 5).
    covers("product", ["name", "slug", "description", "details", "images", "category", "status", "order", "seo", "commerceNotice", "sku", "variant", "pack"]);
    for (const type of ["imageWithAlt", "cta", "seo", "socialLink", "sectionTheme", "commerceNotice", "sectionIntro", "landingSection", "heroSection", "trustSection", "promiseSection", "episodesSectionIntro", "offlineSection", "leadSection", "finalCtaSection", "navigationSettings", "footerSettings"]) expect(types.has(type), `${type} object schema`).toBe(true);
    expect(types.get("imageWithAlt")?.type).toBe("image"); // Sanity image owns asset, crop and hotspot intrinsically.
    covers("imageWithAlt", ["alt", "caption", "decorative"]);
    covers("cta", ["label", "href", "external"]);
    covers("socialLink", ["platform", "url", "verified"]);
    covers("seo", ["title", "description", "image", "noIndex"]);
    covers("landingSection", ["id", "visible", "theme"]);
    covers("heroSection", ["eyebrow", "heading", "description", "image", "title", "primaryCta", "secondaryCta", "artworkDescription"]);
    covers("episodesSectionIntro", ["eyebrow", "heading", "description", "image", "conceptLabel", "cta"]);
    covers("trustSection", ["eyebrow", "heading", "description", "image", "items"]);
    covers("promiseSection", ["eyebrow", "heading", "description", "image", "quote", "body"]);
    covers("leadSection", ["eyebrow", "heading", "description", "image", "buttonLabel", "consentCopy", "successMessage", "errorMessage", "leadMagnet"]);
    covers("navigationSettings", ["links", "primaryCta", "commerceLabel"]);
    covers("footerSettings", ["text", "legalLinks", "contactLabel", "contactPageLabel"]);
    // R158, R163: the contact page's copy, one editable field per visible string.
    covers("contactPage", ["seo", "heading", "description", "buttonLabel", "successMessage", "errorMessage", "closedMessage", "emailIntro"]);
    expect(types.get("contactPage")?.type).toBe("document");
    expect(fields("contactPage").get("seo")?.type).toBe("seo");
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
    expect(site.orderCountries).toEqual([]);
    // R82: the order form's own consent sentence and version, as the repository fallback has them.
    const legal = docs.find((d) => d._id === "legalSettings")!;
    expect([legal.orderConsentCopy, legal.orderConsentCopyVersion]).toEqual([SAFE_FALLBACK_LEGAL.orderConsentCopy, SAFE_FALLBACK_LEGAL.orderConsentCopyVersion]);
    // The one owner-confirmed account: the Bibo Bay YouTube channel.
    expect(site.socialLinks).toEqual([{ _type: "socialLink", _key: "youtube", platform: "youtube", url: "https://www.youtube.com/@bibobay-tv", verified: true }]);
    const landing = docs.find((d) => d._id === "landingPage")!;
    expect(landing.testimonials).toEqual([]);
    expect(landing.episodes).toHaveLength(7);
    expect(landing.characters).toHaveLength(3);
    expect(landing.ecosystem).toHaveLength(8);
    expect((landing.sections as Array<{ id: string; visible: boolean }>).find((s) => s.id === "testimonials")?.visible).toBe(false);
    // The one download: the activity pack this repository ships (R66).
    expect((landing.lead as Record<string, unknown>).leadMagnet).toEqual({ _type: "reference", _ref: "leadMagnet-activity-pack" });
    const pack = docs.find((d) => d._id === "leadMagnet-activity-pack")!;
    expect(pack).toMatchObject({ _type: "leadMagnet", fileUrl: "/freebies/bibo-bay-activity-pack.pdf", available: true });
    for (const episode of docs.filter((d) => d._type === "episodePreview")) {
      expect(episode.status).toBe("published");
      const id = /^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})$/.exec(String(episode.mediaUrl))?.[1];
      expect(id && VERIFIED_VIDEO_IDS.has(id), `${episode._id} links a verified channel video`).toBe(true);
    }
    for (const character of docs.filter((d) => d._type === "character")) expect(character.status).toBe("published");
    // Media and verification appear only where checked above; prices, private contacts and downloads never.
    const others = docs.filter((d) => d._type !== "episodePreview" && d._id !== "siteSettings");
    expect(JSON.stringify(others)).not.toMatch(/"(?:verified|mediaUrl)"\s*:/);
    expect(JSON.stringify(docs)).not.toMatch(/"(?:price|currency|canonicalUrl|studioUrl|contactEmail)"\s*:/);
    expect(docs.filter((d) => "fileUrl" in d).map((d) => d._id)).toEqual(["leadMagnet-activity-pack"]);
  });
});

describe("hero artwork description (rebrand re-review N3)", () => {
  it("tells editors when the description is used, since channel art normally fills the hero", () => {
    const field = (types.get("heroSection")?.fields as Array<Field & { description?: string }> | undefined)?.find((f) => f.name === "artworkDescription");
    expect(field?.description).toMatch(/only when/i);
    expect(field?.description).toMatch(/channel/i);
  });
});

describe("order countries in the Studio (R85)", () => {
  it("checks codes against the same ISO 3166-1 list the site uses", () => {
    expect([...ORDER_COUNTRY_CODES]).toEqual([...ISO_COUNTRY_CODES]);
  });

  it("accepts none, or assigned two-letter codes in capitals, each once", () => {
    expect(orderCountriesProblem(undefined)).toBe(true);
    expect(orderCountriesProblem([])).toBe(true);
    expect(orderCountriesProblem(["PH", "AU", "GB"])).toBe(true);
  });

  it("explains a code that is not one, and a repeated country", () => {
    expect(orderCountriesProblem(["UK"])).toMatch(/UK/);
    expect(orderCountriesProblem(["ph"])).toMatch(/ph/);
    expect(orderCountriesProblem(["PH", "PH"])).toMatch(/once/);
  });

  it("asks for an order consent version whenever the order consent sentence is set (R82)", () => {
    const field = (types.get("legalSettings")?.fields as Array<Field & { description?: string }> | undefined)?.find((f) => f.name === "orderConsentCopyVersion");
    expect(field?.description).toMatch(/change it whenever/i);
  });
});

describe("the order consent version check (Task 7c review M5a, M5b)", () => {
  it("asks for a version when the sentence is set, accepts none when it is not, and accepts only a short token", () => {
    expect(orderConsentVersionProblem("", "I agree.")).toMatch(/version/i);
    expect(orderConsentVersionProblem(undefined, "I agree.")).toMatch(/version/i);
    expect(orderConsentVersionProblem("", "")).toBe(true);
    expect(orderConsentVersionProblem(undefined, undefined)).toBe(true);
    expect(orderConsentVersionProblem("order-2", "I agree.")).toBe(true);
    expect(orderConsentVersionProblem(" order-2 ", "I agree.")).toBe(true);
    expect(orderConsentVersionProblem("<b>2</b>", "I agree.")).toMatch(/token/i);
    expect(orderConsentVersionProblem("x".repeat(41), "I agree.")).toMatch(/token/i);
  });

  it("is the Studio rule the field runs", () => {
    const field = (types.get("legalSettings")?.fields as Array<Field & { validation?: unknown }> | undefined)?.find((f) => f.name === "orderConsentCopyVersion");
    expect(String(field?.validation)).toContain("orderConsentVersionProblem");
  });

  it("uses the same token pattern as the site (no drift from lib/leads/dependencies.ts)", () => {
    expect(STUDIO_CONSENT_VERSION.source).toBe(CONSENT_VERSION_PATTERN.source);
    expect(STUDIO_CONSENT_VERSION.flags).toBe(CONSENT_VERSION_PATTERN.flags);
  });
});

describe("the contact page in the Studio (R158, R163)", () => {
  it("is a singleton the structure, the Presentation tool and the seed all know", () => {
    expect([...SINGLETON_IDS]).toContain("contactPage");
    const docs = buildSeedDocuments();
    expect(docs.filter((d) => d._id === "contactPage")).toHaveLength(1);
    expect(docs.find((d) => d._id === "contactPage")?._type).toBe("contactPage");
    expect(JSON.stringify(mainDocuments)).toContain("/contact");
    expect(JSON.stringify(mainDocuments)).toContain("contactPage");
    expect(Object.keys(locations)).toContain("contactPage");
  });

  it("seeds exactly the repository fallback copy and the footer's page label", () => {
    const docs = buildSeedDocuments();
    const seeded = docs.find((d) => d._id === "contactPage")!;
    expect(normalizeContactPage(seeded)).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
    expect(seeded.heading).toBe(SAFE_FALLBACK_CONTACT_PAGE.heading);
    expect(seeded.successMessage).toBe(SAFE_FALLBACK_CONTACT_PAGE.successMessage);
    expect((docs.find((d) => d._id === "siteSettings")!.footer as Record<string, unknown>).contactPageLabel).toBe("Contact us");
  });

  it("runs the delivery-claim check on the success message", () => {
    const field = (types.get("contactPage")?.fields as Array<Field & { validation?: unknown }> | undefined)?.find((f) => f.name === "successMessage");
    expect(String(field?.validation)).toContain("deliveryClaimProblem");
  });

  it("refuses a success message that claims delivery and accepts the fallback", () => {
    expect(deliveryClaimProblem("We emailed the team")).toMatch(/received/i);
    expect(deliveryClaimProblem("Your message was sent")).not.toBe(true);
    expect(deliveryClaimProblem(SAFE_FALLBACK_CONTACT_PAGE.successMessage)).toBe(true);
    expect(deliveryClaimProblem(undefined)).toBe(true);
    expect(deliveryClaimProblem("")).toBe(true);
  });

  it("uses the same claim pattern as the site (no drift from lib/content/claims.ts)", () => {
    expect(STUDIO_DELIVERY_CLAIM_PATTERN.source).toBe(DELIVERY_CLAIM_PATTERN.source);
    expect(STUDIO_DELIVERY_CLAIM_PATTERN.flags).toBe(DELIVERY_CLAIM_PATTERN.flags);
  });

  it("explains where each field shows on the page", () => {
    for (const field of fields("contactPage").values()) expect((field as Field & { description?: string }).description, `contactPage.${field.name}`).toBeTruthy();
  });
});
