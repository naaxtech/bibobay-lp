import type { ReactNode } from "react";

import type { Cta, LandingPageContent, SiteSettings } from "@/lib/content/types";
import { Footer } from "./Footer";
import { Navbar } from "./Navbar";
import { SectionRenderer } from "./SectionRenderer";
import { SHOP_PATH, isReachable, linkContext, reachableCtas, renderableSections } from "./sections";
import { UI_COPY } from "./ui-copy";

export interface LandingPageProps {
  content: LandingPageContent;
  settings: SiteSettings;
  /** The founding-family form for the lead section; omitted, the section shows its CMS copy only. */
  leadForm?: ReactNode;
}

/** Header links: the CMS story anchors, plus the shop only while commerce is enabled. */
function navigationLinks(settings: SiteSettings): Cta[] {
  const links = [...settings.navigation.links];
  if (settings.commerceEnabled && !links.some((link) => link.href === SHOP_PATH)) {
    links.push({ label: settings.navigation.commerceLabel, href: SHOP_PATH });
  }
  return links;
}

/** The whole landing page: skip link, sticky header, CMS-ordered sections and footer. */
export function LandingPage({ content, settings, leadForm }: LandingPageProps) {
  const sections = renderableSections(content, settings);
  const links = linkContext(sections, settings);
  const primaryCta = isReachable(settings.navigation.primaryCta.href, links) ? settings.navigation.primaryCta : undefined;
  const heroShown = sections.some((section) => section.id === "hero");
  return (
    <>
      <a href="#main-content" className="skip-link">
        {UI_COPY.skipToContent}
      </a>
      <Navbar links={reachableCtas(navigationLinks(settings), links)} primaryCta={primaryCta} />
      <main id="main-content">
        {/* With the hero hidden in the CMS, the page still has exactly one level-one heading. */}
        {heroShown ? null : <h1 className="sr-only">{settings.title}</h1>}
        <SectionRenderer content={content} settings={settings} leadForm={leadForm} />
      </main>
      <Footer settings={settings} />
    </>
  );
}
