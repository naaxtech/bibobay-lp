// @vitest-environment node
import { stegaClean } from "@sanity/client/stega";
import { evaluate, parse } from "groq-js";
import { describe, expect, it, vi } from "vitest";

import { friendArt } from "@/lib/content/brand-art";
import { normalizeLandingContent, normalizeLegalSettings, normalizeSiteSettings } from "@/lib/content/normalize";
import { cleanStega, stegaCleanText, stegaText } from "@/lib/content/stega";
import type { Product } from "@/lib/content/types";
import { LANDING_PAGE_QUERY, LEGAL_SETTINGS_QUERY, SITE_SETTINGS_QUERY } from "@/lib/sanity/queries";
import { homeMetadata, legalMetadata, manifestFor, productMetadata, seoEnvironment, shopMetadata, structuredData, thankYouMetadata } from "@/lib/seo/metadata";
import { buildSeedDocuments } from "@/studio/scripts/seed-data";
import { encodeAllStrings, encodeString, STEGA_CHARACTER } from "@/tests/support/stega";

/*
 * Ruling R160: in the Studio's Presentation tool every string Sanity returns may carry an invisible
 * click-to-edit payload. Text keeps it (that is what makes it clickable); nothing the site decides
 * with may see it.
 */

vi.setConfig({ testTimeout: 30_000 });

const read = async (query: string) => structuredClone(await (await evaluate(parse(query), { dataset: buildSeedDocuments() })).get()) as Record<string, unknown>;

const PORTABLE = [
  { _type: "block", _key: "b1", style: "h2", markDefs: [], children: [{ _type: "span", _key: "s1", text: "Our promise", marks: [] }] },
  {
    _type: "block", _key: "b2", style: "normal",
    markDefs: [{ _type: "link", _key: "l1", href: "https://www.youtube.com/@bibobay-tv" }],
    children: [{ _type: "span", _key: "s2", text: "Watch ", marks: ["strong"] }, { _type: "span", _key: "s3", text: "on YouTube", marks: ["l1", "em"] }],
  },
];

/** The seeded landing read, plus every kind of field the normalizer decides with. */
async function richLanding() {
  const raw = await read(LANDING_PAGE_QUERY);
  const sections = raw.sections as Array<Record<string, unknown>>;
  sections[0] = { ...sections[0], theme: { background: "sea", accent: "teal" } };
  sections[1] = { ...sections[1], theme: { background: "navy", accent: "purple" } };
  const characters = raw.characters as Array<Record<string, unknown>>;
  characters[0] = {
    ...characters[0], accentColor: "#11aa88",
    image: { asset: { _ref: "image-abc123-640x480-png" }, alt: "Tula waving", caption: "Tula", crop: { top: 0.1, bottom: 0.1, left: 0, right: 0 }, hotspot: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 } },
  };
  const ecosystem = raw.ecosystem as Array<Record<string, unknown>>;
  ecosystem[0] = { ...ecosystem[0], status: "available", cta: { label: "Visit", href: "https://academy.example.com/start" } };
  // An editor emptied the eyebrow: the fallback shows, payload or not.
  raw.hero = { ...(raw.hero as Record<string, unknown>), eyebrow: "", title: "  Bright minds.  " };
  raw.promise = { ...(raw.promise as Record<string, unknown>), body: PORTABLE };
  return raw;
}
async function richSettings() {
  return { ...(await read(SITE_SETTINGS_QUERY)), contactEmail: "hello@example.com", canonicalUrl: "https://www.example.com", canonicalUrlVerified: true, studioUrl: "https://bibobay.sanity.studio", orderCountries: ["gb", "PH"], commerceEnabled: true };
}
async function richLegal() {
  return { ...(await read(LEGAL_SETTINGS_QUERY)), privacy: PORTABLE, terms: PORTABLE, privacyVersion: "2026-10-21", termsVersion: "v2", consentCopyVersion: "consent-2" };
}

const hasStega = (value: unknown) => STEGA_CHARACTER.test(JSON.stringify(value) ?? "");

describe("stega helpers", () => {
  it.each(["Hello", " padded  ", "", "https://www.youtube.com/watch?v=3birY6XZ3_c", "2026-10-21", "Tula the Turtle", "/freebies/bibo-bay-activity-pack.pdf"])("cleans %j exactly like @sanity/client", (value) => {
    const encoded = encodeString(value);
    expect(encoded).not.toBe(value);
    expect(stegaCleanText(encoded)).toBe(stegaClean(encoded));
    expect(stegaCleanText(encoded)).toBe(value);
  });

  it("keeps a text's payload and trims the text around it", () => {
    const encoded = encodeString("  Hello  ");
    const payload = encoded.slice("  Hello  ".length);
    expect(stegaText(encoded)).toBe(`Hello${payload}`);
    expect(stegaClean(stegaText(encoded))).toBe("Hello");
  });

  it("sees an emptied field as empty, payload or not, so the fallback shows", () => {
    expect(stegaText(encodeString(""), "fallback")).toBe("fallback");
    expect(stegaText(encodeString("   "), "fallback")).toBe("fallback");
    expect(stegaText(42, "fallback")).toBe("fallback");
  });

  it("cleans deep, and leaves class instances such as URL untouched", () => {
    const url = new URL("https://www.example.com/");
    const cleaned = cleanStega({ list: [encodeString("a"), { b: encodeString("b") }], url, n: 1, flag: true, none: null });
    expect(cleaned).toEqual({ list: ["a", { b: "b" }], url, n: 1, flag: true, none: null });
    expect(cleaned.url).toBe(url);
  });
});

describe("the normalizer under Presentation stega (R160)", () => {
  it("landing: every decision is the same as for the plain read", async () => {
    const raw = await richLanding();
    const plain = normalizeLandingContent(raw);
    // The fixture exercises the logic fields it claims to.
    expect(plain.sections[0]?.theme).toEqual({ background: "sea", accent: "teal" });
    expect(plain.promise.body[0]?.style).toBe("h2");
    expect(plain.characters[0]?.image?.asset._ref).toBe("image-abc123-640x480-png");
    expect(plain.ecosystem[0]?.cta?.href).toBe("https://academy.example.com/start");
    expect(cleanStega(normalizeLandingContent(encodeAllStrings(raw)))).toEqual(plain);
  });

  it("landing: text keeps its click-to-edit payload; ids, themes, styles, marks and links do not", async () => {
    const encoded = normalizeLandingContent(encodeAllStrings(await richLanding()));
    for (const text of [encoded.hero.title, encoded.hero.heading, encoded.characters[0]!.name, encoded.faqs[0]!.answer, encoded.trust.items[0]!, encoded.promise.body[1]?.children?.[0]?.text ?? ""]) {
      expect(STEGA_CHARACTER.test(text), text).toBe(true);
    }
    expect(stegaClean(encoded.hero.title)).toBe("Bright minds.");
    expect(encoded.hero.eyebrow).toBe(normalizeLandingContent(await richLanding()).hero.eyebrow);
    expect(hasStega(encoded.sections)).toBe(false);
    expect(hasStega(encoded.characters.map(({ id, status, accentColor, image }) => ({ id, status, accentColor, ref: image?.asset._ref })))).toBe(false);
    expect(hasStega(encoded.episodes.map(({ id, status, mediaUrl }) => ({ id, status, mediaUrl })))).toBe(false);
    expect(hasStega(encoded.promise.body.map(({ style, markDefs, children }) => ({ style, markDefs, marks: (children ?? []).map(({ marks }) => marks) })))).toBe(false);
    expect(hasStega([encoded.hero.primaryCta.href, encoded.ecosystem[0]!.cta!.href, encoded.lead.leadMagnet?.fileUrl])).toBe(false);
  });

  it("site settings: every decision is the same; the address, countries and links are clean", async () => {
    const raw = await richSettings();
    const plain = normalizeSiteSettings(raw);
    expect(plain.contactEmail).toBe("hello@example.com");
    expect(plain.orderCountries).toEqual(["GB", "PH"]);
    expect(plain.socialLinks).toHaveLength(1);
    const encoded = normalizeSiteSettings(encodeAllStrings(raw, { _id: "siteSettings", _type: "siteSettings" }));
    expect(cleanStega(encoded)).toEqual(plain);
    expect(hasStega([encoded.contactEmail, encoded.orderCountries, encoded.socialLinks, encoded.canonicalUrl, encoded.studioUrl, encoded.navigation.links.map(({ href }) => href)])).toBe(false);
    expect(STEGA_CHARACTER.test(encoded.footer.text)).toBe(true);
  });

  it("legal settings: every decision is the same; versions are clean", async () => {
    const raw = await richLegal();
    const plain = normalizeLegalSettings(raw);
    const encoded = normalizeLegalSettings(encodeAllStrings(raw, { _id: "legalSettings", _type: "legalSettings" }));
    expect(cleanStega(encoded)).toEqual(plain);
    expect(hasStega([encoded.privacyVersion, encoded.termsVersion, encoded.consentCopyVersion, encoded.orderConsentCopyVersion])).toBe(false);
    expect(STEGA_CHARACTER.test(encoded.orderConsentCopy)).toBe(true);
  });

  it.each(["Lumi", "Tula the Turtle"])("a friend's portrait is found by an encoded name too (%s)", (name) => {
    const art = friendArt({ id: "character-x", name });
    expect(art).toBeDefined();
    // The payload sits after the last word: a one-word name is where a raw lookup breaks.
    expect(friendArt({ id: "character-x", name: encodeString(name) })).toBe(art);
  });
});

describe("head metadata and structured data never carry stega", () => {
  const env = { VERCEL_ENV: "production" };
  const product: Product = { id: "product-plush", name: "Tula plush", slug: "tula-plush", description: "A soft Tula.", details: [], images: [], status: "listed", order: 0, seo: { title: "Tula plush", description: "A soft sea turtle." } };
  const encodedProduct: Product = { ...product, name: encodeString(product.name), description: encodeString(product.description), seo: { title: encodeString("Tula plush"), description: encodeString("A soft sea turtle.") } };

  it("each builder gives the same result for encoded content as for plain content", async () => {
    const [landing, settingsRaw, legalRaw] = await Promise.all([richLanding(), richSettings(), richLegal()]);
    const plain = { content: normalizeLandingContent(landing), settings: normalizeSiteSettings(settingsRaw), legal: normalizeLegalSettings(legalRaw) };
    const encoded = {
      content: normalizeLandingContent(encodeAllStrings(landing)),
      settings: normalizeSiteSettings(encodeAllStrings(settingsRaw, { _id: "siteSettings", _type: "siteSettings" })),
      legal: normalizeLegalSettings(encodeAllStrings(legalRaw, { _id: "legalSettings", _type: "legalSettings" })),
    };
    expect(hasStega(encoded.content.seo) || hasStega(encoded.settings.title)).toBe(true);
    const build = (input: typeof plain, item: Product) => {
      const seo = seoEnvironment(input.settings, env);
      return {
        home: homeMetadata({ content: input.content, settings: input.settings, seo, draft: true, image: { url: "https://cdn.sanity.io/images/k82r18ol/production/a.png", alt: input.content.hero.title } }),
        privacy: legalMetadata({ kind: "privacy", legal: input.legal, settings: input.settings, seo, draft: true }),
        thanks: thankYouMetadata({ settings: input.settings, seo }),
        shop: shopMetadata({ settings: input.settings, seo, draft: true }),
        product: productMetadata({ product: item, settings: input.settings, seo, draft: true, image: { url: "https://cdn.sanity.io/images/k82r18ol/production/b.png", alt: item.name } }),
        jsonLd: structuredData(input.settings, seo),
        manifest: manifestFor(input.settings),
      };
    };
    const fromEncoded = build(encoded, encodedProduct);
    expect(hasStega(fromEncoded)).toBe(false);
    expect(fromEncoded).toEqual(build(plain, product));
  });
});
