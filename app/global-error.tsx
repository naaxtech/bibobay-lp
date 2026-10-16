"use client";

import { useEffect } from "react";

import { UI_COPY } from "@/components/landing/ui-copy";
import { sentryDsnFrom } from "@/lib/observability/sentry-dsn";

/**
 * The last-resort error page (Task 10M-a): a calm branded message with no internal detail, and a
 * report to Sentry when it is configured (scrubbed by the shared beforeSend). It replaces the root
 * layout, so it brings its own html and body and inline styles.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!sentryDsnFrom(process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#fffbf8", color: "#283b63", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 0.75rem" }}>{UI_COPY.globalError.title}</h1>
          <p style={{ margin: "0 0 1.5rem", color: "#4a5878" }}>{UI_COPY.globalError.body}</p>
          <button type="button" onClick={reset} style={{ font: "inherit", fontWeight: 600, padding: "0.75rem 1.5rem", borderRadius: "999px", border: 0, background: "#fdbb1f", color: "#283b63", cursor: "pointer" }}>
            {UI_COPY.globalError.retry}
          </button>
          <p style={{ marginTop: "1rem" }}>
            {/* A full page load on purpose: the app shell is what failed, so client navigation is not trusted here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#0c6b68" }}>
              {UI_COPY.globalError.home}
            </a>
          </p>
        </main>
      </body>
    </html>
  );
}
