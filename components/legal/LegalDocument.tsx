import { PortableText } from "@/components/landing/PortableText";
import type { SiteSettings } from "@/lib/content/types";
import { legalFallbackFor } from "@/lib/content/legal-fallback";
import type { LegalKind, LegalPageState } from "@/lib/seo/metadata";
import type { LegalSettings } from "@/lib/content/types";
import { LEGAL_PAGE_COPY } from "./legal-copy";

export interface LegalDocumentProps {
  kind: LegalKind;
  legal: LegalSettings;
  state: LegalPageState;
  settings: SiteSettings;
  /** The contact form is open (R196): the fallback privacy text then says what a message stores. */
  contactOpen?: boolean;
  /** The bot check is on (R222): the fallback privacy text then names Cloudflare Turnstile. */
  botCheck?: boolean;
  /** The AdSense tag is on (R254): the fallback privacy text then describes Google's advertising. */
  ads?: boolean;
}

/**
 * Ruling R30: the Sanity legal text when there is some; otherwise the repository fallback, under a
 * note saying it has not been reviewed. The fallback follows the commerce switch (Task 7b): it says
 * nothing is sold while commerce is off, and describes order requests while it is on. Only the
 * fallback privacy page adds the configured contact address: Sanity text carries its own.
 */
export function LegalDocument({ kind, legal, state, settings, contactOpen = false, botCheck = false, ads = false }: LegalDocumentProps) {
  if (state.source === "cms") {
    return (
      <>
        {state.indexable ? <p className="simple-page__meta">{LEGAL_PAGE_COPY.version(state.version)}</p> : null}
        <PortableText value={legal[kind]} headingLevel={2} className="prose-paper simple-page__prose" />
      </>
    );
  }
  return (
    <>
      <p role="note" className="simple-page__note">
        {LEGAL_PAGE_COPY.fallbackNote}
      </p>
      <PortableText value={legalFallbackFor(settings, process.env, contactOpen, botCheck, ads)[kind]} headingLevel={2} className="prose-paper simple-page__prose" />
      {kind === "privacy" && settings.contactEmail ? (
        <p className="simple-page__contact">
          {LEGAL_PAGE_COPY.contactLead}{" "}
          <a href={`mailto:${settings.contactEmail}`} className="text-link">
            {settings.contactEmail}
          </a>
          .
        </p>
      ) : null}
    </>
  );
}
