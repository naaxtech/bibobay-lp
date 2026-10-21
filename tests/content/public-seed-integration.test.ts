import { describe, expect, it } from "vitest";
import { evaluate, parse } from "groq-js";
import { buildSeedDocuments } from "@/studio/scripts/seed-data";
import { CONTACT_PAGE_QUERY, LANDING_PAGE_QUERY, LEGAL_SETTINGS_QUERY, SITE_SETTINGS_QUERY } from "@/lib/sanity/queries";
import { SAFE_FALLBACK_CONTACT_PAGE, SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { normalizeContactPage, normalizeLandingContent, normalizeLegalSettings, normalizeSiteSettings } from "@/lib/content/normalize";
import { schemaTypes } from "@/studio/schemaTypes";

// Models a tokenless published read: root-path documents are public, dotted IDs are not.
const publicDataset = () => buildSeedDocuments().filter((document) => !document._id.includes(".") && !document._id.startsWith("drafts."));
const publicRead = async (query: string) => (await evaluate(parse(query), { dataset: publicDataset() })).get();

describe("seeded tokenless published landing read", () => {
  it("gives all collection documents and their references public root-path IDs", () => {
    const documents = buildSeedDocuments();
    expect(documents).toHaveLength(33);
    expect(documents.every((document) => !document._id.includes("."))).toBe(true);
    const landing = documents.find((document) => document._id === "landingPage")!;
    for (const key of ["characters", "episodes", "pillars", "ecosystem", "faqs"]) {
      const references = landing[key] as Array<{ _ref: string }>;
      expect(references.length).toBeGreaterThan(0);
      for (const { _ref } of references) {
        expect(_ref).not.toContain(".");
        expect(documents.some((document) => document._id === _ref)).toBe(true);
      }
    }
  });

  it("evaluates the real landing GROQ on public seed records and normalizes every collection", async () => {
    const settings = normalizeSiteSettings(await publicRead(SITE_SETTINGS_QUERY));
    const raw = await publicRead(LANDING_PAGE_QUERY) as Record<string, unknown>;
    const content = normalizeLandingContent(raw, { testimonialsEnabled: settings.testimonialsEnabled });
    for (const [name, count] of Object.entries({ characters: 3, episodes: 7, pillars: 6, ecosystem: 8, faqs: 4 })) {
      expect(raw[name], `${name} must dereference for tokenless reads`).toHaveLength(count);
      expect(content[name as keyof typeof content], `${name} must normalize without fallback substitution`).toHaveLength(count);
    }
    expect(content.characters.map(({ name }) => name)).toEqual(["Tula the Turtle", "Bob the Fish", "Lumi"]);
    expect(content.episodes.every(({ status, mediaUrl }) => status === "published" && mediaUrl?.startsWith("https://www.youtube.com/watch?v="))).toBe(true);
    expect(content.pillars[0]?.title).toBe("Bright minds");
    expect(content.ecosystem[0]?.name).toBe("BIBO Academy");
    expect(content.faqs[0]?.question).toBe("What is BIBO Bay?");
    expect(settings.testimonialsEnabled).toBe(false);
    expect(content.testimonials).toEqual([]);
    expect(content.sections.find(({ id }) => id === "testimonials")?.visible).toBe(false);
  });

  it("publishes exactly the repository fallback copy, so a fresh Studio and an offline site say the same thing", async () => {
    const settings = normalizeSiteSettings(await publicRead(SITE_SETTINGS_QUERY));
    const content = normalizeLandingContent(await publicRead(LANDING_PAGE_QUERY) as Record<string, unknown>, { testimonialsEnabled: settings.testimonialsEnabled });
    // Sanity ids carry their document type (`character-tula`); the copy itself must match word for word.
    const bareIds = <T extends { id: string }>(entries: T[]) => entries.map((entry) => ({ ...entry, id: entry.id.replace(/^(?:character|episodePreview|brandPillar|ecosystemEntry|faqItem)-/, "") }));
    expect({ ...content, characters: bareIds(content.characters), episodes: bareIds(content.episodes), pillars: bareIds(content.pillars), ecosystem: bareIds(content.ecosystem), faqs: bareIds(content.faqs) }).toEqual(SAFE_FALLBACK_CONTENT);
    expect(settings).toEqual(SAFE_FALLBACK_SETTINGS);
  });

  it("publishes the repository's contact page copy through the real GROQ, with no fallback substitution (R163)", async () => {
    const raw = await publicRead(CONTACT_PAGE_QUERY) as Record<string, unknown>;
    expect(raw).toMatchObject({ _id: "contactPage", heading: "Contact us" });
    expect(normalizeContactPage(raw)).toEqual(SAFE_FALLBACK_CONTACT_PAGE);
  });

  it("publishes the repository's legal settings, the order consent sentence and version included (R82)", async () => {
    expect(normalizeLegalSettings(await publicRead(LEGAL_SETTINGS_QUERY))).toEqual(SAFE_FALLBACK_LEGAL);
  });
});

describe("public testimony excludes private evidence", () => {
  it("cannot edit provenance in the public Sanity schema and never exposes legacy evidence through GROQ or normalization", async () => {
    const testimonial = schemaTypes.find((type) => type.name === "testimonial");
    expect(testimonial && "fields" in testimonial && testimonial.fields.some((field) => field.name === "verification")).toBe(false);
    const landing = buildSeedDocuments().find((document) => document._id === "landingPage")!;
    const raw = await (await evaluate(parse(LANDING_PAGE_QUERY), { dataset: [
      { ...landing, testimonials: [{ _type: "reference", _key: "proof", _ref: "testimonial-public" }] },
      { _id: "testimonial-public", _type: "testimonial", quote: "An approved quote", attribution: "An adult", verified: true, verification: "Private consent evidence" },
    ] })).get() as Record<string, unknown>;
    expect(JSON.stringify(raw.testimonials)).not.toContain("Private consent evidence");
    const enabled = normalizeLandingContent(raw, { testimonialsEnabled: true });
    expect(enabled.testimonials).toEqual([{ id: "testimonial-public", quote: "An approved quote", attribution: "An adult", verified: true }]);
    expect(normalizeLandingContent(raw).testimonials).toEqual([]);
  });
});
