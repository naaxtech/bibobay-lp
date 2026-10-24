"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Ruling R257: Google's ad script loads with a document, and a client-side navigation keeps it
 * running, so an anchor ad opened on the home page would follow a visitor onto the contact form or
 * a 404 page (Google Publisher Policies: no ads on screens without publisher content). Mounted only
 * with the tag (components/ads/AdSenseTag.tsx), this reloads the document once the path leaves the
 * ad pages; the server then answers the new page without the tag. In-page anchors keep the path, so
 * they never reload. `reload` is injectable for tests.
 */
export function AdPageGuard({ pages, reload = () => window.location.reload() }: { pages: readonly string[]; reload?: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && !pages.includes(pathname)) reload();
  }, [pathname, pages, reload]);
  return null;
}
