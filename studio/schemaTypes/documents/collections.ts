import { defineArrayMember, defineField, defineType } from "sanity";

const stringArray = (name: string, title: string) => defineField({ name, title, type: "array", of: [defineArrayMember({ type: "string" })] });
const art = () => defineField({ name: "image", title: "Artwork (when verified)", type: "imageWithAlt" });

export const character = defineType({ name: "character", title: "Bay friend", type: "document", fields: [
  defineField({ name: "name", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "species", type: "string" }), defineField({ name: "role", type: "string" }),
  defineField({ name: "description", type: "text" }), defineField({ name: "personality", type: "text" }),
  defineField({ name: "catchphrase", type: "string" }), defineField({ name: "favoriteActivity", type: "string" }),
  stringArray("teaches", "Values and interests"), art(),
  defineField({ name: "status", type: "string", options: { list: ["concept", "published"] }, initialValue: "concept" }),
  defineField({ name: "accentColor", type: "string", description: "CSS-compatible accent color; no hardcoded artwork required." }),
], preview: { select: { title: "name", subtitle: "status", media: "image" } } });
export const episodePreview = defineType({ name: "episodePreview", title: "Story preview", type: "document", fields: [
  defineField({ name: "title", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "summary", type: "text" }), defineField({ name: "characterFocus", type: "string" }),
  stringArray("learningFocus", "Possible themes"), defineField({ name: "offlinePrompt", type: "text" }), art(),
  defineField({ name: "mediaUrl", type: "url", description: "Only add finished, verified media after publication." }),
  defineField({ name: "status", type: "string", options: { list: ["concept", "published"] }, initialValue: "concept" }),
], preview: { select: { title: "title", subtitle: "status", media: "image" } } });
export const brandPillar = defineType({ name: "brandPillar", title: "BIBO value", type: "document", fields: [
  defineField({ name: "title", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "description", type: "text" }), stringArray("prompts", "Conversation starters"), art(),
] });
export const ecosystemEntry = defineType({ name: "ecosystemEntry", title: "Wider BIBO vision", type: "document", fields: [
  defineField({ name: "name", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "tagline", type: "string" }), defineField({ name: "description", type: "text" }),
  defineField({ name: "status", type: "string", options: { list: ["idea", "in-development", "available"] }, initialValue: "idea" }),
  art(), defineField({ name: "cta", title: "Only for verified available experiences", type: "cta" }),
], preview: { select: { title: "name", subtitle: "status" } } });
export const testimonial = defineType({ name: "testimonial", title: "Verified experience", type: "document", fields: [
  defineField({ name: "quote", type: "text", validation: (rule) => rule.required() }),
  defineField({ name: "attribution", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "verified", title: "Explicitly verified and cleared for publication", type: "boolean", initialValue: false }),
] });
export const faqItem = defineType({ name: "faqItem", title: "Question and answer", type: "document", fields: [
  defineField({ name: "question", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "answer", type: "text", validation: (rule) => rule.required() }),
] });
export const leadMagnet = defineType({ name: "leadMagnet", title: "Download (only when real)", type: "document", fields: [
  defineField({ name: "title", type: "string" }), defineField({ name: "description", type: "text" }),
  defineField({
    name: "fileUrl",
    title: "Verified download URL",
    type: "url",
    description: "An https file (public at its own address), or a repository PDF named /freebies/<name>.pdf, which lives in content/freebies and is offered only through the signed download after a signup (the activity pack is /freebies/bibo-bay-activity-pack.pdf).",
    validation: (rule) => rule.uri({ scheme: ["https"], allowRelative: true }).custom((value) => !value || /^https:\/\//.test(value) || /^\/freebies\/[a-z0-9][a-z0-9-]*\.pdf$/.test(value) || "Use an https URL or a /freebies/<name>.pdf path"),
  }),
  defineField({ name: "available", title: "File exists and may be offered", type: "boolean", initialValue: false, validation: (rule) => rule.custom((value, context) => value !== true || !!(context.document?.fileUrl) || "A real verified file URL is required before enabling this download") }),
] });
export const productCategory = defineType({ name: "productCategory", title: "Product category", type: "document", fields: [
  defineField({ name: "name", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "slug", type: "slug", options: { source: "name" }, validation: (rule) => rule.required() }),
  defineField({ name: "description", type: "text" }), art(),
  defineField({ name: "order", type: "number", initialValue: 0 }),
] });
export const product = defineType({ name: "product", title: "Enquiry catalogue product (no public prices)", type: "document", fields: [
  defineField({ name: "name", type: "string", validation: (rule) => rule.required() }),
  defineField({ name: "slug", type: "slug", options: { source: "name" }, validation: (rule) => rule.required() }),
  defineField({ name: "description", type: "text" }),
  defineField({ name: "details", type: "portableContent" }),
  defineField({ name: "images", type: "array", of: [defineArrayMember({ type: "imageWithAlt" })] }),
  defineField({ name: "category", type: "reference", to: [{ type: "productCategory" }] }),
  defineField({ name: "status", type: "string", options: { list: ["draft", "listed", "sold-out"] }, initialValue: "draft" }),
  // R80: what an order request snapshots (spec §10 step 5). Optional; no prices, ever.
  defineField({ name: "sku", title: "SKU", type: "string", description: "Stock code staff use for this product. Never shown with a price.", validation: (rule) => rule.max(64) }),
  defineField({ name: "variant", type: "string", description: "Size, colour or edition, when the product has one.", validation: (rule) => rule.max(120) }),
  defineField({ name: "pack", type: "string", description: "What one unit contains, e.g. \"Set of 3\".", validation: (rule) => rule.max(120) }),
  defineField({ name: "order", type: "number", initialValue: 0 }),
  defineField({ name: "seo", type: "seo" }),
  defineField({ name: "commerceNotice", type: "commerceNotice" }),
], preview: { select: { title: "name", subtitle: "status", media: "images.0" } } });

export const collectionTypes = [character, episodePreview, brandPillar, ecosystemEntry, testimonial, faqItem, leadMagnet, productCategory, product];
