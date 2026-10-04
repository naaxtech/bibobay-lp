import { describe, expect, it } from "vitest";
import { normalizeLandingContent, normalizeSiteSettings, normalizeLegalSettings } from "@/lib/content/normalize";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

describe("untrusted editorial content", () => {
  it("uses complete safe copy for missing or malformed landing documents", () => {
    expect(normalizeLandingContent(null)).toEqual(SAFE_FALLBACK_CONTENT);
    expect(normalizeLandingContent({ hero: { title: "  " }, characters: "bad" })).toEqual(SAFE_FALLBACK_CONTENT);
  });

  it("preserves editor order, hero visibility and omissions, and hides unverified proof", () => {
    const result = normalizeLandingContent({
      sections: [{ id: "faq", visible: true }, { id: "hero", visible: false }, { id: "bogus", visible: true }, { id: "faq", visible: true }, { id: "testimonials", visible: true }],
      testimonials: [{ id: "invented", quote: "A quote", verified: false }],
    });
    expect(result.sections.map((s) => s.id)).toEqual(["faq", "hero", "testimonials"]);
    expect(result.sections.find((s) => s.id === "hero")?.visible).toBe(false);
    expect(result.sections.find((s) => s.id === "testimonials")?.visible).toBe(false);
    expect(new Set(result.sections.map((s) => s.id)).size).toBe(result.sections.length);
    expect(result.testimonials).toEqual([]);
    expect(normalizeLandingContent({ sections: [] }).sections).toEqual([]);
    expect(normalizeLandingContent({ sections: "malformed" }).sections).toEqual(SAFE_FALLBACK_CONTENT.sections);
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

  it("retains supported styles, span formatting and safe link definitions in promise and legal rich text", () => {
    const blocks = [{ _type: "block", _key: "paragraph", style: "h2", children: [
      { _type: "span", _key: "one", text: "Read the notice", marks: ["strong", "safe", "unsafe", "unknown"] },
    ], markDefs: [
      { _type: "link", _key: "safe", href: "https://example.com/notice" },
      { _type: "link", _key: "unsafe", href: "javascript:alert(1)" },
    ] }];
    const expected = [{ _type: "block", _key: "paragraph", style: "h2", children: [
      { _type: "span", _key: "one", text: "Read the notice", marks: ["strong", "safe"] },
    ], markDefs: [{ _type: "link", _key: "safe", href: "https://example.com/notice" }] }];
    expect(normalizeLandingContent({ promise: { body: blocks } }).promise.body).toEqual(expected);
    expect(normalizeLegalSettings({ privacy: blocks, terms: blocks }).privacy).toEqual(expected);
    expect(normalizeLegalSettings({ privacy: blocks, terms: blocks }).terms).toEqual(expected);
  });
});
