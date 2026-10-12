import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import type { ImageWithAlt, LandingPageContent, SectionId, SectionIntro, SiteSettings } from "@/lib/content/types";
import nextConfig from "@/next.config";
import { landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

// Spec §8: every landing image is CMS-controlled. An image an editor supplies must reach the page,
// resolved through lib/sanity/image.ts; without one, the illustrated fallback stays.

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
  vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderPage(content: LandingPageContent = landingContent(), settings: SiteSettings = siteSettings()) {
  return render(<LandingPage content={content} settings={settings} />);
}

const section = (id: SectionId) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`section #${id} is not rendered`);
  return element;
};

/** A Sanity image reference for a 1600x1200 jpg, and the CDN path it resolves to. */
const art = (name: string, alt: string): ImageWithAlt => ({ asset: { _ref: `image-${name}-1600x1200-jpg` }, alt });
const cdnPath = (name: string) => `https://cdn.sanity.io/images/abcdefgh/production/${name}-1600x1200.jpg`;

/** Images inside the page content; the header and footer logos are not CMS art. */
const contentImages = () => Array.from(document.querySelectorAll("main img"));

const INTROS: ReadonlyArray<[SectionId, (draft: LandingPageContent) => SectionIntro]> = [
  ["trust", (draft) => draft.trust],
  ["promise", (draft) => draft.promise],
  ["characters", (draft) => draft.charactersIntro],
  ["episodes", (draft) => draft.episodesIntro],
  ["offline", (draft) => draft.offline],
  ["pillars", (draft) => draft.pillarsIntro],
  ["ecosystem", (draft) => draft.ecosystemIntro],
  ["lead", (draft) => draft.lead],
  ["faq", (draft) => draft.faqIntro],
  ["finalCta", (draft) => draft.finalCta],
];

describe("CMS images", () => {
  it("keeps every illustrated fallback when the CMS supplies no images", () => {
    renderPage();
    expect(contentImages()).toHaveLength(0);
    expect(within(section("hero")).getByRole("img", { name: "A calm, illustrated bay on the horizon." })).toBeTruthy();
    expect(section("hero").querySelector("[data-bay-layer]")).not.toBeNull();
    expect(section("finalCta").querySelector("[data-bay-layer]")).not.toBeNull();
  });

  it("puts the hero image in the postcard in place of the illustrated Bay, and loads it first", () => {
    renderPage(landingContent((draft) => {
      draft.hero.image = art("hero", "A painted bay at sunrise");
    }));
    const hero = section("hero");
    const image = within(hero).getByRole("img", { name: "A painted bay at sunrise" });
    expect(image.getAttribute("src")).toContain(cdnPath("hero"));
    expect(image.closest(".hero-postcard")).not.toBeNull();
    expect(image.getAttribute("fetchpriority")).toBe("high");
    // The image replaces the default artwork; the artwork's description no longer names anything.
    expect(hero.querySelector("[data-bay-layer]")).toBeNull();
    expect(within(hero).queryByRole("img", { name: "A calm, illustrated bay on the horizon." })).toBeNull();
    expect(contentImages()).toHaveLength(1);
  });

  it.each(INTROS)("shows the %s section's own image when the CMS supplies one", (id, intro) => {
    // Sanity asset ids carry no hyphen (the URL builder splits the ref on them).
    renderPage(landingContent((draft) => {
      intro(draft).image = art(`${id}intro`, `Art for the ${id} section`);
    }));
    const image = within(section(id)).getByRole("img", { name: `Art for the ${id} section` });
    expect(image.getAttribute("src")).toContain(cdnPath(`${id}intro`));
    expect(contentImages()).toHaveLength(1);
  });

  it("shows the testimonials section's image when the section is shown", () => {
    renderPage(
      landingContent((draft) => {
        draft.testimonialsIntro.image = art("voices", "Paper notes pinned to a board");
        draft.testimonials = [{ id: "t1", quote: "Our evenings feel calmer.", attribution: "A parent in Leeds", verified: true }];
        draft.sections = draft.sections.map((entry) => (entry.id === "testimonials" ? { ...entry, visible: true } : entry));
      }),
      siteSettings((draft) => {
        draft.testimonialsEnabled = true;
      }),
    );
    const image = within(section("testimonials")).getByRole("img", { name: "Paper notes pinned to a board" });
    expect(image.getAttribute("src")).toContain(cdnPath("voices"));
  });

  it("swaps the closing horizon for the closing image, and keeps the loop drawn around its image", () => {
    renderPage(landingContent((draft) => {
      draft.finalCta.image = art("close", "Footprints along the shore");
      draft.offline.image = art("loop", "A child's paper boat");
    }));
    expect(section("finalCta").querySelector("[data-bay-layer]")).toBeNull();
    const loop = section("offline");
    expect(loop.querySelector("[data-loop-path]")).not.toBeNull();
    expect(within(loop).getByRole("img", { name: "A child's paper boat" })).toBeTruthy();
    // The readable steps are untouched.
    expect(within(loop).getByRole("list").children).toHaveLength(4);
  });

  it("sets a value's image and a wider-world entry's image beside that entry", () => {
    renderPage(landingContent((draft) => {
      draft.pillars[1]!.image = art("kind", "Two hands sharing a shell");
      draft.ecosystem[2]!.image = art("play", "A paper kite over the sand");
    }));
    const pillar = within(section("pillars")).getByRole("heading", { name: "Kind hearts" }).closest("li");
    expect(within(pillar!).getByRole("img", { name: "Two hands sharing a shell" }).getAttribute("src")).toContain(cdnPath("kind"));
    const entry = within(section("ecosystem")).getByRole("heading", { name: "BIBO Play" }).closest("li");
    expect(within(entry!).getByRole("img", { name: "A paper kite over the sand" }).getAttribute("src")).toContain(cdnPath("play"));
    expect(contentImages()).toHaveLength(2);
  });

  it("renders a decorative image with an empty alt, announced to nobody", () => {
    renderPage(landingContent((draft) => {
      draft.hero.image = { asset: { _ref: "image-waves-1600x1200-jpg" }, alt: "", decorative: true };
      draft.pillarsIntro.image = { asset: { _ref: "image-shells-1600x1200-jpg" }, alt: "", decorative: true };
    }));
    for (const id of ["hero", "pillars"] as const) {
      const image = section(id).querySelector("img");
      expect(image?.getAttribute("alt"), id).toBe("");
      expect(within(section(id)).queryAllByRole("img"), id).toHaveLength(0);
    }
  });

  it("honours the editor's crop in the image URL and centres the frame on the hotspot", () => {
    const geometry = { crop: { left: 0.1, right: 0.1, top: 0.2, bottom: 0.2 }, hotspot: { x: 0.7, y: 0.4, width: 0.3, height: 0.3 } };
    renderPage(landingContent((draft) => {
      draft.hero.image = { asset: { _ref: "image-cropped-1200x1000-png" }, alt: "Cropped bay", ...geometry };
      draft.characters[0]!.image = { asset: { _ref: "image-ollie-1200x1000-png" }, alt: "Ollie", hotspot: { x: 0.25, y: 0.8, width: 0.2, height: 0.2 } };
    }));
    const hero = within(section("hero")).getByRole("img", { name: "Cropped bay" }) as HTMLImageElement;
    expect(new URL(hero.getAttribute("src")!).searchParams.get("rect")).toBe("120,200,960,600");
    // Hotspot (0.7, 0.4) inside the 10%/20% crop is 75% across and a third of the way down the cropped image.
    expect(hero.style.objectPosition).toBe("75% 33.33%");
    const ollie = within(section("characters")).getByRole("img", { name: "Ollie" }) as HTMLImageElement;
    expect(ollie.style.objectPosition).toBe("25% 80%");
  });

  it("keeps the placeholder when the image cannot be resolved because Sanity is not configured", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "");
    renderPage(landingContent((draft) => {
      draft.hero.image = art("hero", "A painted bay at sunrise");
      draft.pillars[0]!.image = art("bright", "A magnifying glass");
    }));
    expect(contentImages()).toHaveLength(0);
    expect(section("hero").querySelector("[data-bay-layer]")).not.toBeNull();
  });
});

describe("next/image configuration", () => {
  it("allows images from Sanity's CDN and no other remote host", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];
    expect(patterns).toEqual([expect.objectContaining({ protocol: "https", hostname: "cdn.sanity.io" })]);
  });
});
