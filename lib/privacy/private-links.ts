/*
 * Private links (Task 7b, for Task 7c's /orders/[token] page). The order page carries a private
 * tracking token in its path, and anyone holding the link can see the order's status. So the token
 * never leaves the site through the services the site reports to: visit statistics
 * (lib/analytics/events.ts) and error reports (lib/observability/sentry-config.ts) replace it with
 * "[token]", and the page sends no referrer (lib/security/headers.ts). Relative imports only: the
 * security headers are read by next.config.ts, whose transpiler does not resolve "@/".
 */

/** The private order page's route, as Next names it and as reports show it. */
export const ORDER_LINK_ROUTE = "/orders/[token]";

/** next.config.ts `headers()` source for the private order pages. */
export const ORDER_LINK_SOURCE = "/orders/:path*";

/**
 * `/orders/<segment>` where `/orders` is the first segment of a path: at the start of the text, right
 * after an origin (`https://host`), or after any character that cannot belong to a path segment
 * (review Minor 2: `:`, `;`, `,`, a backtick, a bracket, `>`, a quote, a space…). A path character
 * before it (`/api/orders/track`, `/shop/orders/…`) means a longer path, which is left alone. An
 * already masked `/orders/[token]` stays as it is.
 */
const ORDER_TOKEN_SEGMENT = /(^|[^A-Za-z0-9._~%+-]|[a-z][a-z0-9+.-]*:\/\/[^/\s"'?#]+)\/orders\/(?!\[token\])[^/?#\s"'<>&`\],;)]+/gi;
/** The same path URL-encoded (`%2Forders%2F<segment>`), as in a `?next=` value or a digest. */
const ENCODED_ORDER_TOKEN_SEGMENT = /(^|[^A-Za-z0-9._~+-])%2Forders%2F(?!\[token\])[^/?#\s"'<>&%`\],;)]+/gi;

/**
 * A tracking token on its own: exactly 64 hex digits (lib/orders/fields.ts TRACKING_TOKEN_PATTERN),
 * wherever it appears (Task 7b re-review O2, O4: Next's router-state header, a host without a
 * scheme, a double-encoded path). Any run of 64 or more hex digits is masked whole: in URL-encoded
 * text the escape before a token ends in a hex digit (`%22`, `%2F`), so a boundary check would miss
 * it. Shorter ids (trace and span ids, commit hashes) are left alone.
 */
const TRACKING_TOKEN = /[0-9a-f]{64,}/gi;

/** The text with every private order token replaced by "[token]". */
export function maskPrivatePaths(value: string): string {
  const unhexed = value.replace(TRACKING_TOKEN, "[token]");
  // No order path at all: done, without running the path patterns over long text.
  if (!/orders/i.test(unhexed)) return unhexed;
  return unhexed
    .replace(ORDER_TOKEN_SEGMENT, `$1${ORDER_LINK_ROUTE}`)
    .replace(ENCODED_ORDER_TOKEN_SEGMENT, (match, before: string) => `${before}${match.slice(before.length, before.length + 12)}[token]`);
}
