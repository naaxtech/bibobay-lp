import { defineArrayMember, defineField, defineType } from "sanity";

const intro = () => [
  defineField({ name: "eyebrow", title: "Eyebrow", type: "string" }),
  defineField({ name: "heading", title: "Heading", type: "string" }),
  defineField({ name: "description", title: "Description", type: "text" }),
  defineField({ name: "image", title: "Image (optional)", type: "imageWithAlt" }),
];
const copyList = (name: string, title: string) => defineField({ name, title, type: "array", of: [defineArrayMember({ type: "string" })] });
const section = (name: string, title: string, fields: ReturnType<typeof defineField>[] = []) => defineType({ name, title, type: "object", fields: [...intro(), ...fields] });

export const imageWithAlt = defineType({
  name: "imageWithAlt", title: "Image with alt text", type: "image", options: { hotspot: true },
  fields: [
    defineField({ name: "decorative", title: "Decorative only (empty alt)", type: "boolean", initialValue: false }),
    defineField({ name: "alt", title: "Accessible description", type: "string", validation: (rule) => rule.custom((value, context) => (context.parent as { decorative?: boolean } | undefined)?.decorative === true || (typeof value === "string" && !!value.trim()) ? true : "Describe content images, or mark decorative to use empty alt.") }),
    defineField({ name: "caption", title: "Caption", type: "string" }),
  ],
});
export const cta = defineType({ name: "cta", title: "Call to action", type: "object", fields: [
  defineField({ name: "label", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "href", title: "URL or page anchor", type: "string", validation: (rule) => rule.required().custom((v) => !v || /^#[a-zA-Z][\w-]*$|^\/(?!\/)[\w/#?=&%-]*$|^https:\/\/[^\s]+$/.test(v) ? true : "Use an anchor, internal path or HTTPS URL") }),
  defineField({ name: "external", type: "boolean", initialValue: false }),
] });
export const seo = defineType({ name: "seo", title: "SEO", type: "object", fields: [
  defineField({ name: "title", type: "string" }), defineField({ name: "description", type: "text" }),
  defineField({ name: "image", type: "imageWithAlt" }), defineField({ name: "noIndex", type: "boolean", initialValue: false }),
] });
export const socialLink = defineType({ name: "socialLink", title: "Verified social link", type: "object", fields: [
  defineField({ name: "platform", type: "string", options: { list: ["instagram", "youtube", "facebook", "tiktok", "pinterest"] }, validation: (rule) => rule.required() }),
  defineField({ name: "url", type: "url", validation: (rule) => rule.uri({ scheme: ["https"] }).required() }),
  defineField({ name: "verified", title: "Official account verified by the team", type: "boolean", initialValue: false }),
] });
export const sectionTheme = defineType({ name: "sectionTheme", title: "Section colors", type: "object", fields: [
  defineField({ name: "background", type: "string", options: { list: ["paper", "sea", "sand", "navy"] } }),
  defineField({ name: "accent", type: "string", options: { list: ["teal", "yellow", "orange", "purple"] } }),
] });
export const portableContent = defineType({ name: "portableContent", title: "Rich text", type: "array", of: [defineArrayMember({ type: "block", styles: [{ title: "Normal", value: "normal" }, { title: "Heading", value: "h2" }, { title: "Subheading", value: "h3" }] })] });
export const commerceNotice = defineType({ name: "commerceNotice", title: "Commerce notice", type: "object", fields: [
  defineField({ name: "title", type: "string" }), defineField({ name: "body", type: "text" }), defineField({ name: "cta", type: "cta" }),
] });
export const sectionIntro = section("sectionIntro", "Section introduction");
export const landingSection = defineType({ name: "landingSection", title: "Ordered landing section", type: "object", fields: [
  defineField({ name: "id", type: "string", options: { list: ["hero", "trust", "promise", "characters", "episodes", "offline", "pillars", "ecosystem", "testimonials", "lead", "faq", "finalCta"] }, validation: (rule) => rule.required() }),
  defineField({ name: "visible", type: "boolean", initialValue: true }),
  defineField({ name: "theme", type: "sectionTheme" }),
], preview: { select: { title: "id", visible: "visible" }, prepare: ({ title, visible }) => ({ title, subtitle: visible === false ? "Hidden" : "Visible" }) } });
export const heroSection = section("heroSection", "Hero", [
  defineField({ name: "title", type: "string" }), defineField({ name: "primaryCta", type: "cta" }),
  defineField({ name: "secondaryCta", type: "cta" }), defineField({
    name: "artworkDescription",
    type: "text",
    description: "Names the drawn Bay scene, which shows only when the hero has neither an image of its own nor the channel's art (the channel's trio fills it by default). An uploaded image carries its own alt text.",
  }),
]);
export const trustSection = section("trustSection", "Trust strip", [copyList("items", "Factual principles")]);
export const promiseSection = section("promiseSection", "The BIBO promise", [defineField({ name: "quote", type: "string" }), defineField({ name: "body", type: "portableContent" })]);
export const episodesSectionIntro = section("episodesSectionIntro", "Story preview introduction", [defineField({ name: "conceptLabel", type: "string" })]);
export const offlineStep = defineType({ name: "offlineStep", title: "Screen to real-life step", type: "object", fields: [
  defineField({ name: "title", type: "string" }), defineField({ name: "description", type: "text" }),
] });
export const offlineSection = section("offlineSection", "From screen to real life", [defineField({ name: "steps", type: "array", of: [defineArrayMember({ type: "offlineStep" })] })]);
export const leadSection = section("leadSection", "Founding families", [
  defineField({ name: "buttonLabel", type: "string" }), defineField({ name: "consentCopy", type: "text" }),
  defineField({ name: "successMessage", type: "text" }), defineField({ name: "errorMessage", type: "text" }),
  defineField({ name: "leadMagnet", type: "reference", to: [{ type: "leadMagnet" }], description: "Only shown when available with a real downloadable file; no implied delivery." }),
]);
export const finalCtaSection = section("finalCtaSection", "Closing CTA", [defineField({ name: "cta", type: "cta" })]);
export const navigationSettings = defineType({ name: "navigationSettings", title: "Navigation", type: "object", fields: [
  defineField({ name: "links", type: "array", of: [defineArrayMember({ type: "cta" })] }),
  defineField({ name: "primaryCta", type: "cta" }), defineField({ name: "commerceLabel", type: "string" }),
] });
export const footerSettings = defineType({ name: "footerSettings", title: "Footer", type: "object", fields: [
  defineField({ name: "text", type: "text" }), defineField({ name: "legalLinks", type: "array", of: [defineArrayMember({ type: "cta" })] }),
  defineField({ name: "contactLabel", type: "string" }),
] });
export const objectTypes = [imageWithAlt, cta, seo, socialLink, sectionTheme, portableContent, commerceNotice, sectionIntro, landingSection, heroSection, trustSection, promiseSection, episodesSectionIntro, offlineStep, offlineSection, leadSection, finalCtaSection, navigationSettings, footerSettings];
