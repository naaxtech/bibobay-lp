import { draftMode } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { PreviewUrlValidateUrlResult, SanityClientLike } from "@sanity/preview-url-secret";

/*
 * Draft mode for Sanity Presentation (Task 9 ruling R33).
 *
 * src: node_modules/next/dist/docs/01-app/02-guides/draft-mode.md · next 16.3.8 · 2026-10-13
 * The Studio's Presentation tool opens /api/draft-mode/enable with a short-lived secret it stored in
 * the dataset; @sanity/preview-url-secret checks that secret with the server-only read token. Only
 * then is Next's draft-mode cookie set and the browser sent on, to a same-origin path only.
 */

export const DRAFT_ENABLE_PATH = "/api/draft-mode/enable";
export const DRAFT_DISABLE_PATH = "/api/draft-mode/disable";

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
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export interface DraftModeEnableDependencies {
  /** The Sanity client with the read token, or null when preview is not configured. */
  client: SanityClientLike | null;
  validate: (client: SanityClientLike, previewUrl: string) => Promise<PreviewUrlValidateUrlResult>;
  enable: () => void;
}

const noStore = { "cache-control": "no-store" };

export async function handleDraftModeEnable(request: Request, { client, validate, enable }: DraftModeEnableDependencies): Promise<Response> {
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
