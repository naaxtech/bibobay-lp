// Fixed singleton IDs; never query the first document by _type alone.
export const SITE_SETTINGS_QUERY = '*[_id == "siteSettings"][0]{...}';
export const LEGAL_SETTINGS_QUERY = '*[_id == "legalSettings"][0]{...}';
export const CONTACT_PAGE_QUERY = '*[_id == "contactPage"][0]{...}';
export const LANDING_PAGE_QUERY = `*[_id == "landingPage"][0]{
  ...,
  "characters": characters[]->,
  "episodes": episodes[]->,
  "pillars": pillars[]->,
  "ecosystem": ecosystem[]->,
  "testimonials": testimonials[]->{ "id": _id, quote, attribution, verified },
  "faqs": faqs[]->,
  "lead": lead{..., "leadMagnet": leadMagnet->}
}`;
export const LISTED_PRODUCTS_QUERY = `*[_type == "product" && status == "listed"] | order(order asc, name asc){
  name, description, details, images, status, order, seo, commerceNotice, sku, variant, pack,
  "id": _id, "category": category-> { "id": _id, name, "slug": slug.current, description, image, order },
  "slug": slug.current
}`;
export const PRODUCT_BY_SLUG_QUERY = `*[_type == "product" && slug.current == $slug][0]{
  name, description, details, images, status, order, seo, commerceNotice, sku, variant, pack,
  "id": _id, "category": category-> { "id": _id, name, "slug": slug.current, description, image, order },
  "slug": slug.current
}`;

/**
 * The order canonical reload (spec §10 step 5): published, listed products among the submitted ids,
 * with only what an order line snapshots. Drafts and release versions are excluded by id as well as
 * by the published perspective the caller reads with. No price is ever projected.
 */
export const ORDER_PRODUCTS_QUERY = `*[_type == "product" && _id in $ids && status == "listed" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{
  "id": _id, name, sku, variant, pack, status
}`;
