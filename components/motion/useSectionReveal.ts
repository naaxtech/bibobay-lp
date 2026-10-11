import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, type RefObject } from "react";

import { registerMotionPlugins, useMotionEnabled } from "./GsapProvider";

export type BayMotion = "drift" | "settle";

export interface SectionRevealOptions {
  /**
   * How the section's cut-paper bay layers (`[data-bay-layer]`) follow the scroll. "drift": far
   * layers lag behind as the section scrolls away (the opening horizon). "settle": they rise into
   * their drawn places as the section scrolls fully in (the closing horizon). Omitted: they stay still.
   */
  bay?: BayMotion;
}

/** The readable blocks a section reveals: each block whole, a list item by item. */
const REVEAL_BLOCKS = [
  "h1",
  "h2",
  "h3",
  "p",
  "li",
  "figure",
  "blockquote",
  "details",
  "dl",
  "form",
  ".btn",
  "[role='tablist']",
  "[role='tabpanel']",
].join(", ");

/**
 * Height on screen, as a share of the viewport from its top, at which an entering block starts its
 * reveal: the bottom edge, so a block is only ever faded out in the frame it first comes on screen,
 * never after the reader has seen it.
 */
const REVEAL_LINE = 1;
/**
 * A block that is already this high on screen when it enters did not scroll in: the reader jumped
 * (an anchor link, a restored scroll position). It is already being read, so it is left alone.
 */
const ARRIVED_BY_JUMP = 0.5;
const REVEAL = { y: 24, duration: 0.6, stagger: 0.08 } as const;
/** Pixels a layer at depth 0 would travel across the whole scroll range; the shore (depth 1) holds still. */
const BAY_TRAVEL = 48;
/** The loop is drawn at an even pace, so each step appears as the line reaches it. */
const LOOP_SECONDS = 1.6;
const LOOP_MARK_SECONDS = 0.35;
const STAGE = { y: 14, duration: 0.32, stagger: 0.07 } as const;
const MOTION_PROPS = "opacity,transform";

type ContextSafe = <T extends (...args: never[]) => unknown>(func: T) => T;

const viewportHeight = () => window.innerHeight || document.documentElement.clientHeight;
/** Where the element's top is on screen, as a share of the viewport height. */
const topOnScreen = (element: Element) => element.getBoundingClientRect().top / viewportHeight();
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Outermost readable blocks in the section, skipping decoration and panels that are not shown. */
function revealBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(REVEAL_BLOCKS)).filter((element) => {
    if (element.closest("[aria-hidden='true'], [hidden]")) return false;
    const outer = element.parentElement?.closest(REVEAL_BLOCKS);
    return !outer || !root.contains(outer);
  });
}

/**
 * Short opacity and rise reveals for blocks that scroll in from below the fold, staggered when
 * several arrive together. Blocks already on screen are never touched, so nothing that was readable
 * is hidden; until a block's reveal begins it renders as normal.
 */
function revealOnScroll(root: HTMLElement, contextSafe: ContextSafe, isActive: () => boolean) {
  let entering: HTMLElement[] = [];
  const flush = contextSafe(() => {
    const blocks = entering.filter((block) => topOnScreen(block) >= ARRIVED_BY_JUMP);
    entering = [];
    if (!isActive() || blocks.length === 0) return;
    gsap.from(blocks, { opacity: 0, y: REVEAL.y, duration: REVEAL.duration, stagger: REVEAL.stagger, ease: "power2.out", clearProps: MOTION_PROPS });
  });
  for (const block of revealBlocks(root)) {
    if (topOnScreen(block) < REVEAL_LINE) continue;
    ScrollTrigger.create({
      trigger: block,
      start: `top ${percent(REVEAL_LINE)}`,
      once: true,
      onEnter: () => {
        // Gather every block that enters in this scroll step and reveal them together before paint.
        if (entering.length === 0) queueMicrotask(flush);
        entering.push(block);
      },
    });
  }
}

/** Calm, scrubbed parallax for the cut-paper bay: each layer moves by how far back it sits. */
function moveBay(root: HTMLElement, bay: BayMotion) {
  const layers = Array.from(root.querySelectorAll<SVGGElement>("[data-bay-layer]"));
  const canvas = layers[0]?.closest("svg");
  if (!canvas) return;
  const travel = (layer: Element) => Math.round((1 - Number(layer.getAttribute("data-depth") ?? 1)) * BAY_TRAVEL * 10) / 10;
  const moving = layers.filter((layer) => travel(layer) > 0);
  const timeline = gsap.timeline({
    scrollTrigger:
      bay === "drift"
        ? { trigger: canvas, start: "clamp(top bottom)", end: "bottom top", scrub: true }
        : { trigger: canvas, start: "top bottom", end: "bottom bottom", scrub: true },
  });
  for (const layer of moving) {
    if (bay === "drift") timeline.to(layer, { y: travel(layer), ease: "none" }, 0);
    else timeline.fromTo(layer, { y: travel(layer) }, { y: 0, ease: "none" }, 0);
  }
  return () => {
    // The server markup has no transform on these groups; GSAP leaves an identity matrix behind on SVG.
    for (const layer of moving) {
      layer.removeAttribute("transform");
      layer.removeAttribute("data-svg-origin");
    }
  };
}

/**
 * The screen-to-life loop draws itself clockwise once it scrolls in, and each step (`[data-loop-at]`,
 * its share of the way round) appears as the line reaches it. The finished loop is left as drawn.
 */
function drawLoop(root: HTMLElement, contextSafe: ContextSafe, isActive: () => boolean) {
  const path = root.querySelector<SVGPathElement>("[data-loop-path]");
  const canvas = path?.closest("svg");
  if (!path || !canvas || topOnScreen(canvas) < REVEAL_LINE) return;
  const at = (mark: Element) => Number(mark.getAttribute("data-loop-at")) || 0;
  const marks = Array.from(root.querySelectorAll<HTMLElement | SVGElement>("[data-loop-at]")).sort((a, b) => at(a) - at(b));
  ScrollTrigger.create({
    trigger: canvas,
    start: `top ${percent(REVEAL_LINE)}`,
    once: true,
    onEnter: contextSafe(() => {
      if (!isActive() || topOnScreen(canvas) < ARRIVED_BY_JUMP) return;
      const timeline = gsap.timeline();
      // The path has pathLength="1", so a dash of 1 offset by 1 hides it and an offset of 0 draws it
      // whole. GSAP rounds px values to whole pixels unless told not to, which would snap 1 to 0.
      timeline.fromTo(
        path,
        { strokeDasharray: 1, strokeDashoffset: 1 },
        { strokeDasharray: 1, strokeDashoffset: 0, duration: LOOP_SECONDS, ease: "none", autoRound: false, clearProps: "strokeDasharray,strokeDashoffset" },
        0,
      );
      for (const mark of marks) {
        const position = LOOP_SECONDS * at(mark);
        timeline.from(mark, { opacity: 0, duration: LOOP_MARK_SECONDS, ease: "power1.out", clearProps: "opacity" }, position);
        // Step nodes also pop as the line reaches them. Arrowheads are placed by their SVG transform,
        // which must stay untouched, so they only fade in.
        if (mark instanceof HTMLElement) {
          timeline.from(mark, { scale: 0.6, duration: LOOP_MARK_SECONDS, ease: "back.out(2)", clearProps: "transform" }, position);
        }
      }
    }),
  });
}

/**
 * Tab stages (the friend stage, the storybook) bring the chosen panel's parts in with a short fade
 * and rise. The stage itself stays put, so the layout never jumps; the outgoing panel just closes.
 */
function transitionStages(root: HTMLElement, contextSafe: ContextSafe, isActive: () => boolean) {
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[role='tabpanel']"));
  if (panels.length < 2) return;
  const finish = (parts: Element[]) => {
    for (const tween of gsap.getTweensOf(parts)) tween.progress(1);
  };
  const onToggle = contextSafe((records: MutationRecord[]) => {
    if (!isActive()) return;
    for (const { target } of records) {
      if (!(target instanceof HTMLElement)) continue;
      const parts = Array.from(target.children);
      finish(parts);
      if (target.hidden || parts.length === 0) continue;
      gsap.from(parts, { opacity: 0, y: STAGE.y, duration: STAGE.duration, stagger: STAGE.stagger, ease: "power2.out", clearProps: MOTION_PROPS });
    }
  });
  const observer = new MutationObserver(onToggle);
  for (const panel of panels) observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  return () => observer.disconnect();
}

/**
 * Narrative motion for one landing section: scroll reveals, plus its bay parallax, loop drawing and
 * tab-stage transitions where the section has them. It runs only below a `GsapProvider` that allows
 * motion (so never on the server, before hydration or under reduced motion), never hides content
 * that is already on screen, and reverts every tween, timeline and ScrollTrigger when the section
 * unmounts or motion is switched off, leaving the markup exactly as the server rendered it.
 */
export function useSectionReveal(scope: RefObject<HTMLElement | null>, options: SectionRevealOptions = {}) {
  const enabled = useMotionEnabled();
  const { bay } = options;

  useEffect(() => {
    const root = scope.current;
    if (!enabled || !root) return;
    registerMotionPlugins();
    let active = true;
    const isActive = () => active;
    const context = gsap.context((_self: gsap.Context, contextSafe?: gsap.ContextSafeFunc) => {
      const safe = contextSafe as unknown as ContextSafe;
      revealOnScroll(root, safe, isActive);
      drawLoop(root, safe, isActive);
      const stopStages = transitionStages(root, safe, isActive);
      const resetBay = bay ? moveBay(root, bay) : undefined;
      return () => {
        active = false;
        stopStages?.();
        resetBay?.();
      };
    }, root);
    return () => context.revert();
  }, [enabled, bay, scope]);
}
