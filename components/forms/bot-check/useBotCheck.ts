"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { BotCheckAction } from "@/lib/bot-check/fields";

import { loadTurnstile, TURNSTILE_LOAD_TIMEOUT_MS, type TurnstileApi } from "./load-turnstile";

export type BotCheckTokenResult = { token: string } | { problem: "interactive" | "unavailable" };

export interface BotCheckHandle {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  /** True while Turnstile is showing its widget (a challenge or an error); layout only. */
  visible: boolean;
  /** Idempotent: loads Cloudflare's script and renders the widget on the first call. */
  prepare(): void;
  /** The current token, or waits up to 15 s for one. */
  token(): Promise<BotCheckTokenResult>;
  /** Call after every request that carried a token: it is single use (R218). */
  reset(): void;
}

/** Below this container width the widget is drawn compact; "normal" would overflow at 320 px (R217). */
const COMPACT_BELOW_PX = 300;

/*
 * The widget callbacks are carried in a ref-held record so a render never rebuilds them. The handle
 * returned is stable for a given site key and action.
 */
export function useBotCheck(siteKey: string | null, action: BotCheckAction): BotCheckHandle {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const state = useRef({
    mounted: false,
    started: false,
    failed: false,
    interactive: false,
    token: null as string | null,
    api: null as TurnstileApi | null,
    widgetId: null as string | null,
    waiters: new Set<(result: BotCheckTokenResult) => void>(),
  });

  const [visible, setVisible] = useState(false);

  const settle = useCallback((result: BotCheckTokenResult) => {
    const waiters = Array.from(state.current.waiters);
    state.current.waiters.clear();
    for (const waiter of waiters) waiter(result);
  }, []);

  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      if (current.api && current.widgetId !== null) current.api.remove(current.widgetId);
      current.api = null;
      current.widgetId = null;
      current.started = false;
      current.interactive = false;
      current.failed = false;
      current.token = null;
      setVisible(false);
      settle({ problem: "unavailable" });
    };
  }, [settle]);

  const prepare = useCallback(() => {
    const current = state.current;
    if (siteKey === null || current.started) return;
    current.started = true;
    current.failed = false;
    loadTurnstile().then(
      (api) => {
        const container = containerRef.current;
        if (!current.mounted || current.widgetId !== null) return;
        if (!container) {
          current.started = false;
          return;
        }
        // src: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/ · turnstile api v0 (hosted) · 2026-10-22
        current.api = api;
        current.widgetId = api.render(container, {
          sitekey: siteKey,
          action,
          appearance: "interaction-only",
          execution: "render",
          theme: "light",
          size: container.clientWidth < COMPACT_BELOW_PX ? "compact" : "flexible",
          language: "auto",
          "refresh-expired": "auto",
          "response-field": false,
          callback: (token: string) => {
            current.token = token;
            current.failed = false;
            settle({ token });
          },
          "expired-callback": () => {
            current.token = null;
          },
          "before-interactive-callback": () => {
            current.interactive = true;
            setVisible(true);
            if (current.token === null) settle({ problem: "interactive" });
          },
          "after-interactive-callback": () => {
            current.interactive = false;
          },
          // src: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/ · turnstile api.js v0 (hosted) · 2026-10-22
          // Returning true tells Turnstile the error is handled, so it prints nothing to the console.
          "error-callback": () => {
            current.failed = true;
            current.interactive = false;
            current.token = null;
            setVisible(true);
            settle({ problem: "unavailable" });
            return true;
          },
        });
      },
      () => {
        current.started = false;
        current.failed = true;
        settle({ problem: "unavailable" });
      },
    );
  }, [action, settle, siteKey]);

  const token = useCallback((): Promise<BotCheckTokenResult> => {
    const current = state.current;
    if (siteKey === null) return Promise.resolve({ problem: "unavailable" });
    if (current.token !== null) return Promise.resolve({ token: current.token });
    if (current.interactive) return Promise.resolve({ problem: "interactive" });
    if (current.failed) {
      // A failed widget is retried by the next submit: a keyboard user's Enter fires no focusin to prepare it again.
      current.failed = false;
      if (current.api && current.widgetId !== null) current.api.reset(current.widgetId);
    }
    prepare();
    return new Promise<BotCheckTokenResult>((resolve) => {
      const timer = setTimeout(() => {
        current.waiters.delete(waiter);
        resolve({ problem: "unavailable" });
      }, TURNSTILE_LOAD_TIMEOUT_MS);
      const waiter = (result: BotCheckTokenResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      current.waiters.add(waiter);
    });
  }, [prepare, siteKey]);

  const reset = useCallback(() => {
    const current = state.current;
    current.token = null;
    current.interactive = false;
    setVisible(false);
    if (current.api && current.widgetId !== null) current.api.reset(current.widgetId);
  }, []);

  return useMemo(
    () => ({ enabled: siteKey !== null, containerRef, visible, prepare, token, reset }),
    [prepare, reset, siteKey, token, visible],
  );
}
