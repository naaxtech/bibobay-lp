import { DOWNLOAD_ROUTE } from "@/lib/content/freebie-path";

/** A download the form may show: the server's answer, checked. */
export interface AcceptedDownload {
  url: string;
  title: string;
  /** True for the site's own signed path, which gets the `download` attribute. */
  sameOrigin: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The `download` member of a 200 answer, or null. The caller has already confirmed a persisted signup. Needs a
 * non-empty title and either the site's own signed path (`/api/freebies/download?...`) or an
 * https URL without credentials. Anything else (javascript:, protocol-relative, other paths,
 * http) is refused, so a bad answer can never become a link.
 */
export function acceptDownload(value: unknown): AcceptedDownload | null {
  if (!isRecord(value)) return null;
  const { url, title } = value;
  if (typeof url !== "string" || typeof title !== "string" || title.trim() === "") return null;
  if (url.startsWith(`${DOWNLOAD_ROUTE}?`)) return { url, title, sameOrigin: true };
  try {
    // src: https://developer.mozilla.org/en-US/docs/Web/API/URL/URL · WHATWG URL, Node 24 / evergreen browsers · 2026-10-16
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "") return { url, title, sameOrigin: false };
  } catch {
    return null;
  }
  return null;
}
