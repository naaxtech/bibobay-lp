import type { ReactNode } from "react";

import { isCommerceEnabled } from "@/lib/commerce/gate";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getSiteSettings } from "@/lib/sanity/fetch";
import { OrderPadProvider } from "./OrderPadProvider";

/**
 * The order pad for the commerce pages (Task 6 carry, spec §10 "Server gating"), mounted by the
 * app/(commerce) layout from the server and only while commerce is on (a literal `true`, lib/commerce/gate.ts). Off, the
 * pages render as they are: no provider, so no control finds a pad and the device is never read.
 * Draft mode reads the settings an editor previews, as the pages do.
 */
export async function OrderPadMount({ children }: { children: ReactNode }) {
  const settings = await getSiteSettings({ preview: await isDraftMode() });
  return isCommerceEnabled(settings) ? <OrderPadProvider>{children}</OrderPadProvider> : <>{children}</>;
}
