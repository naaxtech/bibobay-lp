import "server-only";

import type { BotCheckConfig } from "@/lib/bot-check/config";
import { TURNSTILE_ORIGIN, type BotCheckAction } from "@/lib/bot-check/fields";

/*
 * The Turnstile server-side verifier (R218, R219). The secret and the token travel only to
 * Cloudflare's siteverify endpoint; nothing here logs, stores or returns either of them.
 */

// src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
export const SITEVERIFY_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

export type BotCheckVerdict =
  | { outcome: "passed" }
  | { outcome: "refused"; reason: "missing_token" | "rejected" | "hostname" | "action" }
  | {
      outcome: "unavailable";
      reason:
        | "timeout"
        | "network"
        | "http"
        | "malformed_reply"
        | "secret_rejected"
        | "bad_request"
        | "internal_error";
    };

export interface BotCheckVerifier {
  verify(token: string | undefined, action: BotCheckAction): Promise<BotCheckVerdict>;
}

export interface TurnstileVerifierOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  idempotencyKey?: () => string;
}

type Unavailable = Extract<BotCheckVerdict, { outcome: "unavailable" }>;

// src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_DELAY_MS = 500;

interface Attempt {
  verdict: BotCheckVerdict;
  retryable: boolean;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unavailable(reason: Unavailable["reason"], retryable: boolean): Attempt {
  return { verdict: { outcome: "unavailable", reason }, retryable };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function createTurnstileVerifier(
  config: Extract<BotCheckConfig, { state: "on" }>,
  options: TurnstileVerifierOptions = {},
): BotCheckVerifier {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const newKey = options.idempotencyKey ?? (() => crypto.randomUUID());

  async function post(body: string): Promise<Response | "timeout" | "network"> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, timeoutMs);
    });
    const request = doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    }).catch((): "network" | "timeout" => (controller.signal.aborted ? "timeout" : "network"));
    try {
      return await Promise.race([request, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  function judge(reply: Record<string, unknown>, action: BotCheckAction): Attempt {
    if (reply.success === true) {
      // src: https://developers.cloudflare.com/turnstile/troubleshooting/testing/ · turnstile api v0 (hosted) · 2026-10-22
      if (config.testKeys) return { verdict: { outcome: "passed" }, retryable: false };
      // src: https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/ · turnstile api v0 (hosted) · 2026-10-22
      if (config.expectedHostname !== null) {
        const hostname = typeof reply.hostname === "string" ? reply.hostname.toLowerCase() : "";
        if (hostname !== config.expectedHostname.toLowerCase()) {
          return { verdict: { outcome: "refused", reason: "hostname" }, retryable: false };
        }
      }
      // src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
      if (reply.action !== action) return { verdict: { outcome: "refused", reason: "action" }, retryable: false };
      return { verdict: { outcome: "passed" }, retryable: false };
    }

    // src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
    const codes = Array.isArray(reply["error-codes"]) ? reply["error-codes"] : [];
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret")) {
      return unavailable("secret_rejected", false);
    }
    if (codes.includes("bad-request")) return unavailable("bad_request", false);
    if (codes.includes("internal-error")) return unavailable("internal_error", true);
    return { verdict: { outcome: "refused", reason: "rejected" }, retryable: false };
  }

  async function attempt(body: string, action: BotCheckAction): Promise<Attempt> {
    const response = await post(body);
    if (response === "timeout") return unavailable("timeout", true);
    if (response === "network") return unavailable("network", true);
    if (!response.ok) return unavailable("http", response.status >= 500);

    let reply: Record<string, unknown> | null;
    try {
      reply = asRecord(await response.json());
    } catch {
      reply = null;
    }
    if (reply === null || typeof reply.success !== "boolean") return unavailable("malformed_reply", false);
    return judge(reply, action);
  }

  return {
    async verify(token, action) {
      if (!token) return { outcome: "refused", reason: "missing_token" };

      // src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
      // No `remoteip`: nothing about the visitor leaves our server (R218). The idempotency key is
      // reused on the retry so Cloudflare treats both calls as one validation.
      const body = JSON.stringify({ secret: config.secretKey, response: token, idempotency_key: newKey() });

      const first = await attempt(body, action);
      if (!first.retryable) return first.verdict;
      await wait(retryDelayMs);
      return (await attempt(body, action)).verdict;
    },
  };
}
