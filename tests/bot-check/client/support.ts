import type { TurnstileApi } from "@/components/forms/bot-check/load-turnstile";

export type WidgetOptions = Record<string, unknown>;

export interface FakeTurnstile extends TurnstileApi {
  renders: { el: HTMLElement; options: WidgetOptions; id: string }[];
  resets: string[];
  removes: string[];
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __bibobayTurnstileOnload?: () => void;
  }
}

export function installFakeTurnstile(): FakeTurnstile {
  const fake: FakeTurnstile = {
    renders: [],
    resets: [],
    removes: [],
    render(el, options) {
      const id = `w${fake.renders.length + 1}`;
      fake.renders.push({ el, options, id });
      return id;
    },
    reset(id) {
      fake.resets.push(id);
    },
    remove(id) {
      fake.removes.push(id);
    },
  };
  window.turnstile = fake;
  return fake;
}

export function turnstileScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>("script")).filter((s) => s.src.includes("challenges.cloudflare.com"));
}

export function fire(options: WidgetOptions, name: string, ...args: unknown[]): unknown {
  const callback = options[name];
  if (typeof callback !== "function") throw new Error(`no ${name} callback`);
  return callback(...args);
}
