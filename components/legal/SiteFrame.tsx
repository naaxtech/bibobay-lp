import Link from "next/link";
import type { ReactNode } from "react";

import { BiboLogo } from "@/components/brand/BiboLogo";
import { Footer } from "@/components/landing/Footer";
import { UI_COPY } from "@/components/landing/ui-copy";
import { GsapProvider } from "@/components/motion/GsapProvider";
import { PreviewNotice } from "@/components/preview/PreviewNotice";
import type { SiteSettings } from "@/lib/content/types";
import { contactFormOpen } from "@/lib/contact/availability";

export interface SiteFrameProps {
  settings: SiteSettings;
  /** Draft mode (ruling R33): shows the preview notice with its exit link. */
  preview: boolean;
  /** Classes for the page's `<main>`, which sits on paper. */
  mainClassName: string;
  /** One call to action at the end of the header (the shop's order review), if any. */
  headerAction?: ReactNode;
  children: ReactNode;
}

/**
 * The frame every page but the landing page shares: skip link, the preview notice in draft mode, a
 * header with the canonical logo linking home, the page's `<main>` on paper, and the site footer,
 * which links to /contact while the contact form is open (R158).
 * Inside the motion layer, so buttons keep their tactile press like on the landing page.
 */
export function SiteFrame({ settings, preview, mainClassName, headerAction, children }: SiteFrameProps) {
  return (
    <GsapProvider>
      <a href="#main-content" className="skip-link">
        {UI_COPY.skipToContent}
      </a>
      {preview ? <PreviewNotice /> : null}
      <header className="site-header" data-site-header>
        <div className="landing-container flex h-full items-center justify-between gap-4">
          <Link href="/" className="site-header__home">
            <BiboLogo priority className="w-[7.75rem] lg:w-[8.5rem]" />
          </Link>
          {headerAction}
        </div>
      </header>
      <main id="main-content" className={mainClassName} data-ground="paper">
        {children}
      </main>
      <Footer settings={settings} contactOpen={contactFormOpen()} />
    </GsapProvider>
  );
}
