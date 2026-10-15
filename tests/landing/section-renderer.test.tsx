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
    expect(screen.queryByRole("link", { name: "Watch" })).toBeNull();
    expect(linkHrefs()).not.toContain("#episodes");
  });

  it("leaves out a section whose CMS collection is empty, and the links to it", () => {
    renderPage(landingContent((draft) => {
      draft.characters = [];
      draft.faqs = [];
    }));
    expect(sectionOrder()).toEqual(["hero", "trust", "promise", "episodes", "offline", "pillars", "ecosystem", "lead", "finalCta"]);
    expect(screen.queryByRole("link", { name: "Meet Tula, Bob & Lumi" })).toBeNull();
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
    // Social profiles live in the footer; the page's own "Watch on YouTube" calls are not profiles.
    const social = () => within(screen.getByRole("contentinfo")).queryAllByRole("link").map((link) => link.getAttribute("href")).filter((href) => /instagram|youtube|facebook|tiktok|pinterest/.test(href ?? ""));
    const { unmount } = renderPage(landingContent(), siteSettings((draft) => { draft.socialLinks = []; }));
    expect(social()).toEqual([]);
    unmount();
    // The fallback's one owner-confirmed account: the Bibo Bay channel, in the footer.
    const second = renderPage();
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: /YouTube/ }).getAttribute("href")).toBe("https://www.youtube.com/@bibobay-tv");
    second.unmount();
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

  it("keeps the founding-family list one tap away and sends the page's calls to action to YouTube", () => {
    renderPage();
    const toLead = Array.from(document.querySelectorAll('a[href="#lead"]')).map((link) => link.textContent?.trim());
    expect(toLead.length).toBeGreaterThan(0);
    const external = (link: HTMLElement, href: string) => {
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    };
    external(within(section("hero")).getByRole("link", { name: /Watch on YouTube/ }), "https://www.youtube.com/@bibobay-tv");
    const subscribe = "https://www.youtube.com/channel/UCFruHuRQ2eOrq9NOyx0K1GA?sub_confirmation=1";
    // The header's one call to action, the watch section and the closing invitation all subscribe.
    external(within(screen.getByRole("banner")).getAllByRole("link", { name: /Subscribe on YouTube/ })[0]!, subscribe);
    external(within(section("episodes")).getByRole("link", { name: /Subscribe on YouTube/ }), subscribe);
    external(within(section("finalCta")).getByRole("link", { name: /Subscribe on YouTube/ }), subscribe);
    expect(within(section("hero")).getByRole("link", { name: "Meet Tula, Bob & Lumi" }).getAttribute("href")).toBe("#characters");
  });

  it("offers the repository's activity pack by default, with its page previews and real size", () => {
    renderPage();
    const lead = section("lead");
    const link = within(lead).getByRole("link", { name: /^Download the free pack/ });
    expect(link.getAttribute("href")).toBe("/freebies/bibo-bay-activity-pack.pdf");
    expect(link.hasAttribute("download")).toBe(true);
    // The link's whole name, one label: "<visible words>: <pack title>".
    expect(link.getAttribute("aria-label")).toBe("Download the free pack: Bibo Bay Activity Pack");
    const cover = within(lead).getByRole("img", { name: /activity pack/i });
    expect(cover.getAttribute("src")).toMatch(/^\/freebies\/activity-pack-cover-\d+\.webp$/);
    expect(within(lead).getByText(/^PDF · 8 pages · \d+(\.\d)? MB$/)).toBeTruthy();
  });

  it("offers a download only when the CMS marks a real file available", () => {
    const { unmount } = renderPage(landingContent((draft) => {
      delete draft.lead.leadMagnet;
    }));
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    unmount();
    renderPage(landingContent((draft) => {
      draft.lead.leadMagnet = { title: "Bay colouring sheet", description: "One printable page of the Bay.", fileUrl: "https://cdn.sanity.io/files/abc/production/sheet.pdf", available: true };
    }));
    const link = within(section("lead")).getByRole("link", { name: /^Download the free pack/ });
    expect(link.getAttribute("href")).toBe("https://cdn.sanity.io/files/abc/production/sheet.pdf");
    expect(link.getAttribute("aria-label")).toBe("Download the free pack: Bay colouring sheet");
    expect(within(section("lead")).getByText("One printable page of the Bay.")).toBeTruthy();
    // The repository's previews and size describe only the repository's own pack.
    expect(within(section("lead")).queryByRole("img", { name: /activity pack/i })).toBeNull();
    expect(within(section("lead")).queryByText(/^PDF ·/)).toBeNull();
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
      // Only an unchosen tab panel may start out of reach (inert, or hidden as tab panels once were);
      // it is still laid out and hidden by the stylesheet, never by an inline style.
      if (element.hidden || element.hasAttribute("inert")) expect(element.getAttribute("role"), element.outerHTML.slice(0, 80)).toBe("tabpanel");
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

  it("shows approved Sanity art for friends and stories in place of the channel art", () => {
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
    // The other friends keep their channel portraits, served by this site.
    const portraits = Array.from(section("characters").querySelectorAll(".friend-stage__art img"), (image) => decodeURIComponent(image.getAttribute("src") ?? ""));
    expect(portraits).toHaveLength(3);
    expect(portraits.filter((src) => src.includes("/brand/art/friend-"))).toHaveLength(2);
  });
});

describe("YouTube-first calls to action", () => {
  it("marks every link to the channel or a video with YouTube's play mark, hidden from assistive technology", () => {
    renderPage();
    const toYouTube = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((link) => new URL(link.href, "https://bibobay.example").hostname.endsWith("youtube.com"));
    expect(toYouTube.length).toBeGreaterThanOrEqual(5);
    for (const link of toYouTube) {
      const mark = link.querySelector("[data-youtube-mark]");
      expect(mark, `${link.textContent} carries the mark`).not.toBeNull();
      expect(mark!.getAttribute("aria-hidden")).toBe("true");
      // Review M9: the real mark, drawn in YouTube's own colours (red, with a white play triangle).
      expect(mark!.tagName.toLowerCase(), `${link.textContent} draws the mark`).toBe("svg");
      const fills = Array.from(mark!.querySelectorAll("[fill]"), (shape) => shape.getAttribute("fill")?.toUpperCase());
      expect(fills).toEqual(["#FF0000", "#FFFFFF"]);
    }
    // Links elsewhere carry no mark.
    expect(document.querySelectorAll("a[href^='#'] [data-youtube-mark]").length).toBe(0);
  });
});

describe("YouTube mark on every kind of link (review M9)", () => {
  it("marks a CMS link to YouTube that is not set to open a new tab", async () => {
    const { CtaLink } = await import("@/components/landing/CtaLink");
    render(<CtaLink cta={{ label: "Our channel", href: "https://www.youtube.com/@bibobay-tv" }} />);
    expect(screen.getByRole("link", { name: "Our channel" }).querySelector("svg[data-youtube-mark]")).not.toBeNull();
  });
});

describe("the free pack card (review M12)", () => {
  it("titles the pack as a heading under the section's own", () => {
    renderPage();
    expect(within(section("lead")).getByRole("heading", { level: 3, name: "Bibo Bay Activity Pack" })).toBeTruthy();
  });
});
