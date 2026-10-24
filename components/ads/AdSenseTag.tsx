import { headers } from "next/headers";

import { ADSENSE_PAGES, ADSENSE_SCRIPT_SRC, adsenseOnFor } from "@/lib/ads/adsense";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { NONCE_HEADER, PATHNAME_HEADER } from "@/lib/security/headers";

import { AdPageGuard } from "./AdPageGuard";

/**
 * Whether this document carries the AdSense tag: a production ad page (R251, R252, R257), and not
 * Sanity draft mode, so editors' previews in Presentation never count as ad impressions.
 */
async function adsenseRequest(): Promise<{ on: boolean; nonce: string | undefined }> {
  const request = await headers();
  const on = adsenseOnFor(request.get(PATHNAME_HEADER), process.env) && !(await isDraftMode());
  return { on, nonce: request.get(NONCE_HEADER) || undefined };
}

/**
 * The AdSense snippet for the root layout's <head>: exactly the code AdSense gives, plus the
 * request's CSP nonce, which the policy requires of every script. A server component with no client
 * code. On any other request it renders nothing.
 */
export async function AdSenseTag() {
  const { on, nonce } = await adsenseRequest();
  if (!on) return null;
  return <script async src={ADSENSE_SCRIPT_SRC} crossOrigin="anonymous" nonce={nonce} />;
}

/** R257: for the root layout's <body>; mounts the leave guard exactly where the tag is rendered. */
export async function AdSenseLeaveGuard() {
  const { on } = await adsenseRequest();
  return on ? <AdPageGuard pages={ADSENSE_PAGES} /> : null;
}
