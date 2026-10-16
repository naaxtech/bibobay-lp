/*
 * Staff paths in error reports (8c-M1). The staff pages and staff API routes carry an order
 * reference (`BB-xxxx-xxxx`) in the path, and a reference identifies a customer's order. Error
 * reports carry `/admin/orders/[reference]` and `/api/admin/orders/[reference]/...` instead, the
 * way the private order link carries `/orders/[token]` (lib/privacy/private-links.ts). Relative
 * imports only, like its neighbours.
 */

/** The staff order page's route, as Next names it and as reports show it. */
export const ADMIN_ORDER_ROUTE = "/admin/orders/[reference]";

/**
 * `/admin/orders/<segment>` or `/api/admin/orders/<segment>` where the path starts at the beginning
 * of the text, right after an origin (`https://host`), or after any character that cannot belong to a
 * path segment (a space, a quote, a bracket...). A path character before it (`/shop/admin/orders/...`)
 * means a longer path, which is left alone. An already masked `[reference]` stays as it is.
 */
const ADMIN_ORDER_SEGMENT = /(^|[^A-Za-z0-9._~%+-]|[a-z][a-z0-9+.-]*:\/\/[^/\s"'?#]+)((?:\/api)?\/admin\/orders)\/(?!\[reference\])[^/?#\s"'<>&`\],;)]+/gi;
/** The same path URL-encoded (`%2Fadmin%2Forders%2F<segment>`), as in a `?next=` value. */
const ENCODED_ADMIN_ORDER_SEGMENT = /(^|[^A-Za-z0-9._~+-])((?:%2Fapi)?%2Fadmin%2Forders)%2F(?!\[reference\])[^/?#\s"'<>&%`\],;)]+/gi;

/** The text with every staff order reference in a path replaced by "[reference]". */
export function maskAdminOrderPaths(value: string): string {
  // No staff order path at all: done, without running the path patterns over long text.
  if (!/admin(?:\/|%2f)orders/i.test(value)) return value;
  return value
    .replace(ADMIN_ORDER_SEGMENT, "$1$2/[reference]")
    .replace(ENCODED_ADMIN_ORDER_SEGMENT, "$1$2%2F[reference]");
}
