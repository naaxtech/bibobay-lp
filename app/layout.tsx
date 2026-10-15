import type { Metadata } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { analyticsConfig } from "@/lib/analytics/config";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { atRequestTime } from "@/lib/next/request-time";

// src: https://nextjs.org/docs/app/api-reference/components/font#css-variables · next 16.3.8 · 2026-10-04
// Self-hosted at build time (no request to Google at runtime); globals.css maps these variables
// into --bibo-font-display / --bibo-font-body with system fallbacks.
const displayFace = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const bodyFace = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta", display: "swap" });

/*
 * Ruling R36: each page sets its own metadata from Sanity (app/page.tsx `generateMetadata`, the legal
 * and thank-you pages). This is only the default for routes without any (the 404 page), taken from
 * the repository fallback settings. The favicon comes from app/icon.svg, generated from the canonical
 * logo; the share image from app/opengraph-image.tsx.
 */
export const metadata: Metadata = {
  title: SAFE_FALLBACK_SETTINGS.title,
  description: SAFE_FALLBACK_SETTINGS.description,
};

/**
 * Ruling R34: the CSP nonce is made per request (proxy.ts), and Next can only stamp it on the scripts
 * of a page rendered for that request. This renders nothing; awaiting `connection()` makes every page
 * under the root layout (including the 404 page) render at request time. Sanity reads stay in the
 * Data Cache under their tags, so a request costs a render, not a CMS call.
 * src: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md#forcing-dynamic-rendering · next 16.3.8 · 2026-10-13
 */
async function RenderPerRequest() {
  await atRequestTime();
  return null;
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${displayFace.variable} ${bodyFace.variable}`}>
      <body>
        <RenderPerRequest />
        {children}
        {/* Ruling R70: cookieless visit statistics on every page; nothing without a PostHog key. */}
        <AnalyticsProvider config={analyticsConfig()} />
      </body>
    </html>
  );
}
