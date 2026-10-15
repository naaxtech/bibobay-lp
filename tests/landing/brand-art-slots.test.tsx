import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import { BRAND_ART, friendArt } from "@/lib/content/brand-art";
import type { LandingPageContent, SectionId } from "@/lib/content/types";
import { landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

// Ruling R58: every art slot resolves CMS image → repository brand art → drawn placeholder.

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
  vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const renderPage = (content: LandingPageContent = landingContent()) => render(<LandingPage content={content} settings={siteSettings()} />);

const section = (id: SectionId) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`section #${id} is not rendered`);
  return element;
};

/** The file an image shows, whether served as is or through the Next image optimiser. */
const shownFile = (image: Element) => {
  const src = image.getAttribute("src") ?? "";
  const optimised = src.startsWith("/_next/image?") ? new URLSearchParams(src.slice("/_next/image?".length)).get("url") : null;
  return optimised ?? src;
};
const imagesIn = (root: Element) => Array.from(root.querySelectorAll("img"));
const showsFile = (root: Element, file: string) => imagesIn(root).some((image) => shownFile(image) === file);

describe("repository art in empty CMS slots", () => {
  it("opens on the channel's own trio, described by its own alt text and loaded first", () => {
    renderPage();
    const image = within(section("hero")).getByRole("img", { name: BRAND_ART.sections.hero!.alt });
    expect(shownFile(image)).toBe(BRAND_ART.sections.hero!.src);
    expect(image.getAttribute("fetchpriority")).toBe("high");
    expect(image.getAttribute("loading")).toBe("eager");
  });

  it("shows each friend's own portrait on their stage, named in its alt text", () => {
    renderPage();
    const tabs = within(section("characters")).getAllByRole("tab");
    landingContent().characters.forEach((friend, index) => {
      fireEvent.click(tabs[index]!);
      const panel = within(section("characters")).getByRole("tabpanel");
      const portrait = within(panel).getByRole("img", { name: friendArt(friend)!.alt });
      expect(shownFile(portrait)).toBe(friendArt(friend)!.src);
    });
  });

  it("shows each video's real thumbnail, served from this site", () => {
    renderPage();
    const tabs = within(section("episodes")).getAllByRole("tab");
    landingContent().episodes.forEach((video, index) => {
      fireEvent.click(tabs[index]!);
      const panel = within(section("episodes")).getByRole("tabpanel");
      const id = new URL(video.mediaUrl!).searchParams.get("v");
      expect(showsFile(panel, `/brand/art/video-${id}.webp`), video.title).toBe(true);
    });
  });

  it("fills the section scenes and every value's sticker", () => {
    renderPage();
    for (const id of ["promise", "offline", "pillars", "lead", "finalCta"] as const) {
      expect(showsFile(section(id), BRAND_ART.sections[id]!.src), id).toBe(true);
    }
    for (const value of section("pillars").querySelectorAll("li.pillar")) {
      expect(imagesIn(value).length, value.textContent ?? "").toBe(1);
    }
  });

  it("lets the browser pick a pre-sized file for the slot's width, with no request-time resizing", () => {
    renderPage();
    const hero = within(section("hero")).getByRole("img", { name: BRAND_ART.sections.hero!.alt });
    expect(hero.getAttribute("srcset")).toBe(BRAND_ART.sections.hero!.srcSet);
    expect(hero.getAttribute("sizes")).toMatch(/vw|rem/);
    expect(hero.getAttribute("decoding")).toBe("async");
    for (const image of imagesIn(document.querySelector("main")!)) {
      expect(image.getAttribute("src"), image.outerHTML.slice(0, 80)).not.toContain("/_next/image");
      expect(image.getAttribute("srcset"), image.outerHTML.slice(0, 80)).toMatch(/\/brand\/art\/[\w-]+\.webp \d+w/);
    }
  });

  it("serves every image from this site: no third-party host is asked for anything", () => {
    renderPage();
    const files = imagesIn(document.querySelector("main")!).map(shownFile);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(file, file).toMatch(/^\/brand\/art\/[\w-]+\.webp$/);
  });
});

describe("precedence", () => {
  it("lets an editor's image win over the repository art in its slot", () => {
    renderPage(landingContent((draft) => {
      draft.hero.image = { asset: { _ref: "image-sunrise-1600x1200-jpg" }, alt: "A reef at sunrise" };
      draft.characters[0]!.image = { asset: { _ref: "image-tula-1200x900-png" }, alt: "Tula drawn by the studio" };
    }));
    const hero = section("hero");
    expect(shownFile(within(hero).getByRole("img", { name: "A reef at sunrise" }))).toContain("https://cdn.sanity.io/");
    expect(showsFile(hero, BRAND_ART.sections.hero!.src)).toBe(false);
    const stage = within(section("characters")).getByRole("tabpanel");
    expect(shownFile(within(stage).getByRole("img", { name: "Tula drawn by the studio" }))).toContain("https://cdn.sanity.io/");
  });

  it("keeps the drawn placeholder for a friend or video the repository has no art for", () => {
    renderPage(landingContent((draft) => {
      draft.characters[0] = { ...draft.characters[0]!, id: "character-pip", name: "Pip the Little Squid" };
      draft.episodes[0] = { ...draft.episodes[0]!, mediaUrl: "https://www.youtube.com/watch?v=AAAAAAAAAAA" };
    }));
    const stage = within(section("characters")).getByRole("tabpanel");
    expect(stage.querySelector(".friend-stage__art img")).toBeNull();
    expect(stage.querySelector(".friend-stage__art svg")?.getAttribute("aria-hidden")).toBe("true");
    const book = within(section("episodes")).getByRole("tabpanel");
    expect(book.querySelector(".storybook__cover img")).toBeNull();
  });
});

describe("rebrand review fixes", () => {
  it("describes the repository trio by its own alt text, whatever the CMS says about other artwork (M2)", () => {
    renderPage(landingContent((draft) => { draft.hero.artworkDescription = "A drawing of the Bay at dusk"; }));
    const hero = within(section("hero")).getByRole("img", { name: BRAND_ART.sections.hero!.alt });
    expect(shownFile(hero)).toBe(BRAND_ART.sections.hero!.src);
    expect(within(section("hero")).queryByRole("img", { name: "A drawing of the Bay at dusk" })).toBeNull();
  });

  it("names each video's way out by its title, so a links list tells them apart (M6)", () => {
    renderPage();
    const tabs = within(section("episodes")).getAllByRole("tab");
    landingContent().episodes.forEach((video, index) => {
      fireEvent.click(tabs[index]!);
      const panel = within(section("episodes")).getByRole("tabpanel");
      const link = within(panel).getByRole("link", { name: /Watch on YouTube/ });
      expect(link.textContent).toContain(video.title);
    });
  });

  it("draws the reef only on the sea ground, and its front dune only when the sand band follows (M7)", () => {
    renderPage();
    const reef = () => section("hero").querySelector(".reef-backdrop");
    expect(reef()).not.toBeNull();
    expect(reef()!.querySelector("[data-bay-layer='sand'] [data-dune]:last-child")?.getAttribute("fill")).toBe("#fbe9d4");
    cleanup();

    // The trust band hidden: the hero meets the promise's clear water, so no sand dune runs into it.
    renderPage(landingContent((draft) => { draft.sections = draft.sections.map((entry) => (entry.id === "trust" ? { ...entry, visible: false } : entry)); }));
    expect(reef()).not.toBeNull();
    expect(Array.from(reef()!.querySelectorAll("[data-dune]"), (dune) => dune.getAttribute("fill"))).not.toContain("#fbe9d4");
    cleanup();

    renderPage(landingContent((draft) => { draft.sections = draft.sections.map((entry) => (entry.id === "hero" ? { ...entry, theme: { background: "paper" } } : entry)); }));
    expect(reef()).toBeNull();
  });

  it("draws reef sand over the channel's closing scene but never over an editor's own image (M7)", () => {
    renderPage();
    expect(section("finalCta").querySelector(".reef-backdrop")).not.toBeNull();
    cleanup();
    renderPage(landingContent((draft) => { draft.finalCta.image = { asset: { _ref: "image-close-1600x900-jpg" }, alt: "Footprints along the shore" }; }));
    expect(section("finalCta").querySelector(".reef-backdrop")).toBeNull();
  });
});

describe("rebrand re-review fixes", () => {
  it("builds each video link's name from interface copy, not a string fixed in the component (N4)", async () => {
    const { UI_COPY } = await import("@/components/landing/ui-copy");
    renderPage();
    const video = landingContent().episodes[0]!;
    const link = within(within(section("episodes")).getByRole("tabpanel")).getByRole("link", { name: /Watch on YouTube/ });
    expect(link.textContent).toBe(`${UI_COPY.watchOnYouTube}${UI_COPY.videoLinkTitle(video.title)} ${UI_COPY.opensInNewTab}`);
  });
});
