import { describe, expect, it, vi } from "vitest";
import { normalizeLandingContent } from "@/lib/content/normalize";
import { sanityImageUrl } from "@/lib/sanity/image";
import { createImageUrlBuilder } from "@sanity/image-url";

vi.mock("server-only", () => ({}));

const geometry = { crop: { left: 0.1, right: 0.1, top: 0.2, bottom: 0.2 }, hotspot: { x: 0.7, y: 0.4, width: 0.3, height: 0.3 } };
const ref = "image-abc-1200x1000-png";

describe("normalized image and Sanity URL", () => {
  it("preserves crop, hotspot, caption and explicit decorative empty alt in landing images", () => {
    const image = { asset: { _ref: ref }, alt: "", decorative: true, caption: "Waves", ...geometry };
    const content = normalizeLandingContent({ hero: { image }, characters: [{ id: "ollie", name: "Ollie", image }] });
    expect(content.hero.image).toEqual(image);
    expect(content.characters[0]?.image).toEqual(image);
    const missingAlt = normalizeLandingContent({ hero: { image: { asset: { _ref: ref }, ...geometry } } });
    expect(missingAlt.hero.image).toEqual({ asset: { _ref: ref }, alt: "Bright minds. Kind hearts. Big adventures. illustration", ...geometry });
  });

  it.each([
    ["horizontal zero width", { left: 0.5, right: 0.5, top: 0, bottom: 0 }],
    ["horizontal negative width", { left: 1, right: 1, top: 0, bottom: 0 }],
    ["vertical zero height", { left: 0, right: 0, top: 0.5, bottom: 0.5 }],
    ["vertical negative height", { left: 0, right: 0, top: 1, bottom: 1 }],
  ])("keeps the image but drops a crop with %s", (_case, crop) => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    try {
      const image = normalizeLandingContent({ hero: { image: { asset: { _ref: ref }, alt: "Concept art", caption: "Waves", crop } } }).hero.image;
      const url = sanityImageUrl(image, 400);
      expect(url).toBeDefined();
      const built = new URL(url!);
      expect(built.pathname).toContain("/images/abcdefgh/production/abc-1200x1000.png");
      expect(built.searchParams.get("rect")).toBeNull();
      expect(built.searchParams.get("w")).toBe("400");
      expect(image).toEqual({ asset: { _ref: ref }, alt: "Concept art", caption: "Waves" });
    } finally { vi.unstubAllEnvs(); }
  });

  it("builds a real image URL for decorative art using crop and hotspot", () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    try {
      const image = normalizeLandingContent({ hero: { image: { asset: { _ref: ref }, alt: "", decorative: true, ...geometry } } }).hero.image;
      const url = sanityImageUrl(image, 400);
      expect(url).toBeDefined();
      const built = new URL(url!);
      expect(built.pathname).toContain("/images/abcdefgh/production/abc-1200x1000.png");
      expect(built.searchParams.get("rect")).toBe("120,200,960,600");
      expect(built.searchParams.get("w")).toBe("400");
      const builder = createImageUrlBuilder({ projectId: "abcdefgh", dataset: "production" });
      const left = new URL(builder.image({ ...image!, hotspot: { ...geometry.hotspot, x: 0.25 } }).width(400).height(400).url());
      const right = new URL(builder.image({ ...image!, hotspot: { ...geometry.hotspot, x: 0.75 } }).width(400).height(400).url());
      expect(left.searchParams.get("rect")).toBe("120,200,600,600");
      expect(right.searchParams.get("rect")).toBe("480,200,600,600");
      expect(sanityImageUrl({ asset: { _ref: ref }, alt: "" }, 400)).toBeUndefined();
    } finally { vi.unstubAllEnvs(); }
  });
});
