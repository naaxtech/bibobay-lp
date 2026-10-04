import { LandingPage } from "@/components/landing/LandingPage";
import { getLandingPage, getSiteSettings } from "@/lib/sanity/fetch";

// Both reads fall back to safe, claim-free content when Sanity is unconfigured or unreachable.
export default async function Home() {
  const [content, settings] = await Promise.all([getLandingPage(), getSiteSettings()]);
  return <LandingPage content={content} settings={settings} />;
}
