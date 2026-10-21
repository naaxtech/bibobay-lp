/*
 * The bot check's browser-safe contract (R214-R223, docs/superpowers/plans/2026-10-22-bot-check.md):
 * the request field, the per-form action, Cloudflare's origin and the visitor copy. No zod, no
 * environment and no secret: the forms, the schemas and the server all import from here.
 */

/** The JSON key that carries the single-use token in every form's request body. */
export const BOT_CHECK_TOKEN_FIELD = "botCheckToken";

// src: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ · turnstile api v0 (hosted) · 2026-10-22
/** Turnstile tokens are at most 2048 characters. */
export const BOT_CHECK_TOKEN_MAX_LENGTH = 2048;

// src: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/ · turnstile api.js v0 (hosted) · 2026-10-22
/** The widget `action` per form (at most 32 characters of [A-Za-z0-9_-]); the server checks it with real keys. */
export type BotCheckAction = "lead" | "contact" | "order";

/** Where Cloudflare serves the Turnstile script, its frame and siteverify. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** What a visitor is told at each stop; plain words, no blame (R219). */
export const BOT_CHECK_MESSAGES = {
  refused: "We couldn't confirm this came from a person. Please try again.",
  unavailable: "Our spam check isn't answering just now. Please try again in a few minutes.",
  interactive: "Please complete the quick check just above the button, then press it again.",
  notLoaded: "The spam check didn't load. Please check your connection and try again.",
} as const;
