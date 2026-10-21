import type { Metadata } from "next";

import { ContactForm } from "@/components/forms/ContactForm";
import { SimplePageShell } from "@/components/legal/SimplePageShell";
import { contactFormOpen } from "@/lib/contact/availability";
import { contactPageState } from "@/lib/contact/page-state";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { getContactPage, getSiteSettings } from "@/lib/sanity/fetch";
import { contactMetadata, seoEnvironment } from "@/lib/seo/metadata";

/** Draft-aware reads shared by the page and its metadata (Next dedupes the tagged fetches). */
async function load() {
  const preview = await isDraftMode();
  const [copy, settings] = await Promise.all([getContactPage({ preview }), getSiteSettings({ preview })]);
  return { preview, copy, settings, state: contactPageState(contactFormOpen(), settings) };
}

/** R158: the CMS SEO; indexable only while the page offers a way to reach the team (R161). */
export async function generateMetadata(): Promise<Metadata> {
  const { preview, copy, settings, state } = await load();
  return contactMetadata({ copy, settings, seo: seoEnvironment(settings), draft: preview, state });
}

/**
 * R158, R161: the form while it is open (Supabase and email sending are both configured, R173);
 * otherwise the CMS contact address as a mailto link, or a plain closed notice. Every string is CMS
 * copy with a repository fallback.
 */
export default async function ContactPage() {
  const { preview, copy, settings, state } = await load();
  return (
    <SimplePageShell settings={settings} title={copy.heading} preview={preview}>
      {state.kind === "closed" ? (
        <p className="simple-page__prose">{copy.closedMessage}</p>
      ) : (
        <div className="prose-paper simple-page__prose">
          <p>{copy.description}</p>
          {state.kind === "email" ? (
            <p>
              {copy.emailIntro}{" "}
              <a href={`mailto:${state.email}`} className="text-link">
                {state.email}
              </a>
            </p>
          ) : null}
        </div>
      )}
      {state.kind === "form" ? (
        <div className="simple-page__prose">
          <ContactForm copy={{ buttonLabel: copy.buttonLabel, successMessage: copy.successMessage, errorMessage: copy.errorMessage, closedMessage: copy.closedMessage }} />
        </div>
      ) : null}
    </SimplePageShell>
  );
}
