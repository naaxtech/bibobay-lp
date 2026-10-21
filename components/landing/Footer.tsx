import { AnalyticsChoices } from "@/components/analytics/AnalyticsChoices";
import { BiboLogo } from "@/components/brand/BiboLogo";
import { analyticsConfig } from "@/lib/analytics/config";
import { YouTubeMark, isYouTubeHref } from "@/components/brand/YouTubeMark";
import { ORDER_COPY } from "@/components/forms/order-copy";
import { CONTACT_PATH } from "@/lib/contact/fields";
import { isCommerceEnabled, isTrackingEnabled } from "@/lib/commerce/gate";
import type { Cta, SiteSettings } from "@/lib/content/types";
import { CtaLink } from "./CtaLink";
import { SHOP_PATH } from "./sections";
import { UI_COPY } from "./ui-copy";

export interface FooterProps {
  settings: SiteSettings;
  /** The contact form is open (R190, `contactFormOpen()`); only then does the footer link to /contact. */
  contactOpen?: boolean;
}

/** The tracking page (Task 7c); it exists only while commerce and tracking are both on. */
const TRACK_PATH = "/track";

/**
 * Navy band with the canonical logo, the CMS footer copy and legal links, led by the shop link while
 * commerce is on (spec §10, Task 7b) and the tracking link while tracking is also on (Task 7c).
 * then the contact page link while its form is open (R190), before the legal links. Social links come
 * only from verified settings, and the contact address appears only when one is configured.
 */
export function Footer({ settings, contactOpen = false }: FooterProps) {
  const { footer, socialLinks, contactEmail } = settings;
  const analytics = analyticsConfig();
  const shop: Cta[] = isCommerceEnabled(settings) && !footer.legalLinks.some((link) => link.href === SHOP_PATH) ? [{ label: settings.navigation.commerceLabel, href: SHOP_PATH }] : [];
  const track: Cta[] = isTrackingEnabled(settings) && !footer.legalLinks.some((link) => link.href === TRACK_PATH) ? [{ label: ORDER_COPY.track.title, href: TRACK_PATH }] : [];
  const contact: Cta[] = contactOpen && !footer.legalLinks.some((link) => link.href === CONTACT_PATH) ? [{ label: footer.contactPageLabel, href: CONTACT_PATH }] : [];
  const links = [...shop, ...track, ...contact, ...footer.legalLinks];
  return (
    <footer className="site-footer" data-surface="navy">
      <div className="landing-container grid gap-x-12 gap-y-10 py-14 sm:py-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <BiboLogo className="w-36" />
          {footer.text ? <p className="mt-6 max-w-[38ch] text-(--footer-ink-soft)">{footer.text}</p> : null}
        </div>
        <div className="grid gap-8 sm:grid-cols-3 lg:col-span-6 lg:col-start-7">
          {links.length > 0 ? (
            <nav aria-label={UI_COPY.footerNavigation}>
              <ul className="grid gap-1">
                {links.map((link) => (
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
            // Review I2: Analytics choices stays, whatever an editor removes. It is the only way to turn
            // statistics off after a "yes", and to turn them on for a visitor who said no or whose
            // browser sends Global Privacy Control or Do Not Track (never asked by the notice, R147).
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
