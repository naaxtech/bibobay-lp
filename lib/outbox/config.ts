import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { isTrackingEnabled } from "@/lib/commerce/gate";
import type { SiteSettings } from "@/lib/content/types";
import { SERVER_SECRET_MIN_LENGTH } from "@/lib/security/secrets";
import { seoEnvironment } from "@/lib/seo/metadata";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The cron worker's secret (`CRON_SECRET`, server only). Vercel sends it as
 * `Authorization: Bearer <secret>` on every scheduled call. Shorter than the shared server-secret
 * minimum (32 characters, Task 5 re-review N4) counts as unconfigured: the route answers 503.
 */
export function cronSecretFrom(env: Env = process.env): string | null {
  const secret = env.CRON_SECRET?.trim() ?? "";
  return secret.length >= SERVER_SECRET_MIN_LENGTH ? secret : null;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * True only for exactly `Bearer <secret>`. Both sides are hashed to equal-length digests first, so
 * the comparison takes the same time whatever the header holds (constant-time compare).
 */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

/**
 * Ruling R89: what the order acknowledgement says about tracking. Null while tracking is off;
 * otherwise the /track page on the site's verified origin, or `url: null` (the copy then names the
 * page) while no origin is verified. Never the private tracking link.
 */
export function orderTrackingForEmail(settings: SiteSettings, env: Env = process.env): { url: string | null } | null {
  if (!isTrackingEnabled(settings)) return null;
  const origin = seoEnvironment(settings, env).baseUrl;
  return { url: origin ? new URL("/track", origin).toString() : null };
}
