import { describe, expect, it } from "vitest";
import { normalizeLandingContent, normalizeSiteSettings, normalizeLegalSettings } from "@/lib/content/normalize";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

describe("untrusted editorial content", () => {
  it("uses complete safe copy for missing or malformed landing documents", () => {
    expect(normalizeLandingContent(null)).toEqual(SAFE_FALLBACK_CONTENT);
    expect(normalizeLandingContent({ hero: { title: "  " }, characters: "bad" })).toEqual(SAFE_FALLBACK_CONTENT);
  });

  it("preserves editor order, excludes unknown or duplicated IDs, and hides unverified proof", () => {
    const result = normalizeLandingContent({
      sections: [{ id: "faq", visible: true }, { id: "hero", visible: false }, { id: "bogus", visible: true }, { id: "faq", visible: true }, { id: "testimonials", visible: true }],
      testimonials: [{ id: "invented", quote: "A quote", verified: false }],
    });
    expect(result.sections.map((s) => s.id).slice(0, 2)).toEqual(["faq", "hero"]);
    expect(result.sections.find((s) => s.id === "hero")?.visible).toBe(true);
    expect(result.sections.find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect(new Set(result.sections.map((s) => s.id)).size).toBe(result.sections.length);
    expect(result.testimonials).toEqual([]);
  });

  it("fills image alt from honest identity, never emits a blank alt for content images", () => {
    const result = normalizeLandingContent({ characters: [{ id: "new", name: "Tess", species: "Turtle", image: { asset: { _ref: "image-abc-120x100-png" }, alt: " " } }] });
    expect(result.characters[0]?.image?.alt).toBe("Tess character concept illustration");
    expect(result.characters[0]?.name).toBe("Tess");
  });

  it("retains a deliberately decorative CMS image with an empty alt", () => {
    const result = normalizeLandingContent({ characters: [{ id: "new", name: "Tess", image: { asset: { _ref: "image-abc-120x100-png" }, decorative: true, alt: "" } }] });
    expect(result.characters[0]?.image?.alt).toBe("");
  });

  it("filters social links to explicitly verified platform URLs and defaults flags off", () => {
    const settings = normalizeSiteSettings({ commerceEnabled: "true", trackingEnabled: 1, testimonialsEnabled: null, socialLinks: [
      { platform: "instagram", url: "https://instagram.com/bibo", verified: false },
      { platform: "youtube", url: "javascript:alert(1)", verified: true },
      { platform: "instagram", url: "https://evil.example/bibo", verified: true },
      { platform: "youtube", url: "https://www.youtube.com/@bibo", verified: true },
    ] });
    expect([settings.commerceEnabled, settings.trackingEnabled, settings.testimonialsEnabled]).toEqual([false, false, false]);
    expect(settings.socialLinks).toEqual([{ platform: "youtube", url: "https://www.youtube.com/@bibo", verified: true }]);
    expect(normalizeSiteSettings(null).socialLinks).toEqual([]);
  });

  it("returns safe legal defaults for invalid CMS documents", () => {
    expect(normalizeLegalSettings({ privacy: "bad", consentCopyVersion: 2 }).privacy).toEqual([]);
    expect(normalizeLegalSettings(undefined).consentCopyVersion).toBeTruthy();
  });
});
