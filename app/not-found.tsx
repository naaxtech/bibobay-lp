import type { Metadata } from "next";

import { CtaLink } from "@/components/landing/CtaLink";
import { SimplePageShell } from "@/components/legal/SimplePageShell";
import { NOT_FOUND_COPY } from "@/components/legal/legal-copy";
import { BIBO_YOUTUBE_CHANNEL_URL } from "@/lib/content/fallback";
import { getSiteSettings } from "@/lib/sanity/fetch";

/**
 * The page for an address the site does not have (review I2): branded, calm, a way home and to
 * the channel, and the site footer, so Analytics choices are offered here too. Next answers 404 and
 * marks it noindex itself.
 */
export const metadata: Metadata = { title: NOT_FOUND_COPY.title };

export default async function NotFound() {
  const settings = await getSiteSettings();
  return (
    <SimplePageShell settings={settings} title={NOT_FOUND_COPY.title} preview={false}>
      <div className="prose-paper simple-page__prose">
        {NOT_FOUND_COPY.paragraphs.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <p className="simple-page__actions">
        <CtaLink cta={{ label: NOT_FOUND_COPY.backHome, href: "/" }} variant="primary" />
        <CtaLink cta={{ label: NOT_FOUND_COPY.watch, href: BIBO_YOUTUBE_CHANNEL_URL, external: true }} variant="text" />
      </p>
    </SimplePageShell>
  );
}
