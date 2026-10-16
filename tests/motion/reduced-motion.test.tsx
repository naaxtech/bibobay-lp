import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/components/landing/LandingPage";
import { GsapProvider } from "@/components/motion/GsapProvider";
import { useReducedMotion } from "@/components/motion/useReducedMotion";
import { useSectionReveal } from "@/components/motion/useSectionReveal";
import { landingContent, siteSettings } from "../landing/fixtures";

vi.mock("server-only", () => ({}));

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
type Preference = "reduce" | "no-preference";

/** Stands in for the browser's prefers-reduced-motion setting, which the reader can change at any time. */
function emulateMotionPreference(initial: Preference) {
  let reduce = initial === "reduce";
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const matchMedia = (query: string) =>
    ({
      media: query,
      get matches() {
        return query === REDUCE_QUERY ? reduce : false;
      },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: matchMedia });
  return {
    set(next: Preference) {
      reduce = next === "reduce";
      act(() => {
        for (const listener of [...listeners]) listener({ matches: reduce, media: REDUCE_QUERY } as MediaQueryListEvent);
      });
    },
  };
}

/*
 * jsdom has no layout, so the page is laid out by hand: sections stacked 1200 px apart, each element a
 * little below the one before it in its section, every box 200 px tall. The hero starts on screen;
 * everything after it starts below the fold (jsdom's window is 768 px tall).
 */
const SECTION_SPACING = 1200;
const BOX_HEIGHT = 200;
/** Where a reader who has just scrolled something into view sees its top: low on the screen. */
const JUST_SCROLLED_IN = 0.8;
let scrollTop = 0;

function documentTop(element: Element): number {
  const sectionRoot = element.closest("[data-section]");
  if (!sectionRoot) return 0;
  const index = Array.from(document.querySelectorAll("[data-section]")).indexOf(sectionRoot);
  const depth = element === sectionRoot ? 0 : Array.from(sectionRoot.querySelectorAll("*")).indexOf(element) + 1;
  return index * SECTION_SPACING + Math.min(depth, 250) * 4;
}

function layOut(top: (element: Element) => number) {
  scrollTop = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const y = top(this) - scrollTop;
    return { top: y, bottom: y + BOX_HEIGHT, left: 0, right: 1024, width: 1024, height: BOX_HEIGHT, x: 0, y, toJSON: () => ({}) } as DOMRect;
  });
}

function scrollPageTo(y: number) {
  scrollTop = y;
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    ScrollTrigger.update();
  });
}

/** Scroll until the element's top sits low on the screen, as it does just after it scrolls into view. */
function scrollJustInto(element: Element) {
  scrollPageTo(documentTop(element) - window.innerHeight * JUST_SCROLLED_IN);
}

/** Scroll the whole page the way a reader does, a little at a time. */
function scrollThroughPage() {
  const end = document.querySelectorAll("[data-section]").length * SECTION_SPACING;
  for (let y = 0; y <= end; y += 150) scrollPageTo(y);
}

/**
 * Lets the motion layer react to what just happened (its MutationObserver records and gathered
 * reveals run as microtasks) without yielding to a timer, so GSAP's wall-clock ticker cannot advance
 * and a short tween cannot finish before it is inspected, however loaded the machine is.
 */
async function motionReacted() {
  for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
}

const MOTION_PROPERTIES = new Set(["opacity", "transform", "translate", "rotate", "scale"]);
const pageElements = () => Array.from(document.body.querySelectorAll<HTMLElement | SVGElement>("*"));
const tweensOnPage = () => gsap.getTweensOf(pageElements());
const isBayLayer = (element: Element) => element.closest("[data-bay-layer]") !== null;

/** Inline motion styles left on the page (bay layers are decoration moved only by parallax, so opt-in). */
function inlineMotionStyles(options: { includeBayLayers?: boolean } = {}) {
  const found: string[] = [];
  for (const element of pageElements()) {
    if (!options.includeBayLayers && isBayLayer(element)) continue;
    const { style } = element;
    const motion = [style.opacity, style.visibility, style.transform, style.translate, style.scale, style.rotate, style.getPropertyValue("--btn-press"), style.strokeDasharray, style.strokeDashoffset].filter(Boolean);
    if (motion.length > 0 || (element.matches("[data-bay-layer]") && element.hasAttribute("transform"))) {
      found.push(`${element.outerHTML.slice(0, 70)} → ${element.getAttribute("style") ?? element.getAttribute("transform")}`);
    }
  }
  return found;
}

const renderPage = () => render(<LandingPage content={landingContent()} settings={siteSettings()} />);
const sectionById = (id: string) => document.getElementById(id) as HTMLElement;
const heroCta = () => within(sectionById("hero")).getByRole("link", { name: "Meet Tula, Bob & Lumi" });
const pillarItems = () => Array.from(sectionById("pillars").querySelectorAll<HTMLElement>("li.pillar"));
const shownPanel = (id: string) => within(sectionById(id)).getByRole("tabpanel");
const bayLayer = (id: string, name: string) => sectionById(id).querySelector(`[data-bay-layer="${name}"]`) as SVGGElement;
const layerY = (layer: Element) => Number(gsap.getProperty(layer, "y"));

beforeEach(() => {
  layOut(documentTop);
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollTop });
  Object.defineProperty(window, "pageYOffset", { configurable: true, get: () => scrollTop });
  // ScrollTrigger restores the scroll position after measuring; jsdom does not implement scrolling.
  Object.defineProperty(window, "scrollTo", { configurable: true, writable: true, value: () => undefined });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
  document.documentElement.removeAttribute("data-motion");
});

describe("useReducedMotion", () => {
  function Probe() {
    return <p>{useReducedMotion() ? "reduce" : "no-preference"}</p>;
  }

  it("reports the reader's reduced-motion preference and follows it when it changes", () => {
    const preference = emulateMotionPreference("reduce");
    render(<Probe />);
    expect(screen.getByText("reduce")).toBeTruthy();
    preference.set("no-preference");
    expect(screen.getByText("no-preference")).toBeTruthy();
  });

  it("assumes reduced motion when the browser cannot be asked", () => {
    Reflect.deleteProperty(window, "matchMedia");
    render(<Probe />);
    expect(screen.getByText("reduce")).toBeTruthy();
  });
});

describe("the landing page under reduced motion", () => {
  it("renders statically: no ScrollTriggers, no tweens, nothing hidden or moved after scrolling, pressing and switching tabs", async () => {
    emulateMotionPreference("reduce");
    renderPage();
    scrollThroughPage();
    fireEvent.pointerDown(heroCta(), { button: 0 });
    fireEvent.click(within(sectionById("characters")).getAllByRole("tab")[1]!);
    fireEvent.click(within(sectionById("episodes")).getAllByRole("tab")[1]!);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(tweensOnPage()).toHaveLength(0);
    expect(inlineMotionStyles({ includeBayLayers: true })).toEqual([]);
    expect(document.documentElement.dataset.motion).not.toBe("full");
  });

  it("switches friends and stories at once: the panel left behind is out of reach in the same step and nothing tweens", async () => {
    emulateMotionPreference("reduce");
    renderPage();
    for (const id of ["characters", "episodes"]) {
      const outgoing = shownPanel(id);
      fireEvent.click(within(sectionById(id)).getAllByRole("tab")[1]!);
      const incoming = shownPanel(id);
      await motionReacted();
      expect(incoming, `${id}: the chosen panel is the one exposed`).not.toBe(outgoing);
      expect(outgoing.hasAttribute("inert"), `${id}: the panel left behind is out of reach at once`).toBe(true);
      expect(incoming.hasAttribute("inert")).toBe(false);
      const panels = [outgoing, incoming];
      expect(gsap.getTweensOf([...panels, ...panels.flatMap((panel) => Array.from(panel.querySelectorAll("*")))])).toHaveLength(0);
      for (const panel of panels) expect(panel.getAttribute("style") ?? "", `${id}: no inline motion`).not.toMatch(/opacity|visibility|transform|translate/);
    }
  });

  it("drops every animation and inline style the moment the reader asks for reduced motion", async () => {
    const preference = emulateMotionPreference("no-preference");
    renderPage();
    scrollJustInto(sectionById("pillars"));
    fireEvent.pointerDown(heroCta(), { button: 0 });
    await motionReacted();
    expect(gsap.getTweensOf(pillarItems()).length).toBeGreaterThan(0);
    expect(inlineMotionStyles().length).toBeGreaterThan(0);

    preference.set("reduce");

    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(tweensOnPage()).toHaveLength(0);
    expect(inlineMotionStyles({ includeBayLayers: true })).toEqual([]);
    expect(document.documentElement.dataset.motion).not.toBe("full");
    fireEvent.pointerDown(heroCta(), { button: 0 });
    expect(gsap.getTweensOf(heroCta()), "pressing no longer animates").toHaveLength(0);
  });
});

describe("the landing page with motion allowed", () => {
  it("hides nothing up front: no element starts transparent or moved, and on-screen content is never animated", () => {
    emulateMotionPreference("no-preference");
    renderPage();
    expect(ScrollTrigger.getAll().length).toBeGreaterThan(0);
    expect(inlineMotionStyles()).toEqual([]);
    expect(gsap.getTweensOf(sectionById("hero").querySelectorAll("*:not([data-bay-layer])"))).toHaveLength(0);
  });

  it("reveals content as it scrolls in with opacity and transform only, and leaves it fully visible", async () => {
    emulateMotionPreference("no-preference");
    renderPage();
    expect(pillarItems().length).toBeGreaterThan(1);
    const before = new Map(pageElements().map((element) => [element, new Set(Array.from(element.style))]));

    scrollJustInto(sectionById("pillars"));
    await motionReacted();
    expect(gsap.getTweensOf(pillarItems()).length).toBeGreaterThan(0);
    for (const element of pageElements()) {
      if (isBayLayer(element)) continue;
      const added = Array.from(element.style).filter((property) => !before.get(element)?.has(property));
      expect(added.filter((property) => !MOTION_PROPERTIES.has(property)), element.outerHTML.slice(0, 70)).toEqual([]);
    }

    await vi.waitFor(() => expect(inlineMotionStyles()).toEqual([]), { timeout: 4000 });
    expect(gsap.getTweensOf(pillarItems())).toHaveLength(0);
  });

  it("never re-hides content the reader can already see, such as a section reached by an anchor jump", async () => {
    emulateMotionPreference("no-preference");
    renderPage();
    // Jump straight to the values section: its heading lands near the top of the screen.
    scrollPageTo(documentTop(sectionById("pillars")));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(gsap.getTweensOf(pillarItems())).toHaveLength(0);
    expect(inlineMotionStyles()).toEqual([]);
  });

  it("moves the hero's reef layers by depth as the hero scrolls away: the light drifts most, the sand holds", () => {
    emulateMotionPreference("no-preference");
    renderPage();
    expect(layerY(bayLayer("hero", "rays"))).toBe(0);

    scrollPageTo(BOX_HEIGHT / 2);

    const rays = layerY(bayLayer("hero", "rays"));
    const farBubbles = layerY(bayLayer("hero", "far-bubbles"));
    const nearBubbles = layerY(bayLayer("hero", "near-bubbles"));
    expect(rays).toBeGreaterThan(farBubbles);
    expect(farBubbles).toBeGreaterThan(nearBubbles);
    expect(nearBubbles).toBeGreaterThan(0);
    expect(layerY(bayLayer("hero", "sand"))).toBe(0);
    expect(rays, "a calm drift, not a slide").toBeLessThanOrEqual(48);
  });

  it("settles the closing reef into its drawn position once it has fully scrolled in", () => {
    emulateMotionPreference("no-preference");
    renderPage();
    const rays = bayLayer("finalCta", "rays");
    const reef = rays.closest("svg")!;
    const arrived = documentTop(reef) + BOX_HEIGHT - window.innerHeight;

    scrollPageTo(arrived - BOX_HEIGHT / 2);
    expect(Math.abs(layerY(rays))).toBeGreaterThan(0);
    scrollPageTo(arrived);
    expect(layerY(rays)).toBe(0);
    expect(layerY(bayLayer("finalCta", "sand"))).toBe(0);
  });

  it("draws the screen-to-life loop in step order when it scrolls in, and leaves it fully drawn", async () => {
    emulateMotionPreference("no-preference");
    renderPage();
    const path = sectionById("offline").querySelector("[data-loop-path]") as SVGPathElement;
    const marks = Array.from(sectionById("offline").querySelectorAll<HTMLElement | SVGElement>("[data-loop-at]"));
    expect(marks, "each step's node and arrow is placed along the loop").toHaveLength(2 * 4);
    expect(path.getAttribute("pathLength"), "the dash is measured as a share of the loop").toBe("1");

    scrollJustInto(path.closest(".loop-diagram")!);
    await motionReacted();
    expect(gsap.getTweensOf(path).length).toBeGreaterThan(0);
    const byPosition = [...marks].sort((a, b) => Number(a.getAttribute("data-loop-at")) - Number(b.getAttribute("data-loop-at")));
    const starts = byPosition.map((mark) => gsap.getTweensOf(mark)[0]!.startTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.at(-1)!).toBeGreaterThan(starts[0]!);

    await vi.waitFor(() => expect(inlineMotionStyles()).toEqual([]), { timeout: 4000 });
  });

  it("presses a CTA in under 180 ms and springs it back in under 180 ms", async () => {
    emulateMotionPreference("no-preference");
    renderPage();
    const cta = heroCta();
    expect(document.documentElement.dataset.motion, "the motion layer is running").toBe("full");

    fireEvent.pointerDown(cta, { button: 0 });
    const press = gsap.getTweensOf(cta);
    expect(press).toHaveLength(1);
    expect(press[0]!.duration() * 1000).toBeLessThan(180);
    await vi.waitFor(() => expect(Number(cta.style.getPropertyValue("--btn-press"))).toBeLessThan(1));

    fireEvent.pointerUp(window);
    const release = gsap.getTweensOf(cta);
    expect(release).toHaveLength(1);
    expect(release[0]!.duration() * 1000).toBeLessThan(180);
    await vi.waitFor(() => expect(cta.style.getPropertyValue("--btn-press")).toBe(""));
  });

  it("crossfades friends and stories: the panel left behind fades out while the chosen one fades in, then no styles remain", async () => {
    emulateMotionPreference("no-preference");
    renderPage();
    for (const id of ["characters", "episodes"]) {
      const outgoing = shownPanel(id);
      const ownStyles = Array.from(outgoing.style);
      fireEvent.click(within(sectionById(id)).getAllByRole("tab")[2]!);
      const incoming = shownPanel(id);
      expect(incoming, `${id}: the chosen panel is the one exposed`).not.toBe(outgoing);
      await motionReacted();

      // The panel left behind is out of reach at once, but still painted while it fades out.
      expect(outgoing.hasAttribute("inert"), `${id}: left behind`).toBe(true);
      const fadeOut = gsap.getTweensOf(outgoing);
      expect(fadeOut.length, `${id}: the panel left behind is tweened out`).toBeGreaterThan(0);
      expect(outgoing.style.visibility, `${id}: held on screen while it fades`).not.toBe("hidden");
      const added = Array.from(outgoing.style).filter((property) => !ownStyles.includes(property));
      expect(added.filter((property) => !["opacity", "visibility"].includes(property)), `${id}: fades, never moves or resizes`).toEqual([]);
      for (const tween of fadeOut) tween.progress(0.5);
      const midway = Number(gsap.getProperty(outgoing, "opacity"));
      expect(midway, `${id}: half way through it is fading`).toBeGreaterThan(0);
      expect(midway).toBeLessThan(1);

      // The chosen panel's parts fade and rise in; its paper stage stays solid beneath the one leaving.
      expect(gsap.getTweensOf(incoming.children).length, `${id}: the chosen panel comes in`).toBeGreaterThan(0);
      expect(incoming.style.opacity, "the paper stage itself stays solid").toBe("");
      for (const tween of [...fadeOut, ...gsap.getTweensOf(incoming.children)]) expect(tween.totalDuration()).toBeLessThan(0.6);
    }
    await vi.waitFor(() => expect(inlineMotionStyles()).toEqual([]), { timeout: 3000 });
    const panels = ["characters", "episodes"].flatMap((id) => Array.from(sectionById(id).querySelectorAll("[role='tabpanel'], [role='tabpanel'] *")));
    expect(gsap.getTweensOf(panels), "every stage transition has finished").toHaveLength(0);
  });

  it("kills every ScrollTrigger and tween and restores every style on unmount", async () => {
    emulateMotionPreference("no-preference");
    const { unmount } = renderPage();
    scrollJustInto(sectionById("pillars"));
    fireEvent.pointerDown(heroCta(), { button: 0 });
    fireEvent.click(within(sectionById("characters")).getAllByRole("tab")[1]!);
    await motionReacted();
    expect(gsap.getTweensOf(pillarItems()).length).toBeGreaterThan(0);
    expect(gsap.getTweensOf(shownPanel("characters").children).length).toBeGreaterThan(0);
    const touched = pageElements().filter((element) => element.getAttribute("style") || element.matches("[data-bay-layer]"));
    expect(ScrollTrigger.getAll().length).toBeGreaterThan(0);

    unmount();

    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(gsap.getTweensOf(touched)).toHaveLength(0);
    for (const element of touched) {
      expect(element.getAttribute("style") ?? "", element.outerHTML.slice(0, 70)).not.toMatch(/opacity|visibility|transform|translate|--btn-press|stroke-dash/);
      if (element.matches("[data-bay-layer]")) expect(element.hasAttribute("transform")).toBe(false);
    }
    expect(document.documentElement.hasAttribute("data-motion"), "the page-level motion flag goes with the page").toBe(false);
  });
});

describe("useSectionReveal(scope, options)", () => {
  function Section() {
    const scope = useRef<HTMLElement>(null);
    useSectionReveal(scope, {});
    return (
      <section ref={scope} data-section="values">
        <div>
          <h2>Values</h2>
          <ul>
            <li>Bright minds</li>
            <li>Kind hearts</li>
          </ul>
        </div>
      </section>
    );
  }

  const SECTION_TOP = 2000;
  const scrollSectionIn = () => scrollPageTo(SECTION_TOP - window.innerHeight * JUST_SCROLLED_IN);

  beforeEach(() => layOut(() => SECTION_TOP));

  it("does nothing outside a GsapProvider, so a section rendered alone never moves", () => {
    emulateMotionPreference("no-preference");
    render(<Section />);
    scrollSectionIn();
    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(tweensOnPage()).toHaveLength(0);
  });

  it("reveals the heading and each list item, then disposes its triggers on unmount", async () => {
    emulateMotionPreference("no-preference");
    const { unmount } = render(
      <GsapProvider>
        <Section />
      </GsapProvider>,
    );
    expect(ScrollTrigger.getAll().length).toBeGreaterThan(0);
    scrollSectionIn();
    const targets = [screen.getByRole("heading"), ...screen.getAllByRole("listitem")];
    await motionReacted();
    for (const target of targets) expect(gsap.getTweensOf(target).length, target.textContent ?? "").toBeGreaterThan(0);
    expect(gsap.getTweensOf(screen.getByRole("list")), "a list reveals item by item, not as a block").toHaveLength(0);

    unmount();
    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(gsap.getTweensOf(targets)).toHaveLength(0);
    for (const element of targets) expect(element.getAttribute("style") ?? "").toBe("");
  });

  it("creates nothing under reduced motion", () => {
    emulateMotionPreference("reduce");
    render(
      <GsapProvider>
        <Section />
      </GsapProvider>,
    );
    scrollSectionIn();
    expect(ScrollTrigger.getAll()).toHaveLength(0);
    expect(tweensOnPage()).toHaveLength(0);
  });
});
