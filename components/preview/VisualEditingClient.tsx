"use client";

import { VisualEditing, type HistoryAdapter, type HistoryAdapterNavigate, type VisualEditingOptions } from "@sanity/visual-editing/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { changePreviewPerspective } from "@/lib/sanity/preview-actions";
import { createPreviewRefresher } from "./refresh";

/*
 * Click-to-edit overlays and live refresh for the Studio's Presentation tool (ruling R158), loaded
 * only by VisualEditingLoader inside the Studio. Its history adapter mirrors next-sanity's
 * (next-sanity 13.3.4 dist/VisualEditing.js): the Studio's address bar follows the page, and the
 * page follows the Studio's.
 */
export default function VisualEditingClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigate, setNavigate] = useState<HistoryAdapterNavigate | undefined>();

  const history = useMemo<HistoryAdapter>(() => ({
    subscribe: (next) => {
      setNavigate(() => next);
      return () => setNavigate(undefined);
    },
    update: (update) => {
      if (update.type === "push") router.push(update.url);
      else if (update.type === "replace") router.replace(update.url);
      else if (update.type === "pop") router.back();
    },
  }), [router]);

  useEffect(() => {
    const query = searchParams?.toString();
    navigate?.({ type: "push", url: `${pathname}${query ? `?${query}` : ""}` });
  }, [navigate, pathname, searchParams]);

  const refresh = useMemo(() => createPreviewRefresher(() => router.refresh()) as NonNullable<VisualEditingOptions["refresh"]>, [router]);

  return (
    <VisualEditing
      portal
      history={history}
      refresh={refresh}
      onPerspectiveChange={(perspective) => void changePreviewPerspective(perspective)}
      // Draft mode only: names any CMS field whose payload ends up in an attribute, <head> or a form value.
      onSuspiciousStega={(reports) => console.warn("[bibo] stega outside text", reports)}
    />
  );
}
