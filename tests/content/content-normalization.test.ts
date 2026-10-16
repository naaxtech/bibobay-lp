import { describe, expect, it } from "vitest";
import { normalizeLandingContent, normalizeSiteSettings, normalizeLegalSettings } from "@/lib/content/normalize";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";

describe("untrusted editorial content", () => {
  it("uses complete safe copy for missing or malformed landing documents", () => {
    expect(normalizeLandingContent(null)).toEqual(SAFE_FALLBACK_CONTENT);
    expect(normalizeLandingContent({ hero: { title: "  " }, characters: "bad" })).toEqual(SAFE_FALLBACK_CONTENT);
  });

  it("keeps a fallback CTA's external flag only when the CMS gives no destination of its own", () => {
    const external = { label: "Watch on YouTube", href: "https://www.youtube.com/@bibobay-tv", external: true };
    expect(SAFE_FALLBACK_CONTENT.hero.primaryCta).toEqual(external);
    expect(normalizeLandingContent({ hero: { title: "A title" } }).hero.primaryCta).toEqual(external);
    expect(normalizeLandingContent({ hero: { title: "A title", primaryCta: { label: "Meet the friends", href: "#characters" } } }).hero.primaryCta)
      .toEqual({ label: "Meet the friends", href: "#characters" });
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
    // No settings document at all: the repository fallback's owner-confirmed channel; an explicit empty list stays empty.
    expect(normalizeSiteSettings(null).socialLinks).toEqual(SAFE_FALLBACK_SETTINGS.socialLinks);
    expect(normalizeSiteSettings({ socialLinks: [] }).socialLinks).toEqual([]);
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

describe("the watch section's call to action (YouTube-first)", () => {
  it("normalises an editor's own CTA and falls back to the channel's subscribe link", () => {
    expect(normalizeLandingContent({ episodesIntro: { heading: "Watch" } }).episodesIntro.cta).toEqual(SAFE_FALLBACK_CONTENT.episodesIntro.cta);
    expect(normalizeLandingContent({ episodesIntro: { cta: { label: "Our playlists", href: "https://www.youtube.com/@bibobay-tv/playlists", external: true } } }).episodesIntro.cta)
      .toEqual({ label: "Our playlists", href: "https://www.youtube.com/@bibobay-tv/playlists", external: true });
  });
});

describe("download file locations", () => {
  const magnet = (fileUrl: string) => normalizeLandingContent({ lead: { leadMagnet: { title: "Pack", description: "Pages", fileUrl, available: true } } }).lead.leadMagnet;
  it("accepts an https file or a PDF this site serves from its freebies folder", () => {
    expect(magnet("https://cdn.sanity.io/files/abc/production/sheet.pdf")?.fileUrl).toBe("https://cdn.sanity.io/files/abc/production/sheet.pdf");
    expect(magnet("/freebies/bibo-bay-activity-pack.pdf")?.fileUrl).toBe("/freebies/bibo-bay-activity-pack.pdf");
  });
  it("refuses anything else, and with it the download", () => {
    for (const bad of ["//evil.example/x.pdf", "/freebies/../secret.pdf", "/freebies/x.exe", "/other/x.pdf", "javascript:alert(1)", "http://bibobay.example/x.pdf"]) {
      expect(magnet(bad), bad).toBeUndefined();
    }
  });
});

describe("the lead section's download", () => {
  it("keeps the repository's activity pack when there is no lead section at all", () => {
    expect(normalizeLandingContent({}).lead.leadMagnet).toEqual(SAFE_FALLBACK_CONTENT.lead.leadMagnet);
  });
  it("offers nothing when an editor's lead section has no download, or marks it unavailable", () => {
    expect(normalizeLandingContent({ lead: { heading: "Join us" } }).lead.leadMagnet).toBeUndefined();
    expect(normalizeLandingContent({ lead: { leadMagnet: { title: "Pack", fileUrl: "/freebies/bibo-bay-activity-pack.pdf", available: false } } }).lead.leadMagnet).toBeUndefined();
  });
});

describe("the order form's consent sentence and version (R82)", () => {
  it("has a repository sentence and version of its own, separate from the signup's", () => {
    expect(SAFE_FALLBACK_LEGAL.orderConsentCopy).toMatch(/adult/i);
    expect(SAFE_FALLBACK_LEGAL.orderConsentCopy).toMatch(/order/i);
    expect(SAFE_FALLBACK_LEGAL.orderConsentCopyVersion).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/);
    expect(SAFE_FALLBACK_LEGAL.orderConsentCopy).not.toBe(SAFE_FALLBACK_CONTENT.lead.consentCopy);
  });

  it("takes the CMS sentence and version together", () => {
    const legal = normalizeLegalSettings({ consentCopyVersion: "3", orderConsentCopy: " I agree to the order terms. ", orderConsentCopyVersion: " order-2 " });
    expect([legal.orderConsentCopy, legal.orderConsentCopyVersion]).toEqual(["I agree to the order terms.", "order-2"]);
    expect(legal.consentCopyVersion).toBe("3");
  });

  it("never pairs a CMS sentence with the repository version, or the other way round", () => {
    const fallback = [SAFE_FALLBACK_LEGAL.orderConsentCopy, SAFE_FALLBACK_LEGAL.orderConsentCopyVersion];
    for (const raw of [{ orderConsentCopy: "A new sentence." }, { orderConsentCopyVersion: "order-9" }, { orderConsentCopy: " ", orderConsentCopyVersion: "order-9" }, null]) {
      const legal = normalizeLegalSettings(raw);
      expect([legal.orderConsentCopy, legal.orderConsentCopyVersion], JSON.stringify(raw)).toEqual(fallback);
    }
  });
});

describe("the countries an order may be delivered to (R85)", () => {
  it("defaults to none listed, which means every country", () => {
    expect(SAFE_FALLBACK_SETTINGS.orderCountries).toEqual([]);
    expect(normalizeSiteSettings({}).orderCountries).toEqual([]);
    expect(normalizeSiteSettings({ title: "BIBO Bay" }).orderCountries).toEqual([]);
  });

  it("keeps the editor's ISO 3166-1 alpha-2 codes, in their order, once each, in capitals", () => {
    expect(normalizeSiteSettings({ orderCountries: ["ph", " AU ", "GB", "PH"] }).orderCountries).toEqual(["PH", "AU", "GB"]);
  });

  it("drops anything that is not an assigned country code", () => {
    expect(normalizeSiteSettings({ orderCountries: ["UK", "ZZ", "EU", "Philippines", 7, null, "NZ"] }).orderCountries).toEqual(["NZ"]);
    expect(normalizeSiteSettings({ orderCountries: "PH" }).orderCountries).toEqual([]);
  });
});
