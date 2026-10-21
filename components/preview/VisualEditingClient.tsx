"use client";

import { VisualEditing, type HistoryAdapter, type HistoryAdapterNavigate, type SuspiciousStegaReport, type VisualEditingOptions } from "@sanity/visual-editing/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { changePreviewPerspective } from "@/lib/sanity/preview-actions";
import { createPreviewRefresher } from "./refresh";
import { shareStyleNonce } from "./style-nonce";

// R169: before styled-components makes its first style sheet, which the CSP admits only with the nonce.
if (typeof document !== "undefined") shareStyleNonce(document);

/*
 * Click-to-edit overlays and live refresh for the Studio's Presentation tool (ruling R158), loaded
 * only by VisualEditingLoader inside the Studio. Its history adapter mirrors next-sanity's
 * (next-sanity 13.3.4 dist/VisualEditing.js): the Studio's address bar follows the page, and the
 * page follows the Studio's.
 */
/**
 * Draft mode inside the Studio only: names any CMS field whose edit link ended up outside text, in
 * an attribute, <head>, JSON-LD or a form value (R160, R167). Next's own payload scripts
 * (`self.__next_f`) carry every rendered text by design and are never shown, so they are skipped.
 */
function reportStegaLeaks(reports: SuspiciousStegaReport[]) {
  const leaks = reports.filter((report) => !(report.kind === "script" && isExecutableScript(report.element)));
  for (const report of leaks) {
    const field = report.sanity && "path" in report.sanity ? `${report.sanity.id} ${report.sanity.path}` : JSON.stringify(report.cleaned.slice(0, 60));
    console.warn(`[bibo] edit link outside text (${report.kind}${report.attribute ? ` ${report.attribute}` : ""}): ${field}`, report.element);
  }
}
const isExecutableScript = (element: Element | undefined) =>
  element instanceof HTMLScriptElement && (element.type === "" || element.type === "module" || element.type === "text/javascript");

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
      onSuspiciousStega={reportStegaLeaks}
    />
  );
}
