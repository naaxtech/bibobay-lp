import type { Metadata } from "next";

import { LeadForm } from "@/components/forms/LeadForm";
import { LandingPage } from "@/components/landing/LandingPage";
import { PreviewNotice } from "@/components/preview/PreviewNotice";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getLandingPage, getSiteSettings } from "@/lib/sanity/fetch";
import { sanityImageUrl } from "@/lib/sanity/image";
import { homeMetadata, seoEnvironment, serializeJsonLd, structuredData } from "@/lib/seo/metadata";

/** Published content, or drafts while an editor previews from the Studio (ruling R33). */
async function load() {
  const preview = await isDraftMode();
  const [content, settings] = await Promise.all([getLandingPage({ preview }), getSiteSettings({ preview })]);
  return { preview, content, settings };
}

/** Ruling R36: landing SEO from Sanity, with the repository fallback when Sanity is absent. */
export async function generateMetadata(): Promise<Metadata> {
  const { preview, content, settings } = await load();
  const seoImage = content.seo.image ?? settings.seo.image;
  const url = sanityImageUrl(seoImage, 1200);
  return homeMetadata({ content, settings, seo: seoEnvironment(settings), draft: preview, ...(url && seoImage ? { image: { url, alt: seoImage.alt } } : {}) });
}

// Both reads fall back to safe, claim-free content when Sanity is unconfigured or unreachable.
export default async function Home() {
  const { preview, content, settings } = await load();
  const { buttonLabel, consentCopy, successMessage, errorMessage } = content.lead;
  // The form always renders. Without Supabase the route answers 503 and the form shows the CMS
  // error message; success appears only once the server reports the signup stored.
  const leadForm = <LeadForm copy={{ buttonLabel, consentCopy, successMessage, errorMessage }} />;
  return (
    <>
      {preview ? <PreviewNotice /> : null}
      {/* src: node_modules/next/dist/docs/01-app/02-guides/json-ld.md · next 16.3.8 · 2026-10-13. Organization and WebSite only (ruling R35); a data block, never executed. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData(settings, seoEnvironment(settings))) }} />
      <LandingPage content={content} settings={settings} leadForm={leadForm} />
    </>
  );
}
