import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIBO Bay — Bright minds. Kind hearts. Better humans.",
  description: "Meet BIBO Bay, a place for imagination, curiosity, and kindness.",
  openGraph: {
    title: "BIBO Bay",
    description: "Bright minds. Kind hearts. Better humans.",
    type: "website",
  },
  twitter: { card: "summary" },
  icons: { icon: "/bibo-logo.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
