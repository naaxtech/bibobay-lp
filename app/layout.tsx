import type { Metadata } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// src: https://nextjs.org/docs/app/api-reference/components/font#css-variables · next 16.3.8 · 2026-10-04
// Self-hosted at build time (no request to Google at runtime); globals.css maps these variables
// into --bibo-font-display / --bibo-font-body with system fallbacks.
const displayFace = Fredoka({ subsets: ["latin"], variable: "--font-fredoka", display: "swap" });
const bodyFace = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-plus-jakarta", display: "swap" });

// The favicon comes from app/icon.svg, generated from the canonical logo.
export const metadata: Metadata = {
  title: "BIBO Bay — Bright minds. Kind hearts. Better humans.",
  description: "Meet BIBO Bay, a place for imagination, curiosity, and kindness.",
  openGraph: {
    title: "BIBO Bay",
    description: "Bright minds. Kind hearts. Better humans.",
    type: "website",
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${displayFace.variable} ${bodyFace.variable}`}>
      <body>{children}</body>
    </html>
  );
}
