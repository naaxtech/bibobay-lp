import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { evaluate, parse } from "groq-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactForm } from "@/components/forms/ContactForm";
import { LeadForm } from "@/components/forms/LeadForm";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { LandingPage } from "@/components/landing/LandingPage";
import { linkContext } from "@/components/landing/sections";
import { UI_COPY } from "@/components/landing/ui-copy";
import { AddToOrder } from "@/components/shop/AddToOrder";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { OrderPadSummary } from "@/components/shop/OrderPadSummary";
import { normalizeContactPage, normalizeLandingContent, normalizeSiteSettings } from "@/lib/content/normalize";
import { stegaCleanText } from "@/lib/content/stega";
import { CONTACT_PAGE_QUERY, LANDING_PAGE_QUERY, SITE_SETTINGS_QUERY } from "@/lib/sanity/queries";
import { buildSeedDocuments } from "@/studio/scripts/seed-data";
import { encodeAllStrings, encodeString, STEGA_CHARACTER } from "@/tests/support/stega";

/*
 * Ruling R167: in the Studio's Presentation tool, CMS text carries its invisible click-to-edit link
 * into the page, and an attribute is the wrong place for it: in `aria-label` a screen reader gets
 * the payload, in `data-*` it breaks the layout tricks that read them. The only attributes that may
 * keep it are the ones Visual Editing itself reads to make an element clickable.
 * src: node_modules/@sanity/visual-editing/dist/VisualEditing-CNvAjHwz.js EXPECTED_STEGA_ATTRIBUTES · @sanity/visual-editing 6.1.3 · 2026-10-21
 */
const EXPECTED_STEGA_ATTRIBUTES: Record<string, readonly string[]> = { IMG: ["alt"], TIME: ["datetime"], SVG: ["aria-label"] };

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
});

const read = async (query: string) => structuredClone(await (await evaluate(parse(query), { dataset: buildSeedDocuments() })).get()) as Record<string, unknown>;

/** Every attribute carrying a payload where Visual Editing does not expect one. */
function leaks(root: Element): string[] {
  const found: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      if (!STEGA_CHARACTER.test(attribute.value)) continue;
      if (EXPECTED_STEGA_ATTRIBUTES[element.tagName.toUpperCase()]?.includes(attribute.name.toLowerCase())) continue;
      found.push(`<${element.tagName.toLowerCase()} ${attribute.name}="${stegaCleanText(attribute.value)}">`);
    }
  }
  return found;
}

/** The seeded home page as Presentation serves it: every string encoded, then normalized like fetch.ts. */
async function encodedHome() {
  const landing = await read(LANDING_PAGE_QUERY);
  const settingsRaw = await read(SITE_SETTINGS_QUERY);
  const settings = normalizeSiteSettings(encodeAllStrings({ ...settingsRaw, testimonialsEnabled: true }, { _id: "siteSettings", _type: "siteSettings" }));
  const content = normalizeLandingContent(encodeAllStrings(landing), { testimonialsEnabled: true });
  return { content, settings };
}

describe("CMS text split for display under Presentation stega (R170)", () => {
  // Visual Editing makes the element holding the payload's text node clickable. Split into lines,
  // the payload sat in the last line only, so only "Big adventures." was clickable.
  async function hero(title: string) {
    const { content, settings } = await encodedHome();
    const section = content.sections.find((entry) => entry.id === "hero");
    if (!section) throw new Error("no hero section");
    render(<Hero section={section} hero={{ ...content.hero, title }} links={linkContext(content.sections, settings)} />);
    return screen.getByRole("heading", { level: 1 });
  }

  it("the hero title's edit link belongs to the whole heading, and no line carries it", async () => {
    const h1 = await hero(encodeString("Bright minds. Kind hearts. Big adventures."));
    const lines = Array.from(h1.querySelectorAll(".hero-title__line"));
    expect(lines.map((line) => line.textContent)).toEqual(["Bright minds.", " Kind hearts.", " Big adventures."]);
    const own = Array.from(h1.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "");
    expect(own.some((text) => STEGA_CHARACTER.test(text))).toBe(true);
    expect(stegaCleanText(h1.textContent ?? "")).toBe("Bright minds. Kind hearts. Big adventures.");
  });

  it("a published title renders exactly as before: lines only", async () => {
    const h1 = await hero("Bright minds. Kind hearts. Big adventures.");
    expect(Array.from(h1.childNodes).every((node) => node.nodeType === Node.ELEMENT_NODE)).toBe(true);
    expect(h1.textContent).toBe("Bright minds. Kind hearts. Big adventures.");
  });
});

describe("CMS text in attributes under Presentation stega (R167)", () => {
  it("the home page puts no payload in an attribute, and keeps it in text", async () => {
    const { content, settings } = await encodedHome();
    const { successMessage, errorMessage, buttonLabel, consentCopy } = content.lead;
    const { container } = render(<LandingPage content={content} settings={settings} leadForm={<LeadForm copy={{ buttonLabel, consentCopy, successMessage, errorMessage }} />} />);

    // The fixture really is encoded where it matters: the hero title stays clickable.
    expect(STEGA_CHARACTER.test(screen.getByRole("heading", { level: 1 }).textContent ?? "")).toBe(true);
    // The free-pack button and the lead form's outcome reservations are on the page.
    expect(container.querySelector(".freebie-card__download")).not.toBeNull();
    expect(container.querySelector(".lead-form__outcome[data-reserve-a]")).not.toBeNull();

    expect(leaks(container)).toEqual([]);
  });

  it("the hero's drawn backdrop is described without a payload when no artwork is set", async () => {
    const { content, settings } = await encodedHome();
    const section = content.sections.find((entry) => entry.id === "hero");
    if (!section) throw new Error("no hero section");
    // No `art`: the CMS image and the channel's trio are both missing, so the drawn Bay stands in.
    const { container } = render(<Hero section={section} hero={content.hero} links={linkContext(content.sections, settings)} />);
    const art = container.querySelector(".hero-postcard__art[role='img']");
    expect(art?.getAttribute("aria-label")).toBe(stegaCleanText(content.hero.artworkDescription));
    expect(leaks(container)).toEqual([]);
  });

  it("the contact form puts no payload in an attribute, and keeps it in its button text", async () => {
    const { buttonLabel, successMessage, errorMessage, closedMessage } = normalizeContactPage(encodeAllStrings(await read(CONTACT_PAGE_QUERY), { _id: "contactPage", _type: "contactPage" }));
    const { container } = render(<ContactForm copy={{ buttonLabel, successMessage, errorMessage, closedMessage }} />);

    const button = container.querySelector("button[type='submit']");
    expect(STEGA_CHARACTER.test(button?.textContent ?? "")).toBe(true);
    expect(stegaCleanText(button?.textContent ?? "")).toBe("Send message");
    // The outcome line's height reservations hold the plain messages.
    const [outer, inner] = Array.from(container.querySelectorAll(".lead-form__outcome"));
    expect(outer?.getAttribute("data-reserve-a")).toBe("Thank you. We have received your message.");
    expect(outer?.getAttribute("data-reserve-b")).toBe("We could not save your message. Please try again.");
    expect(inner?.getAttribute("data-reserve-a")).toBe("The contact form is not open yet, so no message can be saved from this page. Please check back soon.");

    expect(leaks(container)).toEqual([]);
  });

  it("the footer's link to /contact keeps its label's payload in text only", async () => {
    const { settings } = await encodedHome();
    const { container } = render(<Footer settings={settings} contactOpen />);
    // Found by its address: the accessible name folds the payload's U+FEFF characters into spaces.
    const link = container.querySelector("a[href='/contact']");
    expect(stegaCleanText(link?.textContent ?? "")).toBe("Contact us");
    expect(STEGA_CHARACTER.test(link?.textContent ?? "")).toBe(true);
    expect(leaks(container)).toEqual([]);
  });

  it("the order pad names products without a payload", async () => {
    const tula = encodeString("Tula plush");
    render(
      <OrderPadProvider>
        <AddToOrder productId="plush-tula" productName={tula} />
        <OrderPadSummary listed={[{ id: "plush-tula", name: tula }]} />
      </OrderPadProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: `${UI_COPY.orderPad.remove}: Tula plush` })).toBeDefined();
    expect(leaks(document.body)).toEqual([]);
  });
});
