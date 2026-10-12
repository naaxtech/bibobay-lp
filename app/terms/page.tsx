import { LegalPage, legalPageMetadata } from "@/components/legal/LegalPage";

/** Ruling R30: Sanity terms, or the truthful repository fallback (noindex). */
export function generateMetadata() {
  return legalPageMetadata("terms");
}

export default function TermsPage() {
  return LegalPage({ kind: "terms" });
}
