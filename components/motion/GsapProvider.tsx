"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { useReducedMotion } from "./useReducedMotion";

/** Whether motion may run below this provider. Outside one, or under reduced motion, nothing moves. */
const MotionContext = createContext(false);

export const useMotionEnabled = () => useContext(MotionContext);

/**
 * Registers ScrollTrigger. Only ever called from effects, so it only runs in the browser; it is
 * idempotent, and section effects call it too because child effects run before this provider's.
 */
export function registerMotionPlugins() {
  gsap.registerPlugin(ScrollTrigger);
}

/** Anything styled as a button gets the tactile press. */
const PRESSABLE = ".btn";
/** Pressed scale. The press eases in and the release springs back, each well under 180 ms. */
const PRESSED_SCALE = 0.96;
const PRESS_SECONDS = 0.1;
const RELEASE_SECONDS = 0.16;

const currentPress = (target: HTMLElement) => Number.parseFloat(target.style.getPropertyValue("--btn-press")) || 1;

/**
 * Tactile CTA feedback. GSAP eases the `--btn-press` custom property and landing.css scales `.btn`
 * by it while `html[data-motion="full"]`; the CSS `:active` nudge is switched off then, and stays
 * the press without the motion layer, so a press is only ever animated once. Every tween is created
 * in one context, reverted when motion stops.
 */
function startPressFeedback() {
  const context = gsap.context(() => undefined);
  let pressed: HTMLElement | null = null;

  const release = () => {
    const target = pressed;
    if (!target) return;
    pressed = null;
    context.add(() =>
      gsap.fromTo(
        target,
        { "--btn-press": currentPress(target) },
        { "--btn-press": 1, duration: RELEASE_SECONDS, ease: "back.out(2)", overwrite: true, clearProps: "--btn-press" },
      ),
    );
  };

  const press = (event: PointerEvent) => {
    // Primary button only (a synthetic event may carry none); other buttons open menus, not links.
    if (event.button > 0 || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>(PRESSABLE);
    if (!target) return;
    release();
    pressed = target;
    context.add(() =>
      gsap.fromTo(
        target,
        { "--btn-press": currentPress(target) },
        { "--btn-press": PRESSED_SCALE, duration: PRESS_SECONDS, ease: "power2.out", overwrite: true },
      ),
    );
  };

  document.addEventListener("pointerdown", press);
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  return () => {
    document.removeEventListener("pointerdown", press);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    context.revert();
  };
}

/**
 * The page's motion layer. Motion starts only in the browser, after hydration, and only while the
 * reader has not asked for reduced motion; until then (and without JavaScript) the page is still and
 * complete. Once the layer has decided, `html[data-motion]` says which it chose: "full" or "reduced".
 * Sections attach their own motion through `useSectionReveal`, which reads this provider.
 */
export function GsapProvider({ children }: { children: ReactNode }) {
  const enabled = !useReducedMotion();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motion = enabled ? "full" : "reduced";
    let stopPressFeedback: (() => void) | undefined;
    if (enabled) {
      registerMotionPlugins();
      stopPressFeedback = startPressFeedback();
    }
    return () => {
      stopPressFeedback?.();
      delete root.dataset.motion;
    };
  }, [enabled]);

  return <MotionContext value={enabled}>{children}</MotionContext>;
}
