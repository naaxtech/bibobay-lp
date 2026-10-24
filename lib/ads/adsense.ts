/*
 * Google AdSense (owner request 2026-10-24, rulings R251-R255).
 *
 * The tag is the snippet AdSense gives for the <head> of every page ("Your AdSense code"):
 *   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-…"
 *           crossorigin="anonymous"></script>
 * components/ads/AdSenseTag.tsx renders it in the root layout's <head> with the request's CSP nonce
 * (the policy is nonce + 'strict-dynamic', lib/security/headers.ts), so adsbygoogle.js may load
 * Google's other scripts without a host list in script-src.
 *
 * R257 (overrides R251/R252's "every public page"): only the content pages in ADSENSE_PAGES load it,
 * today the home page. Google Publisher Policies forbid ads on screens without publisher content
 * (thank-you and error/404 pages, alerts) and the contact page is a form; legal and shop pages are
 * left out until there is a reason to add them. Adding a page here changes the privacy text's claim
 * (lib/content/legal-fallback.ts names the pages), so change both together.
 *
 * R251: only the Vercel production deployment loads it. Previews, a local `next start`, the dev
 * server and CI never ask Google for anything, so their tests keep the "no third-party request"
 * contract and no test run counts as ad traffic.
 * R252: never on private pages. An ad request carries the page address, and /orders/<token> has the
 * order's private tracking code in it; the staff and tracking pages show order details. proxy.ts
 * forwards the document path (PATHNAME_HEADER), and no path means no tag.
 *
 * The publisher ID is public by design (it is in every page that shows the ads), so it lives here,
 * not in the environment.
 *
 * This file is imported by lib/security/headers.ts, which next.config.ts imports: relative imports
 * only (Next's config transpiler does not resolve "@/").
 */

type Env = Readonly<Record<string, string | undefined>>;

export const ADSENSE_CLIENT = "ca-pub-6883401604924323";

export const ADSENSE_SCRIPT_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;

/**
 * R256: the line public/ads.txt carries, exactly as AdSense gives it: Google's domain, this publisher
 * (`pub-`, without the `ca-` prefix), DIRECT, and Google's certification authority ID.
 */
export const ADS_TXT_LINE = `google.com, ${ADSENSE_CLIENT.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0`;

/** R257: the exact paths (no trailing slash, no query) whose documents carry the tag. */
export const ADSENSE_PAGES: readonly string[] = ["/"];

/** Path prefixes that never load the ad script (R252), kept as a second guard behind ADSENSE_PAGES; each matches the path itself and anything under it. */
export const ADSENSE_PRIVATE_PATHS: readonly string[] = ["/admin", "/orders", "/track", "/studio"];

/** R251: the Vercel production deployment only. */
export function adsenseEnabled(env: Env = process.env): boolean {
  return env.VERCEL_ENV?.trim() === "production";
}

/** Whether the document at `pathname` carries the tag (R251, R252, R257). */
export function adsenseOnFor(pathname: string | null | undefined, env: Env = process.env): boolean {
  if (!adsenseEnabled(env) || !pathname || !ADSENSE_PAGES.includes(pathname)) return false;
  return !ADSENSE_PRIVATE_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * R253: CSP sources added to img-src, connect-src and frame-src while the tag is on. script-src
 * needs nothing: 'strict-dynamic' trusts what the nonced adsbygoogle.js loads (observed on www,
 * 2026-10-24). These are for when ads serve: Google's ad frames, beacons and fraud checks. Wildcards
 * only on Google's ad-only domains; google.com and gstatic.com hosts are named one by one, so no
 * general Google host (for example one serving user content) is admitted.
 */
export const ADSENSE_CSP_SOURCES: readonly string[] = [
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.adtrafficquality.google",
  "https://*.googleadservices.com",
  "https://www.google.com",
  "https://adservice.google.com",
  "https://fundingchoicesmessages.google.com",
  "https://csi.gstatic.com",
];

const AD_DOMAINS = ["googlesyndication.com", "doubleclick.net", "adtrafficquality.google", "googleadservices.com"];
const AD_HOSTS = new Set(["adservice.google.com", "fundingchoicesmessages.google.com", "csi.gstatic.com"]);

/** Whether an https address belongs to Google's ad serving (R255: how verify:deployment files a console message). */
export function isAdScriptUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return AD_HOSTS.has(host) || AD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
