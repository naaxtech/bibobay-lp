import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Vercel Deployment Protection bypass for the browser specs (residual fixer, item 4).
 *
 * Sending `x-vercel-protection-bypass` as an extra HTTP header put the secret on every request the
 * browser made, third-party hosts included. Vercel's documented alternative is a cookie: one request
 * to the deployment with the secret and `x-vercel-set-bypass-cookie=true` answers a Set-Cookie scoped
 * to the deployment's host, and the browser then sends only that cookie, only to that host. The
 * storage state holding it lives in the OS temp folder, never in the repository.
 * src: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation · 2026-10-16
 */
export const BYPASS_QUERY = "x-vercel-protection-bypass";
const SET_COOKIE_QUERY = "x-vercel-set-bypass-cookie";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

/** The deployment's root with the secret and the ask for a bypass cookie. Never log the result. */
export function bypassCookieUrl(baseURL: string, secret: string): string {
  const url = new URL("/", baseURL);
  url.searchParams.set(BYPASS_QUERY, secret);
  url.searchParams.set(SET_COOKIE_QUERY, "true");
  return url.toString();
}

/** The cookies scoped to the deployment's own host; anything set for another host is dropped. */
export function selectBypassCookies<T extends StoredCookie>(cookies: readonly T[], baseURL: string): T[] {
  const host = new URL(baseURL).hostname;
  return cookies.filter((cookie) => cookie.domain.replace(/^\./, "") === host);
}

/** Where the storage state is written: the OS temp folder, one fixed name so config and workers agree. */
export function bypassStorageStatePath(): string {
  return join(tmpdir(), "bibobay-playwright-vercel-bypass-state.json");
}
