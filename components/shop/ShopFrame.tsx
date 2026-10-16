import type { ReactNode } from "react";

import { CtaLink } from "@/components/landing/CtaLink";
import { UI_COPY } from "@/components/landing/ui-copy";
import { SiteFrame } from "@/components/legal/SiteFrame";
import type { SiteSettings } from "@/lib/content/types";
import { ORDER_PATH } from "./catalogue";

/**
 * The shop's pages in the site frame, with the way to review the order in the header. The shop
 * renders only while commerce is on, so the link appears only then; it is not prefetched (CtaLink
 * prefetches only routes this site always serves).
 */
export function ShopFrame({ settings, preview, children }: { settings: SiteSettings; preview: boolean; children: ReactNode }) {
  return (
    <SiteFrame
      settings={settings}
      preview={preview}
      mainClassName="shop-page"
      headerAction={<CtaLink cta={{ label: UI_COPY.orderPad.review, href: ORDER_PATH }} variant="paper" className="shop-review" />}
    >
      {children}
    </SiteFrame>
  );
}
