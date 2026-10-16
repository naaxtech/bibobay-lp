import type { ReactNode } from "react";

import type { SiteSettings } from "@/lib/content/types";
import { SiteFrame } from "./SiteFrame";

export interface SimplePageShellProps {
  settings: SiteSettings;
  title: string;
  /** Draft mode (ruling R33): shows the preview notice with its exit link. */
  preview: boolean;
  children: ReactNode;
}

/**
 * The frame for a short reading page (privacy, terms, thank-you, 404): the shared site frame
 * (./SiteFrame.tsx) around one level-one heading on a paper sheet.
 */
export function SimplePageShell({ settings, title, preview, children }: SimplePageShellProps) {
  return (
    <SiteFrame settings={settings} preview={preview} mainClassName="simple-page">
      <article className="landing-container simple-page__sheet">
        <h1 className="simple-page__title">{title}</h1>
        {children}
      </article>
    </SiteFrame>
  );
}
