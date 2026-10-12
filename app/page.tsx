import { LeadForm } from "@/components/forms/LeadForm";
import { LandingPage } from "@/components/landing/LandingPage";
import { getLandingPage, getSiteSettings } from "@/lib/sanity/fetch";

// Both reads fall back to safe, claim-free content when Sanity is unconfigured or unreachable.
export default async function Home() {
  const [content, settings] = await Promise.all([getLandingPage(), getSiteSettings()]);
  const { buttonLabel, consentCopy, successMessage, errorMessage } = content.lead;
  // The form always renders. Without Supabase the route answers 503 and the form shows the CMS
  // error message; success appears only once the server reports the signup stored.
  const leadForm = <LeadForm copy={{ buttonLabel, consentCopy, successMessage, errorMessage }} />;
  return <LandingPage content={content} settings={settings} leadForm={leadForm} />;
}
