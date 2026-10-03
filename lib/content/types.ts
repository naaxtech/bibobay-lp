export type PortableContent = Array<{ _type: "block"; _key?: string; style?: string; children?: Array<{ _type: "span"; text: string; marks?: string[] }>; markDefs?: unknown[] }>;
export interface ImageWithAlt { asset: { _ref: string }; alt: string; caption?: string; hotspot?: Record<string, number>; crop?: Record<string, number> }
export interface Cta { label: string; href: string; external?: boolean }
export interface Seo { title: string; description: string; image?: ImageWithAlt; noIndex?: boolean }
export interface SectionTheme { background?: "paper" | "sea" | "sand" | "navy"; accent?: "teal" | "yellow" | "orange" | "purple" }
export type SectionId = "hero" | "trust" | "promise" | "characters" | "episodes" | "offline" | "pillars" | "ecosystem" | "testimonials" | "lead" | "faq" | "finalCta";
export interface SectionConfig { id: SectionId; visible: boolean; theme?: SectionTheme }
export interface SectionIntro { eyebrow: string; heading: string; description: string; image?: ImageWithAlt }
export interface Character { id: string; name: string; species: string; role: string; description: string; personality: string; catchphrase: string; favoriteActivity: string; teaches: string[]; image?: ImageWithAlt; status: "concept" | "published"; accentColor?: string }
export interface EpisodePreview { id: string; title: string; summary: string; characterFocus: string; learningFocus: string[]; offlinePrompt: string; image?: ImageWithAlt; mediaUrl?: string; status: "concept" | "published" }
export interface BrandPillar { id: string; title: string; description: string; prompts: string[]; image?: ImageWithAlt }
export interface EcosystemEntry { id: string; name: string; tagline: string; description: string; status: "idea" | "in-development" | "available"; image?: ImageWithAlt; cta?: Cta }
export interface Testimonial { id: string; quote: string; attribution: string; verification: string; verified: boolean }
export interface FaqItem { id: string; question: string; answer: string }
export interface LeadMagnet { title: string; description: string; fileUrl?: string; available: boolean }
export interface ProductCategory { id: string; name: string; slug: string; description: string; image?: ImageWithAlt; order: number }
export interface CommerceNotice { title: string; body: string; cta?: Cta }
export interface Product { id: string; name: string; slug: string; description: string; details: PortableContent; images: ImageWithAlt[]; category?: ProductCategory; price?: number; currency?: string; status: "draft" | "listed" | "sold-out"; order: number; seo?: Seo; commerceNotice?: CommerceNotice }
export type SocialPlatform = "instagram" | "youtube" | "facebook" | "tiktok" | "pinterest";
export interface SocialLink { platform: SocialPlatform; url: string; verified: true }
export interface SiteSettings {
  title: string; description: string; canonicalUrl?: string; seo: Seo;
  commerceEnabled: boolean; trackingEnabled: boolean; testimonialsEnabled: boolean;
  contactEmail?: string; studioUrl?: string; socialLinks: SocialLink[];
  navigation: { links: Cta[]; primaryCta: Cta; commerceLabel: string };
  footer: { text: string; legalLinks: Cta[]; contactLabel: string };
}
export interface LandingPageContent {
  sections: SectionConfig[]; seo: Seo;
  hero: SectionIntro & { title: string; primaryCta: Cta; secondaryCta: Cta; artworkDescription: string };
  trust: SectionIntro & { items: string[] };
  promise: SectionIntro & { quote: string; body: PortableContent };
  charactersIntro: SectionIntro; characters: Character[];
  episodesIntro: SectionIntro & { conceptLabel: string }; episodes: EpisodePreview[];
  offline: SectionIntro & { steps: Array<{ title: string; description: string }> };
  pillarsIntro: SectionIntro; pillars: BrandPillar[];
  ecosystemIntro: SectionIntro; ecosystem: EcosystemEntry[];
  testimonialsIntro: SectionIntro; testimonials: Testimonial[];
  lead: SectionIntro & { buttonLabel: string; consentCopy: string; successMessage: string; errorMessage: string; leadMagnet?: LeadMagnet };
  faqIntro: SectionIntro; faqs: FaqItem[];
  finalCta: SectionIntro & { cta: Cta };
}
export interface LegalSettings { privacy: PortableContent; terms: PortableContent; privacyVersion?: string; termsVersion?: string; consentCopyVersion: string }
