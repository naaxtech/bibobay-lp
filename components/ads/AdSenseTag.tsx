import { headers } from "next/headers";

import { ADSENSE_SCRIPT_SRC, adsenseOnFor } from "@/lib/ads/adsense";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/security/headers";

/**
 * The AdSense snippet for the root layout's <head> (rulings R251, R252): exactly the code AdSense
 * gives, plus the request's CSP nonce, which the policy requires of every script. A server component
 * with no client code, so nothing ships in the page's scripts for it. Production public pages only;
 * on any other request it renders nothing.
 */
export async function AdSenseTag() {
  const request = await headers();
  if (!adsenseOnFor(request.get(PATHNAME_HEADER), process.env)) return null;
  const nonce = request.get(NONCE_HEADER) || undefined;
  return <script async src={ADSENSE_SCRIPT_SRC} crossOrigin="anonymous" nonce={nonce} />;
}
