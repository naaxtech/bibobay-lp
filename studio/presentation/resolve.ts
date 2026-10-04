import { defineDocuments, defineLocations } from "sanity/presentation";

export const mainDocuments = defineDocuments([
  { route: "/", filter: '_id == "landingPage"' },
  { route: "/privacy", filter: '_id == "legalSettings"' },
  { route: "/terms", filter: '_id == "legalSettings"' },
  { route: "/shop", type: "siteSettings" },
  { route: "/shop/:slug", filter: '_type == "product" && slug.current == $slug' },
]);

const home = defineLocations({ locations: [{ title: "Landing page", href: "/" }] });
export const locations = {
  landingPage: home,
  siteSettings: defineLocations({ locations: [{ title: "Site", href: "/" }, { title: "Shop (when enabled)", href: "/shop" }] }),
  legalSettings: defineLocations({ locations: [{ title: "Privacy", href: "/privacy" }, { title: "Terms", href: "/terms" }] }),
  character: home, episodePreview: home, brandPillar: home, ecosystemEntry: home,
  testimonial: home, faqItem: home, leadMagnet: home,
  productCategory: defineLocations({ locations: [{ title: "Shop (when enabled)", href: "/shop" }] }),
  product: defineLocations({ select: { slug: "slug.current" }, resolve: (doc) => ({ locations: doc?.slug ? [{ title: "Product (when enabled)", href: `/shop/${encodeURIComponent(doc.slug)}` }] : [] }) }),
};
