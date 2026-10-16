import { LegalPage, legalPageMetadata } from "@/components/legal/LegalPage";

/** Ruling R30: Sanity privacy text, or the truthful repository fallback (noindex). */
export function generateMetadata() {
  return legalPageMetadata("privacy");
}

export default function PrivacyPage() {
  return LegalPage({ kind: "privacy" });
}
