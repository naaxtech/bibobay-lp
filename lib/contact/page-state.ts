import type { SiteSettings } from "@/lib/content/types";

/**
 * What /contact shows (R158, R161). The form while it is open; otherwise the CMS contact address as
 * a mailto link when one is set; otherwise a closed notice. Pure, so the metadata and the sitemap
 * can use it without reaching the server-only availability check: callers pass `open` in.
 */
export type ContactPageState = { kind: "form" } | { kind: "email"; email: string } | { kind: "closed" };

export function contactPageState(open: boolean, settings: Pick<SiteSettings, "contactEmail">): ContactPageState {
  if (open) return { kind: "form" };
  return settings.contactEmail ? { kind: "email", email: settings.contactEmail } : { kind: "closed" };
}
