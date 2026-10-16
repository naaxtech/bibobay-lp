import type { Metadata } from "next";

import { CtaLink } from "@/components/landing/CtaLink";
import { SimplePageShell } from "@/components/legal/SimplePageShell";
import { THANK_YOU_COPY } from "@/components/legal/legal-copy";
import { removalPhrase } from "@/lib/content/removal-copy";
import { removalChannelFrom } from "@/lib/leads/removal-channel";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getSiteSettings } from "@/lib/sanity/fetch";
import { seoEnvironment, thankYouMetadata } from "@/lib/seo/metadata";

/**
 * Ruling R31: the form never redirects here and a visit proves nothing, so this page explains the
 * list and points back to the form. It never says the visitor joined. Noindex, not in the sitemap.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return thankYouMetadata({ settings, seo: seoEnvironment(settings) });
}

export default async function ThankYouPage() {
  const preview = await isDraftMode();
  const settings = await getSiteSettings({ preview });
  const phrase = removalPhrase(removalChannelFrom(settings));
  const paragraphs = phrase ? [...THANK_YOU_COPY.paragraphs, THANK_YOU_COPY.removal(phrase)] : THANK_YOU_COPY.paragraphs;
  return (
    <SimplePageShell settings={settings} title={THANK_YOU_COPY.title} preview={preview}>
      <div className="prose-paper simple-page__prose">
        {paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <p className="simple-page__actions">
        <CtaLink cta={{ label: THANK_YOU_COPY.backToForm, href: "/#lead" }} variant="primary" />
        <CtaLink cta={{ label: THANK_YOU_COPY.backHome, href: "/" }} variant="text" />
      </p>
    </SimplePageShell>
  );
}
