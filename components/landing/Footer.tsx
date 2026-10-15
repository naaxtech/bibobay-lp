import { AnalyticsChoices } from "@/components/analytics/AnalyticsChoices";
import { BiboLogo } from "@/components/brand/BiboLogo";
import { analyticsConfig } from "@/lib/analytics/config";
import { YouTubeMark, isYouTubeHref } from "@/components/brand/YouTubeMark";
import type { SiteSettings } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { UI_COPY } from "./ui-copy";

export interface FooterProps {
  settings: SiteSettings;
}

/**
 * Navy band with the canonical logo, the CMS footer copy and legal links. Social links come only
 * from verified settings, and contact appears only when an address is configured.
 */
export function Footer({ settings }: FooterProps) {
  const { footer, socialLinks, contactEmail } = settings;
  const analytics = analyticsConfig();
  return (
    <footer className="site-footer" data-surface="navy">
      <div className="landing-container grid gap-x-12 gap-y-10 py-14 sm:py-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <BiboLogo className="w-36" />
          {footer.text ? <p className="mt-6 max-w-[38ch] text-(--footer-ink-soft)">{footer.text}</p> : null}
        </div>
        <div className="grid gap-8 sm:grid-cols-3 lg:col-span-6 lg:col-start-7">
          {footer.legalLinks.length > 0 ? (
            <nav aria-label={UI_COPY.footerNavigation}>
              <ul className="grid gap-1">
                {footer.legalLinks.map((link) => (
                  <li key={`${link.href}-${link.label}`}>
                    <CtaLink cta={link} className="footer-link" />
                  </li>
                ))}
                <li>
                  <AnalyticsChoices config={analytics} />
                </li>
              </ul>
            </nav>
          ) : analytics ? (
            // Review I2: the only way to turn statistics off stays, whatever an editor removes.
            <ul className="grid gap-1">
              <li>
                <AnalyticsChoices config={analytics} />
              </li>
            </ul>
          ) : null}
          {socialLinks.length > 0 ? (
            <ul className="grid gap-1">
              {socialLinks.map((link) => (
                <li key={link.url}>
                  <a href={link.url} className="footer-link footer-link--social" target="_blank" rel="me noopener noreferrer">
                    {isYouTubeHref(link.url) ? <YouTubeMark /> : null}
                    {UI_COPY.socialPlatforms[link.platform]}
                    <span className="sr-only"> {UI_COPY.opensInNewTab}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {contactEmail ? (
            <div>
              <p className="text-(--footer-ink-soft)">{footer.contactLabel}</p>
              <a href={`mailto:${contactEmail}`} className="footer-link break-all">
                {contactEmail}
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
