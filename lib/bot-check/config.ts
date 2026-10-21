// Relative import on purpose: scripts/verify-env.ts runs this module under plain tsx, which has no "@/" path alias.
import { TURNSTILE_ORIGIN } from "./fields";

/*
 * The bot check's configuration state (R215). It is computed from an `env` argument, never from
 * `process.env`, so the CSP, env verification, readiness and the form pipelines all agree and every
 * state is tested without touching the process. Plain module: the secret is only returned inside
 * the "on" state, and only server code ever holds that object.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type BotCheckProblem = "half" | "malformed" | "mixed_keys" | "test_keys_in_production";

export type BotCheckConfig =
  | { state: "off" }
  | { state: "misconfigured"; problem: BotCheckProblem }
  | { state: "on"; siteKey: string; secretKey: string; testKeys: boolean; expectedHostname: string | null };

// src: https://developers.cloudflare.com/turnstile/troubleshooting/testing/ · turnstile api v0 (hosted) · 2026-10-22
export const TURNSTILE_TEST_SITE_KEYS: ReadonlySet<string> = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "1x00000000000000000000BB",
  "2x00000000000000000000BB",
  "3x00000000000000000000FF",
]);

// src: https://developers.cloudflare.com/turnstile/troubleshooting/testing/ · turnstile api v0 (hosted) · 2026-10-22
export const TURNSTILE_TEST_SECRET_KEYS: ReadonlySet<string> = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

const KEY_SHAPE = /^[A-Za-z0-9_-]{16,256}$/;

// src: https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/ · turnstile api v0 (hosted) · 2026-10-22
function expectedHostname(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname ? url.hostname : null;
  } catch {
    return null;
  }
}

export function botCheckConfig(env: Env): BotCheckConfig {
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";

  if (!siteKey && !secretKey) return { state: "off" };
  if (!siteKey || !secretKey) return { state: "misconfigured", problem: "half" };
  if (!KEY_SHAPE.test(siteKey) || !KEY_SHAPE.test(secretKey)) return { state: "misconfigured", problem: "malformed" };

  const siteIsTest = TURNSTILE_TEST_SITE_KEYS.has(siteKey);
  const secretIsTest = TURNSTILE_TEST_SECRET_KEYS.has(secretKey);
  if (siteIsTest !== secretIsTest) return { state: "misconfigured", problem: "mixed_keys" };

  // The always-pass test secret accepts any token, so it must never guard production (R215).
  if (siteIsTest && env.VERCEL_ENV === "production") {
    return { state: "misconfigured", problem: "test_keys_in_production" };
  }

  return {
    state: "on",
    siteKey,
    secretKey,
    testKeys: siteIsTest,
    expectedHostname: expectedHostname(env.NEXT_PUBLIC_APP_URL),
  };
}

/** The public site key, only when the check is on. */
export function botCheckSiteKey(env: Env): string | null {
  const config = botCheckConfig(env);
  return config.state === "on" ? config.siteKey : null;
}

/** The CSP `frame-src` entries the widget needs, only when the check is on (R220). */
export function botCheckFrameSources(env: Env): readonly string[] {
  return botCheckConfig(env).state === "on" ? [TURNSTILE_ORIGIN] : [];
}
