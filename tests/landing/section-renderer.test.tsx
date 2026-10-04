import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import type { LandingPageContent, SectionId, SiteSettings, Testimonial } from "@/lib/content/types";
import { DEFAULT_RENDERED_SECTIONS, landingContent, siteSettings } from "./fixtures";

vi.mock("server-only", () => ({}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderPage(content: LandingPageContent = landingContent(), settings: SiteSettings = siteSettings(), leadForm?: ReactNode) {
  return render(<LandingPage content={content} settings={settings} leadForm={leadForm} />);
}

const sectionOrder = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-section]")).map((section) => section.dataset.section);

const section = (id: SectionId) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`section #${id} is not rendered`);
  return element;
};

const linkHrefs = () => Array.from(document.querySelectorAll("a[href]")).map((link) => link.getAttribute("href"));

describe("section order and visibility", () => {
  it("renders the safe fallback narrative in order, without testimonials", () => {
    renderPage();
    expect(sectionOrder()).toEqual([...DEFAULT_RENDERED_SECTIONS]);
  });

  it("follows the order the CMS gives", () => {
    const order: SectionId[] = ["faq", "hero", "lead", "characters", "trust", "promise", "episodes", "offline", "pillars", "ecosystem", "finalCta"];
    renderPage(landingContent((draft) => {
      draft.sections = order.map((id) => ({ id, visible: true }));
    }));
    expect(sectionOrder()).toEqual(order);
  });

  it("leaves out sections the CMS hides, and every link that pointed at them", () => {
    renderPage(landingContent((draft) => {
      for (const entry of draft.sections) if (entry.id === "promise" || entry.id === "episodes") entry.visible = false;
    }));
    expect(sectionOrder()).toEqual(["hero", "trust", "characters", "offline", "pillars", "ecosystem", "lead", "faq", "finalCta"]);
    expect(document.getElementById("episodes")).toBeNull();
    expect(screen.queryByRole("link", { name: "Story ideas" })).toBeNull();
    expect(linkHrefs()).not.toContain("#episodes");
  });

  it("leaves out a section whose CMS collection is empty, and the links to it", () => {
    renderPage(landingContent((draft) => {
      draft.characters = [];
      draft.faqs = [];
    }));
    expect(sectionOrder()).toEqual(["hero", "trust", "promise", "episodes", "offline", "pillars", "ecosystem", "lead", "finalCta"]);
    expect(screen.queryByRole("link", { name: "Meet the Bay friends" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Meet the friends" })).toBeNull();
    expect(linkHrefs()).not.toContain("#characters");
  });

  it("gives every section a section root whose id and data-section hook match", () => {
    renderPage();
    const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-section]"));
    expect(roots).toHaveLength(DEFAULT_RENDERED_SECTIONS.length);
    for (const root of roots) {
      expect(root.tagName).toBe("SECTION");
      expect(root.id).toBe(root.dataset.section);
    }
  });

  it("points every in-page link at an element that exists", () => {
    for (const content of [landingContent(), landingContent((draft) => { draft.sections = draft.sections.filter((entry) => entry.id !== "lead"); })]) {
      const { unmount } = renderPage(content);
      const anchors = linkHrefs().filter((href): href is string => !!href?.startsWith("#"));
      expect(anchors.length).toBeGreaterThan(0);
      for (const href of anchors) expect(document.getElementById(href.slice(1)), href).not.toBeNull();
      unmount();
    }
  });
});

describe("testimonials", () => {
  const verified: Testimonial = { id: "t1", quote: "We talk about Shelly on every beach walk now.", attribution: "Parent of a five-year-old", verified: true };
  const withProof = (entries: Testimonial[]) => landingContent((draft) => {
    draft.testimonials = entries;
    for (const entry of draft.sections) if (entry.id === "testimonials") entry.visible = true;
  });

  it("stay absent while the site setting is off, even with a verified entry", () => {
    renderPage(withProof([verified]), siteSettings());
    expect(sectionOrder()).toEqual([...DEFAULT_RENDERED_SECTIONS]);
    expect(document.body.textContent).not.toContain(verified.quote);
  });

  it("stay absent when enabled without a verified entry", () => {
    renderPage(withProof([]), siteSettings((draft) => { draft.testimonialsEnabled = true; }));
    expect(sectionOrder()).toEqual([...DEFAULT_RENDERED_SECTIONS]);
  });

  it("render verified entries when enabled and visible", () => {
    renderPage(withProof([verified]), siteSettings((draft) => { draft.testimonialsEnabled = true; }));
    const proof = section("testimonials");
    expect(within(proof).getByText(verified.quote)).toBeTruthy();
    expect(within(proof).getByText(verified.attribution)).toBeTruthy();
  });

  it("never render an unverified entry", () => {
    const unverified = { id: "t2", quote: "Invented praise.", attribution: "Nobody", verified: false } as unknown as Testimonial;
    const enabled = siteSettings((draft) => { draft.testimonialsEnabled = true; });
    const { unmount } = renderPage(withProof([verified, unverified]), enabled);
    expect(document.body.textContent).toContain(verified.quote);
    expect(document.body.textContent).not.toContain(unverified.quote);
    unmount();
    renderPage(withProof([unverified]), enabled);
    expect(document.querySelector('[data-section="testimonials"]')).toBeNull();
  });
});

describe("navigation, footer and settings gates", () => {
  it("links the commerce route only when commerce is enabled", () => {
    const { unmount } = renderPage();
    expect(screen.queryByRole("link", { name: "Shop" })).toBeNull();
    expect(linkHrefs()).not.toContain("/shop");
    unmount();
    renderPage(landingContent(), siteSettings((draft) => { draft.commerceEnabled = true; }));
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Shop" }).getAttribute("href")).toBe("/shop");
  });

  it("drops a CMS link into the shop while commerce is disabled", () => {
    const content = landingContent((draft) => {
      draft.ecosystem[7] = { ...draft.ecosystem[7]!, status: "available", cta: { label: "Visit BIBO Shop", href: "/shop" } };
    });
    const { unmount } = renderPage(content);
    expect(screen.queryByRole("link", { name: "Visit BIBO Shop" })).toBeNull();
    unmount();
    renderPage(content, siteSettings((draft) => { draft.commerceEnabled = true; }));
    expect(screen.getByRole("link", { name: "Visit BIBO Shop" }).getAttribute("href")).toBe("/shop");
  });

  it("renders social links only from verified settings", () => {
    const { unmount } = renderPage();
    expect(linkHrefs().filter((href) => /instagram|youtube|facebook|tiktok|pinterest/.test(href ?? ""))).toEqual([]);
    unmount();
    renderPage(landingContent(), siteSettings((draft) => {
      draft.socialLinks = [{ platform: "instagram", url: "https://www.instagram.com/bibobay/", verified: true }];
    }));
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: /Instagram/ }).getAttribute("href")).toBe("https://www.instagram.com/bibobay/");
  });

  it("shows a contact link only when an email is configured", () => {
    const { unmount } = renderPage();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    unmount();
    renderPage(landingContent(), siteSettings((draft) => { draft.contactEmail = "hello@bibobay.example"; }));
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Contact")).toBeTruthy();
    expect(within(footer).getByRole("link", { name: "hello@bibobay.example" }).getAttribute("href")).toBe("mailto:hello@bibobay.example");
  });

  it("renders the footer copy and the CMS legal links", () => {
    renderPage(landingContent(), siteSettings((draft) => {
      draft.footer.text = "A small studio making a big bay.";
      draft.footer.legalLinks = [{ label: "Privacy notice", href: "/privacy" }, { label: "Terms of use", href: "/terms" }];
    }));
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("A small studio making a big bay.")).toBeTruthy();
    expect(within(footer).getByRole("link", { name: "Privacy notice" }).getAttribute("href")).toBe("/privacy");
    expect(within(footer).getByRole("link", { name: "Terms of use" }).getAttribute("href")).toBe("/terms");
  });

  it("draws the header and footer logo from the canonical file", () => {
    renderPage();
    const header = screen.getByRole("banner");
    const footer = screen.getByRole("contentinfo");
    expect(within(header).getByRole("img", { name: "BIBO" }).getAttribute("src")).toBe("/bibo-logo.svg");
    expect(footer.querySelector("[data-bibo-logo] img")?.getAttribute("src")).toBe("/bibo-logo.svg");
    // The logo is the canonical file, never geometry copied inline.
    for (const logo of Array.from(document.querySelectorAll("[data-bibo-logo]"))) {
      expect(logo.querySelector("svg")).toBeNull();
      expect(logo.querySelector("img")?.getAttribute("src")).toBe("/bibo-logo.svg");
    }
  });

  it("opens external CMS links in a new tab, says so, and drops the opener", () => {
    renderPage(landingContent((draft) => {
      draft.hero.secondaryCta = { label: "Read our story", href: "https://example.org/bibo-story", external: true };
    }));
    const link = screen.getByRole("link", { name: /Read our story/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("opens in a new tab");
  });
});

describe("lead capture", () => {
  it("renders the CMS lead copy without inventing a form or an outcome", () => {
    const content = landingContent();
    renderPage(content);
    const lead = section("lead");
    expect(within(lead).getByRole("heading", { level: 2, name: content.lead.heading })).toBeTruthy();
    expect(within(lead).getByText(content.lead.description)).toBeTruthy();
    expect(lead.querySelector("form, input, textarea, select, button")).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(content.lead.successMessage);
    expect(text).not.toContain(content.lead.errorMessage);
  });

  it("hosts the form supplied for the lead slot", () => {
    renderPage(landingContent(), siteSettings(), (
      <form aria-label="Founding family signup">
        <label>
          Email
          <input type="email" />
        </label>
      </form>
    ));
    expect(within(section("lead")).getByRole("form", { name: "Founding family signup" })).toBeTruthy();
  });

  it("keeps calls to action that scroll to the lead section", () => {
    renderPage();
    const toLead = Array.from(document.querySelectorAll('a[href="#lead"]')).map((link) => link.textContent?.trim());
    expect(toLead).toEqual(expect.arrayContaining(["Join the list", "Join the founding-family list"]));
    expect(within(section("hero")).getByRole("link", { name: "Join the founding-family list" }).getAttribute("href")).toBe("#lead");
    expect(within(section("finalCta")).getByRole("link", { name: "Join the founding-family list" }).getAttribute("href")).toBe("#lead");
  });

  it("offers a download only when the CMS marks a real file available", () => {
    const { unmount } = renderPage();
    expect(screen.queryByRole("link", { name: "Bay colouring sheet" })).toBeNull();
    unmount();
    renderPage(landingContent((draft) => {
      draft.lead.leadMagnet = { title: "Bay colouring sheet", description: "One printable page of the Bay.", fileUrl: "https://cdn.sanity.io/files/abc/production/sheet.pdf", available: true };
    }));
    const link = within(section("lead")).getByRole("link", { name: "Bay colouring sheet" });
    expect(link.getAttribute("href")).toBe("https://cdn.sanity.io/files/abc/production/sheet.pdf");
    expect(within(section("lead")).getByText("One printable page of the Bay.")).toBeTruthy();
  });
});

describe("content stays visible and server-rendered", () => {
  it("starts every element fully visible, with no animation initial state", () => {
    renderPage();
    const elements = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
    expect(elements.length).toBeGreaterThan(100);
    for (const element of elements) {
      expect(element.style.opacity, element.outerHTML.slice(0, 80)).not.toBe("0");
      expect(element.style.visibility).not.toBe("hidden");
      expect(element.style.transform).toBe("");
      if (element.hidden) expect(element.getAttribute("role"), element.outerHTML.slice(0, 80)).toBe("tabpanel");
    }
  });

  it("server-renders every friend, story concept and answer", () => {
    const content = landingContent();
    const html = renderToStaticMarkup(<LandingPage content={content} settings={siteSettings()} />);
    const decoded = html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
    for (const friend of content.characters) expect(decoded).toContain(friend.description);
    for (const story of content.episodes) expect(decoded).toContain(story.summary);
    for (const faq of content.faqs) expect(decoded).toContain(faq.answer);
  });

  it("takes its visible copy from the CMS", () => {
    renderPage(landingContent((draft) => {
      draft.hero.title = "Tide pools, tall tales.";
      draft.trust.items = ["Calm stories"];
      draft.offline.steps = [{ title: "Imagine", description: "Picture the next page." }];
      draft.pillars = [{ id: "p", title: "Patient builders", description: "Try, wait, try again.", prompts: ["What else could work?"] }];
      draft.ecosystem = [{ id: "e", name: "BIBO Garden", tagline: "Growing things", description: "A possible future space for growing things.", status: "in-development" }];
      draft.finalCta.heading = "See you at the shore.";
    }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tide pools, tall tales.");
    for (const text of ["Calm stories", "Imagine", "Picture the next page.", "Patient builders", "What else could work?", "BIBO Garden", "In development", "See you at the shore."]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
  });

  it("renders the promise rich text with safe structure", () => {
    renderPage(landingContent((draft) => {
      draft.promise.body = [
        { _type: "block", _key: "a", style: "h2", children: [{ _type: "span", _key: "a1", text: "Why stories first" }], markDefs: [] },
        {
          _type: "block", _key: "b", style: "normal", markDefs: [{ _type: "link", _key: "l1", href: "/privacy" }],
          children: [
            { _type: "span", _key: "b1", text: "Children learn best when they ", marks: [] },
            { _type: "span", _key: "b2", text: "care", marks: ["strong"] },
            { _type: "span", _key: "b3", text: " — read our ", marks: [] },
            { _type: "span", _key: "b4", text: "privacy notes", marks: ["l1"] },
          ],
        },
      ];
    }));
    const promise = section("promise");
    expect(within(promise).getByRole("heading", { level: 3, name: "Why stories first" })).toBeTruthy();
    expect(within(promise).getByText("care").tagName).toBe("STRONG");
    expect(within(promise).getByRole("link", { name: "privacy notes" }).getAttribute("href")).toBe("/privacy");
  });

  it("shows approved Sanity art for friends and stories, and honest abstract shapes otherwise", () => {
    vi.stubEnv("NEXT_PUBLIC_SANITY_PROJECT_ID", "abcdefgh");
    vi.stubEnv("NEXT_PUBLIC_SANITY_DATASET", "production");
    renderPage(landingContent((draft) => {
      draft.characters[0]!.image = { asset: { _ref: "image-ollie-1200x1000-png" }, alt: "Ollie the Sea Otter floating on her back" };
      draft.episodes[0]!.image = { asset: { _ref: "image-coral-1600x900-jpg" }, alt: "Letter stones on a coral reef" };
    }));
    const ollie = within(section("characters")).getByRole("img", { name: "Ollie the Sea Otter floating on her back" });
    expect(ollie.getAttribute("src")).toContain("https://cdn.sanity.io/images/abcdefgh/production/ollie-1200x1000.png");
    const coral = within(section("episodes")).getByRole("img", { name: "Letter stones on a coral reef" });
    expect(coral.getAttribute("src")).toContain("https://cdn.sanity.io/images/abcdefgh/production/coral-1600x900.jpg");
    // The other five friends keep their abstract placeholder: no <img>, nothing announced.
    expect(section("characters").querySelectorAll("img")).toHaveLength(1);
  });
});
