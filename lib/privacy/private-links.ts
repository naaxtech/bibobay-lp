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
 * after an origin (`https://host`), or after a space, quote, bracket or `=`. `/api/orders/track` and
 * other paths that merely contain "orders" are left alone.
 */
const ORDER_TOKEN_SEGMENT = /(^|[\s"'(=]|[a-z][a-z0-9+.-]*:\/\/[^/\s"'?#]+)\/orders\/[^/?#\s"'<>&]+/gi;

/** The text with every private order token replaced by "[token]". */
export function maskPrivatePaths(value: string): string {
  return value.replace(ORDER_TOKEN_SEGMENT, `$1${ORDER_LINK_ROUTE}`);
}
