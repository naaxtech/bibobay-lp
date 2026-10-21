import { cookies, draftMode } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { PreviewUrlValidateUrlResult, SanityClientLike } from "@sanity/preview-url-secret";

import { PARTITIONED_COOKIE, PERSPECTIVE_COOKIE, parsePreviewPerspective, perspectiveCookieValue, sanitizePreviewPerspective, type PreviewPerspective } from "./perspective";

/*
 * Draft mode for Sanity Presentation (Task 9 ruling R33).
 *
 * src: node_modules/next/dist/docs/01-app/02-guides/draft-mode.md · next 16.3.8 · 2026-10-13
 * The Studio's Presentation tool opens /api/draft-mode/enable with a short-lived secret it stored in
 * the dataset; @sanity/preview-url-secret checks that secret with the server-only read token. Only
 * then is Next's draft-mode cookie set and the browser sent on, to a same-origin path only.
 */

export { DRAFT_DISABLE_PATH, DRAFT_ENABLE_PATH } from "./draft-mode-paths";

const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

/**
 * A path on this site, or "/" for anything that could leave it (protocol-relative, backslash,
 * absolute URL, control characters). Prevents an open redirect even with a valid secret.
 */
export function safeRedirectPath(input: unknown): string {
  if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//")) return "/";
  // Backslashes are treated as slashes by browsers; control characters can split headers.
  if (/[\\\u0000-\u001f\u007f]/.test(input)) return "/";
  try {
    const url = new URL(input, PLACEHOLDER_ORIGIN);
    if (url.origin !== PLACEHOLDER_ORIGIN) return "/";
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Dot segments ("/.//x", "/a/..//x", "/%2e//x") normalise to a protocol-relative "//x", which a
    // browser follows to another host. Re-check the normalised result, not only the input.
    if (path.startsWith("//") || path.startsWith("/\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

/** The part of Next's mutable cookie store the draft-mode routes and the perspective switch use. */
export interface PreviewCookieJar {
  get(name: string): { name: string; value: string } | undefined;
  has(name: string): boolean;
  set(options: PreviewCookie): void;
  delete(options: Omit<PreviewCookie, "value">): void;
}
export interface PreviewCookie { name: string; value: string; httpOnly: true; path: "/"; secure: boolean; sameSite: "none" | "lax"; partitioned: boolean }

/** The draft-mode cookie Next sets (src: next/dist/server/api-utils/index.js COOKIE_NAME_PRERENDER_BYPASS · next 16.3.8). */
const DRAFT_COOKIE = "__prerender_bypass";

/**
 * Attributes for a preview cookie. A secure deployment needs `SameSite=None` for the Studio's
 * cross-site iframe; `partitioned` (CHIPS) keeps it in browsers that block third-party cookies
 * (ruling R163, as next-sanity's defineEnableDraftMode does). Local http stays `lax`.
 */
const cookieOptions = (name: string, value: string, secure: boolean, partitioned: boolean): PreviewCookie => ({
  name, value, httpOnly: true, path: "/", secure, sameSite: secure ? "none" : "lax", partitioned: secure && partitioned,
});
const removal = (cookie: PreviewCookie): Omit<PreviewCookie, "value"> => {
  const { name, httpOnly, path, secure, sameSite, partitioned } = cookie;
  return { name, httpOnly, path, secure, sameSite, partitioned };
};

export interface DraftModeEnableDependencies {
  /** The Sanity client with the read token, or null when preview is not configured. */
  client: SanityClientLike | null;
  validate: (client: SanityClientLike, previewUrl: string) => Promise<PreviewUrlValidateUrlResult>;
  enable: () => void;
  /** Next's cookies, to re-set the draft cookie for the Studio frame and store the perspective (R162, R163). */
  cookies?: PreviewCookieJar;
  /** A production server: secure, SameSite=None cookies. */
  secure?: boolean;
}

const noStore = { "cache-control": "no-store" };

export async function handleDraftModeEnable(request: Request, { client, validate, enable, cookies, secure = false }: DraftModeEnableDependencies): Promise<Response> {
  if (!client) return new Response("Preview is not configured.", { status: 503, headers: noStore });
  let result: PreviewUrlValidateUrlResult;
  try {
    result = await validate(client, request.url);
  } catch {
    // Sanity unreachable or the token refused: fail closed, never enable on an unchecked secret.
    return new Response("Preview could not be checked. Please try again.", { status: 503, headers: noStore });
  }
  if (!result.isValid) return new Response("Invalid preview secret.", { status: 401, headers: noStore });
  enable();
  if (cookies) {
    // Presentation loads this route in its cross-site iframe. Fetch metadata says so; a top-level
    // visit ("Open preview") keeps plain cookies, which /api/draft-mode/disable can clear.
    const partitioned = request.headers.get("sec-fetch-dest") === "iframe" && request.headers.get("sec-fetch-site") === "cross-site";
    const bypass = cookies.get(DRAFT_COOKIE);
    if (bypass) cookies.set(cookieOptions(DRAFT_COOKIE, bypass.value, secure, partitioned));
    cookies.set(cookieOptions(PERSPECTIVE_COOKIE, perspectiveCookieValue(sanitizePreviewPerspective(result.studioPreviewPerspective)), secure, partitioned));
    if (secure && partitioned) cookies.set(cookieOptions(PARTITIONED_COOKIE, "1", secure, true));
  }
  return new Response(null, { status: 307, headers: { ...noStore, location: safeRedirectPath(result.redirectTo) } });
}

/**
 * Whether this request is in draft mode. Outside a request (unit tests rendering a page directly)
 * the answer is false; Next's own control-flow errors are rethrown untouched.
 */
export async function isDraftMode(): Promise<boolean> {
  try {
    return (await draftMode()).isEnabled;
  } catch (error) {
    // src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md · next 16.3.8 · 2026-10-13
    unstable_rethrow(error);
    return false;
  }
}

export interface DraftModeDisableDependencies {
  disable: () => void;
  cookies: PreviewCookieJar;
  secure: boolean;
}

/**
 * Leaves draft mode and forgets the perspective. Inside the Studio frame the cookies are the
 * partitioned copies (R163), which only a partitioned removal reaches; Next's own disable covers
 * the plain draft cookie.
 */
export async function handleDraftModeDisable({ disable, cookies, secure }: DraftModeDisableDependencies): Promise<Response> {
  disable();
  const partitioned = cookies.has(PARTITIONED_COOKIE);
  if (partitioned) cookies.delete(removal(cookieOptions(DRAFT_COOKIE, "", secure, true)));
  if (cookies.has(PERSPECTIVE_COOKIE)) cookies.delete(removal(cookieOptions(PERSPECTIVE_COOKIE, "", secure, partitioned)));
  if (partitioned) cookies.delete(removal(cookieOptions(PARTITIONED_COOKIE, "", secure, true)));
  return new Response(null, { status: 307, headers: { ...noStore, location: "/" } });
}

export interface PerspectiveChangeDependencies {
  /** Whether this request is in draft mode: nobody else may set a preview perspective. */
  draftMode: boolean;
  cookies: PreviewCookieJar;
  secure: boolean;
  /** Next's `refresh()`, so the frame re-renders with the new perspective. */
  refresh: () => void;
}

/**
 * Presentation's perspective switch (R162), behind the server action in lib/sanity/preview-actions.ts.
 * A value that is not a perspective changes nothing: storing "drafts" for it would silently undo
 * the editor's choice.
 */
export async function applyPerspectiveChange(perspective: unknown, { draftMode: enabled, cookies, secure, refresh }: PerspectiveChangeDependencies): Promise<void> {
  if (!enabled) return;
  const parsed = parsePreviewPerspective(perspective);
  if (!parsed) return;
  const value = perspectiveCookieValue(parsed);
  if (cookies.get(PERSPECTIVE_COOKIE)?.value === value) return;
  cookies.set(cookieOptions(PERSPECTIVE_COOKIE, value, secure, cookies.has(PARTITIONED_COOKIE)));
  refresh();
}

/** The perspective this draft-mode request reads with; drafts outside a request or without a choice. */
export async function readPreviewPerspective(): Promise<PreviewPerspective> {
  try {
    return sanitizePreviewPerspective((await cookies()).get(PERSPECTIVE_COOKIE)?.value);
  } catch (error) {
    unstable_rethrow(error);
    return "drafts";
  }
}
