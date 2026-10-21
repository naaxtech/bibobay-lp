import { defineArrayMember, defineField, defineType } from "sanity";

import { orderConsentVersionProblem } from "../consent";
import { deliveryClaimProblem } from "../contact";
import { orderCountriesProblem } from "../countries";

export const siteSettings = defineType({ name: "siteSettings", title: "Site settings", type: "document", fields: [
  defineField({ name: "title", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "description", type: "text" }),
  defineField({ name: "canonicalUrl", title: "Verified canonical URL", type: "url", description: "Only add after ownership/DNS is verified." }),
  defineField({ name: "canonicalUrlVerified", title: "Canonical URL ownership verified", type: "boolean", initialValue: false }),
  defineField({ name: "seo", type: "seo" }),
  defineField({ name: "commerceEnabled", title: "Enable public commerce", description: "Before switching this on, a Vercel Pro plan and the 15-minute email schedule must be in place (docs/deployment.md).", type: "boolean", initialValue: false }),
  defineField({ name: "trackingEnabled", title: "Enable public order tracking", type: "boolean", initialValue: false }),
  defineField({
    name: "orderCountries",
    title: "Countries an order may be delivered to",
    description: "Two-letter ISO 3166-1 codes in capitals, such as GB or PH. Leave empty to list every country on the order form; the team quotes freight for each request.",
    type: "array",
    of: [defineArrayMember({ type: "string" })],
    options: { layout: "tags" },
    validation: (rule) => rule.custom((value) => orderCountriesProblem(value)),
  }),
  defineField({ name: "testimonialsEnabled", title: "Enable verified family experiences", type: "boolean", initialValue: false }),
  defineField({ name: "contactEmail", title: "Verified public contact email", type: "email" }),
  defineField({ name: "studioUrl", title: "Verified standalone Studio URL", type: "url" }),
  defineField({ name: "socialLinks", type: "array", of: [defineArrayMember({ type: "socialLink" })] }),
  defineField({ name: "navigation", type: "navigationSettings" }),
  defineField({ name: "footer", type: "footerSettings" }),
], initialValue: { commerceEnabled: false, trackingEnabled: false, testimonialsEnabled: false, canonicalUrlVerified: false, socialLinks: [], orderCountries: [] } });

export const landingPage = defineType({ name: "landingPage", title: "Landing page", type: "document", fields: [
  defineField({ name: "sections", title: "Order and visibility", type: "array", of: [defineArrayMember({ type: "landingSection" })], validation: (rule) => rule.custom((value) => {
    const ids = (value ?? []).map((entry) => (entry as { id?: string }).id).filter(Boolean);
    return new Set(ids).size === ids.length ? true : "Each section may appear only once";
  }) }),
  defineField({ name: "seo", type: "seo" }),
  defineField({ name: "hero", type: "heroSection" }),
  defineField({ name: "trust", type: "trustSection" }),
  defineField({ name: "promise", type: "promiseSection" }),
  defineField({ name: "charactersIntro", type: "sectionIntro" }),
  defineField({ name: "characters", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "character" }] })] }),
  defineField({ name: "episodesIntro", type: "episodesSectionIntro" }),
  defineField({ name: "episodes", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "episodePreview" }] })] }),
  defineField({ name: "offline", type: "offlineSection" }),
  defineField({ name: "pillarsIntro", type: "sectionIntro" }),
  defineField({ name: "pillars", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "brandPillar" }] })] }),
  defineField({ name: "ecosystemIntro", type: "sectionIntro" }),
  defineField({ name: "ecosystem", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "ecosystemEntry" }] })] }),
  defineField({ name: "testimonialsIntro", type: "sectionIntro" }),
  defineField({ name: "testimonials", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "testimonial" }] })] }),
  defineField({ name: "lead", type: "leadSection" }),
  defineField({ name: "faqIntro", type: "sectionIntro" }),
  defineField({ name: "faqs", type: "array", of: [defineArrayMember({ type: "reference", to: [{ type: "faqItem" }] })] }),
  defineField({ name: "finalCta", type: "finalCtaSection" }),
// No title field: without a preview the Studio would title it with its raw content.
], preview: { prepare: () => ({ title: "Landing page" }) } });

export const legalSettings = defineType({ name: "legalSettings", title: "Legal and consent", type: "document", fields: [
  defineField({ name: "privacy", type: "portableContent", description: "Requires counsel review before indexing." }),
  defineField({ name: "terms", type: "portableContent", description: "Requires counsel review before indexing." }),
  defineField({ name: "privacyVersion", type: "date" }), defineField({ name: "termsVersion", type: "date" }),
  defineField({ name: "consentCopyVersion", type: "string", validation: (rule) => rule.required() }),
  defineField({
    name: "orderConsentCopy",
    title: "Order form consent sentence",
    description: "The sentence a buyer ticks on the order form. Leave it and its version empty to use the site's built-in sentence.",
    type: "text",
    rows: 3,
    validation: (rule) => rule.max(500),
  }),
  defineField({
    name: "orderConsentCopyVersion",
    title: "Order consent version",
    description: "Stored with each order as the version of the order consent sentence the buyer agreed to. Change it whenever you change that sentence. A short token: letters, digits, . _ : - (at most 40 characters).",
    type: "string",
    validation: (rule) =>
      rule.custom((value, context) => orderConsentVersionProblem(value, (context.document as { orderConsentCopy?: unknown } | undefined)?.orderConsentCopy)),
  }),
], preview: { prepare: () => ({ title: "Legal and consent" }) } });

export const contactPage = defineType({ name: "contactPage", title: "Contact page", type: "document", fields: [
  defineField({ name: "seo", type: "seo", description: "The search and sharing title and description of the Contact page. The page is listed for search engines only while the contact form is open or a contact email is set." }),
  defineField({ name: "heading", type: "string", description: "The main heading at the top of the Contact page.", validation: (rule) => rule.required() }),
  defineField({ name: "description", type: "text", rows: 3, description: "The paragraph under the heading. Write it for parents, carers and professionals, and ask people to leave out details about a child." }),
  defineField({ name: "buttonLabel", type: "string", description: "The text on the form's submit button." }),
  defineField({
    name: "successMessage",
    type: "text",
    rows: 2,
    description: "Shown under the form after a message was saved. Say it was received. Do not say it was sent, emailed or delivered: nothing is emailed to the sender.",
    validation: (rule) => rule.custom((value) => deliveryClaimProblem(value)),
  }),
  defineField({ name: "errorMessage", type: "text", rows: 2, description: "Shown under the form when a message could not be saved." }),
  defineField({ name: "closedMessage", type: "text", rows: 2, description: "Shown on the Contact page, instead of the form, when the form is not open and no contact email is set. Also shown if the form closes while someone is writing." }),
  defineField({ name: "emailIntro", type: "string", description: "The line above the contact email when the form is not open. The address comes from Site settings, Verified public contact email." }),
// Named like the other singletons, not after whatever its heading says.
], preview: { prepare: () => ({ title: "Contact page" }) } });

export const singletonTypes = [siteSettings, landingPage, legalSettings, contactPage];
