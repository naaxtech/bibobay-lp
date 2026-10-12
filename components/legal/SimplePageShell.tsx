import Link from "next/link";
import type { ReactNode } from "react";

import { BiboLogo } from "@/components/brand/BiboLogo";
import { Footer } from "@/components/landing/Footer";
import { UI_COPY } from "@/components/landing/ui-copy";
import { GsapProvider } from "@/components/motion/GsapProvider";
import { PreviewNotice } from "@/components/preview/PreviewNotice";
import type { SiteSettings } from "@/lib/content/types";

export interface SimplePageShellProps {
  settings: SiteSettings;
  title: string;
  /** Draft mode (ruling R33): shows the preview notice with its exit link. */
  preview: boolean;
  children: ReactNode;
}

/**
 * The frame for a short reading page (privacy, terms, thank-you): skip link, a header with the
 * canonical logo linking home, one level-one heading on paper, and the site footer. Inside the
 * motion layer, so buttons keep their tactile press like on the landing page.
 */
export function SimplePageShell({ settings, title, preview, children }: SimplePageShellProps) {
  return (
    <GsapProvider>
      <a href="#main-content" className="skip-link">
        {UI_COPY.skipToContent}
      </a>
      {preview ? <PreviewNotice /> : null}
      <header className="site-header" data-site-header>
        <div className="landing-container flex h-full items-center">
          <Link href="/" className="site-header__home">
            <BiboLogo priority className="w-[7.75rem] lg:w-[8.5rem]" />
          </Link>
        </div>
      </header>
      <main id="main-content" className="simple-page" data-ground="paper">
        <article className="landing-container simple-page__sheet">
          <h1 className="simple-page__title">{title}</h1>
          {children}
        </article>
      </main>
      <Footer settings={settings} />
    </GsapProvider>
  );
}
