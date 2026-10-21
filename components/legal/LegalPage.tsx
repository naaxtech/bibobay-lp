import type { Metadata } from "next";

import { botCheckConfig } from "@/lib/bot-check/config";
import { contactFormOpen } from "@/lib/contact/availability";
import { getLegalSettings, getSiteSettings } from "@/lib/sanity/fetch";
import { isDraftMode } from "@/lib/sanity/draft-mode";
import { legalMetadata, legalPageState, seoEnvironment, type LegalKind } from "@/lib/seo/metadata";
import { LegalDocument } from "./LegalDocument";
import { SimplePageShell } from "./SimplePageShell";
import { LEGAL_PAGE_COPY } from "./legal-copy";

/** Draft-aware reads shared by the page and its metadata (Next dedupes the tagged fetches). */
async function load() {
  const preview = await isDraftMode();
  const [legal, settings] = await Promise.all([getLegalSettings({ preview }), getSiteSettings({ preview })]);
  return { preview, legal, settings };
}

export async function legalPageMetadata(kind: LegalKind): Promise<Metadata> {
  const { preview, legal, settings } = await load();
  return legalMetadata({ kind, legal, settings, seo: seoEnvironment(settings), draft: preview });
}

export async function LegalPage({ kind }: { kind: LegalKind }) {
  const { preview, legal, settings } = await load();
  return (
    <SimplePageShell settings={settings} title={LEGAL_PAGE_COPY[kind].title} preview={preview}>
      <LegalDocument kind={kind} legal={legal} state={legalPageState(kind, legal)} settings={settings} contactOpen={contactFormOpen()} botCheck={botCheckConfig(process.env).state === "on"} />
    </SimplePageShell>
  );
}
