import { pageScriptNonce } from "@/components/preview/style-nonce";
import { TURNSTILE_ORIGIN } from "@/lib/bot-check/fields";

export interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;

const ONLOAD_NAME = "__bibobayTurnstileOnload";

// src: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ · turnstile api v0 (hosted) · 2026-10-22
const SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=${ONLOAD_NAME}`;

interface TurnstileWindow extends Window {
  turnstile?: TurnstileApi;
  [ONLOAD_NAME]?: () => void;
}

let pending: Promise<TurnstileApi> | null = null;
let abandon: (() => void) | null = null;

/**
 * Loads Cloudflare's script once (R217). A failed or timed-out load clears the singleton, so the next
 * intent injects a fresh script.
 */
export function loadTurnstile(timeoutMs: number = TURNSTILE_LOAD_TIMEOUT_MS): Promise<TurnstileApi> {
  if (pending) return pending;
  const win: TurnstileWindow = window;
  const script = document.createElement("script");
  const attempt = new Promise<TurnstileApi>((resolve, reject) => {
    const timer = setTimeout(() => fail("turnstile load timed out"), timeoutMs);
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      delete win[ONLOAD_NAME];
      abandon = null;
      finish();
    };
    const fail = (reason: string) =>
      settle(() => {
        script.remove();
        if (pending === attempt) pending = null;
        reject(new Error(reason));
      });
    abandon = () => settle(() => script.remove());
    win[ONLOAD_NAME] = () => {
      const api = win.turnstile;
      if (api) settle(() => resolve(api));
      else fail("turnstile api missing after load");
    };
    script.addEventListener("error", () => fail("turnstile script failed to load"));
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    // src: https://developers.cloudflare.com/turnstile/reference/content-security-policy/ · turnstile api v0 (hosted) · 2026-10-22
    const nonce = pageScriptNonce(document);
    if (nonce) {
      script.nonce = nonce;
      // jsdom and older engines have no `nonce` property: the attribute carries it there.
      if (script.nonce !== nonce) script.setAttribute("nonce", nonce);
    }
    document.head.append(script);
  });
  pending = attempt;
  return attempt;
}

/** Test-only: forgets the singleton, its callback and its script, so each test starts clean. */
export function resetTurnstileLoaderForTests(): void {
  abandon?.();
  pending = null;
  abandon = null;
  document.querySelectorAll(`script[src^="${TURNSTILE_ORIGIN}"]`).forEach((element) => element.remove());
}
